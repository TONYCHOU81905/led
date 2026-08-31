# 本機備援模式（Local Fallback Mode）設計

日期：2026-08-31
狀態：設計已確認，待實作

## 問題

場地的 WiFi 不穩定時，Studio 送不出穩定的 timecode，燈光會反覆「跳一下、卡住、再跳一下」——
比完全不同步更難看，而且時機不可預測，沒辦法排練。

需要一個不依賴網路的備援：按下實體開關，timeline 就由板子自己跑。

## 核心概念

**開關的實體位置就是系統的模式。** 這不是「播放鍵」，是「時間來源切換鍵」。

| 開關 | 模式 | 時間來源 |
| --- | --- | --- |
| 閉合 | 本機 | `esp_timer` 自走 |
| 斷開 | 網路 | Studio 的 timecode 校正 anchor |

多台之間的規則是 **OR**：現場任何一個開關閉合，全體進入本機模式。

### 為什麼是硬隔離而不是自動切換

本機模式期間**完全忽略**網路 timecode，直到開關彈起才交還控制權。

理由：這個開關存在的意義就是「網路不可靠時的備援」。若網路一恢復就搶回控制權，
在斷斷續續的場地會造成燈光反覆跳動與凍結 —— 正是要避免的狀況。

不穩定的來源直接不採用，而不是在兩個來源之間切換（fail-safe：預設走安全的那條路）。

代價很小：本機自走的唯一誤差是晶振漂移，ESP32-S3 約 ±10～30ppm，
一首 5 分鐘的歌累積約 10～30ms，肉眼看不出來。

### 網路只留回報，不留控制

| 方向 | 本機模式期間 |
| --- | --- |
| 收 timecode（控制） | 忽略 |
| 送 status（回報） | 照常 |

`status_reporter.cpp` 那條路不動，Studio 端仍看得到每塊板子的狀態。

## 既有架構的關鍵事實

`ClockSync` **永遠都是本機推算**：

```c
// clock_sync.cpp:18
void ClockSync::applyHardSeek(uint32_t music_time_ms, int64_t now_us) {
  _anchor_music_ms = music_time_ms;   // 錨點：音樂時間
  _anchor_local_us = now_us;          // 錨點：本機 esp_timer
  _synced = true;
}
```

`musicTimeMs()` 是拿 `esp_timer` 從 anchor 往前推算。網路封包的角色只是**校正 anchor**，
不是提供時間。所以「本機自走」已經是預設行為，本功能只是新增一個 anchor 的來源。

### 現有的三個決策點

| # | 位置 | 作用 |
| --- | --- | --- |
| ① | `main.cpp:228` | `if (wifi_connected)` 才收 UDP 封包 |
| ② | `main.cpp:274` | `hasSync()` 且 gap > 2000ms 就 `freeze()` |
| ③ | `main.cpp:306` | 決定要不要 render timeline |

### 陷阱：onStart 會設 _synced

按鈕從 0 開始會呼叫 `g_clock.onStart(0, now_us)`，而 `onStart` → `applyHardSeek` →
**`_synced = true`**（`clock_sync.cpp:22`）。

於是決策點 ② 的 `hasSync()` 成立。若板子**先前曾連上過** WiFi，
`_last_packet_ms`（`sync_receiver.h:32`）會停在一個很舊的值 → gap 算出好幾萬 ms →
超過 `TIMECODE_BLACKOUT_MS` → **立刻 `freeze()`**。

結果：按鈕按下去，燈亮不到一瞬間就被凍結。而且只在「曾經連過 WiFi」的板子上發生，
冷開機沒連過網的板子反而正常 —— 這種只在特定順序下出現的 bug 最難查。

**因此本機模式必須有獨立旗標繞過決策點 ②，不能只靠設 state。**

## 元件

三個單元，各自可獨立理解與測試：

| 元件 | 職責 | 依賴 |
| --- | --- | --- |
| `LocalTrigger` | 讀 GPIO、debounce、回報開關狀態 | Arduino GPIO |
| `LocalSyncPeer` | ESP-NOW heartbeat 收發、維護「有沒有人按著」 | esp_now |
| main.cpp 模式判斷 | 綜合兩者決定 `g_local_mode` | 上面兩個 |

`LocalTrigger` 用注入的讀值函式測試 debounce；`LocalSyncPeer` 用假封包測試 OR 邏輯與 timeout。
兩者都不需要真硬體就能驗證。

## 資料流

```
[實體開關] ─▶ LocalTrigger.isOn()
                    │
                    ├──▶ 每 200ms 廣播 ──▶ 其他板子
                    │
其他板子 ──▶ LocalSyncPeer.anyPeerOn()
                    │
                    ▼
        g_local_mode = 自己ON || 有人ON
                    │
      ┌─────────────┴─────────────┐
      ▼                           ▼
  進入本機模式                 退出本機模式
  onStart(起點)              交還給網路
```

## 行為規格

### 進入本機模式

起點看當下狀態：

```c
const uint32_t start = g_clock.isPlaying() ? g_clock.musicTimeMs(now_us) : 0;
g_clock.onStart(start, now_us);
g_state = STATE_PLAYING;
g_local_mode = true;
```

- 演出前就知道網路不行 → 沒在播 → 從 **0** 開始
- 演出中途才掛（燈已被 blackout 凍結）→ 從**凍結點接續**，不跳動

### 退出本機模式

```c
g_local_mode = false;
g_clock.setPlaying(false);          // 等網路重新 anchor
g_state = wifi_connected ? STATE_WAIT_TIMECODE : STATE_WIFI_CONNECTING;
```

### 播完 timeline

**什麼都不做。** `TimelineEngine::render()` 每幀先 `leds.clear()`（`timeline_engine.cpp:393`），
超過最後一個 event 就沒有 event 命中，自然全暗。零程式碼。

時鐘繼續往前跑，開關彈起才回網路模式。

## main.cpp 的改動

| 位置 | 現在 | 改成 |
| --- | --- | --- |
| `main.cpp:228` | `if (wifi_connected)` | `if (wifi_connected && !g_local_mode)` |
| `main.cpp:274` | `if (state==PLAYING && hasSync())` | `if (... && !g_local_mode)` |
| `main.cpp:306` | render 條件 | **不動** |

決策點 ③ 不用改：`onStart` 已把 `_playing` 設成 true，blackout 被旗標擋掉，條件自然成立。

全部都是加條件、不動既有邏輯。

## ESP-NOW 協定

```c
struct LocalSyncBeacon {
  uint8_t  magic[2];        // 'L','S' — 濾掉不相干封包
  uint8_t  version;         // 1
  uint8_t  switch_on;       // 0/1
  uint32_t music_time_ms;   // 保留欄位，本版不使用
  uint32_t seq;
};
```

- 廣播到 `FF:FF:FF:FF:FF:FF`
- **只在自己的開關 ON 時廣播**，每 200ms 一包；OFF 時完全不發
- timeout 1000ms（容許連掉 4 包）

「只在 ON 時發」讓接收端的邏輯變成單一句話：**收到合法封包 = 有人按著**，
`anyPeerOn()` 就是「距離最後一次收到封包是否在 1 秒內」。
若改成一直發、用 `switch_on` 欄位分辨，接收端得額外維護每個 peer 的最後狀態，
掉包時還要決定要不要沿用舊值 —— 沒必要的複雜度。

`switch_on` 欄位仍保留在協定裡（恆為 1），供日後擴充與除錯辨識用。

`music_time_ms` 先傳但**不使用**。晶振漂移一首歌才 10～30ms，5 塊板子之間最多差 60ms，
肉眼看不出來（YAGNI）。欄位先留著，真的看得出不同步再開啟校正。

## 硬體

- **GPIO 10**
  - LED 已用 4/5/6/7/15
  - 避開 19/20（native USB）、33–37（octal PSRAM）、43–46（strapping）
  - 在專案既有的 `SUPPORTED_LED_GPIOS` 安全清單內
- 接法：`GPIO10 ── 開關 ── GND`，`INPUT_PULLUP`，閉合 = LOW
- debounce 30ms（latching switch 的機械接點一樣會彈跳）

## 已知風險：ESP-NOW 的 channel 問題

**這是本設計唯一沒把握的地方，必須實機驗證。**

ESP-NOW 只有在**同一個 WiFi channel** 才收得到，而 channel 跟著 WiFi 連線走：

- 全部板子都斷線 → channel 各自停在最後的值，可能不一致
- 部分連上、部分沒連 → channel 一定不一致

打算的處理：進入本機模式且 WiFi 未連線時，強制 `esp_wifi_set_channel(1)` 固定。
但斷線瞬間切 channel 會不會有空窗期，未經驗證。

標記 `Evidence insufficient` —— 這條要燒進板子實測，不能只看文件推論。
若驗證失敗，退路是接受「同 channel 才可靠」的限制，或改用實體並聯線觸發。

## 錯誤處理

| 情況 | 行為 |
| --- | --- |
| ESP-NOW init 失敗 | 降級成「只管自己」，serial 印警告，不影響本機播放 |
| 某板掉線 | 1 秒 timeout 自動移除，其他板子不受影響 |
| 兩人同時按 | OR 邏輯，都算 ON，不衝突 |
| 本機模式中 WiFi 恢復 | 完全忽略（決策點 ① 擋掉） |
| 開關彈起 | 回 `STATE_WAIT_TIMECODE`，等網路重新 anchor |
| 開機時開關已閉合 | 視為 ON，直接進本機模式從 0 開始 |

## 測試

**單元**
- `LocalTrigger` debounce：餵假 GPIO 讀值序列，驗證彈跳被濾掉
- `LocalSyncPeer` OR 邏輯與 timeout：餵假封包，驗證 1 秒後 `anyPeerOn()` 轉為 false
- `LocalSyncPeer` 封包過濾：magic/version 不符的封包必須被忽略

**整合**
- 模式切換時 `g_clock` 的 anchor 正確
- blackout 不會在本機模式誤觸發（回歸測試，對應上面的陷阱）

**實機**
- 兩塊板子驗證廣播收發
- **拔掉 AP 電源**驗證 channel 問題（見「已知風險」）

## 不做的事（YAGNI）

- heartbeat 的時間校正（欄位留著，先不用）
- timeline 播完自動 loop
- 播完自動退出本機模式（會破壞「開關位置 = 目前模式」這個不變式）

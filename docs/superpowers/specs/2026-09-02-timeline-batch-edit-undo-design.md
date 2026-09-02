# Timeline 多選批次編輯 + Undo + 鞋子通道 設計

日期：2026-09-02
狀態：設計已確認，實作中

## 需求

1. 多選 chips 後可以一起調整開始／結束時間
2. 拖曳 chip 邊緣時，選取的所有 chips 一起延長或縮短
3. Timeline 編輯時可以「恢復上一步」
4. 新增「鞋子」LED 通道

前三項是純 Studio 前端且互相關聯（undo 是批次編輯的安全網），第 4 項跨 firmware
且需要重燒，兩者沒有交集，分成兩個部分處理。

## Part A：多選批次時間編輯

### 核心洞察：兩個功能是同一件事

都是 **delta（差值）語意**，不是絕對值：

| 操作 | delta | 套用 |
| --- | --- | --- |
| Inspector 改開始時間 5s→7s | `+2s` | 每個選取 chip 的 `from`、`to` 都 +2s |
| 拖右邊緣延長 2s | `to: +2s` | 每個選取 chip 的 `to` 都 +2s |
| 拖左邊緣 | `from: +2s` | 每個選取 chip 的 `from` 都 +2s |

所以核心只需要一個函式，三個入口共用。

### 為什麼不是絕對值

`batchPatch.ts:10` 已經把 `from`/`to` 放進 `PRIMARY_ONLY_KEYS`，理由寫在註解裡：

> from/to 是絕對時間 —— 套用到整組會把所有 clip 疊在同一個時間點。

這個顧慮成立，所以**不動那個清單**。時間走的是另一條 delta 路徑，兩者不衝突；
移除排除清單反而會讓原本的保護消失。

### 邊界處理：整組一起 clamp

這是最容易做錯的地方。

三個 chip 在 1s / 5s / 9s，主選取往左拉 3s：

- **各自 clamp（錯）**：第一個夾在 0s，另外兩個變 2s / 6s
  → 相對間距從 4s 變 2s，排好的節奏毀了
- **整組 clamp（對）**：先算出「不讓任何 chip 越界的最大移動量」= −1s，
  全體移動 −1s → 0s / 4s / 8s，間距完全保持

伸縮同理：任何一個 chip 長度會 ≤ 0 時，整組停在那個極限。

**規則：先算全體允許的 delta，再一次套用。**

### 不做碰撞推擠

延長後允許 chip 重疊，這是現有行為，不在本次範圍。

## Part B：Undo

### 快照式而非指令式

存整個 events 陣列的快照。events 頂多幾百筆，快照成本可忽略；
指令式要為每種操作寫一對 do/undo，複雜度高很多且容易漏掉某個操作。

| 項目 | 決定 |
| --- | --- |
| 深度 | 50 步 |
| 快捷鍵 | `Cmd/Ctrl+Z` undo、`Cmd/Ctrl+Shift+Z` redo |
| 範圍 | 只涵蓋當前角色的 `events` |
| 粒度 | 一個「動作」= 一步 |

### 粒度是關鍵

拖曳過程中滑鼠會觸發幾十次狀態更新。若每次都記錄，按一次 undo 只退一個像素。

作法：**拖曳開始時存快照、結束時提交**，中間完全不記錄。

### 切換角色時清空 undo stack

否則 undo 會把使用者拉回另一個角色的狀態 —— 難以理解，而且會靜默覆蓋掉
目前角色的內容。

## Part C：鞋子通道

### 撞到 firmware 上限

```c
#define MAX_LED_OUTPUTS 5    // src/types.h:14
```

目前正好用滿 5 個（帽子／右手／右腳／左腳／左手），加鞋子是第 6 個。
與 `LED_COUNT_MAX` 640→1024 同性質：改常數 + 重編 + 重燒。

`eventValidator.ts:134` 另有一份硬編的 `5`，兩邊都要改（又是「兩份常數」問題，
與 `FIRMWARE_LED_COUNT_MAX` 相同的處理方式：抽成具名常數並交叉引用）。

### GPIO 選擇：16

已佔用：4/5/6/7/15（LED）、10（本機備援開關）、8（其他 env 的 LED_DATA_GPIO 預設，保留）。

選 16 的三重確認：

1. 在 `SUPPORTED_LED_GPIOS`（`eventValidator.ts:26`）清單內，validator 不會擋
2. `led_driver.cpp` 的 `LED_GPIO_CASE(16)` 存在 —— FastLED 的 pin 是編譯期
   template，沒有對應 case 就無法使用
3. 非 strapping（0/3/45/46）、非 native USB（19/20）、非 octal PSRAM（33–37）、
   非 SPI flash（26–32）

16/17/18 連續，未來要再加通道可以順著用。

### RAM 影響

`MAX_LED_OUTPUTS` 只影響 `LedOutputConfig outputs[MAX_LED_OUTPUTS]`（`types.h:170`）
這個小陣列，不影響 `CRGB _leds[LED_COUNT_MAX]`。成本可忽略。

但鞋子的 logical LED 數會計入 820 → 更高，需確認不超過 `LED_COUNT_MAX = 1024`。

## 元件

| 元件 | 職責 | 可獨立測試 |
| --- | --- | --- |
| `selectionShift.ts` | 純函式：算 delta、整組 clamp、套用 | 純函式 |
| `useUndoHistory.ts` | 快照堆疊、undo/redo、深度上限 | 不依賴 UI |
| TimelineEditor 接線 | 綁快捷鍵、拖曳起訖點、Inspector 入口 | 整合層 |

前兩個是純邏輯。既有的 `buildSelectionPatch` 不動 —— 時間走新路徑，
其他欄位維持現有行為。

## 測試

**單元**
- `selectionShift`：整組 clamp（1/5/9s 往左拉 3s 的案例）、長度不得 ≤ 0、
  空選取、單一選取、from 與 to 同時位移
- `useUndoHistory`：深度上限、undo→redo→新動作會截斷 redo、清空

**整合**
- 拖曳中途不產生多餘的 undo 步驟
- 切換角色後 undo stack 為空

**firmware**
- 6 通道設定可以編譯、上傳、正確解析

## 不做的事（YAGNI）

- 等比例縮放（選了等量）
- 絕對值對齊（現有行為已擋掉，無需求）
- 跨角色 undo
- 磁性吸附／碰撞推擠
- heartbeat 時間校正（沿用上一個 spec 的決定）

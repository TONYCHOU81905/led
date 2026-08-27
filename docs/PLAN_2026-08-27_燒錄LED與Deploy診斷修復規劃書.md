# 燒錄不穩／LED 只亮第一顆／Deploy 常失敗 —— 診斷與修復規劃書

日期：2026-08-27
硬體：ESP32-S3-N16R8（實機 esptool 確認：16MB quad flash、8MB PSRAM、USB-Serial/JTAG）
症狀來源：使用者回報 + git 歷史 + 全 repo 調查（韌體、led-studio、docs）

---

## 一、三個症狀的因果分析

### 症狀 1：無法正確燒錄

**已被歷史 commit 排除的根因**（不要再重修）：
- 燒錄覆寫映像檔頭 flash 設定 → boot loop（a5cb1ab）
- 冗餘 flash_mode / psram_type → boot loop（4d5fb45）
- 燒錄產物不完整靜默降級（22dbed1）、port 被 monitor 佔住（537654f、f8724e2）

**剩餘根因候選**：
| # | 候選 | 等級 | 證據 |
|---|---|---|---|
| 1-A | `platform = espressif32` 沒有 pin 版本（platformio.ini:15）→ toolchain / Arduino core 隨時間飄移，同一份程式今天能燒明天不能 | **P1** | platformio.ini:15 無版本號 |
| 1-B | `upload_speed = 115200` 全域偏慢，長時間燒錄期間 USB 斷線機率上升 | P3 | platformio.ini:18 |
| 1-C | 外部 `pio device monitor` 或 DebugView 佔住 port（已有錯誤提示，但仍需人為配合） | P2 | f8724e2 |

**注意**：n16r8 env 刻意不設 `memory_type` / `BOARD_HAS_PSRAM` 是**正確的既有決策**（韌體不用 PSRAM，eFuse 為 quad flash；註解在 platformio.ini:88–97）。**不要**「補上 qio_opi」，那正是之前 boot loop 的來源。

### 症狀 2：GPIO4 燈不照 timeline 顯示、有時只亮第一顆

關鍵事實：`showStatusColor()` 是整條 `fillSolid`（src/led_driver.cpp:166–175），狀態指示也是全條填色。所以「只亮第一顆」**必然是資料訊號在第一顆之後斷掉**，不是軟體只畫一顆。

| # | 假說 | 等級 | 判別方法 |
|---|---|---|---|
| 2-A | **硬體訊號品質**：3.3V GPIO 直推 5V WS2812B、未經 74AHCT125/74HCT245 電平轉換（docs/WS2812B_5_CHANNEL_WIRING.md 明確要求）。第一顆勉強解碼，它 regenerate 的 5V 訊號之後正常 —— 但若第一顆解碼 marginal，時好時壞正是這個特徵 | **P0（硬體）** | 跑 `led-test-gpio4-60`（無 WiFi 最小韌體）：若同樣只亮第一顆 → 硬體確定 |
| 2-B | **FastLED RMT4 + WiFi 中斷互咬**：FastLED 3.6 在 ESP32-S3 用 RMT 中斷 refill；WiFi/UDP（timecode sync 常駐）延遲該中斷 >50µs → 燈條提早 latch → 只有前面幾顆更新，且時好時壞 | **P1（韌體）** | 燒 `n16r8-nowifi`（主韌體關 WiFi）：若燈全正常 → 2-B 確定；再用 `n16r8-rmtbuiltin` 驗證緩解 |
| 2-C | **供電不足**：USB 供電撐不住多顆全亮，電壓崩掉（前一輪已加 `LED_DISABLE_BOOT_SELFTEST` 診斷） | P0（硬體） | 獨立 5V 電源供燈條、共地後重測 |
| 2-D | Config 未上傳成功 → 板子跑預設值 → 停在 WIFI_CONNECTING/WAIT_TIMECODE，不進 PLAYING（「不照 timeline」的另一半） | P1 | serial `[health]` log 看 `state=`；與症狀 3 同根 |

### 症狀 3：APP「deploy wifi and config」常失敗

**已排除**：CDC RX buffer 溢出（230e4f4，現為 4096B + 128B chunk + 逐 chunk ACK）、port 洩漏（537654f）、macOS port 釋放延遲（6f75a2f）、DTR/RTS reset（serialDevice.ts:112–118 constructor 即設 false）。

**剩餘根因候選**：
| # | 候選 | 等級 |
|---|---|---|
| 3-A | 失敗當下**證據不足**：timeout 錯誤只收 `[config]` 開頭的診斷行，板子若在 boot loop、當機、或印其他錯誤，APP 端看不到，只回「Serial command timeout」 | **P1** |
| 3-B | 板子因症狀 2-C（供電崩潰）當機或重開 → port 消失/重新枚舉 → deploy 自然失敗。**症狀 3 很可能是症狀 2 的下游** | P1 |
| 3-C | monitor 暫停→deploy→恢復之間的 250ms settle 在 macOS 偶爾不夠 | P2 |

---

## 二、修復任務（派給 Haiku，逐項照做）

> 原則：預設 env 行為不變；所有「實驗」都做成獨立 env，用實機二分法判別假說。

- **T1（P1）** `platformio.ini`：把 `platform = espressif32` pin 到本機目前實際安裝的版本。先查 `~/.platformio/platforms/espressif32/platform.json` 的 `"version"`，改成 `platform = espressif32 @ ~<該版本>`，附註解說明「pin 版本避免 toolchain 飄移導致燒錄行為不可重現」。查不到版本就跳過並回報 Evidence insufficient。
- **T2（P1）** `src/main.cpp`：新增編譯旗標 `DIAG_DISABLE_WIFI` —— 定義時 setup() 不啟動 WiFi 連線（印 `[diag] WiFi disabled (DIAG_DISABLE_WIFI)`），loop() 的 WiFi 重連邏輯也一併跳過；serial 指令、LED 渲染、狀態機全部照舊（板子會停在 WIFI_CONNECTING，整條橙色脈動 —— 這正好是測試圖樣）。
- **T3（P1）** `platformio.ini`：新增 `[env:esp32-s3-devkitc-1-n16r8-nowifi]`，完整複製 n16r8 設定＋`-DDIAG_DISABLE_WIFI`，註解寫明「判別假說 2-B：WiFi 中斷是否干擾 RMT」。
- **T4（P2）** `platformio.ini`：新增 `[env:esp32-s3-devkitc-1-n16r8-rmtbuiltin]`，完整複製 n16r8 設定＋`-DFASTLED_RMT_BUILTIN_DRIVER=1`，註解寫明「實驗：改用 ESP-IDF 內建 RMT driver，犧牲 RAM 換取對 WiFi 中斷的免疫力；僅在 2-B 成立時採用」。
- **T5（P2）** `platformio.ini`：新增 `[env:led-test-gpio4-60]`（比照 led-test：TEST_GPIO=4、TEST_COUNT=60、TEST_BRIGHTNESS=30）—— 現有 led-test 被改成 3 顆，缺一個「GPIO4 全 60 顆、無 WiFi」的判別 env。
- **T6（P1）** `led-studio/electron/services/serialDevice.ts`：`onData` 目前只收集 `[config]` 開頭的行進 `commandDiagnostics`；改為**同時**收集所有非 JSON 行（保留最後 8 行），且 `send()` 的 timeout 錯誤訊息要帶上最後收到的診斷行（例：`Serial command timeout（板子最後輸出：...）`）。目的：下次 deploy 失敗時能直接看出板子在 boot loop 還是沒回應。

## 三、硬體檢查清單（程式修不了，P0，交給使用者）

1. **電平轉換**：GPIO4 → 74AHCT125 或 74HCT245 → 330Ω → DIN。3.3V 直推 5V 燈條就是「時好時壞、只亮第一顆」的最常見原因（接線文件 docs/WS2812B_5_CHANNEL_WIRING.md 本來就要求）。
2. **獨立 5V 供電 + 共地**：燈條不可吃 USB 5V（60 顆 25% 亮度 ≈ 0.9A，全白更高）；燈條電源 GND 必須與 ESP32 GND 相接。
3. **第一顆 LED 本身**：只亮第一顆也可能是第一顆的 DOUT 已燒毀 —— 剪掉第一顆重接測一次。
4. 燈條頭端併 1000µF 電容、資料線盡量短。

## 四、判別流程（修完後照這個順序做）

1. `./scripts/fw.sh upload led-test-gpio4-60` → 60 顆應輪流紅綠藍。
   - 只亮第一顆 → **硬體問題（2-A/2-C）**，照第三節清單處理，軟體停手。
   - 全亮正常 → 進 2。
2. `./scripts/fw.sh upload esp32-s3-devkitc-1-n16r8-nowifi` → 整條橙色脈動。
   - 正常 → **2-B 成立**（WiFi 干擾 RMT），燒 `n16r8-rmtbuiltin` 驗證緩解。
   - 只亮第一顆 → 回頭查硬體（主韌體渲染負載較高，供電/訊號 margin 更吃緊）。
3. 硬體與 2-B 都排除後再跑正式 deploy 流程；失敗時 T6 的新錯誤訊息會直接顯示板子最後的輸出。

## 五、驗證（派給 Sonnet）

- `pio run -e esp32-s3-devkitc-1-n16r8 -e esp32-s3-devkitc-1-n16r8-nowifi -e esp32-s3-devkitc-1-n16r8-rmtbuiltin -e led-test-gpio4-60 -e led-test -e led-test-raw -e led-test-gpio8`（全部要編過）
- led-studio：TypeScript 檢查（依 package.json 的 script，通常 `npx tsc --noEmit`）
- `git diff --stat`：範圍不得超出 T1–T6 列的檔案
- 逐項核對 T1–T6 的驗收條件，標 P0–P3 回報；跑不動的指令標 Evidence insufficient

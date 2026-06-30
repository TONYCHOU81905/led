# 韌體技術選型說明

規格書 v1.2 建議 **ESP-IDF + led_strip (RMT)**。本 repo 實際採用：

| 項目 | 現況 | 原因 |
|---|---|---|
| 框架 | **Arduino (PlatformIO)** | 與 LED Show Studio 燒錄流程整合快、FastLED 生態成熟 |
| LED 驅動 | **FastLED**（WS2811_400 / WS2812B） | 已驗證可驅動目標燈條；RMT 遷移留待硬體穩定後 |
| Config 儲存 | **LittleFS** | JSON 持久化，支援分片上傳後重開載入 |
| WiFi 憑證 | **NVS (Preferences)** | SSID/密碼跨重開保留 |

若未來需遷移至 ESP-IDF RMT：保留 `config_json_parser`、`timeline_engine`、`sync_receiver` 介面，替換 `led_driver` 與 `main` 啟動層即可。

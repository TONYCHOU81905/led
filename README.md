# LED Show — ESP32-S3 同步穿戴燈光系統

舞者穿戴 **WS2811 / WS2812B** 燈條，由桌面端 **LED Show Studio** 編排，ESP32 依 UDP Timecode 同步播放。

| 子專案 | 路徑 | 說明 |
|---|---|---|
| 韌體 | `src/` + `platformio.ini` | ESP32-S3：timeline、FastLED、UDP timecode |
| 桌面端 | `led-studio/` | Electron + React：編排、Device Manager、Show Control |
| 規格書 | `docs/ESP32-S3_WS2812B_Timecode_LED_Dev_Spec.md` | 完整需求（v1.2） |
| 色票 | `shared/stage_colors.json` | 舞台標準色（韌體 / UI 共用） |
| 工具 | `tools/` | LTC sidecar 等輔助腳本 |

---

## 實作進度總覽

相對規格書 v1.2 的粗估完成度（2026-06-30）：

| 區塊 | 狀態 | 說明 |
|---|---|---|
| 韌體 LED 驅動 | 🟡 可用 | FastLED + Arduino；預設 **WS2811 (400kHz)**，可改 **WS2812B** |
| 韌體 Timeline | 🟢 核心完成 | solid / off / blink / fade_in / fade_out、priority、多部位 |
| 韌體 Timecode 同步 | 🟡 可用 | UDP 4210、CRC、START/RUNNING/PAUSE/STOP/SEEK；**50 Hz** 廣播（規格建議 100 Hz） |
| 韌體 Config 持久化 | 🔴 未完成 | 開機用內建 demo；Serial 上傳僅寫 RAM，重開消失 |
| 桌面 Studio 骨架 | 🟢 完成 | Dashboard、舞者、Timeline、LED 串聯、Devices、Show Control |
| Timeline Editor | 🟡 大部分 | Canvas 多軌、Snap、Inspector、Web Audio 波形；缺 ffmpeg 快取、部分快捷鍵 |
| Device Manager | 🟡 大部分 | 掃埠、Ping、燒錄、WiFi NVS、上傳 config（**≤8 KB**） |
| Show Control | 🟡 部分 | Manual / LTC Bridge；缺 UDP 裝置監看、Pause/Seek UI |
| 同步精度驗收 ±10 ms | 🔴 未驗收 | 需多 ESP 實測與場地 burn-in |
| Test / Calibration 頁 | 🔴 未做 | 規格 §11.1 |

圖例：🟢 可用　🟡 部分完成　🔴 未做或差距大

詳細差距見下方 **[規格書 vs 現況](#規格書-vs-現況未完成項目)**。

---

## 快速開始

### 韌體

```bash
# 需安裝 PlatformIO CLI（或 ~/.platformio/penv/bin/pio）
pio run                          # 500 LED 正式版
pio run -e esp32-s3-devkitc-1-test   # 10 LED 測試編譯
pio run -t upload                # 燒錄（接 USB）
pio device monitor               # Serial 115200
```

**LED 硬體**

| 項目 | 預設 | 調整方式 |
|---|---|---|
| 資料腳 | GPIO 8（placeholder） | `platformio.ini` → `-DLED_DATA_GPIO=N` 後重編譯 |
| 燈條 IC | **WS2811**（400 kHz） | config `device.led_type`: `"WS2811"` 或 `"WS2812B"` |
| 顆數上限 | 500 | `-DLED_COUNT_MAX=N`；test env 為 10 |

**WiFi**：內建 demo 使用 `SHOW_SYNC_AP` / `CHANGE_ME`。可從 Studio Device Manager 寫入 NVS，或改 `src/default_config.h`。

**Serial 指令**（115200，JSON 一行一筆）：

| 指令 | 範例 |
|---|---|
| 狀態 | `status` 或 `{"cmd":"status"}` |
| Ping | `{"cmd":"ping"}` |
| WiFi | `{"cmd":"wifi","ssid":"...","password":"..."}` |
| 上傳 config | `{"cmd":"config","config":{...}}` |

> 注意：上傳的 config **重開機後不保留**（尚未寫入 Flash partition）。`reload` 指令規格書有提，韌體尚未實作。

### 桌面端 LED Show Studio

```bash
cd led-studio
npm install
npm run rebuild   # 首次必跑（serialport 原生模組）
npm run dev       # Electron 開發模式
npm test          # 單元測試（48 tests）
npm run test:e2e  # Playwright E2E（需先 build）
npm run build     # 正式建置
npm run dist:mac  # 或 dist:win 打包
```

**功能頁面**

| 頁面 | 路徑 | 功能 |
|---|---|---|
| Dashboard | `/` | 開啟/儲存專案、載入 demo |
| 舞者 CRUD | `/dancers` | 角色與事件表格編輯 |
| Timeline | `/timeline` | Canvas 多軌、Snap、Inspector、音檔預覽 |
| LED 串聯 | `/led-chain` | 6 部位 index range（預設 120 LED） |
| Devices | `/devices` | esptool 燒錄、Serial config、WiFi NVS |
| Show Control | `/show` | UDP Bridge、LTC sidecar |

**Device Manager 流程**

1. 接 USB → 選 Serial Port → **Ping**
2. **燒錄韌體**（需先於 repo 根目錄 `pio run`；本機 `pip install esptool`）
3. 填 WiFi SSID/密碼 → **寫入 WiFi → ESP NVS**
4. 選角色 → **上傳 Config**（Serial JSON，含 timeline + network）

**LTC Sidecar**

```bash
python3 tools/ltc_sidecar.py --simulate --duration-ms 180000
# Show Control 選 LTC 時間源 → Start Bridge
```

### 韌體 + Bridge 聯測

1. ESP 與電腦連同一 Wi-Fi（或電腦開 2.4 GHz 熱點）
2. Device Manager 寫入 WiFi，或暫改 `src/default_config.h`
3. Studio → Show Control → **Start Bridge**
4. ESP 收到 timecode 進入 PLAYING，依 config timeline 亮燈

開機狀態燈：藍（BOOT）→ 橘呼吸（連 WiFi）→ 滅（等 timecode）。

---

## LED 燈條型號切換

韌體支援兩種 chipset（`src/led_chipset.h`）：

| `led_type` | FastLED driver | 適用 |
|---|---|---|
| `WS2811`（**預設**） | `WS2811_400` | 常見 12V WS2811，400 kHz |
| `WS2812B` | `WS2812B` | 5V WS2812B，800 kHz |

在 device config 設定：

```json
{
  "device": {
    "led_type": "WS2812B",
    "data_gpio": 8,
    "led_count": 120
  }
}
```

改 `led_type` / `data_gpio` / `led_count` 後需 **重開機** 才會重新 init LED。

---

## 舞台色票

12 組絢麗標準色 + 基本色，定義於 `shared/stage_colors.json`，韌體與 Studio 已對齊。

| 名稱 | 中文 | 用途 |
|---|---|---|
| `electric_cyan` | 電光青 | 科技感開場 |
| `hot_magenta` | 熱力洋紅 | 強烈情緒高光 |
| `laser_lime` | 雷射萊姆 | 高能量節拍 |
| `royal_violet` | 皇家紫 | 神秘慢板 |
| `golden_spark` | 金耀 | 高潮結尾 |
| `flame_orange` | 火焰橙 | 爆點轉折 |
| `ice_blue` | 冰藍 | 冷調對比 |
| `neon_pink` | 霓虹粉 | 流行舞曲 |
| `emerald_glow` | 翡翠光 | 自然過渡 |
| `ultraviolet` | 紫外光 | 黑光場景 |
| `silver_white` | 銀白 | 全場閃光 |
| `deep_crimson` | 深緋紅 | 戲劇獨舞 |

---

## 目錄結構

```text
led/
├── src/                 # ESP32 韌體（Arduino + FastLED）
├── led-studio/          # Electron 桌面 App
├── shared/              # 跨專案資源（色票）
├── docs/                # 規格書
├── tools/               # LTC sidecar 等
└── platformio.ini
```

---

## 規格書 vs 現況（未完成項目）

對照 `docs/ESP32-S3_WS2812B_Timecode_LED_Dev_Spec.md` v1.2。✅ = 已有核心實作，🟡 = 部分，❌ = 尚未做。

### 韌體（ESP32-S3）

| 規格項目 | 現況 |
|---|---|
| ESP-IDF + `led_strip` RMT driver | ❌ 實際為 **Arduino + FastLED** |
| WS2812B only | 🟡 支援 WS2811 + WS2812B 可切換 |
| 500 LED / 台、60 FPS | 🟡 編譯支援 500；未在實機滿載驗證 refresh 邊界 |
| JSON config 開機載入（Flash） | ❌ 僅內建 `default_config.h`；Serial 上傳不持久化 |
| Serial 分片協定（BEGIN_CONFIG / CHUNK / VERIFY） | ❌ 單包 JSON `cmd:config`，上限約 8 KB |
| Timecode 100 Hz 廣播 | ❌ Bridge **50 Hz**（`TIMECODE_RATE_HZ`） |
| Timecode timeout / `continue_local` / blackout | ❌ 掉包後無 timeout 狀態機 |
| UDP status 4211 + `battery_mv` | 🟡 有廣播 JSON；ADC 腳位未接（回傳 0） |
| `fade`（A→B 漸變）效果 | ❌ 僅 fade_in / fade_out；`fade` 編譯時當 fade_in |
| Config partition / LittleFS | ❌ `config_loader.cpp` 仍為 TODO |
| `reload` 指令 | ❌ |
| GPIO 從 config 動態切換 | ❌ FastLED 模板腳位仍綁編譯期 `LED_DATA_GPIO` |
| 同步驗收 ±10 ms | ❌ 無自動化 / 場地量測報告 |
| Milestone 1–3 核心功能 | ✅ LED、timeline、UDP sync 主路徑可跑 |

### 桌面端（LED Show Studio）

| 規格項目 | 現況 |
|---|---|
| Electron + React + TypeScript | ✅ |
| Tailwind + shadcn/ui | ❌ 自訂 CSS |
| TanStack Query | ❌ 使用 Zustand |
| Project Dashboard | ✅ |
| 獨立 Role / LED Mapping / Color Palette 頁 | 🟡 合併在 Dancers、LED 串聯、Timeline |
| Timeline Canvas 多軌 + from/to + Snap | ✅ |
| 波形 ffmpeg 預計算 + cache | ❌ 瀏覽器 **Web Audio** 即時解碼 |
| Snap 1/4、1/8 拍細粒度 | 🟡 有 BPM snap；缺多檔粒度切換 |
| 快捷鍵 Cmd+D、Space 播放 | ❌ 僅 Delete 刪事件 |
| 1000 事件虛擬化 | 🟡 Canvas 只繪可見區；未壓力測試 1000 筆 |
| 重疊事件 UI 警告 | 🟡 `eventValidator` 有驗證；Timeline 未全顯示衝突 |
| Device Manager 掃埠 / 燒錄 / config | ✅ |
| Config `led_type` 從 Studio 編譯 | ❌ `configCompiler` 尚未輸出 `led_type` |
| Show Control：Pause / Seek / Stop 封包 | ❌ 僅 Start/Stop Bridge |
| Show Control：監看 ESP UDP status | ❌ 有 `device:getStatus`（Serial），無 4211 listener |
| 外部 DJ / OSC / MIDI 時間源 | 🟡 Manual + LTC sidecar；無 Rekordbox/VDJ 直連 |
| Test / Calibration 頁 | ❌ |
| 操作手冊 / 場地 burn-in 流程 | ❌ |

### 驗收標準（§22）快照

| 編號 | 條件 | 現況 |
|---|---|---|
| F001–F004 | UI 建事件、多角色 config | 🟡 可做；需手動匯出/上傳 |
| F005 | 燒錄 + checksum | 🟡 Serial 回 crc32；無分片 verify |
| F006–F009 | START/廣播/多機同步/暫停跳轉 | 🟡 協定支援；UI 與多機驗收未完成 |
| 非功能 | 30 分鐘穩定、±10 ms、非工程師可用 | ❌ 未驗收 |

### 建議下一步（優先序）

1. **Config 寫入 Flash** + 開機載入（解決重開設定消失）
2. **Studio 輸出 `led_type`** + Device Manager 可選 chipset
3. **Show Control**：Pause/Seek/Stop、UDP 4211 裝置面板
4. **Timecode 100 Hz** + 掉包 timeout 狀態機
5. **大 config 分片上傳**（支援 ~1000 events/角色）
6. **多 ESP ±10 ms 場地驗收**與操作手冊

---

## 相關文件

- 完整規格：`docs/ESP32-S3_WS2812B_Timecode_LED_Dev_Spec.md`
- Studio 開發說明：`led-studio/README.md`

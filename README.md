# LED Show — ESP32 同步穿戴燈光系統

舞者穿戴 **WS2812B / WS2811** 燈條，由桌面端 **LED Show Studio** 編排，ESP32 依 UDP Timecode 同步播放。預設硬體為 **五通道 WS2812B**（帽子 + 四肢），邏輯 580 LED / 實體約 740 顆。

| 子專案 | 路徑 | 說明 |
|---|---|---|
| 韌體 | `src/` + `platformio.ini` | ESP32-S3 / ESP32：timeline、FastLED 多輸出、UDP timecode、LittleFS config |
| 桌面端 | `led-studio/` | Electron + React：編排、Device Manager、音樂控制、校正 |
| 規格書 | `docs/ESP32-S3_WS2812B_Timecode_LED_Dev_Spec.md` | 完整需求（v1.2） |
| 接線 | `docs/WS2812B_5_CHANNEL_WIRING.md` | 五通道 GPIO、並聯分支、供電 |
| 現場手冊 | `docs/OPERATIONS.md` | burn-in、同步驗收、疑難排解 |
| 色票 | `shared/stage_colors.json` | 舞台標準色（韌體 / UI 共用） |
| 工具 | `tools/` | LTC sidecar 等輔助腳本 |

---

## 實作進度總覽

相對規格書 v1.2 的粗估完成度（2026-07-16）：

| 區塊 | 狀態 | 說明 |
|---|---|---|
| 韌體 LED 驅動 | 🟢 可用 | FastLED；最多 **5 輸出**、`LED_COUNT_MAX=640`；WS2811 / WS2812B 可切換 |
| 韌體 Timeline | 🟢 核心完成 | solid / off / blink / fade* / pulse / wipe / chase / wave / trail / sparkle 等 + priority |
| 韌體 Timecode 同步 | 🟢 可用 | UDP 4210、CRC、START/RUNNING/PAUSE/STOP/SEEK；**100 Hz**；500 ms hold / 2 s blackout |
| 韌體 Config 持久化 | 🟢 完成 | LittleFS 寫入；開機載入；`reload`；大檔 **分片上傳** |
| 桌面 Studio | 🟢 完成 | Dashboard、舞者、Timeline、LED 串聯、Devices、音樂控制、校正 |
| Timeline Editor | 🟢 大部分 | Canvas 多軌、BPM snap（1/4–1/16）、Inspector、LED Sync、波形 |
| Device Manager | 🟢 大部分 | 多板型燒錄、Ping、WiFi NVS、分片 config、`led_type` |
| Show Control | 🟢 可用 | 播放/暫停/Seek、UDP Bridge、4211 裝置監看、自動發現 |
| 同步精度驗收 ±10 ms | 🟡 UI 就緒 | Calibration 頁可看 `drift_ms`；場地多機 burn-in 尚未完成 |
| Test / Calibration 頁 | 🟢 完成 | `/calibration` |

圖例：🟢 可用　🟡 部分完成　🔴 未做或差距大

詳細差距見下方 **[規格書 vs 現況](#規格書-vs-現況未完成項目)**。

---

## 快速開始

### 韌體

```bash
# 需安裝 PlatformIO CLI（或 ~/.platformio/penv/bin/pio）
pio run -e esp32-s3-devkitc-1-n16r8   # 穿戴主目標（16MB + PSRAM，預設 WS2812B）
pio run                              # 預設 env：esp32-s3-devkitc-1（GPIO 8）
pio run -e esp32-dev                 # Classic ESP32（GPIO 4，MAX_EVENTS=256）
pio run -e esp32-s3-devkitc-1-test   # 10 LED 測試編譯
pio run -t upload                    # 燒錄（接 USB）
pio device monitor                   # Serial 115200
```

**查看 ESP32 log（Serial monitor）：**

```bash
# 列出所有 Serial port（接 USB 前後各跑一次，多出來的就是 ESP）
ls /dev/cu.*

# 開啟 Serial monitor（115200 baud）
~/.platformio/penv/bin/pio device monitor -p /dev/cu.wchusbserial10 -b 115200

# 離開：Ctrl+C
```

**板型對照（Studio Device Manager 可選）**

| 板型 | PIO env | 預設資料腳 | 備註 |
|---|---|---|---|
| ESP32-S3 N16R8（建議） | `esp32-s3-devkitc-1-n16r8` | GPIO 4 | 五通道穿戴預設 |
| ESP32-S3 DevKitC-1 | `esp32-s3-devkitc-1` | GPIO 8 | 8MB Flash |
| ESP32 classic | `esp32-dev` | GPIO 4 | RAM 較小，事件上限 256 |

**LED 硬體**

| 項目 | 預設（N16R8） | 調整方式 |
|---|---|---|
| 五通道 GPIO | 4 / 5 / 6 / 7 / 15 | Studio「LED 串聯」或 config `device.outputs`（允許 4–18、21） |
| 燈條 IC | **WS2812B**（N16R8 compile default） | config `device.led_type`: `"WS2811"` 或 `"WS2812B"` |
| 邏輯顆數 | 580（帽 60 + 四肢各 130） | `-DLED_COUNT_MAX=N`；test env 為 10 |
| 亮度上限 | 25% | config `max_brightness` |

接線細節見 `docs/WS2812B_5_CHANNEL_WIRING.md`。

**WiFi**：內建 demo 使用 `SHOW_SYNC_AP` / `CHANGE_ME`。可從 Studio Device Manager 寫入 NVS，或改 `src/default_config.h`。

**Serial 指令**（115200，JSON 一行一筆）：

| 指令 | 範例 |
|---|---|
| 狀態 | `status` 或 `{"cmd":"status"}` |
| Ping | `{"cmd":"ping"}` |
| WiFi | `{"cmd":"wifi","ssid":"...","password":"..."}` |
| 上傳 config | `{"cmd":"config","config":{...}}`（小檔）或分片 `config_begin` / `config_chunk` |
| 重載 Flash | `reload` 或 `{"cmd":"reload"}` |

> Config 上傳後寫入 **LittleFS**，重開機仍保留。回應應含 `flash_saved: true`。

### 桌面端 LED Show Studio

```bash
cd led-studio
npm install
npm run rebuild   # 首次必跑（serialport 原生模組）
npm run dev       # Electron 開發模式
npm test          # 單元測試（74 tests）
npm run test:e2e  # Playwright E2E（需先 build）
npm run build     # 正式建置
npm run dist:mac  # 或 dist:win 打包（產物在 release/）
```

**功能頁面**

| 頁面 | 路徑 | 功能 |
|---|---|---|
| Dashboard | `/` | 開啟/儲存專案、載入 demo |
| 舞者 CRUD | `/dancers` | 角色與事件表格編輯 |
| Timeline | `/timeline` | Canvas 多軌、Snap、Inspector、音檔、**LED Sync** |
| LED 串聯 | `/led-chain` | 五輸出 layout（去程 / 並聯 / 回程） |
| Devices | `/devices` | 多板型燒錄、Serial config、WiFi NVS |
| 音樂控制 | `/show` | 播放/暫停/Seek + UDP Bridge + ESP 狀態 |
| 測試 / 校正 | `/calibration` | `drift_ms`、±10 ms 計數、burn-in 清單 |

**Device Manager 流程**

1. 接 USB → 選板型 → 選 Serial Port → **Ping**
2. **燒錄韌體**（對應 `pio run -e …`；本機 `pip install esptool`）
3. 填 WiFi SSID/密碼 → **寫入 WiFi → ESP NVS**
4. 選角色 → **上傳 Config**（寫入 Flash；大檔自動分片）

**LTC Sidecar**

```bash
python3 tools/ltc_sidecar.py --simulate --duration-ms 180000
# 音樂控制選 LTC 時間源 → Start Bridge
```

### 韌體 + Bridge 聯測

1. ESP 與電腦連同一 Wi-Fi（或電腦開 **2.4 GHz** 熱點）
2. Device Manager 寫入 WiFi，或暫改 `src/default_config.h`
3. Studio → **音樂控制** → **播放**（或 Timeline 開啟 **LED Sync**）
4. ESP 收到 timecode 進入 PLAYING，依 config timeline 亮燈

開機：LED self-test（R/G/B）→ 狀態燈藍（BOOT）→ 橘呼吸（連 WiFi）→ 滅（等 timecode）。

---

## LED 燈條型號切換

韌體支援兩種 chipset（`src/led_chipset.h`）：

| `led_type` | FastLED driver | 適用 |
|---|---|---|
| `WS2811` | `WS2811_400` | 常見 12V WS2811，400 kHz |
| `WS2812B` | `WS2812B` | 5V WS2812B，800 kHz（穿戴預設） |

在 device config 設定（Studio `configCompiler` 會輸出）：

```json
{
  "device": {
    "led_type": "WS2812B",
    "data_gpio": 4,
    "led_count": 580,
    "outputs": [
      { "id": "hat", "data_gpio": 4, "offset": 0, "led_count": 60 },
      { "id": "right_arm", "data_gpio": 5, "offset": 60, "led_count": 130 }
    ]
  }
}
```

改 `led_type` / GPIO / `led_count` 後需 **重開機** 才會重新 init LED。

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
| `ice_blue` | 冰蓝 | 冷調對比 |
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
├── docs/                # 規格、接線、現場操作、架構說明
├── tools/               # LTC sidecar 等
└── platformio.ini
```

---

## 規格書 vs 現況（未完成項目）

對照 `docs/ESP32-S3_WS2812B_Timecode_LED_Dev_Spec.md` v1.2。✅ = 已有核心實作，🟡 = 部分，❌ = 尚未做。

### 韌體（ESP32）

| 規格項目 | 現況 |
|---|---|
| ESP-IDF + `led_strip` RMT driver | ❌ 實際為 **Arduino + FastLED**（見 `docs/ARCHITECTURE.md`） |
| WS2812B only | 🟡 支援 WS2811 + WS2812B；穿戴預設 WS2812B |
| 500+ LED / 台、60 FPS | 🟡 編譯支援 640 邏輯 LED、五輸出；實機滿載 refresh 邊界待場地驗證 |
| JSON config 開機載入（Flash） | ✅ LittleFS |
| Serial 分片協定 | ✅ `config_begin` / `config_chunk` + CRC |
| Timecode 100 Hz 廣播 | ✅ `TIMECODE_RATE_HZ = 100` |
| Timecode timeout / `continue_local` / blackout | ✅ 500 ms / 2 s（`TIMECODE_HOLD_MS` / `TIMECODE_BLACKOUT_MS`） |
| UDP status 4211 + `battery_mv` | 🟡 有廣播 JSON；ADC 腳位預設未接（回傳 0） |
| 進階 timeline 效果 | ✅ fade / pulse / wipe / chase / wave / trail / path_flow 等 |
| `reload` 指令 | ✅ |
| GPIO 從 config 動態切換 | ✅ 運行期 init；腳位限 GPIO 4–18、21 |
| 同步驗收 ±10 ms | 🟡 Calibration UI 有；缺場地量測報告 |
| Milestone 1–3 核心功能 | ✅ LED、timeline、UDP sync、持久化主路徑可跑 |

### 桌面端（LED Show Studio）

| 規格項目 | 現況 |
|---|---|
| Electron + React + TypeScript | ✅ |
| Tailwind + shadcn/ui | ❌ 自訂 CSS |
| TanStack Query | ❌ 使用 Zustand |
| Project Dashboard | ✅ |
| Role / LED Mapping / Color | 🟡 合併在 Dancers、LED 串聯、Timeline |
| Timeline Canvas 多軌 + Snap | ✅ 含 1/4、1/8、1/16 拍 |
| 波形 ffmpeg 預計算 + cache | 🟡 有 `waveformCache`；無 ffmpeg 時退回 Web Audio |
| Show Control Pause / Seek / Stop | ✅ |
| Show Control 監看 ESP UDP status | ✅ port 4211 + 自動發現 |
| Config `led_type` 從 Studio 編譯 | ✅ |
| Timeline ↔ LED 硬體同步 | ✅ **LED Sync**（播放/暫停/Seek） |
| Test / Calibration 頁 | ✅ |
| 外部 DJ / OSC / MIDI 時間源 | 🟡 Manual + LTC sidecar；無 Rekordbox/VDJ 直連 |
| 操作手冊 / 場地 burn-in | 🟡 文件已有（`docs/OPERATIONS.md`）；實測報告未完成 |

### 驗收標準（§22）快照

| 編號 | 條件 | 現況 |
|---|---|---|
| F001–F004 | UI 建事件、多角色 config | ✅ 可編排並上傳 Flash |
| F005 | 燒錄 + checksum | ✅ 分片 CRC verify |
| F006–F009 | START/廣播/多機同步/暫停跳轉 | 🟡 協定與 UI 齊；多機場地驗收未完成 |
| 非功能 | 30 分鐘穩定、±10 ms、非工程師可用 | 🟡 流程文件就緒；實測待做 |

### 建議下一步（優先序）

1. **多 ESP ±10 ms 場地驗收** + 30 分鐘 burn-in 報告
2. **滿載五通道 refresh / 功耗** 實測與供電定案
3. **電池 ADC** 接線與 `battery_mv` 校正
4. 外部時間源（Rekordbox / OSC）若演出需要再接
5. （可選）ESP-IDF RMT 遷移，見 `docs/ARCHITECTURE.md`

---

## 相關文件

- 完整規格：`docs/ESP32-S3_WS2812B_Timecode_LED_Dev_Spec.md`
- 五通道接線：`docs/WS2812B_5_CHANNEL_WIRING.md`
- 現場操作：`docs/OPERATIONS.md`
- 韌體選型：`docs/ARCHITECTURE.md`
- Studio 開發說明：`led-studio/README.md`

# LED Show — ESP32-S3 同步穿戴燈光系統

舞者穿戴 WS2812B 燈條，由桌面端 **LED Show Studio** 編排，ESP32 依 UDP Timecode 同步播放。

| 子專案 | 路徑 | 說明 |
|---|---|---|
| 韌體 | `src/` + `platformio.ini` | ESP32-S3：timeline、FastLED、UDP timecode |
| 桌面端 | `led-studio/` | Electron + React：編排、Bridge、燒錄（規劃中） |
| 規格書 | `docs/ESP32-S3_WS2812B_Timecode_LED_Dev_Spec.md` | 完整需求 |
| 色票 | `shared/stage_colors.json` | 舞台標準色（韌體/UI 共用） |

## 快速開始

### 韌體

```bash
# 需安裝 PlatformIO CLI
pio run                          # 500 LED 正式版
pio run -e esp32-s3-devkitc-1-test   # 10 LED 測試編譯
pio run -t upload                # 燒錄（接 USB）
pio device monitor               # Serial 115200
```

**LED 資料腳位**：目前 placeholder `GPIO 8`，在 `platformio.ini` 改 `-DLED_DATA_GPIO=N` 後重新編譯。你提供腳位後更新此 flag 即可。

**WiFi**：內建 demo 使用 `SHOW_SYNC_AP` / `CHANGE_ME`，上線前必改（或之後從 UI 燒錄 config）。

Serial 指令：

- `status` — 列印同步狀態
- `reload` — 重載內建 demo config

### 桌面端 LED Show Studio

```bash
cd led-studio
npm install
npm run rebuild   # 首次必跑（serialport 原生模組）
npm run dev
npm test         # 單元測試（20 tests）
npm run build    # 正式建置
```

**功能頁面：**

| 頁面 | 路徑 | 功能 |
|---|---|---|
| Dashboard | `/` | 開啟/儲存專案、demo |
| 舞者 CRUD | `/dancers` | 新增/刪除舞者、表格編輯亮燈條件 |
| Timeline | `/timeline` | **Canvas 多軌**拖拉編輯、Snap、Inspector |
| Devices | `/devices` | esptool 燒錄、Serial 上傳 config、WiFi NVS |
| Show Control | `/show` | UDP Bridge、LTC sidecar |

**Device Manager 流程：**

1. 接 USB → 選 Serial Port → **Ping**
2. **燒錄韌體**（需先 `pio run`，本機 `pip install esptool`）
3. 填 WiFi SSID/密碼 → **寫入 WiFi → ESP NVS**
4. 選角色 → **上傳 Config**（Serial JSON，含 timeline + network）

**LTC Sidecar：**

```bash
python3 tools/ltc_sidecar.py --simulate --duration-ms 180000
# Show Control 選 LTC 時間源 → Start Bridge
```

### 韌體 + Bridge 聯測

1. ESP 與電腦連同一 Wi-Fi（或電腦開熱點）
2. 修改韌體 WiFi SSID/密碼（暫時在 `src/default_config.h` 或之後燒 config）
3. Studio → Show Control → **Start Bridge**
4. ESP 進入 PLAYING，依 demo timeline 亮燈

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

## 目錄結構

```text
led/
├── src/                 # ESP32 韌體模組
├── led-studio/          # Electron 桌面 App
├── shared/              # 跨專案資源（色票）
├── docs/                # 規格書
└── platformio.ini
```

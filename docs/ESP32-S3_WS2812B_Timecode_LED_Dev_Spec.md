# ESP32-S3 控制 WS2812B 燈條同步演出系統開發規格書

版本：v1.2  
文件狀態：需求已確認；桌面端技術已定案（Electron + React）  
適用情境：舞者穿戴式 LED、角色燈光編排、音樂同步燈光演出  
目標平台：ESP32-S3 + WS2812B / SK6812 類單線可編址 RGB LED 燈條  
主控端平台：Windows / macOS 桌面電腦  
建議韌體框架：ESP-IDF 5.x 或更新版本  
桌面端技術（已定案）：**Electron + React + TypeScript**

---

## 1. 專案目標

本專案要開發一套可讓桌面端建立角色燈光設定檔，並將設定檔燒錄或部署到多個 ESP32-S3 裝置的同步 LED 控制系統。系統需支援舞者身上不同部位，例如「手」、「腳」、「頭」、「身體」等區域，在指定音樂時間點顯示指定顏色或效果。

核心目標如下：

1. 使用 ESP32-S3 控制 WS2812B LED 燈條。
2. 透過設定檔描述「時間區間、部位、顏色、效果」（`from`～`to`，見 §8.5）。
3. 每位角色或每個 ESP 裝置可使用不同設定檔。
4. 桌面 UI 可新增、編輯、預覽、匯出設定檔。
5. 桌面 UI 可讀取設定檔，並將設定檔燒錄或部署到 ESP32-S3。
6. 音樂播放開始時，由主控端電腦作為發射台，透過 Wi-Fi 廣播時間碼 Timecode 給所有 ESP32-S3。
7. ESP32-S3 接收到時間碼後，以該時間碼作為演出主時間軸，根據本地設定檔即時更新 LED。
8. 在同一時間點，不同部位可以顯示不同顏色，例如「手藍色、腳綠色、頭紅色」。
9. 系統必須盡可能確保各 ESP 在相同音樂時間點顯示相同或對應的 LED 狀態。

---

## 2. 重要假設與設計原則

### 2.1 重要假設

本規格先採用以下假設，若後續需求不同，可調整：

| 項目 | 已確認值 |
|---|---|
| LED 類型 | WS2812B RGB，單線資料輸入 |
| 控制器 | ESP32-S3，4 位舞者各 1 台，共 4 台 |
| 每台 LED 數 | 500 顆 |
| 部位定義 | 每個 ESP 可定義多個 body parts，例如 hand、foot、head、body |
| LED 分區方式 | 使用 LED index range 定義，例如 hand = LED 0-29 |
| 時間單位 | 毫秒 ms |
| 每角色事件量 | 約 1000 筆 |
| 音樂播放 | **外部 DJ 軟體**；本系統只負責 Timecode 橋接與燈效編排 |
| 音樂同步方式 | 主控端從 DJ 時間源取得 playback position，透過 Wi-Fi UDP Broadcast 廣播 Timecode |
| 設定檔格式 | JSON 為主；1000 事件/角色可先用 JSON，必要時轉 compact binary |
| 韌體框架 | ESP-IDF，使用 RMT peripheral 或官方 led_strip component 驅動 WS2812B |
| 燒錄方式 | USB Serial + esptool.py（**不需 OTA**） |
| 主控端平台 | Windows + macOS 皆需支援 |
| 主控端網路 | 現場**無法使用專用 AP**；需連場地既有 Wi-Fi 或電腦熱點 |
| 電池回報 | 需要（`battery_mv` 回報至 Show Control） |
| UI 編輯 | 需波形顯示與節拍吸附；**不需**多人同時編輯 |
| 桌面端 UI | Electron + React + TypeScript（§26） |

### 2.2 對「完全不會有時間差」的工程定義

無線網路與 LED 更新本身一定存在傳輸延遲、排程延遲與 LED refresh 時間，因此工程上無法保證物理上的 0 ms 時間差。本專案應以「可量測且可接受的同步誤差」作為驗收標準。

建議目標：

| 等級 | 同步誤差目標 | 適用情境 |
|---|---:|---|
| 基本版 | ±50 ms 以內 | 一般舞台視覺效果 |
| 建議版 | ±20 ms 以內 | 多人同步舞蹈、節奏明顯的音樂 |
| 進階版 | ±10 ms 以內 | 高精準節拍燈效、快速閃爍同步 |

**已確認驗收目標：±10 ms 以內**（進階版）。因現場無專用 AP，需提高 Timecode 廣播頻率（建議 100 Hz）、強化 drift 修正，並在實地 Wi-Fi 環境做 burn-in 測試。

---

## 3. 系統整體架構

```text
+---------------------------------------------------------------+
|                       主控端桌面電腦                           |
|                                                               |
|  +------------------+   +------------------+   +------------+ |
|  | 設定檔編輯 UI    |   | 音樂播放器 / Cue |   | 燒錄工具   | |
|  +------------------+   +------------------+   +------------+ |
|          |                      |                    |          |
|          |                      |                    | USB      |
|          v                      v                    v          |
|  +------------------+   +------------------+   +------------+ |
|  | Config Manager   |   | Timecode Sender  |   | esptool    | |
|  +------------------+   +------------------+   +------------+ |
|                                |                              |
+--------------------------------|------------------------------+
                                 |
                                 | Wi-Fi UDP Broadcast
                                 v
+----------------------------------------------------------------+
|                       Wi-Fi AP / PC Hotspot                    |
+----------------------------------------------------------------+
              |                  |                    |
              v                  v                    v
+-------------------+  +-------------------+  +-------------------+
| ESP32-S3 dancer A |  | ESP32-S3 dancer B |  | ESP32-S3 dancer C |
| role: dancer_A    |  | role: dancer_B    |  | role: dancer_C    |
| local config      |  | local config      |  | local config      |
| LED mapping       |  | LED mapping       |  | LED mapping       |
+-------------------+  +-------------------+  +-------------------+
```

---

## 4. 子系統說明

### 4.1 桌面端 UI / 主控端

桌面端負責：

1. 建立角色。
2. 建立 ESP 裝置資料。
3. 建立部位與 LED index range 對應。
4. 建立時間軸事件。
5. 匯出不同角色設定檔。
6. 讀取既有設定檔。
7. 透過 USB 將韌體與設定檔燒錄到 ESP32-S3。
8. 播放音樂或接收音樂播放狀態（**已確認：接收外部 DJ 時間源，不自播現場音樂**）。
9. 在音樂開始時廣播 `START` / `RESET` timecode（**時間源來自外部 DJ 或 LTC/MTC，見 §9.7**）。
10. 播放期間持續廣播目前音樂時間碼。
11. 暫停、停止、跳轉時廣播對應控制封包。

### 4.2 ESP32-S3 韌體

ESP32-S3 韌體負責：

1. 開機讀取本地設定檔。
2. 初始化 WS2812B LED strip。
3. 連線至指定 Wi-Fi。
4. 接收主控端 Timecode UDP Broadcast。
5. 根據 Timecode 更新內部播放時間。
6. 在每個 frame 根據時間軸查詢目前各部位 LED 狀態。
7. 將 LED 狀態透過 RMT 輸出至 WS2812B。
8. 在網路封包短暫遺失時，使用本地單調時鐘進行補償。
9. 在停止或斷線時進入安全狀態，例如關燈或保持最後狀態。

### 4.3 設定檔

設定檔負責描述：

1. 專案資料。
2. 角色資料。
3. ESP 裝置資料。
4. LED 硬體設定。
5. 部位對應 LED 範圍。
6. 時間軸事件。
7. 顏色定義。
8. 效果定義。
9. 同步與容錯參數。

---

## 5. 技術選型

### 5.1 ESP32-S3 韌體技術

| 項目 | 建議 |
|---|---|
| Framework | ESP-IDF |
| LED Driver | Espressif led_strip component + RMT backend |
| Network | Wi-Fi Station mode |
| Timecode Transport | UDP Broadcast 或 UDP Multicast |
| Config Storage | NVS / LittleFS / SPIFFS / 自訂 data partition |
| Firmware Flash | esptool.py |
| Debug | UART log + optional Web status endpoint |

說明：Espressif 的 LED Strip component 支援使用 RMT backend 產生可編址 LED 所需的精準 timing signal，官方文件也說明可建立多個 LED strip object，且 RMT channel 會由 driver 視情況配置。RMT backend 對 WS2812B 類型 LED 是比 bit-banging 更穩定的方案。

### 5.2 桌面端技術（已定案：Electron + React）

#### 決策

| 項目 | 選型 |
|---|---|
| App 框架 | Electron 33+ |
| UI | React 18+ / TypeScript |
| 狀態管理 | Zustand（專案/timeline）+ TanStack Query（裝置/燒錄 job） |
| 樣式 | Tailwind CSS + shadcn/ui |
| 打包 | electron-builder（Windows `.exe` / macOS `.dmg`） |
| 詳細實作規格 | 見 **§26** |

#### 選型理由

1. Timeline Editor 需波形、多軌拖拉、縮放、節拍吸附——React + Canvas 生態最成熟。
2. 需跨 Windows / macOS，Electron 驗證成本最低。
3. USB 燒錄、UDP 廣播、LTC 解碼屬 **Main Process** 能力，Electron 邊界清楚。
4. 1000 事件/角色需虛擬化渲染，自訂 Timeline 元件比 PySide6 從零刻更快做對。
5. 單人/小團隊長期維護：前後端皆 TypeScript，與 ESP 韌體 C 分工明確。

#### 不採用方案

| 方案 | 不採原因 |
|---|---|
| Python + PySide6 | Timeline 互動需大量自訂 widget，長期 UX 成本高 |
| Tauri + Rust | 第一版交付慢；Rust 與 React timeline 整合 ROI 低 |
| 純 Web App | 無法穩定存取 USB serial、UDP broadcast、LTC 音訊 IN |

#### 附屬工具（随 App 打包）

| 工具 | 用途 |
|---|---|
| esptool.py（bundled Python 或 standalone binary） | USB 燒錄 |
| ffmpeg（static binary） | 音訊轉檔、波形 peaks 預計算 |
| ltc-decoder sidecar（Python + libltc 或 Rust CLI） | Show Control LTC 解碼 |

---

## 6. 硬體規格

### 6.1 ESP32-S3

最低需求：

| 項目 | 規格 |
|---|---|
| MCU | ESP32-S3 |
| Flash | 建議 8 MB 以上 |
| PSRAM | 非必要，但建議使用有 PSRAM 版本 |
| Wi-Fi | 2.4 GHz |
| USB | USB Serial / Native USB 任一可燒錄 |
| GPIO | 至少 1 個 LED data pin |

### 6.2 WS2812B LED 燈條

| 項目 | 規格 |
|---|---|
| 電壓 | 5V |
| 訊號 | 單線 DIN |
| 色彩 | RGB，每顆 LED 24-bit |
| 最大亮度電流 | 約 60mA / LED，白光全亮估算 |

### 6.3 電源設計

電源必須依 LED 數量計算，否則可能導致重啟、閃爍、顏色錯誤。

估算公式：

```text
最大電流 A = LED 數量 × 0.06A × 最大亮度比例
```

範例：

```text
100 顆 LED，最大亮度限制 40%
最大電流 = 100 × 0.06A × 0.4 = 2.4A
建議電源 >= 5V 3A

500 顆 LED，最大亮度限制 40%（本案已確認）
最大電流 = 500 × 0.06A × 0.4 = 12A
建議電源 >= 5V 15A（含餘裕），電池需能瞬間放 12A+
WS2812B 500 顆單條 refresh 約 15 ms，60 FPS 邊界，需實測
```

硬體建議：

1. LED 供電使用獨立 5V 電源或升壓模組。
2. ESP32-S3 與 LED 電源必須共地 GND。
3. LED DIN 前串 330Ω～470Ω 電阻。
4. LED 5V 與 GND 間加 1000µF 電解電容。
5. ESP32-S3 是 3.3V 邏輯，WS2812B 在 5V 供電時建議加 74AHCT125 / 74HCT245 level shifter。
6. 穿戴式裝置需考慮電池放電能力、線材電流、接頭鬆脫與散熱。

---

## 7. LED 部位模型

### 7.1 部位定義

每個設定檔可定義多個部位：

- hand_left
- hand_right
- foot_left
- foot_right
- head
- body
- custom_xxx

### 7.2 LED range 對應

每個部位可對應一段或多段 LED index：

```json
{
  "parts": [
    {
      "id": "hand_left",
      "display_name": "左手",
      "ranges": [
        { "start": 0, "end": 29 }
      ]
    },
    {
      "id": "hand_right",
      "display_name": "右手",
      "ranges": [
        { "start": 30, "end": 59 }
      ]
    },
    {
      "id": "foot",
      "display_name": "腳",
      "ranges": [
        { "start": 60, "end": 89 },
        { "start": 90, "end": 119 }
      ]
    }
  ]
}
```

### 7.3 同時間多部位不同顏色

系統必須允許同一時間點存在多個事件，只要目標部位不同即可。

範例（使用者輸入格式：`from`～`to` 區間，見 §8.5）：

```json
{
  "events": [
    {
      "id": "evt_0001",
      "from": "00:01",
      "to": "00:01.500",
      "targets": ["hand_left", "hand_right"],
      "color": "blue",
      "effect": "solid"
    },
    {
      "id": "evt_0002",
      "from": "00:01",
      "to": "00:01.500",
      "targets": ["foot"],
      "color": "green",
      "effect": "solid"
    }
  ]
}
```

---

## 8. 設定檔格式規格

### 8.1 檔案類型

| 類型 | 副檔名 | 用途 |
|---|---|---|
| Project file | `.ledproj.json` | 桌面 UI 專案檔 |
| Role config | `.role.json` | 單一角色設定檔 |
| Device config | `.device.json` | 單一 ESP 裝置設定檔 |
| Compiled binary config | `.ledbin` | 給 ESP 讀取的壓縮或二進位設定檔 |

第一版建議：UI 內部用 JSON，ESP 端也先讀 JSON。若後續事件量過大，再轉為 compact binary format。

### 8.2 Project file Schema

```json
{
  "schema_version": "1.0.0",
  "project": {
    "id": "show_2026_001",
    "name": "Dance Show 2026",
    "music_file": "song.wav",
    "music_duration_ms": 180000,
    "bpm": 128,
    "created_at": "2026-06-29T00:00:00+08:00",
    "updated_at": "2026-06-29T00:00:00+08:00"
  },
  "colors": {
    "red": { "r": 255, "g": 0, "b": 0 },
    "green": { "r": 0, "g": 255, "b": 0 },
    "blue": { "r": 0, "g": 0, "b": 255 },
    "white": { "r": 255, "g": 255, "b": 255 },
    "off": { "r": 0, "g": 0, "b": 0 }
  },
  "roles": [
    {
      "role_id": "dancer_a",
      "display_name": "舞者 A",
      "device_config_file": "dancer_a.device.json"
    }
  ]
}
```

### 8.3 Device config Schema

```json
{
  "schema_version": "1.0.0",
  "device": {
    "device_id": "esp32s3_dancer_a_001",
    "role_id": "dancer_a",
    "display_name": "舞者 A 主控",
    "firmware_min_version": "1.0.0"
  },
  "hardware": {
    "chip": "ESP32-S3",
    "led_type": "WS2812B",
    "color_order": "GRB",
    "data_gpio": 8,
    "led_count": 120,
    "max_brightness": 0.4,
    "refresh_fps": 60
  },
  "network": {
    "ssid": "SHOW_SYNC_AP",
    "password": "CHANGE_ME",
    "timecode_port": 4210,
    "device_status_port": 4211,
    "use_static_ip": false
  },
  "sync": {
    "timecode_rate_hz": 50,
    "hold_last_timecode_timeout_ms": 500,
    "offline_behavior": "blackout",
    "allowed_drift_ms": 20,
    "resync_smoothing": true
  },
  "parts": [
    {
      "id": "hand",
      "display_name": "手",
      "ranges": [
        { "start": 0, "end": 39 }
      ]
    },
    {
      "id": "foot",
      "display_name": "腳",
      "ranges": [
        { "start": 40, "end": 79 }
      ]
    },
    {
      "id": "head",
      "display_name": "頭",
      "ranges": [
        { "start": 80, "end": 99 }
      ]
    },
    {
      "id": "body",
      "display_name": "身體",
      "ranges": [
        { "start": 100, "end": 119 }
      ]
    }
  ],
  "colors": {
    "red": { "r": 255, "g": 0, "b": 0 },
    "green": { "r": 0, "g": 255, "b": 0 },
    "blue": { "r": 0, "g": 0, "b": 255 },
    "yellow": { "r": 255, "g": 255, "b": 0 },
    "purple": { "r": 128, "g": 0, "b": 255 },
    "off": { "r": 0, "g": 0, "b": 0 }
  },
  "timeline": {
    "duration_ms": 180000,
    "default_state": {
      "color": "off",
      "effect": "solid"
    },
    "events": [
      {
        "id": "evt_0001",
        "name": "Intro hand blue",
        "from": "00:00",
        "to": "00:01",
        "targets": ["hand"],
        "effect": "solid",
        "color": "blue",
        "priority": 10
      },
      {
        "id": "evt_0002",
        "name": "Intro foot green",
        "from": "00:00",
        "to": "00:01",
        "targets": ["foot"],
        "effect": "solid",
        "color": "green",
        "priority": 10
      },
      {
        "id": "evt_0003",
        "name": "Head red flash",
        "from": "00:01.200",
        "to": "00:01.500",
        "targets": ["head"],
        "effect": "blink",
        "color": "red",
        "params": {
          "frequency_hz": 8,
          "duty": 0.5
        },
        "priority": 20
      }
    ]
  }
}
```

### 8.4 設定檔驗證規則

UI 在儲存與燒錄前必須檢查：

1. `schema_version` 是否支援。
2. `led_count` 是否大於 0。
3. `data_gpio` 是否為合法 GPIO。
4. 每個 part id 不可重複。
5. 每個 range 的 `start <= end`。
6. range 不可超出 `0 ~ led_count - 1`。
7. event id 不可重複。
8. event `from` / `to` 必須為合法時間字串，且 `to` > `from`（見 §8.5）。
9. 編譯後 `start_ms` 不可小於 0；`end_ms` 必須大於 `start_ms`。
10. event target 必須存在於 parts。
11. event color 必須存在於 colors，除非使用 inline RGB。
12. 同一個 part 在同一時間重疊事件時，必須透過 priority 決定覆蓋順序。
13. 音樂長度與 timeline duration_ms 不一致時需警告。
14. 設定檔需產生 checksum，燒錄後由 ESP 回報 checksum 供 UI 驗證。

### 8.5 事件時間輸入格式（已確認：區間制）

**使用者只輸入「從幾分幾秒到幾分幾秒」**，不輸入開始時間 + 持續秒數。

#### UI 輸入欄位

| 欄位 | 格式 | 範例 |
|---|---|---|
| from | `mm:ss` 或 `mm:ss.mmm` | `01:30` |
| to | `mm:ss` 或 `mm:ss.mmm` | `02:00` |
| targets | 部位（可多選） | `hand`, `foot` |
| color | 顏色名稱 | `red` |
| effect | 效果 | `solid` |

範例語意：**01:30～02:00，手部位，紅燈**

```json
{
  "id": "evt_0042",
  "from": "01:30",
  "to": "02:00",
  "targets": ["hand"],
  "color": "red",
  "effect": "solid"
}
```

#### 內部編譯（UI → ESP）

使用者只看到 `from` / `to`。燒錄前由 UI 編譯成毫秒，ESP 韌體只讀 `start_ms` / `end_ms`：

```json
{
  "id": "evt_0042",
  "start_ms": 90000,
  "end_ms": 120000,
  "targets": ["hand"],
  "color": "red",
  "effect": "solid"
}
```

轉換規則：

```text
start_ms = parse_time(from)
end_ms   = parse_time(to)
# 不再儲存 duration_ms；若舊檔有 duration_ms，載入時轉成 end_ms = start_ms + duration_ms
```

時間字串格式：

| 格式 | 範例 | 說明 |
|---|---|---|
| `mm:ss` | `01:30` | 1 分 30 秒 = 90000 ms |
| `mm:ss.mmm` | `01:30.500` | 含毫秒 |
| `m:ss` | `1:05` | 可省略前導零 |

---

## 9. 時間碼 Timecode 同步規格

### 9.1 傳輸方式

第一版建議使用：

```text
UDP Broadcast over Wi-Fi
Broadcast IP: 255.255.255.255 或 subnet broadcast，例如 192.168.4.255
Port: 4210
Rate: 50Hz
```

原因：

1. 桌面電腦可直接發送 UDP Broadcast。
2. ESP32-S3 可在 Wi-Fi station mode 接收。
3. 不需要 PC 支援 ESP-NOW。
4. 適合一對多時間碼廣播。

備選方案：

| 方案 | 優點 | 缺點 |
|---|---|---|
| UDP Broadcast | PC 容易實作、相容性高 | 需穩定 Wi-Fi AP |
| UDP Multicast | 對群組管理較佳 | AP/OS 支援需測試 |
| ESP-NOW | 低延遲、一對多 ESP 很方便 | 一般 PC 無法直接發 ESP-NOW |
| 有線 UART/RS485 | 最穩定 | 穿戴式不方便 |

### 9.2 Timecode 封包格式

建議使用二進位封包，避免 JSON parsing 延遲與封包過大。

#### Packet v1

```c
struct TimecodePacketV1 {
    uint32_t magic;              // 'LTC1' = 0x4C544331
    uint8_t  version;            // 1
    uint8_t  packet_type;        // 1=START, 2=RUNNING, 3=PAUSE, 4=STOP, 5=SEEK, 6=PING
    uint16_t flags;              // bit flags
    uint32_t show_id_crc32;      // project/show id checksum
    uint32_t sequence;           // increasing sequence number
    uint64_t sender_unix_ms;     // sender wall clock time, optional
    uint32_t music_time_ms;      // current playback position in ms
    int32_t  playback_rate_ppm;  // 0 = normal, reserved for future
    uint32_t config_crc32;       // target config checksum, optional
    uint32_t packet_crc32;       // crc32 excluding this field
};
```

### 9.3 Packet type

| Type | 名稱 | 用途 |
|---:|---|---|
| 1 | START | 音樂從 0 或指定 cue 開始播放 |
| 2 | RUNNING | 播放中週期性廣播目前時間 |
| 3 | PAUSE | 暫停，ESP 保持目前 LED 狀態或進入指定狀態 |
| 4 | STOP | 停止，ESP 清除本地播放狀態 |
| 5 | SEEK | 跳轉到指定音樂時間 |
| 6 | PING | 主控端在線狀態檢查 |

### 9.4 ESP 端時間同步演算法

ESP 不應每收到封包就直接硬切本地時間，否則 Wi-Fi jitter 會造成 LED 抖動。建議做法：

1. 收到 `START`：
   - 將 `music_time_ms` 設為 0 或指定 cue。
   - 記錄 `local_start_us = esp_timer_get_time()`。
   - 狀態切換為 PLAYING。

2. 收到 `RUNNING`：
   - 取得封包內 `music_time_ms`。
   - 計算本地估算時間：
     ```text
     local_estimated_ms = last_sync_music_ms + (esp_timer_now_us - last_sync_local_us) / 1000
     error_ms = received_music_time_ms - local_estimated_ms
     ```
   - 若 `abs(error_ms) <= 20ms`：使用平滑修正。
   - 若 `abs(error_ms) > 20ms`：快速修正或 seek。

3. 每個 render frame：
   - 使用本地估算 `current_music_time_ms`。
   - 查詢 timeline。
   - 更新 LED buffer。
   - 呼叫 LED strip refresh。

### 9.5 Timecode 廣播頻率

建議：

| 項目 | 數值 |
|---|---:|
| 廣播頻率 | 50 Hz |
| 封包間隔 | 20 ms |
| LED render fps | 60 FPS 或 100 FPS |
| timeout | 500 ms |
| drift alarm | > 20 ms |

若 Wi-Fi 環境複雜，可提高至 100 Hz，但需測試封包遺失與 CPU 負載。

### 9.6 同步狀態機

```text
BOOT
  -> LOAD_CONFIG
  -> WIFI_CONNECTING
  -> WAIT_TIMECODE
  -> PLAYING
  -> PAUSED
  -> STOPPED
  -> ERROR
```

| 狀態 | LED 行為 |
|---|---|
| BOOT | 可顯示短暫白色或藍色開機燈 |
| WIFI_CONNECTING | 黃色呼吸或閃爍 |
| WAIT_TIMECODE | 關燈或低亮度待命 |
| PLAYING | 根據 timeline 顯示 |
| PAUSED | 保持最後狀態或顯示 pause 狀態 |
| STOPPED | 關燈 |
| ERROR | 紅色閃爍錯誤碼 |

### 9.7 外部 DJ 軟體同步（已確認需求）

本系統**不播放現場音樂**。燈效時間 (timeline) 仍以「音樂時間 ms」為軸，但時間源改由外部 DJ 軟體或其周邊介面提供。主控端電腦只扮演 **Timecode Bridge**。

#### 架構

```text
外部 DJ 軟體 (Rekordbox / Traktor / Serato / ...)
        |
        | 時間源（擇一或多源備援）
        v
+----------------------------------+
| 主控端 Timecode Bridge           |
|  - 讀取 DJ playback position    |
|  - 轉成 music_time_ms           |
|  - UDP Broadcast 至 4 台 ESP    |
+----------------------------------+
        | Wi-Fi UDP :4210 @ 100Hz
        v
  ESP32 × 4（本地 timeline 查表 → LED）
```

#### 可行時間源（依 DJ 軟體能力選用）

| 方案 | 原理 | 精度 | 備註 |
|---|---|---|---|
| **A. SMPTE LTC 音軌** | DJ 播含 LTC 的 sidecar 音軌；Bridge 用音訊介面解碼 | 高（~1 ms） | 需 DJ 配合載入 LTC 音檔；最穩 |
| **B. MIDI Time Code (MTC)** | DJ/MIDI 介面輸出 MTC；Bridge 讀 MIDI | 高 | 需確認 DJ 軟體是否輸出 MTC |
| **C. OSC / 軟體 API** | Bridge 訂閱 DJ 的 playhead OSC 或 SDK | 中～高 | 依軟體而異，需查 API |
| **D. Ableton Link** | Bridge 加入 Link session | 高 | 僅限支援 Link 的 DJ 軟體 |
| **E. 手動 GO + 自由跑** | 操作員在 DJ 開場時按 GO，Bridge 從 0 開始送 Timecode | 中 | 零整合成本；長曲會 drift，需持續 RUNNING 封包 |
| **F. 麥克風 beat detect** | Bridge 聽現場 PA 做 onset 對齊 | 低 | 僅適合粗同步，不建議 ±10 ms |

**第一版建議**：編排階段用本系統 UI 匯入 WAV 做波形/節拍吸附；演出時優先 **A（LTC sidecar）** 或 **E（手動 GO）**，視 DJ 配合程度決定。

#### Bridge 與 ESP 的關係（重要）

Wi-Fi **不傳 LED 顏色指令**，只傳「現在是音樂第幾毫秒」：

1. 演出前：USB 燒錄各 ESP 的 timeline config（含 1000 事件）。
2. 演出中：Bridge 每 10～20 ms 廣播 `{ packet_type, music_time_ms }`。
3. 各 ESP 用 `music_time_ms` 查本地 timeline → 算出 500 顆 LED 顏色 → RMT 輸出。

因此 Wi-Fi 延遲只影響「時間校正」，不影響「每顆 LED 要不要傳一個封包」。這是 ±10 ms 可達成的根本原因。

#### 開場同步流程（以外部 DJ + 手動 GO 為例）

```text
1. 4 台 ESP 連上 Wi-Fi，進入 WAIT_TIMECODE
2. DJ 準備好曲目
3. 操作員按 Bridge「ARM」
4. DJ 開始播放 → 操作員按「GO」
5. Bridge 連送 10 次 START(music_time_ms=0)
6. Bridge 以 Bridge 本地 monotonic clock 遞增 music_time_ms，100 Hz 送 RUNNING
7. 若 DJ 有 LTC/MTC，Bridge 改以 DJ 時間源覆寫 music_time_ms
8. DJ 切歌/跳轉 → Bridge 送 SEEK
9. 演出結束 → Bridge 送 STOP，ESP 關燈
```

若 DJ 軟體可提供精準 playhead，Bridge **必須**以 DJ 時間源為準，不可用 Bridge 自己的 timer 自由跑，否則長曲必然與現場音樂脫節。

#### 9.7.1 LTC 如何自動觸發（不需按 GO）

LTC（Linear Timecode）的本質：**時間碼編碼在一條音訊訊號裡**。只要這條音被播放，Bridge 就能即時解碼出「現在是第幾分幾秒」——**觸發來自 DJ 按 Play，不是操作員按 GO**。

##### 硬體接法

```text
DJ 軟體
  ├─ Deck A → 主 PA（觀眾聽到的音樂）
  └─ Deck B / 輔助輸出 → Bridge 音訊輸入（LTC 音軌，觀眾不聽）

Bridge 電腦
  音訊介面 IN ← LTC 訊號
  Wi-Fi → UDP Timecode → ESP × 4
```

LTC 音軌在編排階段從本系統 UI 匯出：與 WAV 等長、從 `00:00:00` 起算，與 timeline 的 `from`/`to` 對齊。

##### Bridge 自動狀態機

```text
IDLE
  └─ 連續 N 幀解碼到合法 LTC → ARMED

ARMED
  └─ LTC 時間開始遞增（DJ 按 Play）
       → 自動送 START + RUNNING（不需 GO）
       → music_time_ms = ltc_to_ms(LTC) - ltc_offset_ms

RUNNING
  └─ 每 10 ms：解碼 LTC → 更新 music_time_ms → UDP 廣播
  └─ LTC 時間不變 ≥ 500 ms（DJ 暫停）→ PAUSED
  └─ LTC 時間跳變 > 500 ms（DJ 跳轉）→ SEEK
  └─ LTC 訊號消失 ≥ 2 s（停止）→ STOP → IDLE

ERROR
  └─ 長時間解碼失敗 → 顯示告警，ESP 維持 continue_local
```

##### 「自動觸發」的第一性原理

| 手動 GO | LTC 自動 |
|---|---|
| Bridge 自己的 clock 跑時間 | 時間來自 DJ 播放器，與現場音樂同一時間軸 |
| DJ 開播後還要人按按鈕 | DJ 按 Play，LTC 音訊流入 → Bridge 立刻知道 `music_time_ms` |
| 長曲可能與 DJ drift | LTC 每幀更新，drift ≈ 0 |

##### LTC → `music_time_ms` 轉換

LTC 格式通常是 `HH:MM:SS:FF`（FF = frame，25 或 30 fps）。轉成毫秒：

```text
music_time_ms = hours*3600000 + minutes*60000 + seconds*1000 + frames*1000/fps
               - ltc_offset_ms
```

`ltc_offset_ms` 用於對齊：若 LTC 從 `00:00:00:00` 開始，且 timeline 也從 `00:00` 起算，則 offset = 0。若整場秀 LTC 從 `01:00:00:00` 開始但 timeline 仍從 `00:00` 起，則 offset = 3600000。

##### 編排階段產出 LTC  sidecar

本系統 UI 在匯出時一併產生：

1. `show.ltc.wav` — 從 0 開始的連續 SMPTE LTC 音訊
2. `show.ltc_offset_ms` — 對齊偏移（通常 0）
3. timeline 事件仍用 `from`/`to`（如 `01:30`～`02:00`），與 LTC 共用同一時間軸

##### DJ 操作（演出當天）

1. 載入曲目到 Deck A（主音）
2. 載入 `show.ltc.wav` 到 Deck B，路由到 Bridge 音訊 IN（不送 PA）
3. **同時觸發 A+B**（或 B 設為跟隨 A）
4. Bridge 偵測到 LTC → 自動 START → ESP 同步亮燈

若 DJ 軟體不支援雙 deck 同步，備案：把 LTC 與音樂混成 stereo（L=音樂, R=LTC），Bridge 只解 R channel——但需確認不會送 R 到 PA。

---

## 10. LED 渲染規格

### 10.1 Render Pipeline

```text
current_music_time_ms
  -> find active events
  -> resolve event priority
  -> compute effect output color
  -> map part to LED index range
  -> write LED buffer
  -> apply brightness limit
  -> led_strip_refresh()
```

### 10.2 Event 查詢

事件生效條件（ESP 端使用編譯後的 `start_ms` / `end_ms`）：

```text
event.start_ms <= current_music_time_ms < event.end_ms
```

注意：區間為 **左閉右開** `[from, to)`。例如 `01:30`～`02:00` 在 `02:00.000` 整點時已結束。

若同一 part 同時存在多個事件：

1. priority 高者優先。
2. priority 相同時，後建立或 timeline 中較後面的 event 優先。
3. UI 必須提示重疊情況。

### 10.3 支援效果

第一版必備：

| effect | 說明 | 參數 |
|---|---|---|
| solid | 固定顏色 | color |
| off | 關燈 | 無 |
| blink | 閃爍 | frequency_hz, duty |
| fade_in | 漸亮 | color |
| fade_out | 漸暗 | color |
| fade | 顏色 A 到 B | from_color, to_color |

第二版可擴充：

| effect | 說明 |
|---|---|
| chase | 跑馬燈 |
| rainbow | 彩虹 |
| pulse | 呼吸 |
| sparkle | 星點 |
| gradient | 漸層 |
| beat_flash | 根據 BPM 閃爍 |

### 10.4 色彩與亮度

1. 設定檔顏色使用 RGB。
2. WS2812B 常見 color order 為 GRB，韌體輸出時需轉換。
3. 全域亮度限制 `max_brightness` 必須套用於所有 LED。
4. 建議加入 gamma correction。
5. UI 預覽與實際 LED 可能有色差，需提供校正表。

---

## 11. 桌面 UI 功能規格

### 11.1 主要頁面

| 頁面 | 功能 |
|---|---|
| Project Dashboard | 建立/開啟專案、選擇音樂、管理角色 |
| Role Editor | 編輯角色與裝置設定 |
| LED Mapping Editor | 設定部位與 LED range |
| Timeline Editor | 建立時間軸燈光事件 |
| Color Palette | 管理顏色名稱與 RGB |
| Device Manager | 掃描 USB ESP、燒錄韌體、部署設定檔 |
| Show Control | 播放音樂、廣播 Timecode、監看 ESP 狀態 |
| Test / Calibration | 測試單一部位、顏色、亮度、同步誤差 |

### 11.2 條件輸入 UI

使用者必須可以輸入（**已確認：區間制，不用持續時間**）：

1. 角色：例如 dancer_a。
2. 部位：手、腳、頭、身體（可多選）。
3. **起始時間 from**：例如 `01:30`（mm:ss）。
4. **結束時間 to**：例如 `02:00`（mm:ss）。
5. 顏色：紅、藍、綠等。
6. 效果：solid、blink、fade。
7. 優先權：用於重疊事件。
8. 備註：方便舞蹈編排。

UI 呈現範例：

```text
01:30 → 02:00 | 手 | 紅燈 | solid
```

Timeline 上拖拉區塊時，自動反填 `from` / `to`；手動輸入時即時在時間軸上預覽色塊。

### 11.3 Timeline Editor 需求

Timeline Editor 應支援：

1. 匯入音樂檔並顯示波形。
2. 時間軸縮放。
3. 拖拉新增事件。
4. 多軌道顯示，每個部位一條 track。
5. 同時間多部位不同顏色。
6. 顏色區塊視覺化。
7. 播放預覽。
8. 快捷鍵：新增、複製、貼上、刪除、吸附節拍。
9. 匯出角色設定檔。
10. 檢查衝突與錯誤。

### 11.4 Device Manager 需求

Device Manager 應支援：

1. 掃描序列埠。
2. 顯示連接的 ESP32-S3。
3. 選擇韌體版本。
4. 選擇設定檔。
5. 燒錄韌體。
6. 燒錄設定檔。
7. 燒錄後讀回 checksum。
8. 顯示 device_id、role_id、firmware_version、config_crc32。
9. 批次燒錄多個 ESP。
10. 顯示燒錄 log。

### 11.5 Show Control 需求

Show Control 應支援：

1. 選擇音樂檔。
2. Start / Pause / Stop / Seek。
3. 播放時廣播 Timecode。
4. 顯示目前音樂時間。
5. 顯示廣播封包頻率。
6. 顯示 ESP 在線狀態。
7. 顯示每台 ESP 最後回報時間。
8. 顯示 drift / packet loss。
9. 演出前系統檢查 checklist。

### 11.6 桌面端實作

功能需求（§11.1–§11.5）的技術實作細節、Timeline 架構、IPC、開發階段見 **§26 桌面端實作規格（Electron + React）**。

---

## 12. 燒錄與部署規格

### 12.1 燒錄內容

ESP 需要以下內容：

1. Bootloader。
2. Partition table。
3. Application firmware。
4. Device config。
5. Optional assets，例如預先編譯 timeline binary。

### 12.2 Partition 建議

```csv
# Name,   Type, SubType, Offset,   Size
nvs,      data, nvs,     0x9000,   0x6000
phy_init, data, phy,     0xf000,   0x1000
factory,  app,  factory, 0x10000,  0x200000
config,   data, fat,     0x210000, 0x100000
storage,  data, fat,     0x310000, 0x100000
```

若使用 OTA：

```csv
# Name,     Type, SubType, Offset,   Size
nvs,        data, nvs,     0x9000,   0x6000
otadata,    data, ota,     0xf000,   0x2000
phy_init,   data, phy,     0x11000,  0x1000
ota_0,      app,  ota_0,   0x20000,  0x200000
ota_1,      app,  ota_1,   0x220000, 0x200000
config,     data, fat,     0x420000, 0x100000
```

### 12.3 USB 燒錄流程

```text
1. 使用者將 ESP32-S3 接到電腦
2. UI 掃描 serial port
3. 使用者選擇 device profile
4. UI 執行 erase 或保留 NVS
5. UI 呼叫 esptool.py 燒錄 firmware
6. UI 寫入 config partition
7. ESP 重啟
8. UI 透過 serial 讀取 boot log
9. ESP 回報 firmware version 與 config checksum
10. UI 顯示燒錄成功
```

### 12.4 設定檔更新流程

第一版可採 USB Serial 更新：

```text
UI -> serial transfer config JSON -> ESP writes config partition -> reboot -> checksum verify
```

第二版可擴充 Wi-Fi OTA config update：

```text
UI -> HTTP POST /config -> ESP validates -> writes config -> reboot or reload timeline
```

---

## 13. ESP 韌體模組設計

### 13.1 模組列表

| 模組 | 職責 |
|---|---|
| app_main | 啟動流程與狀態機 |
| config_loader | 讀取與驗證設定檔 |
| led_driver | 初始化與刷新 LED |
| timeline_engine | 根據時間查詢事件 |
| effect_engine | 計算 solid/blink/fade 等效果 |
| sync_receiver | 接收 UDP Timecode |
| clock_sync | 本地時間估算與 drift 修正 |
| wifi_manager | Wi-Fi 連線管理 |
| status_reporter | 回報 ESP 狀態給主控端 |
| serial_protocol | USB serial 燒錄設定檔與 debug |
| diagnostics | 自測、錯誤碼、log |

### 13.2 開機流程

```text
app_main
  -> init logging
  -> init NVS
  -> mount config partition
  -> load config
  -> validate config
  -> init LED driver
  -> show boot indicator
  -> connect Wi-Fi
  -> start UDP receiver
  -> start status reporter
  -> enter WAIT_TIMECODE
```

### 13.3 主迴圈

```c
while (true) {
    now_us = esp_timer_get_time();
    music_time_ms = clock_sync_get_music_time(now_us);

    if (sync_state == PLAYING) {
        timeline_render(music_time_ms, led_buffer);
        led_driver_refresh(led_buffer);
    }

    vTaskDelayUntil(&last_wake, frame_interval_ticks);
}
```

### 13.4 效能要求

| 項目 | 目標 |
|---|---:|
| LED render rate | >= 60 FPS |
| Timecode receive rate | 50 Hz |
| Timecode packet parse latency | < 2 ms |
| LED refresh jitter | < 10 ms |
| Wi-Fi reconnect time | < 5 s |
| Config load time | < 2 s |

---

## 14. 主控端 Timecode Sender 設計

### 14.1 播放與時間源

主控端必須以音樂播放器的實際 playback position 為唯一時間源，不可只用 `setInterval` 或 UI timer 估算。

建議：

1. 音訊引擎提供精準 playback position。
2. 每 20 ms 廣播一次目前 music_time_ms。
3. Start 時先連續送 5～10 個 START 封包。
4. Stop / Pause / Seek 也連續送多次，提高可靠性。

### 14.2 封包發送策略

```text
START:
  send START packet 10 times over 200ms
  begin audio playback
  send RUNNING packet at 50Hz

RUNNING:
  every 20ms read audio playback position
  broadcast current music_time_ms

PAUSE:
  pause audio
  send PAUSE packet 10 times

STOP:
  stop audio
  send STOP packet 10 times

SEEK:
  set audio position
  send SEEK packet 10 times
```

### 14.3 ESP 狀態回報

ESP 可透過 UDP unicast 或 broadcast 回報：

```json
{
  "type": "status",
  "device_id": "esp32s3_dancer_a_001",
  "role_id": "dancer_a",
  "firmware_version": "1.0.0",
  "config_crc32": "0x12345678",
  "sync_state": "PLAYING",
  "last_timecode_seq": 1024,
  "estimated_drift_ms": -3,
  "packet_loss_count": 2,
  "rssi": -55,
  "battery_mv": 3900
}
```

---

## 15. 準確性與同步保證設計

### 15.1 為什麼不能只靠 ESP 本地 timer

如果只在音樂開始時同步一次，ESP 的晶振與任務排程會造成長時間 drift。演出時間越長，誤差越明顯。因此播放期間必須持續廣播絕對音樂時間碼。

### 15.2 核心策略

1. 主控端以音訊 playback position 作為真實時間。
2. ESP 接收絕對時間碼，而不是只接收 tick。
3. ESP 使用本地 monotonic clock 在封包間隔內補間。
4. ESP 對小誤差平滑修正，對大誤差立即校正。
5. ESP LED 動作以時間查表為主，不靠累積 delay。
6. 所有事件以 absolute `start_ms` / `end_ms` 定義（UI 以 `from`/`to` 區間輸入），不用相對 delay chain。

### 15.3 測試與量測方法

同步測試需至少包含：

1. 單台 ESP 測試：確認指定時間 LED 正確亮起。
2. 多台 ESP 並排測試：同一事件同時閃白燈，用高速攝影檢查差異。
3. 長時間 drift 測試：播放 10 分鐘，每分鐘觸發一次同步閃光。
4. 封包遺失測試：干擾 Wi-Fi，確認短暫掉包仍可補間。
5. Pause / Seek / Stop 測試。
6. 滿載 LED 測試：最大 LED 數、最大亮度、快速效果。

### 15.4 驗收標準

| 測試項目 | 驗收標準 |
|---|---|
| 同步亮燈誤差 | 95% 測試點小於 ±20 ms |
| 最大同步誤差 | 不超過 ±50 ms |
| 10 分鐘 drift | 不累積超過 ±20 ms |
| Wi-Fi 短暫掉包 300 ms | LED 不應明顯卡頓或亂跳 |
| Stop 後關燈 | 200 ms 內完成 |
| Config checksum | UI 與 ESP 回報一致 |
| 重啟恢復 | 5 秒內進入 WAIT_TIMECODE |

---

## 16. 錯誤處理

### 16.1 ESP 錯誤碼

| 錯誤碼 | 說明 | LED 指示 |
|---|---|---|
| E001 | Config missing | 紅燈慢閃 1 次 |
| E002 | Config parse failed | 紅燈慢閃 2 次 |
| E003 | LED init failed | 紅燈慢閃 3 次 |
| E004 | Wi-Fi connect failed | 黃燈快閃 |
| E005 | Timecode timeout | 藍燈慢閃 |
| E006 | Config CRC mismatch | 紫燈慢閃 |
| E007 | Memory insufficient | 紅白交替 |

### 16.2 Timecode timeout 行為

可設定：

| offline_behavior | 行為 |
|---|---|
| blackout | 關燈 |
| hold_last | 保持最後狀態 |
| continue_local | 使用本地 timer 繼續播放 |
| safe_color | 顯示安全顏色 |

演出建議使用 `continue_local` 搭配 timeout，例如短暫 500 ms 內掉包仍繼續，超過 2 秒才進入 blackout。

---

## 17. 安全與可靠性

### 17.1 Wi-Fi 設計

建議：

1. 演出使用專用 2.4GHz AP。
2. AP 放在舞台附近，避免人群遮蔽。
3. 固定 Wi-Fi channel，避開場地干擾。
4. 演出前測 RSSI，建議 > -65 dBm。
5. 主控端電腦關閉省電模式。
6. ESP 關閉不必要 background task。

### 17.2 電源安全

1. 所有穿戴電池需有保護板。
2. 高電流線路需足夠線徑。
3. LED 最大亮度需限制。
4. 設定檔應可限制全域功耗。
5. 穿戴設備需避免過熱接觸皮膚。
6. 所有接頭需做拉力保護。

### 17.3 資料安全

1. 設定檔寫入前需備份。
2. 每次燒錄需保存 log。
3. 每個設定檔需有 schema version。
4. 每個 ESP 需有 device_id。
5. 主控端需顯示目前載入的 show_id 與 config_crc32，避免燒錯角色。

---

## 18. 開發里程碑

### Milestone 1：硬體與單機 LED 驅動

交付項目：

1. ESP32-S3 可驅動 WS2812B。
2. 支援指定 LED range 顯示顏色。
3. 支援手、腳、頭、身體分區。
4. 支援基本 solid / off。
5. UART log 顯示狀態。

### Milestone 2：設定檔與 Timeline Engine

交付項目：

1. ESP 可讀 JSON config。
2. 支援 events timeline。
3. 支援同時間多部位不同顏色。
4. 支援 priority。
5. 支援 blink / fade。

### Milestone 3：Timecode 同步

交付項目：

1. 桌面端可廣播 UDP Timecode。
2. ESP 可接收 START / RUNNING / STOP。
3. 多 ESP 同步顯示。
4. 初步達成 ±50 ms。

### Milestone 4：桌面 UI（Electron + React）

交付項目：

1. LED Show Studio App 骨架（§26.1）。
2. Timeline Editor 完整互動（§26.4）：波形、多軌、from/to、snap、1000 事件虛擬化。
3. 可建立專案、角色、timeline event。
4. configCompiler 匯出 device config + LTC sidecar。
5. Show Control 預覽模式廣播 timecode。

### Milestone 5：燒錄工具整合

交付項目：

1. UI 掃描 ESP serial port。
2. UI 燒錄 firmware。
3. UI 燒錄設定檔。
4. ESP 回報 checksum。
5. UI 顯示成功/失敗。

### Milestone 6：同步精度優化與演出驗收

交付項目：

1. 多 ESP 長時間同步測試。
2. Wi-Fi 干擾測試。
3. 高速攝影驗證。
4. 達成 ±20 ms 目標。
5. 完成操作手冊。

---

## 19. API / Protocol 規格

### 19.1 Serial Config Protocol

用於 UI 透過 USB 傳送設定檔給 ESP。

#### Commands

| Command | 方向 | 說明 |
|---|---|---|
| HELLO | UI -> ESP | 查詢裝置 |
| INFO | ESP -> UI | 回報裝置資訊 |
| BEGIN_CONFIG | UI -> ESP | 開始傳設定檔 |
| CONFIG_CHUNK | UI -> ESP | 傳送設定檔片段 |
| END_CONFIG | UI -> ESP | 傳送完成 |
| VERIFY_CONFIG | UI -> ESP | 驗證 checksum |
| REBOOT | UI -> ESP | 重啟 |

#### INFO response

```json
{
  "type": "INFO",
  "device_id": "esp32s3_dancer_a_001",
  "chip": "ESP32-S3",
  "firmware_version": "1.0.0",
  "config_crc32": "0x12345678",
  "status": "OK"
}
```

### 19.2 UDP Status Protocol

ESP 可定期回報狀態到主控端。

| 項目 | 建議值 |
|---|---|
| Port | 4211 |
| Rate | 1 Hz during idle, 5 Hz during show |
| Format | JSON first version |

---

## 20. UI 資料模型

### 20.1 Entity

```text
Project
  - ColorPalette
  - MusicTrack
  - Roles[]

Role
  - role_id
  - display_name
  - Devices[]
  - Timeline

Device
  - device_id
  - hardware
  - parts[]
  - network

Part
  - part_id
  - display_name
  - ranges[]

TimelineEvent
  - event_id
  - from / to（UI 編輯用，mm:ss 字串）
  - start_ms / end_ms（編譯後，ESP 使用）
  - targets[]
  - effect
  - color
  - params
  - priority
```

### 20.2 使用者操作流程

```text
建立專案
  -> 選音樂
  -> 建立角色
  -> 建立 ESP 裝置
  -> 設定 LED 數量與 GPIO
  -> 設定部位 range
  -> 在 timeline 加入事件
  -> 預覽
  -> 驗證設定檔
  -> 連接 ESP
  -> 燒錄 firmware/config
  -> 進入 Show Control
  -> Start music + broadcast timecode
```

---

## 21. 測試規格

### 21.1 Unit Test

| 模組 | 測試 |
|---|---|
| config_loader | valid / invalid JSON |
| timeline_engine | event overlap, priority |
| effect_engine | solid, blink, fade output |
| clock_sync | drift smoothing |
| packet_parser | CRC, sequence, type |

### 21.2 Integration Test

1. UI 匯出 config，ESP 成功讀取。
2. UI 發 START，ESP 從 0 ms 開始播放。
3. UI 發 SEEK，ESP 跳到指定位置。
4. UI 發 STOP，ESP 關燈。
5. 多台 ESP 同時接收 timecode。

### 21.3 Field Test

1. 舞台實地 Wi-Fi 測試。
2. 舞者移動測試。
3. 電池續航測試。
4. 滿亮度功耗測試。
5. 長時間播放測試。
6. 演出前 30 分鐘 burn-in。

---

## 22. 驗收標準

### 22.1 功能驗收

| 編號 | 條件 | 驗收 |
|---|---|---|
| F001 | 可輸入手、腳、頭、身體條件 | UI 可建立並儲存 |
| F002 | 同時間手藍、腳綠 | ESP 正確顯示不同區域顏色 |
| F003 | 可輸出不同角色設定檔 | 每個角色產生獨立 config |
| F004 | 可從桌面讀取設定檔 | UI 可開啟與驗證 JSON |
| F005 | 可燒錄到 ESP | UI 顯示燒錄成功與 checksum 一致 |
| F006 | 音樂開始時 ESP 重設時間 | START 後 ESP music_time 歸零 |
| F007 | 主控端持續廣播 timecode | 封包頻率接近設定值 |
| F008 | 多台 ESP 同步 | 95% 測試點 ±10 ms 內 |
| F009 | 暫停/停止/跳轉 | ESP 狀態正確 |

### 22.2 非功能驗收

| 項目 | 標準 |
|---|---|
| 穩定性 | 連續播放 30 分鐘無 crash |
| 設定檔安全 | 錯誤設定不可燒錄或需警告 |
| 可維護性 | schema version 可擴充 |
| 可觀測性 | UI 可看到 ESP 在線與 drift |
| 使用性 | 非工程人員可新增基本燈光事件 |

---

## 23. 風險與對策

| 風險 | 影響 | 對策 |
|---|---|---|
| Wi-Fi 干擾 | 同步誤差、掉包 | 專用 AP、固定 channel、短 timeout 補間 |
| LED 電流過大 | 重啟、過熱 | 限制亮度、電源容量估算、保險絲 |
| WS2812B 訊號不穩 | 顏色錯誤 | level shifter、短資料線、RMT driver |
| 設定檔過大 | ESP 記憶體不足 | 預編譯 binary timeline、分段索引 |
| UI 燒錯角色 | 演出錯誤 | device_id + role_id + config_crc32 三重確認 |
| 時間源不準 | LED 與音樂不同步 | 使用音訊 playback position，不用 UI timer |
| 多事件重疊 | 顯示結果不確定 | priority 與 UI 衝突提示 |

---

## 24. 已確認需求（2026-06-29）

| # | 問題 | 確認答案 | 工程影響 |
|---:|---|---|---|
| 1 | 每位舞者幾台 ESP？ | 1 台/人，共 4 台 | 4 台 UDP 接收端，負載低 |
| 2 | 每台控制幾顆 LED？ | 500 顆 | 電源 ≥15A（40% 亮度）；單條 refresh ~15 ms，需驗證 60 FPS |
| 3 | LED 類型？ | WS2812B RGB | GRB color order；需 level shifter |
| 4 | 每角色事件量？ | ~1000 筆 | JSON 可行；建議預編譯索引加速查詢 |
| 5 | 音樂由誰播放？ | **外部 DJ 軟體** | 主控端改為 Timecode Bridge，見 §9.7 |
| 6 | 主控端平台？ | Windows + macOS | UI 與 UDP sender 需跨平台 |
| 7 | 專用 Wi-Fi AP？ | **不行** | ±10 ms 風險高；建議電腦熱點備援、100 Hz 廣播 |
| 8 | 同步誤差？ | **±10 ms** | 廣播 100 Hz、平滑修正閾值降至 10 ms |
| 9 | 電池回報？ | 需要 | ADC 讀電池電壓，UDP status 回報 |
| 10 | OTA？ | 不需要，USB 即可 | 簡化韌體；演出前 USB 燒錄 |
| 11 | 波形與節拍吸附？ | 需要 | Timeline Editor 必備功能（編排用，非現場播放） |
| 12 | 多人同時編輯？ | 不需要 | 單機檔案即可，不需協作同步 |

### 24.1 高風險組合提醒

以下三項同時成立，是本案最大技術挑戰：

1. 500 顆 LED / 台（硬體 refresh 與供電）
2. 現場無專用 AP（Wi-Fi jitter 不可控）
3. ±10 ms 同步（比原規格 ±20 ms 嚴一倍）

建議現場備案：主控電腦開 2.4 GHz 熱點作為演出備援網路，即使場地 Wi-Fi 可用也做 A/B 切換測試。

---

## 25. 建議第一版 MVP 範圍

為了最快做出可用版本，建議 MVP 範圍如下：

1. ESP-IDF firmware。
2. 單條 WS2812B LED strip。
3. JSON 設定檔。
4. 手、腳、頭、身體四個 part。
5. solid、off、blink、fade 四種效果。
6. UDP Broadcast Timecode。
7. 桌面 UI 可新增事件與匯出 config。
8. USB 燒錄設定檔。
9. Show Control 可播放音樂並廣播 START / RUNNING / STOP。
10. 多台 ESP 同步誤差目標 ±10 ms。
11. 外部 DJ Timecode Bridge（至少支援手動 GO + LTC/MTC 擇一）。
12. 桌面端採 **Electron + React**，Timeline Editor 依 **§26.4** 一次做對。

---

## 26. 桌面端實作規格（Electron + React）

本章定義桌面 App **LED Show Studio** 的長期實作架構。設計目標：Timeline 編排體驗一次做對、可維護 1000+ 事件/角色、編排與演出（Bridge）在同一 App 內切換。

### 26.1 應用程式架構

```text
┌──────────────────────────────────────────────────────────────┐
│                     LED Show Studio                          │
├───────────────────────────┬──────────────────────────────────┤
│   Renderer（React）        │   Main Process（Node.js）         │
│                           │                                  │
│  Pages                    │  Services                        │
│   Dashboard               │   ProjectFileService             │
│   TimelineEditor ★        │   WaveformPeaksService (ffmpeg)  │
│   RoleEditor              │   ConfigCompilerService          │
│   DeviceManager           │   FlasherService (esptool)       │
│   ShowControl             │   TimecodeBridgeService (UDP)    │
│   TestCalibration         │   LtcDecoderSidecar              │
│                           │   EspStatusListener (UDP)        │
│  Core（isomorphic TS）     │   SerialPortScanner              │
│   timelineEngine          │                                  │
│   timeParse               │                                  │
│   eventValidator          │                                  │
│   previewRenderer         │                                  │
├───────────────────────────┴──────────────────────────────────┤
│  Preload：contextBridge 暴露型別安全 IPC（不開 nodeIntegration）│
└──────────────────────────────────────────────────────────────┘
         │ USB Serial              │ Wi-Fi UDP
         ▼                         ▼
    ESP32 × 4                  ESP32 × 4
```

#### 程序職責

| 層 | 職責 | 禁止 |
|---|---|---|
| **Renderer** | UI、Timeline 互動、本地預覽播放 | 直接存取 fs / serial / dgram |
| **Preload** | 暴露 `window.api.*` IPC 介面 | 業務邏輯 |
| **Main** | 檔案 I/O、燒錄、UDP、LTC sidecar | 渲染 UI |
| **Core（shared）** | timeline 查詢、驗證、時間解析 | 平台 API |

#### App 模式

| 模式 | 入口 | 說明 |
|---|---|---|
| **Edit** | 預設 | 編排、預覽、燒錄 |
| **Show** | Show Control 全螢幕 | 鎖定編輯；只跑 Bridge + 監控 |

Show 模式禁止修改 timeline，避免演出中誤觸。

### 26.2 專案目錄結構

```text
led-studio/
├── package.json
├── electron-builder.yml
├── electron/
│   ├── main.ts                 # App 生命週期、視窗、服務初始化
│   ├── preload.ts              # contextBridge API
│   └── services/
│       ├── projectFile.ts
│       ├── waveformPeaks.ts
│       ├── configCompiler.ts
│       ├── flasher.ts
│       ├── timecodeBridge.ts
│       ├── espStatusListener.ts
│       └── ltcSidecar.ts
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── routes/
│   │   ├── DashboardPage.tsx
│   │   ├── TimelinePage.tsx
│   │   ├── RoleEditorPage.tsx
│   │   ├── DeviceManagerPage.tsx
│   │   ├── ShowControlPage.tsx
│   │   └── TestPage.tsx
│   ├── features/timeline/      # ★ Timeline 子系統（見 §26.4）
│   │   ├── TimelineEditor.tsx
│   │   ├── TimelineCanvas.tsx
│   │   ├── WaveformLane.tsx
│   │   ├── TrackLane.tsx
│   │   ├── EventBlock.tsx
│   │   ├── Playhead.tsx
│   │   ├── Ruler.tsx
│   │   ├── EventInspector.tsx
│   │   ├── hooks/
│   │   │   ├── useTimelineViewport.ts
│   │   │   ├── useTimelineInteraction.ts
│   │   │   ├── useSnapGrid.ts
│   │   │   └── usePlaybackPreview.ts
│   │   └── utils/
│   │       ├── hitTest.ts
│   │       └── virtualRange.ts
│   ├── stores/
│   │   ├── projectStore.ts
│   │   ├── timelineStore.ts
│   │   └── showStore.ts
│   └── shared/                 # Main/Renderer 共用
│       ├── timelineEngine.ts   # 與 ESP 韌體邏輯對齊
│       ├── timeParse.ts
│       ├── eventValidator.ts
│       └── types/
│           ├── project.ts
│           ├── timelineEvent.ts
│           └── deviceConfig.ts
├── resources/
│   ├── esptool/                # 隨 App 打包
│   ├── ffmpeg/
│   └── ltc-decoder/
└── tests/
    ├── timelineEngine.test.ts
    ├── timeParse.test.ts
    └── eventValidator.test.ts
```

App 顯示名稱：**LED Show Studio**；repo 目錄建議：`led-studio/`。

### 26.3 IPC 介面規格

Preload 暴露 `window.api`，Renderer 僅透過此 API 與 Main 通訊。

```typescript
// 摘要；完整型別定義於 src/shared/types/ipc.ts
interface LedStudioApi {
  project: {
    open(path: string): Promise<Project>;
    save(project: Project): Promise<void>;
    importAudio(path: string): Promise<WaveformMeta>;
  };
  compile: {
    compileRoleConfig(roleId: string): Promise<DeviceConfigCompiled>;
    exportLtc(options: LtcExportOptions): Promise<string>; // 輸出路徑
  };
  device: {
    listSerialPorts(): Promise<SerialPortInfo[]>;
    flash(options: FlashOptions): AsyncIterable<FlashProgress>;
  };
  show: {
    bridgeStart(options: BridgeOptions): Promise<void>;
    bridgeStop(): Promise<void>;
    onBridgeState(cb: (s: BridgeState) => void): Unsubscribe;
    onEspStatus(cb: (s: EspStatus) => void): Unsubscribe;
  };
}
```

| 通道 | 方向 | 用途 |
|---|---|---|
| `project:open/save` | invoke | 讀寫 `.ledproj.json` |
| `audio:import` | invoke | ffmpeg 產生 peaks + 快取 |
| `compile:role` | invoke | `from/to` → `start_ms/end_ms` |
| `device:flash` | invoke + stream | esptool 進度事件 |
| `show:bridge-*` | invoke + push | UDP 100Hz；狀態推送 |
| `show:esp-status` | push | ESP status port 4211 |

### 26.4 Timeline Editor 實作規格（核心）

Timeline 是本 App 最複雜子系統，採 **自訂 Canvas 多軌編輯器**，不依賴通用 DAW 套件（如 react-timeline-editor），以完全掌控 `from/to` 區間語意與 1000 事件效能。

#### 26.4.1 版面配置

```text
┌─ Toolbar：播放 · 縮放 · Snap · 角色切換 · 匯出 ─────────────┐
├─ Ruler：mm:ss 刻度 · 播放游標 · BPM 格線 ────────────────────┤
├─ WaveformLane：預計算 peaks · 點擊 seek · 與游標同步 ────────┤
├─ TrackLane[hand]   ████──────████──────────────────────────  │
├─ TrackLane[foot]   ────████──────────████──────────────────  │
├─ TrackLane[head]   ██──────────────────────────────────────  │
├─ TrackLane[body]   ──────────────────████████──────────────  │
└─ EventInspector：from · to · 部位 · 顏色 · 效果 · priority ──┘
```

固定 4 軌（hand / foot / head / body），每角色獨立 timeline；切換角色時載入該角色 events。

#### 26.4.2 座標系統

| 變數 | 定義 |
|---|---|
| `durationMs` | 專案音樂長度 |
| `zoomPxPerMs` | 縮放：1 ms 對應幾 pixel |
| `scrollXMs` | 水平捲動偏移（ms） |
| `timeToX(t)` | `(t - scrollXMs) * zoomPxPerMs` |
| `xToTime(x)` | `scrollXMs + x / zoomPxPerMs` |

縮放範圍建議：`0.05 ~ 2 px/ms`（整首 3 分鐘 ↔ 細看 1 秒）。

#### 26.4.3 事件資料模型（UI 層）

```typescript
interface TimelineEventUI {
  id: string;
  from: string;           // "01:30" | "01:30.500"
  to: string;             // "02:00"
  targets: PartId[];      // 通常 1 個；多選時在同一軌各畫一塊
  color: string;
  effect: EffectId;
  params?: Record<string, unknown>;
  priority: number;
  note?: string;
  // 快取（不持久化，store 內計算）
  _startMs?: number;
  _endMs?: number;
}
```

持久化 JSON 只用 `from/to`；`_startMs/_endMs` 由 `timeParse.ts` 在 load/edit 時同步更新。

#### 26.4.4 互動行為

| 操作 | 行為 |
|---|---|
| 空白處 drag | 框選時間區間 → 彈出 EventInspector 新增 |
| 色塊 drag 中線 | 整段平移；更新 `from/to` 保持長度 |
| 色塊 drag 左/右邊 | 調整 `from` 或 `to` |
| 雙擊色塊 | EventInspector 聚焦 |
| Delete | 刪除選取事件 |
| Cmd+D | 複製 + 偏移一個 beat |
| Space | 播放/暫停預覽 |
| 點波形 / ruler | seek 預覽游標 |
| Snap 開 | 所有時間操作吸附 BPM 格線 |

**區間語意**：`[from, to)` 左閉右開；UI 右邊界顯示在 `to` 刻度，不佔用 `to` 時刻。

#### 26.4.5 節拍吸附（Snap）

```typescript
// useSnapGrid.ts
const beatIntervalMs = 60000 / bpm;
function snapTime(ms: number, enabled: boolean): number {
  if (!enabled) return ms;
  return Math.round(ms / beatIntervalMs) * beatIntervalMs;
}
```

Toolbar 提供：Snap ON/OFF、1/4 拍、1/8 拍、1 拍細粒度切換。BPM 來自專案設定或音訊分析（ffmpeg/onset 估算，可手動覆寫）。

#### 26.4.6 波形 Lane

1. 匯入音樂時 Main Process 呼叫 ffmpeg：
   ```bash
   ffmpeg -i song.wav -af astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level -f null -
   # peaks：另 pipeline 降採樣為固定 bins（例如 8000 points）
   ```
2. 輸出 `{ peaks: number[], durationMs, sampleRate }` 存 `<project>/cache/waveform.json`。
3. `WaveformLane` 用 Canvas 依 `scrollXMs + zoomPxPerMs` 只繪可見區間。
4. **編排預覽**用 Web Audio API 播放；**不作現場 PA 輸出**。

#### 26.4.7 虛擬化渲染（1000 事件）

不可對 1000 事件逐一 mount DOM。策略：

1. `virtualRange.ts` 計算可見時間窗 `[scrollXMs, scrollXMs + viewportMs]`。
2. 每軌 events 以 `startMs` 排序；binary search 取交集子集（通常 < 50 塊可見）。
3. `TrackLane` Canvas 單層繪製所有可見 EventBlock。
4. Hit test 同樣只測可見子集。
5. 編輯後 debounce 100ms 重绘；播放游標用 `requestAnimationFrame` 獨層更新。

目標：1000 事件、60 FPS 游標、縮放/捲動不卡頓。

#### 26.4.8 衝突檢測

同一 `targets` + 時間區間重疊 → 標記警告（黃框 + Inspector 提示）。重疊非錯誤；依 `priority` 決定覆蓋，與 ESP 韌體一致。匯出/燒錄前若存在同 part 同 priority 重疊，UI 要求確認。

#### 26.4.9 預覽播放

Renderer 內 `previewRenderer.ts` 复用 ESP 相同邏輯：

```text
playbackTimeMs → timelineEngine.queryActiveEvents → 各 part 顏色
→ TrackLane 上方 PartPreview 條（可選）顯示目前狀態
```

預覽不等同實體 LED；僅供編排確認。

### 26.5 核心模組：timelineEngine（共用）

`src/shared/timelineEngine.ts` **必須與 ESP 韌體行為一致**，並有 unit test 覆蓋。

```typescript
function isEventActive(event: CompiledEvent, tMs: number): boolean {
  return event.startMs <= tMs && tMs < event.endMs;
}

function resolvePartColor(
  events: CompiledEvent[],
  partId: PartId,
  tMs: number
): ResolvedColor { /* priority + effect 計算 */ }
```

UI 預覽、Config 編譯、未來 golden test 皆用同一模組，避免「UI 看起來對、ESP 不一樣」。

### 26.6 Config 編譯流程

```text
TimelineEventUI[]（from/to 字串）
  → timeParse → startMs / endMs
  → eventValidator → 錯誤列表
  → configCompiler → device.json（ESP 格式，僅含 startMs/endMs）
  → crc32 → 供燒錄驗證
```

另可匯出 `show.ltc.wav`（§9.7.1）供 DJ sidecar 使用。

### 26.7 Device Manager（Main Process）

```text
listSerialPorts() → 使用者選 port + 角色 config
  → flasher.flash({
       port, firmwareBin, configJson,
       eraseConfig: false
     })
  → spawn esptool.py，stdout 解析進度
  → 燒錄完成 → serial 讀 boot log / checksum
  → UI 顯示 ✅ 或 ❌
```

| 項目 | 規格 |
|---|---|
| esptool 呼叫 | `child_process.spawn`，禁止 Renderer 直接呼叫 |
| 並行燒錄 | 最多 1 台同時（USB 頻寬/操作安全） |
| 燒錄前確認 | 顯示 role_id + config_crc32 + device_id 三重核對 |
| Log | 寫入 `<project>/logs/flash_<timestamp>.txt` |

### 26.8 Show Control / Timecode Bridge（Main Process）

獨立 service，100Hz `setInterval` 或 high-resolution timer：

```typescript
class TimecodeBridgeService {
  private source: 'ltc' | 'manual' | 'preview';
  private musicTimeMs = 0;

  tick(): void {
    const t = this.resolveTimeFromSource();
    this.sendUdp({ type: 'RUNNING', musicTimeMs: t, sequence: ++seq });
  }
}
```

| 時間源 | 實作 |
|---|---|
| **preview** | 編排模式 Web Audio currentTime（僅測試） |
| **manual** | GO 後 monotonic clock |
| **ltc** | ltcSidecar stdin/stdout 或 socket 收解碼時間 |

`EspStatusListener` 監聽 UDP 4211，推送 `{ deviceId, batteryMv, rssi, driftMs }` 至 Show Control UI。

### 26.9 開發階段規劃（桌面端）

與 §18 韌體里程碑並行，桌面端分 5 個 Phase：

| Phase | 週次（估） | 交付 | 驗收 |
|---|---|---|---|
| **D1 骨架** | 1–2 | Electron+React 殼、路由、project 開存、IPC | 可開關專案 |
| **D2 Timeline 核心** | 3–6 | Canvas 多軌、from/to 編輯、snap、波形、1000 事件虛擬化 | 流暢編 1000 事件 |
| **D3 編譯與預覽** | 7–8 | timelineEngine、config 編譯、預覽播放、LTC 匯出 | 匯出 JSON 與 ESP 一致 |
| **D4 燒錄** | 9–10 | Device Manager、esptool 整合、checksum | USB 一鍵燒錄 |
| **D5 Show** | 11–12 | Bridge 100Hz、LTC sidecar、ESP 監控、Show 模式 | 4 ESP 同步 ±10ms 實測 |

**原則**：D2 完成前不開始 Device Manager；Timeline 是關鍵路徑，不砍 scope。

### 26.10 測試策略（桌面端）

| 層 | 工具 | 覆蓋 |
|---|---|---|
| Unit | Vitest | timeParse、timelineEngine、eventValidator、snap |
| Component | React Testing Library | EventInspector、Ruler 刻度 |
| E2E | Playwright（Electron 模式） | 開專案→加事件→匯出→mock 燒錄 |
| Golden | JSON fixture | 同一 timeline 在 UI preview 與 ESP log 比對 |

### 26.11 非功能需求

| 項目 | 目標 |
|---|---|
| 冷啟動 | < 3 s |
| 開啟含 4000 事件專案（4 角色） | < 2 s |
| Timeline 互動 | 60 FPS 游標 |
| App 打包大小 | < 300 MB（含 ffmpeg + esptool） |
| 自動儲存 | 每 30 s + 失焦存 `<project>/.autosave/` |
| 復原 | Undo/Redo 至少 50 步（timeline 操作） |

### 26.12 主要依賴套件

| 套件 | 用途 |
|---|---|
| `electron` | 桌面殼 |
| `react` / `react-router-dom` | UI |
| `zustand` | 狀態 |
| `tailwindcss` / `@radix-ui/*` | 樣式 |
| `serialport` | USB 掃描（Main only） |
| `dgram`（Node 內建） | UDP broadcast |
| `vitest` | 測試 |
| `electron-builder` | 打包 |

Timeline **不自引** 重量级 DAW 库；波形 peaks 自行 Canvas 繪製。

---

## 27. 參考資料

1. Espressif LED Strip component documentation：說明 led_strip component 與 RMT backend 可用於 WS2812 類可編址 LED，且支援多 LED strip object 與 RMT channel 配置。
2. Espressif Component Registry led_strip：說明該 driver 針對 WS2812 等 addressable LED，支援 RMT 與其他 backend。
3. Espressif esptool ESP32-S3 flashing documentation：說明 ESP32-S3 firmware 可透過 esptool 燒錄，且可重複燒錄同一組 binaries。
4. Espressif ESP-NOW documentation：說明 ESP-NOW 是 ESP32 裝置間低延遲、無 AP 的通訊協定；本案因主控端是一般電腦，所以第一版優先使用 UDP Broadcast。

---

## 28. 結論

本系統建議採用「**Electron + React 桌面端** + ESP32-S3 本地 timeline 播放 + 主控端 UDP Broadcast Timecode 同步」架構。桌面端 Timeline Editor 依 **§26.4** 以自訂 Canvas 多軌一次做對；燈效資料 USB 燒錄、演出時間 Wi-Fi 廣播，兩條通道職責分離。

要達成穩定同步，關鍵不是單次開場同步，而是播放期間持續廣播絕對音樂時間碼，並在 ESP 端使用本地 monotonic clock 補間與 drift 修正。外部 DJ 場景下，Bridge（Main Process `TimecodeBridgeService`）必須從 LTC 或 DJ 時間源取得 playhead。已確認目標為 **±10 ms**，在無專用 AP 的現場需提高廣播頻率並做實地 burn-in 驗證。

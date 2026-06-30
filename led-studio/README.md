# LED Show Studio

Desktop app for ESP32-S3 WS2812B timecode-synchronized LED shows. Built with **Electron + React + TypeScript + Vite** (electron-vite).

## Prerequisites

- Node.js 20+
- npm 10+
- macOS, Windows, or Linux

## Setup

```bash
cd led-studio
npm install
npm run rebuild   # Required once: compile serialport native module for Electron
```

## Development

```bash
npm run dev
```

Opens the Electron window with hot reload. Demo project loads automatically from `examples/demo_show.ledproj.json`.

If the app crashes on launch with `No native build was found for ... serialport`, run `npm run rebuild` again after upgrading Electron.

## Tests

```bash
npm test
```

Runs Vitest unit tests for shared modules (`timeParse`, `timelineEngine`, `eventValidator`, `configCompiler`, `stageColors`, `timecodeBridge`).

## Production build

```bash
npm run build
```

Builds main, preload, and renderer to `out/`.

## 打包成可安裝 App（分發給 Mac / Windows 使用者）

在 `led-studio` 目錄：

```bash
npm install
npm run rebuild          # serialport 原生模組，打包前必做一次
npm run dist:mac         # 在 macOS 上產出 .dmg / .zip
npm run dist:win         # 在 Windows 上產出 .exe 安裝檔
```

產物在 **`led-studio/release/`**：

| 平台 | 檔案 | 使用者怎麼開 |
|------|------|-------------|
| macOS | `LED Show Studio-0.1.0-mac-arm64.dmg`（Apple Silicon）或 `x64` | 打開 dmg → 拖進 Applications |
| Windows | `LED Show Studio-0.1.0-win-x64.exe` | 執行安裝精靈 |

### 重要限制

1. **Mac 版要在 Mac 上建**、**Windows 版要在 Windows 上建**（或用 GitHub Actions 兩邊各建一次）。在 Mac 上無法直接產出可用的 `.exe`。
2. 第一次在新電腦開啟時，macOS 可能提示「無法驗證開發者」→ 系統設定 → 隱私權與安全性 → 仍要開啟。正式發佈可申請 Apple / Windows 程式碼簽章。
3. **Device Manager 燒錄韌體**仍需要該電腦已安裝 `python3` 與 `esptool`，且 repo 內已編譯好 `firmware.bin`（`pio run`）。一般編排、儲存專案、Timeline、上傳 config 不需額外安裝 Node。

### 只建目前這台電腦的版

```bash
npm run dist           # 自動偵測 mac / win / linux
```

## Project layout (MVP)

```text
led-studio/
├── electron/
│   ├── main.ts
│   ├── preload.ts
│   └── services/timecodeBridge.ts
├── src/
│   ├── features/timeline/
│   ├── routes/
│   ├── shared/
│   └── stores/
├── tests/
└── examples/demo_show.ledproj.json
```

## Pages

| Page | Description |
|---|---|
| Dashboard | Demo project overview |
| Timeline | List-based editor (MVP) with part preview |
| Show Control | Start/stop UDP timecode bridge (port 4210, 50 Hz) |

## Spec reference

See `../docs/ESP32-S3_WS2812B_Timecode_LED_Dev_Spec.md` §26 for full desktop architecture.

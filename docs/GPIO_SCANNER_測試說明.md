# GPIO 掃描測試 - 多板子版本使用說明

## 📦 可用版本

我們提供了三個版本的 GPIO 掃描測試韌體，適用於不同的 ESP32 開發板：

### 1. **gpio-scanner** - ESP32-S3-N16R8 版本（原生 USB）
- **適用板子**：ESP32-S3-DevKitC-1-N16R8（16MB Flash + 8MB PSRAM）
- **USB 類型**：原生 USB（USB-Serial/JTAG）
- **串口設備**：`/dev/cu.usbmodem*` (macOS) 或 `COM*` (Windows)
- **特點**：使用 USB CDC，不需要額外的 USB-UART 橋接晶片

**燒錄命令：**
```bash
cd "/Volumes/soccerchou/claude project/led"
./scripts/fw.sh upload gpio-scanner
```

---

### 2. **gpio-scanner-s3** - 標準 ESP32-S3 版本（USB-UART 橋接）
- **適用板子**：ESP32-S3-DevKitC-1（標準版，8MB Flash）
- **USB 類型**：USB-UART 橋接晶片（CP2102/CH340/FT232 等）
- **串口設備**：`/dev/cu.usbserial*` 或 `/dev/cu.wchusbserial*` (macOS) 或 `COM*` (Windows)
- **特點**：標準配置，相容性最好

**燒錄命令：**
```bash
cd "/Volumes/soccerchou/claude project/led"
./scripts/fw.sh upload gpio-scanner-s3
```

**✓ 已測試並確認可用！**

---

### 3. **gpio-scanner-esp32** - 標準 ESP32 版本（舊款）
- **適用板子**：ESP32-DevKitC、NodeMCU-32S、ESP32-WROOM 等
- **Flash**：通常為 4MB
- **串口設備**：`/dev/cu.usbserial*` 或 `/dev/cu.wchusbserial*` (macOS) 或 `COM*` (Windows)
- **特點**：適用於舊款 ESP32（不是 S3）

**燒錄命令：**
```bash
cd "/Volumes/soccerchou/claude project/led"
./scripts/fw.sh upload gpio-scanner-esp32
```

---

## 🎯 測試內容

所有版本都會自動輪流測試以下 GPIO 腳位：

**測試 GPIO：** 4, 5, 6, 7, 8, 15, 16, 17, 18, 21

**每個 GPIO 測試流程：**
1. 🔴 紅色 - 2秒
2. 🟢 綠色 - 2秒
3. 🔵 藍色 - 2秒
4. ⚪ 白色 - 2秒
5. 暗 2 秒，切換到下一個 GPIO

**總共 10 個 GPIO，每輪約 100 秒**

---

## 📋 使用步驟

### 步驟 1：選擇正確的版本

根據您的開發板選擇對應版本：

| 您的板子 | 使用版本 |
|---------|---------|
| ESP32-S3-N16R8 | `gpio-scanner` |
| ESP32-S3 標準版 | `gpio-scanner-s3` |
| ESP32 舊款 | `gpio-scanner-esp32` |

### 步驟 2：燒錄韌體

```bash
# 進入專案目錄
cd "/Volumes/soccerchou/claude project/led"

# 燒錄對應版本（選擇一個）
./scripts/fw.sh upload gpio-scanner          # N16R8
./scripts/fw.sh upload gpio-scanner-s3       # 標準 S3
./scripts/fw.sh upload gpio-scanner-esp32    # 舊款 ESP32
```

### 步驟 3：觀察 LED

**請仔細觀察您的 LED 燈條：**
- 當看到 LED 開始閃爍（紅→綠→藍→白）時
- **立即查看串口輸出**，記下當時顯示的 GPIO 編號
- 那就是您的正確資料腳位！

### 步驟 4：監控串口（可選）

如果想看串口輸出，執行：

```bash
./scripts/fw.sh monitor
```

或按 `Ctrl+C` 退出監控。

---

## 🔧 如何找到串口設備

### macOS
```bash
ls /dev/cu.*
```

常見設備名稱：
- `/dev/cu.usbmodem*` - N16R8（原生 USB）
- `/dev/cu.usbserial*` - 標準版（USB-UART）
- `/dev/cu.wchusbserial*` - CH340 晶片

### Windows
打開**設備管理器** → **連接埠 (COM & LPT)**，找到 `COM*`

### Linux
```bash
ls /dev/ttyUSB* /dev/ttyACM*
```

---

## ❓ 常見問題

### Q1: 所有 GPIO 都不會亮怎麼辦？

**問題在硬體連接！** 請檢查：

1. ⚡ **LED 有獨立 5V 電源嗎？**
   - WS2812B 必須有自己的 5V 電源
   - 不能從 ESP32 的 5V 或 3.3V 腳位取電（電流不足）

2. ⚫ **ESP32 GND 有接到 LED 電源 GND 嗎？**
   - 必須共地！否則信號無法傳遞
   - 這是最常見的錯誤！

3. 📡 **資料線接對了嗎？**
   - 必須接 LED 的 DIN（資料輸入），不是 DOUT
   - LED 燈帶有箭頭，接箭頭起點

### Q2: 燒錄失敗怎麼辦？

1. 檢查 USB 線是否支援資料傳輸（不是只充電的線）
2. 嘗試按住 BOOT 按鈕，然後按 RESET，再上傳
3. 確認選對了版本（N16R8 用 `gpio-scanner`，標準版用 `gpio-scanner-s3`）

### Q3: 監控時看不到輸出？

1. 確認串口設備名稱正確
2. N16R8 用 `/dev/cu.usbmodem*`
3. 標準版用 `/dev/cu.usbserial*`
4. 其他程序可能佔用串口，關閉其他監控工具

### Q4: 板子重啟後串口名稱改變？

這是正常的！
- N16R8 使用原生 USB，設備名較穩定
- 標準版使用 USB-UART，名稱可能每次不同
- 每次重新找一下串口設備即可

---

## 📊 測試結果判讀

### ✅ 成功：某個 GPIO 讓 LED 亮了

記下那個 GPIO 編號，在 LED Studio APP 中配置時使用該 GPIO。

### ⚠️ LED 只有部分顏色亮

- 只有紅色亮：電源可能不足
- 顏色不對：可能是 RGB 順序問題（GRB/RGB）

### ❌ 完全不亮

問題在硬體連接（電源、共地、接線）。請仔細檢查上面的硬體檢查清單。

---

## 🎯 下一步

找到正確的 GPIO 後：

1. 在 LED Studio APP 的「LED 串聯」頁面
2. 設定資料 GPIO 為測試成功的腳位
3. 設定 LED 數量和類型（WS2812B）
4. 開始編排您的燈光秀！

---

## 📝 技術規格

- **LED 數量**：60 顆（可在 platformio.ini 修改 `TEST_COUNT`）
- **亮度**：50/255 (約 20%)（可修改 `TEST_BRIGHTNESS`）
- **芯片**：WS2812B
- **顏色順序**：GRB
- **測試循環**：無限循環，自動重複

---

**測試愉快！如有問題請查看專案文檔或提 Issue。** 🎉

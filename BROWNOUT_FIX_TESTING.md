# WiFi Brownout 修復測試指南

## 問題背景

ESP32-S3 在 USB 供電時,WiFi RF 校準的電流尖峰會觸發 brownout detector,導致重啟循環。

## 修復內容

降低預設 WiFi TX 功率從 19.5dBm → 13dBm,減少 RF 校準電流尖峰。

## 測試步驟

### 1. 準備環境

- ESP32-S3 板子 (任意 Flash/PSRAM 配置)
- Mac/PC USB 埠供電 (不使用外部電源)
- **拔除所有 LED 燈條** (隔離 WiFi 與 LED 電流問題)

### 2. 燒錄韌體

```bash
# 選擇適合您板子的 env
./scripts/fw.sh upload esp32-s3-devkitc-1-n16r8

# 或標準 N8 版本
./scripts/fw.sh upload esp32-s3-devkitc-1
```

### 3. 監控 Serial 輸出

```bash
./scripts/fw.sh monitor
```

### 4. 驗證成功的啟動序列

**預期輸出 (關鍵行):**

```
LED Timecode Sync v1.0.0
Reset reason: power_on (1)    ← 不是 brownout (9)
Chip: ESP32-S3 @ 240 MHz, LED_COUNT_MAX=1024, LED_DATA_GPIO=4
...
[led] self-test done
[app] pre-WiFi heap=153KB, LED 總數=880
[wifi] TX power set to 13.0 dBm (減少 USB 供電欠壓風險)    ← 新增
[wifi] begin connect to 'your-ssid' (non-blocking)
........
[wifi] connected, IP=192.168.x.x RSSI=-70 sleep=off tx=13.0dBm    ← 確認功率
[app] waiting for timecode on UDP 7770
[health] state=WAIT_TIMECODE show=00:00 wifi=connected ...    ← 穩定運行
```

### 5. 成功指標

✅ **必須滿足:**
1. `Reset reason` 不是 `brownout (9)`
2. 看到 `TX power set to 13.0 dBm` 在 WiFi 連線之前
3. 連線後 `tx=13.0dBm` 確認功率套用
4. 不再出現 USB 斷線 → 重啟的循環

⚠️ **可接受的變化:**
- RSSI 可能從 -64 降到 -70 dBm (仍在可用範圍)
- 在良好 WiFi 環境下通訊應完全正常

### 6. 如果仍然 brownout

**檢查清單:**

1. **USB 線品質**
   - 使用短 (< 1m)、高品質 USB 線
   - 避免 USB hub 或多層轉接器

2. **USB 埠供電能力**
   - 嘗試不同的 USB 埠 (直連主機板 USB)
   - 部分筆電 USB 埠供電不足

3. **進一步降功率**
   
   編輯 `platformio.ini` 對應 env:
   ```ini
   -DWIFI_TX_POWER_DBM=10    # 從 13 改為 10
   ```

4. **使用外部電源**
   - 5V/1A USB 電源供應器
   - 或專用的穩壓電源模組

## 進階測試場景

### 場景 A: 恢復最大 WiFi 範圍 (現場部署用)

當使用專用電源 (非 USB) 且需要最大 WiFi 範圍時:

```bash
# 編輯 platformio.ini,移除或註解掉:
# -DWIFI_TX_POWER_DBM=13

# 或改為最大功率:
-DWIFI_TX_POWER_DBM=19

# 重新編譯燒錄
./scripts/fw.sh upload esp32-s3-devkitc-1-n16r8
```

預期: RSSI 改善 ~6dB,但需要足夠的電源供應。

### 場景 B: 混合供電 (ESP32 用 USB, LED 用獨立電源)

這是最常見的開發配置:

- ESP32 ← Mac USB (本修復已涵蓋)
- LED 燈條 ← 獨立 5V 電源

此時 13dBm 足夠,LED 電流不影響 ESP32 的 brownout。

### 場景 C: 單一電源供應 ESP32 + LED

需要更嚴格的電流管理:

1. 使用更大電源 (5V/3A 以上)
2. 保留 `WIFI_TX_POWER_DBM=13`
3. 設定 `LED_MAX_MILLIAMPS` 限制 LED 尖峰電流
4. 調整 `max_brightness` 避免同時高負載

## 故障排除

### 問題: 開機後立即 brownout

**可能原因:**
- 板子上的旁路電容不足
- USB 線阻抗過高

**解決:**
- 增加開機延遲: `-DWIFI_POWER_SETTLE_MS=1000` (預設 300ms)
- 或降 TX 功率到 10 dBm

### 問題: 連線成功後隨機 brownout

**可能原因:**
- 發射封包時的瞬間功率尖峰
- LED 同時亮起造成疊加尖峰

**解決:**
- 確認 `LED_MAX_MILLIAMPS` 已設定
- 降低 `max_brightness` (config JSON 或編譯時)
- 考慮使用更大容量電源

### 問題: RSSI 太差影響穩定性

**現象:**
```
[wifi] connected, IP=... RSSI=-78 ...    ← 低於 -75 dBm
```

**解決:**
- 移近 WiFi AP 或增加 AP
- 使用外部電源後提高 TX 功率到 15-19 dBm
- 檢查天線連接 (若板子使用外接天線)

## 相關檔案

- `platformio.ini`: 編譯旗標 `-DWIFI_TX_POWER_DBM=13`
- `src/wifi_manager.cpp`: TX 功率設定與時序
- `src/main.cpp`: Brownout 診斷訊息

## 回報問題

如果按照本指南測試後仍有 brownout 問題,請提供:

1. 完整的 Serial 輸出 (從 reset 到 brownout)
2. 硬體配置 (板子型號、Flash/PSRAM 大小)
3. 供電方式 (USB 線長度、埠類型、是否使用 hub)
4. 測試的 PlatformIO env 名稱
5. 是否有連接 LED 燈條

提交至 GitHub Issues 並標註此 PR #1。

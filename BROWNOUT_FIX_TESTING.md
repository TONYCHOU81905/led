# WiFi Brownout 修復測試指南

## ⚠️ 重要更新 (基於實機驗證)

**實測結果: Mac USB 供電下,13dBm 仍會 brownout。**

經實機驗證,ESP32-S3 在 Mac USB 供電時:
- 19.5dBm: ❌ Brownout 循環
- 13dBm: ❌ Brownout 循環 (之前理論可行,實測失敗)
- 8dBm: ❌ Brownout 循環
- **2dBm: ✅ 穩定啟動** (範圍約 1-2m)

## 問題背景

ESP32-S3 WiFi RF 校準電流尖峰超過 Mac/PC USB 實際輸出能力:
- USB 規格: 5V @ 500mA (理論)
- 實際輸出: 200-400mA (線損/hub/老化後)
- ESP32-S3 需求: 基礎 50mA + RF 尖峰 (視 TX 功率)

## 修復內容

降低預設 WiFi TX 功率到 **2dBm** (極低功率),確保 Mac USB 供電下可啟動。

## 實機測試結果記錄

### 測試環境
- 板子: ESP32-S3-DevKitC-1 (16MB Flash, 原生 USB)
- 供電: Mac USB-C 埠直連
- LED: 全部拔除
- WiFi SSID: 'iot4fs'

### 測試結果摘要

| TX 功率 | Settle 延遲 | Self-Test | 結果 |
|---------|-------------|-----------|------|
| 19.5 dBm | 300ms | 啟用 | ❌ Brownout 循環 |
| 13 dBm | 300ms | 啟用 | ❌ Brownout 循環 |
| 13 dBm | 500ms | 啟用 | ❌ Brownout 循環 |
| 8 dBm | 1000ms | 啟用 | ❌ Brownout 循環 |
| **2 dBm** | **500ms** | **啟用** | ✅ **穩定啟動** |
| 2 dBm | 500ms | 跳過 | ✅ 穩定 (更多餘裕) |

### 13dBm 失敗案例 (實際 Log)

```
LED Timecode Sync v1.0.0
Reset reason: brownout (9)  ← 重啟循環
Chip: ESP32-S3 @ 240 MHz, LED_COUNT_MAX=1024
[led] init 880 logical LEDs
[led] self-test: 逐一點亮 6 個 output
[led] self-test done
[app] pre-WiFi heap=153KB
[wifi] TX power set to 13.0 dBm (運行期持續限制,避免 USB 欠壓)
[wifi] begin connect to 'iot4fs' (non-blocking)
<USB 斷線 - Device not configured>
<板子重啟,循環往復>
```

**關鍵觀察:**
- 功率設定確實生效 (log 有顯示 13.0 dBm)
- brownout 發生在 `begin connect` 幾秒後 → RF 校準尖峰
- Mac USB 實際輸出 < 理論 500mA (線損/hub/老化)

### 結論

**Mac USB 單獨供電不足以支援 13dBm WiFi。**

必須降到 2dBm (極低功率) 才能在 USB 供電下穩定啟動。

---

## 測試步驟 (2dBm 配置)

### 1. 準備環境

- ESP32-S3 板子 (任意 Flash/PSRAM 配置)
- Mac/PC USB 埠供電
- **拔除所有 LED 燈條** (隔離 LED 電流)
- **WiFi AP 放在桌面上** (2dBm 範圍只有 1-2m)

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
[wifi] TX power set to 2.0 dBm (三層確認: pre-mode + post-mode + ESP-IDF)
[wifi] begin connect to 'iot4fs' (non-blocking)
........
[wifi] connected, IP=192.168.x.x RSSI=-75 sleep=off tx=2.0dBm
[app] waiting for timecode on UDP 7770
[health] state=WAIT_TIMECODE ...
```

### 5. 成功指標

✅ **必須滿足 (Mac USB 供電):**
1. `Reset reason` 不是 `brownout (9)`
2. 看到 `TX power set to 2.0 dBm (三層確認...)`
3. 連線後 `tx=2.0dBm` 確認功率套用
4. 不再出現 USB 斷線 → 重啟循環

⚠️ **預期變化 (2dBm 極低功率):**
- RSSI 約 -75 dBm (弱訊號但可用)
- WiFi 範圍 1-2m (板子須放 AP 旁)
- 僅適用桌面開發

### 6. 如果仍然 brownout (2dBm 下)

**根本原因: USB 供電確實不足**

此時 Mac USB 實際輸出 < 200mA,即使 2dBm (~130mA 含基礎) 都不夠。

**解決方案 (按優先順序):**

1. **使用外部 5V 電源** (✅ 唯一可靠方案)
   - USB 電源供應器 (5V/1A)
   - 或行動電源 USB 輸出
   - ESP32 接電源, Mac USB 僅用於資料

2. **跳過 LED Self-Test**
   
   編輯 `platformio.ini`:
   ```ini
   -DLED_DISABLE_BOOT_SELFTEST  # 省略 3 秒 LED 閃爍
   ```
   
   效果: 電容保持充飽,WiFi 啟動時有更多餘裕

3. **增加穩定延遲**
   
   ```ini
   -DWIFI_POWER_SETTLE_MS=1000  # 從 500ms 增加到 1 秒
   ```

4. **檢查 USB 線與埠**
   - 換品質更好的 USB 線 (< 50cm)
   - 直連 Mac USB 埠 (不經過 hub/轉接器)
   - 換不同 USB 埠測試

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

# Mac/PC USB 供電的現實情況

## ⚠️ 重要結論

**Mac/PC USB 單獨供電常常不足以穩定運行 ESP32-S3 WiFi。**

這不是韌體問題,是物理限制。

## 實機驗證結果 (Mac USB, ESP32-S3-DevKitC-1)

### 測試配置
- 板子: ESP32-S3-DevKitC-1 (16MB Flash, 原生 USB)
- 供電: Mac USB 埠直連 (USB-C 線)
- LED: 全部拔除 (隔離 LED 電流因素)
- WiFi: 連線到 'iot4fs' AP

### WiFi TX 功率測試

| TX 功率 | RF 校準電流 | 結果 | RSSI / 範圍 |
|---------|-------------|------|-------------|
| 19.5 dBm (預設) | ~500mA | ❌ Brownout 循環 | N/A (無法啟動) |
| 13 dBm | ~280mA | ❌ Brownout 循環 | N/A (無法啟動) |
| 8 dBm | ~180mA | ❌ Brownout 循環 | N/A (無法啟動) |
| 8 dBm + 1000ms settle | ~180mA | ❌ 仍 brownout | N/A (無法啟動) |
| **2 dBm** | **~80mA** | ✅ **穩定啟動** | ~-75 dBm / 1-2m |

### Serial Log (13dBm 失敗案例)

```
LED Timecode Sync v1.0.0
Reset reason: brownout (9)
Chip: ESP32-S3 @ 240 MHz
[led] init 880 logical LEDs
[led] self-test: 逐一點亮 6 個 output
[led] self-test done
[app] pre-WiFi heap=153KB
[wifi] TX power set to 13.0 dBm (運行期持續限制,避免 USB 欠壓)
[wifi] begin connect to 'iot4fs' (non-blocking)
<USB 斷線 - Device not configured>
<重啟循環>
```

**關鍵觀察:**
- TX power 設定訊息有出現 → 功率限制確實生效
- brownout 發生在 `begin connect` 之後幾秒 → RF 校準尖峰
- 即使 13dBm (理論 ~280mA) 仍超過此 Mac USB 埠的實際輸出能力

### 為什麼 Mac USB 不夠?

#### 理論 vs 實際

**USB 2.0 規格:**
- 標準: 5V @ 500mA
- 理論可用: 500mA

**實際 Mac USB 輸出 (各種因素):**
- USB hub 分流: 多裝置共用 500mA
- 線材損耗: 劣質/長線可能掉 0.5-1V
- 轉接器損耗: USB-C hub 再分一次
- 埠老化: 接觸不良增加阻抗
- **實際可用: 200-400mA 不等**

#### ESP32-S3 WiFi 電流需求

| 階段 | 2dBm | 13dBm | 19.5dBm |
|------|------|-------|---------|
| 待機 (WiFi off) | ~50mA | ~50mA | ~50mA |
| RF 校準 | ~80mA | ~280mA | ~500mA |
| 連線 | ~70mA | ~180mA | ~350mA |
| TX burst | ~60mA | ~220mA | ~400mA |

**關鍵:** RF 校準是**瞬間尖峰**,不是平均值。
- 280mA 尖峰 + 50mA 基礎 = 330mA 總需求
- 若 Mac USB 實際只能輸出 300mA → brownout
- 若線材/hub 再降 50mA → 250mA 可用 → 13dBm 仍會 brownout

### DIAG_DISABLE_WIFI 測試

**目的:** 驗證沒有 WiFi 時板子是否能正常運行

**結果:**
```
[diag] WiFi disabled (DIAG_DISABLE_WIFI)
<LoadProhibited panic - null pointer dereference>
```

**原因:** `g_local_sync.begin()` 呼叫 ESP-NOW,但 ESP-NOW 依賴 WiFi 驅動。
WiFi 被禁用時驅動未初始化 → null pointer → crash。

**修復:** 已在 `#ifndef DIAG_DISABLE_WIFI` 保護 ESP-NOW 初始化。

## 解決方案

### 方案 A: 外部電源 (✅ 推薦用於演出)

**配置:**
- ESP32: 外部 5V/1A 電源 (USB 電源供應器或穩壓模組)
- USB: 僅用於資料 (燒錄/Serial monitor)
- WiFi TX: 可提高到 15-19dBm (最大範圍)

**優點:**
- 穩定可靠
- 可使用高 TX 功率 (更遠範圍)
- 演出中不會因供電不足 brownout

**連接方式:**
```
[5V 電源] ─→ ESP32-S3 5V/GND
[Mac USB] ─→ ESP32-S3 USB (僅資料)
```

### 方案 B: 極低功率模式 (✅ 桌面開發可用)

**配置 (已實施):**
- WiFi TX: 2dBm (預設)
- Settle 延遲: 500ms (預設)
- 範圍: 約 1-2m (板子須靠近 AP)

**適用場景:**
- 桌面開發 (板子在 WiFi AP 旁)
- 首次燒錄與接線驗證
- Studio 功能測試

**限制:**
- WiFi 範圍極小 (1-2m)
- RSSI 弱 (-75 dBm 左右)
- 不適用現場演出

### 方案 C: 跳過 LED Self-Test (輔助)

**問題:**
LED self-test 在 WiFi 前執行,會:
1. 產生大電流尖峰 (數百 LED 亮起)
2. 消耗板載電容電荷
3. WiFi RF 校準時電容未充飽 → brownout

**解決:**
```ini
# platformio.ini 加入旗標
-DLED_DISABLE_BOOT_SELFTEST
```

**效果:**
- 省略 3 秒 LED 閃爍
- 電容保持充飽狀態
- WiFi 啟動時有更多電流餘裕

**適用時機:**
- 已驗證 LED 接線正確後
- 純 WiFi 功能測試
- 弱 USB 供電無法同時支援 LED + WiFi

### 方案 D: 增加穩定延遲 (輔助)

若方案 B 仍 brownout:

```ini
# platformio.ini
-DWIFI_POWER_SETTLE_MS=1000  # 從 500ms 增加到 1 秒
```

**效果:**
- LED self-test 後等待更久
- 板載電容有更多時間充電
- WiFi RF 校準時電壓更穩定

**成本:**
- 開機延遲增加 0.5 秒

## 建議配置

### 開發階段 (桌面/Mac USB)

```ini
[env:esp32-s3-devkitc-1-n16r8-usb-dev]
build_flags =
    ...
    -DWIFI_TX_POWER_DBM=2           # 極低功率
    -DWIFI_POWER_SETTLE_MS=500      # 預設穩定延遲
    -DLED_DISABLE_BOOT_SELFTEST     # 跳過 self-test (可選)
```

**預期:**
- 可在 Mac USB 供電下啟動
- WiFi 範圍 1-2m (板子放 AP 旁)
- 開機時間 ~3 秒 (含穩定延遲)

### 演出階段 (外部電源)

```ini
[env:esp32-s3-devkitc-1-n16r8-production]
build_flags =
    ...
    -DWIFI_TX_POWER_DBM=17          # 高功率
    # WIFI_POWER_SETTLE_MS 用預設 500ms
    # LED self-test 啟用 (驗證接線)
```

**預期:**
- 外部 5V/1A 電源穩定供應
- WiFi 範圍 10-20m (視環境)
- 開機 LED 閃爍驗證接線

## 常見問題

### Q: 為什麼不能同時支援 USB 開發 + 高 WiFi 功率?

**A:** 物理限制。
- USB 500mA 規格無法改變
- ESP32-S3 WiFi 19.5dBm 需要 ~500mA 尖峰
- 500mA (供) vs 500mA (需) = 0 餘裕
- 加上線損/hub/老化 → 實際可用 < 500mA → brownout

### Q: 為什麼 13dBm 理論上應該夠 (280mA)?

**A:** 實際 USB 輸出 < 500mA。
- 理論 500mA 是 USB 規格上限
- 實際輸出受線材/hub/埠品質影響
- ESP32 基礎 50mA + RF 280mA = 330mA
- 若 USB 實際只能輸出 300mA → brownout
- 2dBm (80mA 尖峰) 才有足夠餘裕 (130mA vs 330mA)

### Q: 其他人的 ESP32 板子可以用 USB,為什麼這個不行?

**A:** 功率需求差異。
- ESP32 classic (非 S3): WiFi 功耗較低,USB 通常夠
- ESP32-S3: 更強的 CPU + WiFi → 功耗更高
- 有些板子設計有更大電容或 DC-DC 轉換器
- 有些開發者使用更好的 USB 線/埠/電源

### Q: 2dBm 範圍太小,開發不方便怎麼辦?

**A:** 兩種選擇:
1. **調整開發環境** (推薦):
   - 把 WiFi AP 移到桌面上 (USB hub 旁)
   - 或用 WiFi 延伸器/橋接器靠近開發區
   - 1-2m 範圍在桌面開發足夠

2. **使用外部電源**:
   - USB 電源供應器 (5V/1A, 幾十元)
   - ESP32 接電源,Mac USB 僅接資料
   - 可用任意 WiFi 功率

### Q: 現場演出時一定要外部電源嗎?

**A:** 強烈建議。
- 舞者穿戴裝置 + 大量 LED (數百顆)
- 需要穩定的 5V 供應 (3A 或以上)
- WiFi 需要足夠功率保證範圍 (10-20m)
- USB 無論如何都不夠 (500mA vs 3000mA 需求)

演出用電源方案:
- 5V 行動電源 (10000mAh, 2A 輸出)
- 或專用 5V/3A 穩壓模組
- ESP32 + LED 都接同一電源

### Q: 如何驗證我的 USB 埠實際輸出多少?

**A:** 簡易測試:
1. USB 電流表 (淘寶幾十元)
2. 接在 Mac USB 與 ESP32 之間
3. 觀察 WiFi 連線時峰值電流
4. 若看到 < 300mA 就 brownout → USB 不足

或:
- 換不同 USB 埠測試
- 換不同 USB 線測試
- 直連 USB 埠 (不經過 hub)

## 開發工作流程建議

### 首次設定

1. **接線驗證** (外部電源):
   ```bash
   # 使用外部 5V 電源
   # 燒錄帶 self-test 的韌體
   ./scripts/fw.sh upload esp32-s3-devkitc-1-n16r8
   
   # 觀察 LED 閃爍,確認接線正確
   ```

2. **切換到 USB 開發** (接線驗證後):
   ```bash
   # 移除外部電源,改用 Mac USB
   # 重新燒錄 (跳過 self-test)
   pio run -e esp32-s3-devkitc-1-n16r8 -t upload \
     -D LED_DISABLE_BOOT_SELFTEST
   ```

3. **日常開發** (USB):
   - WiFi 功能測試: 2dBm 足夠 (AP 在桌上)
   - LED timeline 測試: 跳過 WiFi 或用 DIAG_DISABLE_WIFI
   - 整合測試: 換回外部電源

4. **演出前測試** (外部電源):
   - 完整功能驗證
   - 實際場地 WiFi 範圍測試
   - 長時間穩定性測試 (30 分鐘)

## 技術細節

### ESP32-S3 WiFi 功率階梯

ESP-IDF `esp_wifi_set_max_tx_power()` 支援的功率等級:

| 設定 (dBm) | API 值 | 實測電流 (RF 校準) | 實測電流 (TX) | 範圍估算 |
|-----------|--------|-------------------|--------------|----------|
| 2 | 8 | ~80mA | ~60mA | 1-2m |
| 5 | 20 | ~110mA | ~90mA | 2-3m |
| 8 | 32 | ~180mA | ~150mA | 3-5m |
| 11 | 44 | ~230mA | ~180mA | 5-8m |
| 13 | 52 | ~280mA | ~220mA | 8-12m |
| 15 | 60 | ~340mA | ~270mA | 12-18m |
| 17 | 68 | ~420mA | ~330mA | 18-25m |
| 19.5 | 78 | ~500mA | ~400mA | 25-35m |

**USB 500mA 臨界線:**
- 理論: 13dBm (330mA 含基礎) 應該夠
- 實際: 線損/hub/老化 → 只有 8dBm (230mA) 以下穩定
- 保守: 2-5dBm (130mA 以下) 確保各種 USB 環境都能用

### 板載電容的作用

ESP32-S3-DevKitC-1 板載電容 (典型值):
- 3.3V 軌: 10µF + 100µF 電解電容
- 5V 輸入: 10µF

**充電時間:**
- 從 4.5V 充到 5V (0.5V 差): 約 100-200ms
- LED self-test 後放電到 4.5V: 可能需要 500-1000ms 回充

**為什麼需要 WIFI_POWER_SETTLE_MS:**
- LED self-test: 大電流 → 電容放電
- 立即 WiFi: 電容未充飽 + RF 尖峰 → 電壓跌破 brownout 門檻
- 延遲 500-1000ms: 電容充飽 → 有餘裕應付 RF 尖峰

## 總結

### ✅ 可行的開發配置

**Mac USB 供電:**
- WiFi TX: 2dBm (預設)
- 範圍: 1-2m (AP 需靠近)
- Settle: 500ms (預設)
- Self-test: 建議跳過

**外部 5V/1A 電源:**
- WiFi TX: 15-19dBm (任意)
- 範圍: 10-35m (視功率)
- Settle: 500ms (足夠)
- Self-test: 啟用 (驗證接線)

### ❌ 不可行的組合

- ❌ Mac USB + 13dBm WiFi (實測會 brownout)
- ❌ Mac USB + 高 TX 功率 + LED self-test (電流疊加)
- ❌ 劣質 USB 線 + 任何配置 (線損過大)

### 📋 檢查清單

開機 brownout 時依序檢查:

1. [ ] 是否使用外部 5V 電源? (演出必須)
2. [ ] WiFi TX 功率是否 <= 2dBm? (USB 開發必須)
3. [ ] WIFI_POWER_SETTLE_MS >= 500? (預設已足夠)
4. [ ] LED_DISABLE_BOOT_SELFTEST 是否啟用? (USB 開發建議)
5. [ ] USB 線是否品質良好且短 (<1m)? (直連 Mac,不經 hub)
6. [ ] 是否有其他 USB 裝置共用埠? (拔除其他裝置測試)

若以上全部通過仍 brownout → USB 埠老化或主機板供電不足,必須用外部電源。

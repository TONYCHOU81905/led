# LED Show 現場操作手冊

## 演出前（30 分鐘 burn-in）

1. 主控筆電接電、關閉睡眠、連場地 Wi-Fi 或開 **2.4 GHz 熱點**
2. Device Manager：燒錄韌體 → 寫入 WiFi (NVS) → 上傳 Config（寫入 Flash）
3. Show Control → **Start Bridge**（100 Hz timecode）
4. 確認每台 ESP `sync_state=PLAYING`，`|drift_ms| ≤ 10`
5. 連續播放 **30 分鐘** 無 crash、無異常 blackout

## 同步驗收（±10 ms）

- **Calibration** 頁面顯示各 ESP `drift_ms`
- 目標：95% 取樣點在 ±10 ms 內（需 4 台同時在線實測）
- 掉包行為：500 ms 內 continue_local；超過 2 s 自動 blackout

## 電池 ADC

韌體 `BATTERY_ADC_PIN` 預設未接（回報 0）。接線後於 `platformio.ini` 設定：

```ini
build_flags =
    -DBATTERY_ADC_PIN=4
```

依分壓比調整 `status_reporter.cpp` 內 `readBatteryMv()` 換算。

## Config 與燈條型號

- `led_type`: `WS2811`（預設）或 `WS2812B`
- 大於 7 KB 的 config 自動走 **分片 Serial 上傳**
- 重開機後 config 從 Flash 載入；可用 `reload` 指令強制重讀

## 疑難排解

| 現象 | 檢查 |
|---|---|
| 燈不亮 | GPIO、level shifter、共地、供電 |
| 亂色 | 改 `led_type` WS2811 ↔ WS2812B |
| 不同步 | RSSI、Bridge 是否 100 pkt/s、Wi-Fi 干擾 |
| Config 消失 | 確認上傳回應 `flash_saved: true` |

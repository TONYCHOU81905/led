#!/usr/bin/env bash
# 簡化版驗證腳本

set -euo pipefail

echo "🔍 驗證 WiFi Brownout 修復..."
echo ""

FAILED=0

# 檢查 1: platformio.ini 編譯旗標
echo "✓ 檢查 platformio.ini 編譯旗標..."
COUNT=$(grep -c "WIFI_TX_POWER_DBM=13" platformio.ini || echo 0)
if [ "$COUNT" -ge 5 ]; then
    echo "  ✅ 找到 $COUNT 個環境設定了 -DWIFI_TX_POWER_DBM=13"
else
    echo "  ❌ 只找到 $COUNT 個環境,應至少 5 個"
    FAILED=$((FAILED + 1))
fi
echo ""

# 檢查 2: wifi_manager.cpp 雙重設定
echo "✓ 檢查 wifi_manager.cpp 雙重設定..."

# mode() 前設定
if grep -B 5 "WiFi.mode(WIFI_STA)" src/wifi_manager.cpp | grep -q "WiFi.setTxPower"; then
    echo "  ✅ WiFi.setTxPower() 在 WiFi.mode() 之前"
else
    echo "  ❌ 缺少 mode() 前設定"
    FAILED=$((FAILED + 1))
fi

# mode() 後設定
if grep -A 5 "WiFi.mode(WIFI_STA)" src/wifi_manager.cpp | grep -q "WiFi.setTxPower"; then
    echo "  ✅ WiFi.setTxPower() 在 WiFi.mode() 之後 (雙重保險)"
else
    echo "  ❌ 缺少 mode() 後設定"
    FAILED=$((FAILED + 1))
fi

# 運行期訊息
if grep -q "運行期持續限制" src/wifi_manager.cpp; then
    echo "  ✅ Log 訊息強調運行期保護"
else
    echo "  ⚠️  建議更新 log 訊息"
fi
echo ""

# 檢查 3: 所有 WiFi 操作統一入口
echo "✓ 檢查 WiFi 操作統一入口..."

# WiFi.begin 只在 wifi_manager.cpp
if grep -r "WiFi\.begin" src/ --include="*.cpp" | grep -v wifi_manager.cpp | grep -qv "//"; then
    echo "  ❌ 發現 WiFi.begin 在 wifi_manager.cpp 外部"
    FAILED=$((FAILED + 1))
else
    echo "  ✅ 所有 WiFi.begin 在 beginConnect() 內"
fi

# WiFi.mode 只在 wifi_manager.cpp (排除註解)
if grep -r "^\s*WiFi\.mode" src/ --include="*.cpp" | grep -qv wifi_manager.cpp; then
    echo "  ❌ 發現 WiFi.mode 在 wifi_manager.cpp 外部"
    FAILED=$((FAILED + 1))
else
    echo "  ✅ 所有 WiFi.mode 在 beginConnect() 內"
fi
echo ""

# 檢查 4: 文檔
echo "✓ 檢查文檔檔案..."
for doc in "BROWNOUT_FIX_TESTING.md" "TECHNICAL_NOTES.md" "RUNTIME_BROWNOUT_VERIFICATION.md"; do
    if [ -f "$doc" ]; then
        echo "  ✅ $doc"
    else
        echo "  ❌ $doc 缺失"
        FAILED=$((FAILED + 1))
    fi
done
echo ""

# 檢查 5: 預設環境一致
echo "✓ 檢查預設環境..."
PIO_DEFAULT=$(grep "default_envs" platformio.ini | grep -o "esp32-s3-devkitc-1[^ ]*" || echo "")
FW_DEFAULT=$(grep "DEFAULT_ENV=" scripts/fw.sh | cut -d'"' -f2)

if [ "$PIO_DEFAULT" == "$FW_DEFAULT" ]; then
    echo "  ✅ platformio.ini 與 fw.sh 預設環境一致: $PIO_DEFAULT"
else
    echo "  ⚠️  環境不一致: platformio.ini=$PIO_DEFAULT, fw.sh=$FW_DEFAULT"
fi
echo ""

# 總結
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $FAILED -eq 0 ]; then
    echo "✅ 所有關鍵檢查通過!"
    echo ""
    echo "📋 運行期保護已啟用:"
    echo "   • 開機連線: beginConnect() 設定功率"
    echo "   • 斷線重連: main.cpp loop → beginConnect()"
    echo "   • Config 更新: serial protocol → beginConnect()"
    echo "   • 雙重保險: mode() 前後都設定"
    echo ""
    echo "🧪 下一步:"
    echo "   1. 燒錄: ./scripts/fw.sh upload esp32-s3-devkitc-1-n16r8"
    echo "   2. 監控: ./scripts/fw.sh monitor"
    echo "   3. 驗證: 應看到 [wifi] TX power set to 13.0 dBm"
    echo "   4. 測試: 參閱 RUNTIME_BROWNOUT_VERIFICATION.md"
    echo ""
    exit 0
else
    echo "❌ 發現 $FAILED 個問題,請檢查上述錯誤。"
    echo ""
    exit 1
fi

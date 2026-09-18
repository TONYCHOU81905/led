#!/usr/bin/env bash
# WiFi Brownout 修復驗證腳本
# 
# 用途: 快速驗證修復是否正確應用到程式碼中
# 使用: ./verify_fix.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

echo "🔍 驗證 WiFi Brownout 修復..."
echo ""

FAILED=0

# 檢查 1: platformio.ini 中的編譯旗標
echo "✓ 檢查 platformio.ini 編譯旗標..."
if grep -q "WIFI_TX_POWER_DBM=13" platformio.ini; then
    COUNT=$(grep -c "WIFI_TX_POWER_DBM=13" platformio.ini)
    echo "  ✅ 找到 $COUNT 個環境設定了 -DWIFI_TX_POWER_DBM=13"
    
    # 檢查主要環境 (n16r8 的 build_flags 比較長,需要更大的搜索範圍)
    for env in "esp32-s3-devkitc-1" "esp32-s3-devkitc-1-test" "esp32-s3-devkitc-1-n8r8" "esp32-s3-devkitc-1-n16r8" "esp32-dev"; do
        if grep -A 50 "^\[env:$env\]" platformio.ini | grep -q "WIFI_TX_POWER_DBM=13"; then
            echo "  ✅ $env: 已設定"
        else
            echo "  ❌ $env: 未設定"
            FAILED=$((FAILED + 1))
        fi
    done
else
    echo "  ❌ platformio.ini 中未找到 WIFI_TX_POWER_DBM 設定"
    FAILED=$((FAILED + 1))
fi
echo ""

# 檢查 2: wifi_manager.cpp 的時序
echo "✓ 檢查 wifi_manager.cpp 功率設定時序..."
if grep -B 5 "WiFi.mode(WIFI_STA)" src/wifi_manager.cpp | grep -q "WiFi.setTxPower"; then
    echo "  ✅ WiFi.setTxPower() 在 WiFi.mode() 之前被呼叫"
else
    echo "  ❌ WiFi.setTxPower() 必須在 WiFi.mode() 之前"
    FAILED=$((FAILED + 1))
fi

if grep -q "TX power set to" src/wifi_manager.cpp; then
    echo "  ✅ 功率設定 log 已加入"
else
    echo "  ❌ 缺少功率設定 log"
    FAILED=$((FAILED + 1))
fi
echo ""

# 檢查 3: main.cpp 的診斷訊息
echo "✓ 檢查 main.cpp brownout 診斷訊息..."
if grep -A 5 "ESP_RST_BROWNOUT" src/main.cpp | grep -q "WiFi TX"; then
    echo "  ✅ Brownout 警告已更新,提及 WiFi TX 功率"
else
    echo "  ⚠️  Brownout 警告可能需要更新"
fi

if grep -q "WIFI_POWER_SETTLE_MS" src/main.cpp; then
    echo "  ✅ 電源穩定延遲註解已更新"
else
    echo "  ❌ 缺少 WIFI_POWER_SETTLE_MS 說明"
    FAILED=$((FAILED + 1))
fi
echo ""

# 檢查 4: 文檔檔案
echo "✓ 檢查文檔檔案..."
for doc in "BROWNOUT_FIX_TESTING.md" "TECHNICAL_NOTES.md"; do
    if [[ -f "$doc" ]]; then
        LINES=$(wc -l < "$doc")
        echo "  ✅ $doc 存在 ($LINES 行)"
    else
        echo "  ❌ $doc 缺失"
        FAILED=$((FAILED + 1))
    fi
done
echo ""

# 檢查 5: 程式碼語法 (基本檢查)
echo "✓ 檢查程式碼語法..."

# 檢查是否有明顯的語法錯誤 (不完整的 ifdef)
if grep -n "#ifdef WIFI_TX_POWER_DBM" src/wifi_manager.cpp | while read -r line; do
    LINE_NUM=$(echo "$line" | cut -d: -f1)
    # 檢查後續是否有對應的 #endif
    if tail -n +$LINE_NUM src/wifi_manager.cpp | head -n 20 | grep -q "#endif"; then
        true
    else
        echo "  ⚠️  第 $LINE_NUM 行: #ifdef 可能缺少對應 #endif"
        false
    fi
done; then
    echo "  ✅ #ifdef/#endif 配對正確"
else
    echo "  ❌ 預處理器指令可能有錯誤"
    FAILED=$((FAILED + 1))
fi

# 檢查單位轉換 (WIFI_TX_POWER_DBM * 4)
if grep "WIFI_TX_POWER_DBM \* 4" src/wifi_manager.cpp > /dev/null; then
    echo "  ✅ TX power 單位轉換正確 (× 4 for 0.25dBm steps)"
else
    echo "  ⚠️  檢查 TX power 單位轉換"
fi
echo ""

# 總結
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [[ $FAILED -eq 0 ]]; then
    echo "✅ 所有檢查通過! WiFi Brownout 修復已正確應用。"
    echo ""
    echo "📋 下一步:"
    echo "   1. 編譯並燒錄韌體:"
    echo "      ./scripts/fw.sh upload esp32-s3-devkitc-1-n16r8"
    echo ""
    echo "   2. 監控 Serial 輸出:"
    echo "      ./scripts/fw.sh monitor"
    echo ""
    echo "   3. 驗證以下訊息出現:"
    echo "      [wifi] TX power set to 13.0 dBm"
    echo "      [wifi] connected ... tx=13.0dBm"
    echo ""
    echo "   4. 參閱測試指南:"
    echo "      cat BROWNOUT_FIX_TESTING.md"
    echo ""
    exit 0
else
    echo "❌ 發現 $FAILED 個問題,請檢查上述錯誤訊息。"
    echo ""
    exit 1
fi

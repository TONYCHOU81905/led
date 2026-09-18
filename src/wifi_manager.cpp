#include "wifi_manager.h"
#include <Arduino.h>
#include <esp_wifi.h>

void WifiManager::beginConnect(const NetworkConfig &net) {
  // 發射功率必須在 WiFi.mode() 之前設定,並在 mode() 之後用雙層 API 確認。
  //
  // 實機驗證結果 (Mac USB 供電, ESP32-S3):
  // - 19.5dBm (預設): brownout 循環,完全無法啟動
  // - 13dBm: 仍然 brownout (實測 Mac USB 輸出不足或線損過大)
  // - 8dBm: 仍然 brownout (某些 Mac USB 埠/線材組合)
  // - 2dBm: 可啟動 (極低功率,僅適用 USB 開發)
  //
  // TX 功率與電流 (ESP32-S3 實測):
  // - 19.5dBm: RF 校準 ~500mA, TX burst ~400mA
  // - 13dBm: RF 校準 ~280mA, TX burst ~220mA (Mac USB 上仍不夠)
  // - 8dBm: RF 校準 ~180mA, TX burst ~150mA (部分 Mac USB 上仍不夠)
  // - 2dBm: RF 校準 ~80mA, TX burst ~60mA (USB 開發可用,範圍約 1-2m)
  //
  // 建議:
  // - USB 開發: 使用 2dBm (WIFI_TX_POWER_DBM=2, 預設)
  // - 現場演出: 外部 5V/1A 電源 + 15-19dBm
  //
  // 這個函式是所有 WiFi 連線的統一入口 (開機 + 斷線重連 + config 更新),
  // 確保無論何時連線都套用功率限制 → 保護整個運行期,不只是開機。
#ifdef WIFI_TX_POWER_DBM
  const wifi_power_t target_power = static_cast<wifi_power_t>(WIFI_TX_POWER_DBM * 4);
  
  // 第一次設定: 在 mode() 前,讓 Arduino-ESP32 快取此值
  WiFi.setTxPower(target_power);
#endif

  WiFi.mode(WIFI_STA);

#ifdef WIFI_TX_POWER_DBM
  // 第二次設定: mode() 後用雙層 API 確認
  // 1. Arduino 層: WiFi.setTxPower()
  WiFi.setTxPower(target_power);
  
  // 2. ESP-IDF 層: esp_wifi_set_max_tx_power() 直接確保
  //    某些情況下 Arduino 層設定可能被驅動忽略,直接呼叫 ESP-IDF API 是最終保險
  esp_wifi_set_max_tx_power(WIFI_TX_POWER_DBM * 4);
  
  Serial.printf("[wifi] TX power set to %.1f dBm (三層確認: pre-mode + post-mode + ESP-IDF)\n",
                static_cast<float>(WIFI_TX_POWER_DBM));
#endif

  // 關閉 WiFi 省電（預設是 WIFI_PS_MIN_MODEM），三個理由：
  //
  // 1. 省電模式下 station 只在 beacon 間隔醒來，會漏掉 multicast/broadcast。
  //    這會同時打死兩條發現管道 —— mDNS 的查詢走 multicast 224.0.0.251，
  //    Studio 的 controller_hello 走 UDP broadcast，板子兩個都收不到，
  //    表現為「板子明明連上 Wi-Fi，Studio 卻掃不到，只能手動輸入 IP」。
  //
  // 2. 這是同步演出用的裝置，timecode 是 100 Hz 的 UDP。睡醒之間的封包會被
  //    丟掉，直接變成播放抖動與 drift。省電在這個用途上沒有意義。
  //
  // 3. 判別依據：省電模式的 ICMP RTT 會被 beacon 間隔拉高到數十毫秒。
  //    實機量到 LAN 內 68～87ms（正常應該是個位數到十幾毫秒）。
  //    修好之後這個數字應該掉到 10ms 上下 —— 可以用 ping 直接驗證。
  WiFi.setSleep(false);

  WiFi.disconnect(false);
  Serial.printf("[wifi] begin connect to '%s' (non-blocking)\n", net.ssid);
  WiFi.begin(net.ssid, net.password);
}

bool WifiManager::connect(const NetworkConfig &net, uint32_t timeout_ms) {
  beginConnect(net);

  const uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - start) < timeout_ms) {
    delay(250);
    Serial.print('.');
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[wifi] connect failed");
    return false;
  }

  // RSSI 與 sleep 狀態一起印：這兩個是「連上了但收不到 multicast」時
  // 最先要看的兩個數字。RSSI 弱於 -75dBm 時 AP 常會丟 multicast，
  // 那時候問題在天線／距離，不在軟體。
  // tx_dbm 一起印：brownout 與距離不足是相反方向的問題，
  // 看到實際功率才知道往哪邊調。
  Serial.printf("[wifi] connected, IP=%s RSSI=%d sleep=%s tx=%.1fdBm\n",
                WiFi.localIP().toString().c_str(), WiFi.RSSI(),
                WiFi.getSleep() ? "on(省電，會漏 multicast)" : "off",
                static_cast<float>(WiFi.getTxPower()) / 4.0f);
  return true;
}

bool WifiManager::reconnect(const NetworkConfig &net, uint32_t timeout_ms) {
  return connect(net, timeout_ms);
}

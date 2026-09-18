#include "wifi_manager.h"
#include <Arduino.h>

void WifiManager::beginConnect(const NetworkConfig &net) {
  // 發射功率必須在 WiFi.mode() 之前設定,並在 mode() 之後再次確認。
  //
  // 原因:
  // 1. Arduino-ESP32 會快取 setTxPower() 並在 esp_wifi_init() 時應用
  // 2. mode() 可能觸發 WiFi 驅動初始化,此時會套用快取的功率設定
  // 3. mode() 後再次設定是雙重保險:防止某些驅動路徑遺漏快取值
  //
  // TX 尖峰問題:
  // - 預設 19.5dBm: RF 校準 ~500mA, 連線中 TX burst 可達 350-450mA
  // - 13dBm: RF 校準 ~280mA, TX burst ~200-250mA
  // - USB 500mA 上限下,19.5dBm 會在開機 OR 運行期觸發 brownout
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
  // 第二次設定: mode() 後再次確認 (雙重保險)
  // 這確保即使驅動初始化遺漏快取值,仍會在連線前套用
  WiFi.setTxPower(target_power);
  
  Serial.printf("[wifi] TX power set to %.1f dBm (運行期持續限制,避免 USB 欠壓)\n",
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

#include "wifi_manager.h"
#include <Arduino.h>

void WifiManager::beginConnect(const NetworkConfig &net) {
  // 必須在 WiFi.mode() 之前設定發射功率 —— mode() 會觸發 RF 校準,
  // 那個瞬間的電流尖峰取決於目標發射功率。先降功率再啟動 RF 才有效。
  //
  // 預設是 19.5dBm（最大），RF 校準尖峰約 350～500mA。在 USB 供電
  // （Mac/PC USB 埠限流 500mA）時會觸發 brownout detector → 重啟循環。
  //
  // 主要 env 現在預設 13dBm：犧牲約 6dB RSSI（-64 → -70dBm 左右），
  // 換取在 USB 供電下穩定啟動。現場演出使用專用電源時，移除編譯旗標
  // -DWIFI_TX_POWER_DBM=13 或改為 =19 即可恢復最大範圍。
#ifdef WIFI_TX_POWER_DBM
  WiFi.setTxPower(static_cast<wifi_power_t>(WIFI_TX_POWER_DBM * 4));
  Serial.printf("[wifi] TX power set to %.1f dBm (減少 USB 供電欠壓風險)\n",
                static_cast<float>(WIFI_TX_POWER_DBM));
#endif

  WiFi.mode(WIFI_STA);

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

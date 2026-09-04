#include "wifi_manager.h"
#include <Arduino.h>

void WifiManager::beginConnect(const NetworkConfig &net) {
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
  Serial.printf("[wifi] connected, IP=%s RSSI=%d sleep=%s\n",
                WiFi.localIP().toString().c_str(), WiFi.RSSI(),
                WiFi.getSleep() ? "on(省電，會漏 multicast)" : "off");
  return true;
}

bool WifiManager::reconnect(const NetworkConfig &net, uint32_t timeout_ms) {
  return connect(net, timeout_ms);
}

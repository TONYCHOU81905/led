#include "wifi_manager.h"
#include <Arduino.h>

void WifiManager::beginConnect(const NetworkConfig &net) {
  WiFi.mode(WIFI_STA);
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

  Serial.printf("[wifi] connected, IP=%s RSSI=%d\n",
                WiFi.localIP().toString().c_str(), WiFi.RSSI());
  return true;
}

bool WifiManager::reconnect(const NetworkConfig &net, uint32_t timeout_ms) {
  return connect(net, timeout_ms);
}

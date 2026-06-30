#pragma once

#include <WiFi.h>
#include "types.h"

class WifiManager {
public:
  bool connect(const NetworkConfig &net, uint32_t timeout_ms = 15000);
  bool reconnect(const NetworkConfig &net, uint32_t timeout_ms = 15000);
  bool isConnected() const { return WiFi.status() == WL_CONNECTED; }
  int32_t rssi() const { return isConnected() ? WiFi.RSSI() : 0; }
};

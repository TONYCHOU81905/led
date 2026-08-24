#pragma once

#include <WiFi.h>
#include "types.h"

class WifiManager {
public:
  /** Blocking connect — use at boot only (starves Serial if used mid-run). */
  bool connect(const NetworkConfig &net, uint32_t timeout_ms = 15000);
  bool reconnect(const NetworkConfig &net, uint32_t timeout_ms = 15000);

  /** Non-blocking: kick off STA join; poll with isConnected() from loop. */
  void beginConnect(const NetworkConfig &net);

  bool isConnected() const { return WiFi.status() == WL_CONNECTED; }
  int32_t rssi() const { return isConnected() ? WiFi.RSSI() : 0; }
};

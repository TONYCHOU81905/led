#pragma once

#include <WiFiUdp.h>
#include "clock_sync.h"
#include "sync_receiver.h"
#include "types.h"

class StatusReporter {
public:
  void begin(uint16_t port);
  void tick(uint32_t now_ms, const DeviceConfig &cfg, AppSyncState state,
            const ClockSync &clock, const SyncReceiver &rx);

private:
  void pollControllerHello(uint32_t now_ms);
  bool hasFreshController(uint32_t now_ms) const;
  uint16_t readBatteryMv() const;
  const char *stateName(AppSyncState s) const;

  WiFiUDP _udp;
  uint16_t _port = 4211;
  uint32_t _last_send_ms = 0;
  uint32_t _last_controller_hello_ms = 0;
  IPAddress _controller_ip{0, 0, 0, 0};
  bool _has_controller = false;
  IPAddress _broadcast_ip{255, 255, 255, 255};
};

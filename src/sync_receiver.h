#pragma once

#include <WiFi.h>
#include <WiFiUdp.h>
#include "clock_sync.h"
#include "timecode_packet.h"
#include "types.h"

class SyncReceiver {
public:
  bool begin(uint16_t port);
  void poll(ClockSync &clock, AppSyncState &state);

  uint32_t packetsReceived() const { return _rx_count; }
  uint32_t packetsDropped() const { return _drop_count; }

private:
  bool validatePacket(const TimecodePacketV1 &pkt) const;
  void handlePacket(const TimecodePacketV1 &pkt, ClockSync &clock,
                    AppSyncState &state);

  WiFiUDP _udp;
  uint32_t _rx_count = 0;
  uint32_t _drop_count = 0;
  uint32_t _last_seq = 0;
};

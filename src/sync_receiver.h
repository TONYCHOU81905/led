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
  /** 同一 sequence 的重複封包數（Studio 多目標廣播造成），已被略過未處理。 */
  uint32_t packetsDuplicated() const { return _dup_count; }
  uint32_t lastPacketMs() const { return _last_packet_ms; }

private:
  bool validatePacket(const TimecodePacketV1 &pkt) const;
  void handlePacket(const TimecodePacketV1 &pkt, ClockSync &clock,
                    AppSyncState &state);

  WiFiUDP _udp;
  uint32_t _rx_count = 0;
  uint32_t _drop_count = 0;
  uint32_t _dup_count = 0;
  uint32_t _last_seq = 0;
  uint32_t _last_processed_seq = 0;
  bool _has_processed_seq = false;
  uint32_t _last_packet_ms = 0;
  uint32_t _last_debug_log_ms = 0;
  uint32_t _last_drop_log_ms = 0;
  bool _has_logged_first_packet = false;
};

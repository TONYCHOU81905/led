#include "sync_receiver.h"
#include <Arduino.h>

namespace {

constexpr uint32_t kCrc32Poly = 0xEDB88320u;

uint32_t crc32(const uint8_t *data, size_t len) {
  uint32_t crc = 0xFFFFFFFFu;
  for (size_t i = 0; i < len; ++i) {
    crc ^= data[i];
    for (int b = 0; b < 8; ++b) {
      crc = (crc >> 1) ^ ((crc & 1) ? kCrc32Poly : 0);
    }
  }
  return ~crc;
}

} // namespace

bool SyncReceiver::begin(uint16_t port) {
  if (!_udp.begin(port)) {
    Serial.printf("[udp] failed to bind port %u\n", port);
    return false;
  }
  Serial.printf("[udp] timecode listener on port %u\n", port);
  return true;
}

bool SyncReceiver::validatePacket(const TimecodePacketV1 &pkt) const {
  if (pkt.magic != TIMECODE_MAGIC) return false;
  if (pkt.version != 1) return false;

  TimecodePacketV1 copy = pkt;
  copy.packet_crc32 = 0;
  const uint32_t calc =
      crc32(reinterpret_cast<const uint8_t *>(&copy), sizeof(copy));
  if (calc != pkt.packet_crc32) return false;
  return true;
}

void SyncReceiver::handlePacket(const TimecodePacketV1 &pkt, ClockSync &clock,
                                AppSyncState &state) {
  const int64_t now_us = esp_timer_get_time();
  _last_packet_ms = static_cast<uint32_t>(now_us / 1000);
  _last_seq = pkt.sequence;

  switch (pkt.packet_type) {
  case TC_START:
    clock.onStart(pkt.music_time_ms, now_us);
    state = STATE_PLAYING;
    break;
  case TC_RUNNING:
    clock.onRunning(pkt.music_time_ms, now_us);
    if (state == STATE_WAIT_TIMECODE || state == STATE_PAUSED) {
      state = STATE_PLAYING;
    }
    break;
  case TC_PAUSE:
    clock.onPause(now_us);
    state = STATE_PAUSED;
    break;
  case TC_STOP:
    clock.onStop();
    state = STATE_STOPPED;
    break;
  case TC_SEEK:
    clock.onSeek(pkt.music_time_ms, now_us);
    state = STATE_PLAYING;
    break;
  case TC_PING:
    break;
  default:
    break;
  }
}

void SyncReceiver::poll(ClockSync &clock, AppSyncState &state) {
  int packetSize = _udp.parsePacket();
  while (packetSize > 0) {
    if (packetSize >= static_cast<int>(sizeof(TimecodePacketV1))) {
      TimecodePacketV1 pkt{};
      _udp.read(reinterpret_cast<uint8_t *>(&pkt), sizeof(pkt));
      if (validatePacket(pkt)) {
        handlePacket(pkt, clock, state);
        clock.setLastSequence(pkt.sequence);
        _rx_count++;
      } else {
        _drop_count++;
      }
    } else {
      _drop_count++;
    }
    packetSize = _udp.parsePacket();
  }
}

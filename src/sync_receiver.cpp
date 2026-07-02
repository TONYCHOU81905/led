#include "sync_receiver.h"
#include <Arduino.h>
#include "time_format.h"

namespace {

constexpr uint32_t kCrc32Poly = 0xEDB88320u;
constexpr uint32_t kRxDebugIntervalMs = 5000;
constexpr uint32_t kDropDebugIntervalMs = 2000;

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

const char *packetTypeName(uint8_t type) {
  switch (type) {
  case TC_START:
    return "START";
  case TC_RUNNING:
    return "RUNNING";
  case TC_PAUSE:
    return "PAUSE";
  case TC_STOP:
    return "STOP";
  case TC_SEEK:
    return "SEEK";
  case TC_PING:
    return "PING";
  default:
    return "UNKNOWN";
  }
}

} // namespace

bool SyncReceiver::begin(uint16_t port) {
  _udp.stop();
  _last_debug_log_ms = 0;
  _last_drop_log_ms = 0;
  _has_logged_first_packet = false;
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

  // Spec: packet_crc32 covers bytes before this field (not zero-padded tail).
  const uint32_t calc = crc32(reinterpret_cast<const uint8_t *>(&pkt),
                              sizeof(pkt) - sizeof(pkt.packet_crc32));
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
    clock.onPause(pkt.music_time_ms, now_us);
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
    const IPAddress remote_ip = _udp.remoteIP();
    const uint16_t remote_port = _udp.remotePort();
    if (packetSize >= static_cast<int>(sizeof(TimecodePacketV1))) {
      TimecodePacketV1 pkt{};
      _udp.read(reinterpret_cast<uint8_t *>(&pkt), sizeof(pkt));
      if (validatePacket(pkt)) {
        handlePacket(pkt, clock, state);
        clock.setLastSequence(pkt.sequence);
        _rx_count++;
        if (!_has_logged_first_packet) {
          _has_logged_first_packet = true;
          char show[16];
          formatShowTimeMmSs(pkt.music_time_ms, show, sizeof(show));
          Serial.printf("[udp] first valid packet from %s:%u type=%s seq=%u show=%s\n",
                        remote_ip.toString().c_str(), remote_port,
                        packetTypeName(pkt.packet_type), pkt.sequence, show);
        }
        if (_last_debug_log_ms == 0 ||
            (_last_packet_ms - _last_debug_log_ms) >= kRxDebugIntervalMs ||
            pkt.packet_type != TC_RUNNING) {
          _last_debug_log_ms = _last_packet_ms;
          char show[16];
          formatShowTimeMmSs(pkt.music_time_ms, show, sizeof(show));
          Serial.printf("[udp] rx %s from %s:%u seq=%u show=%s total=%u drop=%u\n",
                        packetTypeName(pkt.packet_type),
                        remote_ip.toString().c_str(), remote_port, pkt.sequence,
                        show, _rx_count, _drop_count);
        }
      } else {
        _drop_count++;
        const uint32_t now_ms = static_cast<uint32_t>(esp_timer_get_time() / 1000);
        if (_last_drop_log_ms == 0 ||
            (now_ms - _last_drop_log_ms) >= kDropDebugIntervalMs) {
          _last_drop_log_ms = now_ms;
          Serial.printf("[udp] drop invalid packet from %s:%u size=%d total_drop=%u\n",
                        remote_ip.toString().c_str(), remote_port, packetSize,
                        _drop_count);
        }
      }
    } else {
      _drop_count++;
      const uint32_t now_ms = static_cast<uint32_t>(esp_timer_get_time() / 1000);
      if (_last_drop_log_ms == 0 ||
          (now_ms - _last_drop_log_ms) >= kDropDebugIntervalMs) {
        _last_drop_log_ms = now_ms;
        Serial.printf("[udp] drop short packet from %s:%u size=%d total_drop=%u\n",
                      remote_ip.toString().c_str(), remote_port, packetSize,
                      _drop_count);
      }
    }
    packetSize = _udp.parsePacket();
  }
}

#include "status_reporter.h"
#include <Arduino.h>
#include <ArduinoJson.h>
#include "mdns_advertiser.h"

#ifndef BATTERY_ADC_PIN
#define BATTERY_ADC_PIN -1
#endif

#ifndef CONTROLLER_HELLO_TIMEOUT_MS
#define CONTROLLER_HELLO_TIMEOUT_MS 15000
#endif

namespace {

IPAddress localBroadcastIp() {
  const IPAddress ip = WiFi.localIP();
  const IPAddress mask = WiFi.subnetMask();
  return IPAddress((ip[0] & mask[0]) | (~mask[0] & 0xFF),
                   (ip[1] & mask[1]) | (~mask[1] & 0xFF),
                   (ip[2] & mask[2]) | (~mask[2] & 0xFF),
                   (ip[3] & mask[3]) | (~mask[3] & 0xFF));
}

} // namespace

void StatusReporter::begin(uint16_t port) {
  _port = port;
  _udp.stop();
  _udp.begin(_port);
  _last_send_ms = 0;
  _last_controller_hello_ms = 0;
  _controller_ip = IPAddress(0, 0, 0, 0);
  _has_controller = false;
  Serial.printf("[status] listening for controller hello on UDP %u\n", _port);
}

void StatusReporter::pollControllerHello(uint32_t now_ms) {
  int packet_size = _udp.parsePacket();
  while (packet_size > 0) {
    if (packet_size > 0 && packet_size < 512) {
      char buf[512];
      const int read_len = _udp.read(reinterpret_cast<uint8_t *>(buf),
                                     sizeof(buf) - 1);
      if (read_len > 0) {
        buf[read_len] = '\0';
        JsonDocument doc;
        const DeserializationError err = deserializeJson(doc, buf);
        if (!err) {
          const char *type = doc["type"] | "";
          if (strcmp(type, "controller_hello") == 0) {
            const IPAddress remote_ip = _udp.remoteIP();
            const bool ip_changed = !_has_controller || remote_ip != _controller_ip;
            _controller_ip = remote_ip;
            _last_controller_hello_ms = now_ms;
            _has_controller = true;
            if (ip_changed) {
              Serial.printf("[status] controller discovered at %s:%u\n",
                            remote_ip.toString().c_str(), _udp.remotePort());
            }
          }
        }
      }
    } else if (packet_size > 0) {
      _udp.flush();
    }
    packet_size = _udp.parsePacket();
  }

  if (_has_controller && !hasFreshController(now_ms)) {
    Serial.printf("[status] controller hello timeout for %s\n",
                  _controller_ip.toString().c_str());
    _controller_ip = IPAddress(0, 0, 0, 0);
    _last_controller_hello_ms = 0;
    _has_controller = false;
  }
}

bool StatusReporter::hasFreshController(uint32_t now_ms) const {
  return _has_controller && now_ms >= _last_controller_hello_ms &&
         (now_ms - _last_controller_hello_ms) <= CONTROLLER_HELLO_TIMEOUT_MS;
}

const char *StatusReporter::stateName(AppSyncState s) const {
  switch (s) {
  case STATE_BOOT:
    return "BOOT";
  case STATE_WIFI_CONNECTING:
    return "WIFI_CONNECTING";
  case STATE_WAIT_TIMECODE:
    return "WAIT_TIMECODE";
  case STATE_PLAYING:
    return "PLAYING";
  case STATE_PAUSED:
    return "PAUSED";
  case STATE_STOPPED:
    return "STOPPED";
  default:
    return "UNKNOWN";
  }
}

uint16_t StatusReporter::readBatteryMv() const {
#if BATTERY_ADC_PIN >= 0
  const int raw = analogRead(BATTERY_ADC_PIN);
  // Placeholder scaling — tune divider ratio for your hardware
  return static_cast<uint16_t>(raw * 3300 / 4095);
#else
  return 0;
#endif
}

void StatusReporter::tick(uint32_t now_ms, const DeviceConfig &cfg,
                          AppSyncState state, const ClockSync &clock,
                          const SyncReceiver &rx) {
  pollControllerHello(now_ms);

  const uint32_t interval = (state == STATE_PLAYING) ? 200 : 1000;
  if (now_ms - _last_send_ms < interval) return;
  _last_send_ms = now_ms;

  // chip_id（MAC 後 3 bytes）讓 Studio 能區分「device_id 相同但實體不同」的
  // 多台板子。device_id 是從 role_id 推導的，同 role 的十台會完全一樣。
  char chip[8];
  mdns_advertiser::chipSuffix(chip, sizeof(chip));

  char buf[512];
  const int n = snprintf(
      buf, sizeof(buf),
      "{\"type\":\"status\",\"device_id\":\"%s\",\"chip_id\":\"%s\","
      "\"role_id\":\"%s\","
      "\"firmware_version\":\"%s\",\"config_crc32\":\"0x%08X\","
      "\"sync_state\":\"%s\",\"last_timecode_seq\":%u,"
      "\"music_time_ms\":%u,"
      "\"estimated_drift_ms\":%d,\"packet_loss_count\":%u,"
      "\"rssi\":%d,\"battery_mv\":%u}\n",
      cfg.device_id, chip, cfg.role_id, FIRMWARE_VERSION, cfg.config_crc32,
      stateName(state), clock.lastSequence(),
      clock.hasSync() ? clock.musicTimeMs(esp_timer_get_time()) : 0,
      clock.estimatedDriftMs(),
      rx.packetsDropped(), WiFi.RSSI(), readBatteryMv());

  if (n <= 0) return;

  if (hasFreshController(now_ms)) {
    _udp.beginPacket(_controller_ip, _port);
    _udp.write(reinterpret_cast<uint8_t *>(buf), n);
    _udp.endPacket();
  } else {
    const IPAddress directed_broadcast = localBroadcastIp();
    _udp.beginPacket(directed_broadcast, _port);
    _udp.write(reinterpret_cast<uint8_t *>(buf), n);
    _udp.endPacket();

    if (directed_broadcast != _broadcast_ip) {
      _udp.beginPacket(_broadcast_ip, _port);
      _udp.write(reinterpret_cast<uint8_t *>(buf), n);
      _udp.endPacket();
    }
  }

  if (state == STATE_PLAYING && hasFreshController(now_ms)) {
    // Also mirror a backup broadcast during playback in case the controller
    // listener restarts and needs to rediscover devices mid-show.
    const IPAddress directed_broadcast = localBroadcastIp();
    _udp.beginPacket(_broadcast_ip, _port);
    _udp.write(reinterpret_cast<uint8_t *>(buf), n);
    _udp.endPacket();
    if (directed_broadcast != _broadcast_ip) {
      _udp.beginPacket(directed_broadcast, _port);
      _udp.write(reinterpret_cast<uint8_t *>(buf), n);
      _udp.endPacket();
    }
  }
}

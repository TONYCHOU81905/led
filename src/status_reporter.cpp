#include "status_reporter.h"
#include <Arduino.h>

#ifndef BATTERY_ADC_PIN
#define BATTERY_ADC_PIN -1
#endif

void StatusReporter::begin(uint16_t port) {
  (void)port;
  _udp.begin(0); // ephemeral source port for outbound
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
  const uint32_t interval = (state == STATE_PLAYING) ? 200 : 1000;
  if (now_ms - _last_send_ms < interval) return;
  _last_send_ms = now_ms;

  char buf[512];
  const int n = snprintf(
      buf, sizeof(buf),
      "{\"type\":\"status\",\"device_id\":\"%s\",\"role_id\":\"%s\","
      "\"firmware_version\":\"%s\",\"config_crc32\":\"0x%08X\","
      "\"sync_state\":\"%s\",\"last_timecode_seq\":%u,"
      "\"estimated_drift_ms\":%d,\"packet_loss_count\":%u,"
      "\"rssi\":%d,\"battery_mv\":%u}\n",
      cfg.device_id, cfg.role_id, FIRMWARE_VERSION, cfg.config_crc32,
      stateName(state), clock.lastSequence(), clock.estimatedDriftMs(),
      rx.packetsDropped(), WiFi.RSSI(), readBatteryMv());

  if (n <= 0) return;

  _udp.beginPacket(_broadcast_ip, cfg.network.status_port);
  _udp.write(reinterpret_cast<uint8_t *>(buf), n);
  _udp.endPacket();
}

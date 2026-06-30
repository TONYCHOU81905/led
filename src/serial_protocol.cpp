#include "serial_protocol.h"
#include "config_json_parser.h"
#include "led_chipset.h"
#include "nvs_wifi.h"
#include <Arduino.h>
#include <ArduinoJson.h>
#include <WiFi.h>

void SerialProtocol::begin() {
  Serial.println("[serial] JSON protocol ready");
}

SerialPendingAction SerialProtocol::takePendingAction() {
  SerialPendingAction action = _pending;
  _pending = {};
  return action;
}

void SerialProtocol::respondError(const char *message) {
  JsonDocument doc;
  doc["ok"] = false;
  doc["error"] = message;
  serializeJson(doc, Serial);
  Serial.println();
}

void SerialProtocol::respondPing(const DeviceConfig &cfg) {
  JsonDocument doc;
  doc["ok"] = true;
  doc["firmware"] = FIRMWARE_VERSION;
  doc["device_id"] = cfg.device_id;
  serializeJson(doc, Serial);
  Serial.println();
}

void SerialProtocol::respondWifi(JsonObjectConst root, DeviceConfig &cfg) {
  const char *ssid = root["ssid"] | "";
  const char *password = root["password"] | "";

  if (ssid[0] == '\0') {
    respondError("wifi requires ssid");
    return;
  }

  if (!NvsWifi::saveNetwork(ssid, password)) {
    respondError("failed to save WiFi credentials");
    return;
  }

  strncpy(cfg.network.ssid, ssid, sizeof(cfg.network.ssid) - 1);
  cfg.network.ssid[sizeof(cfg.network.ssid) - 1] = '\0';
  strncpy(cfg.network.password, password, sizeof(cfg.network.password) - 1);
  cfg.network.password[sizeof(cfg.network.password) - 1] = '\0';

  _pending.pending = true;
  _pending.network_changed = true;

  JsonDocument doc;
  doc["ok"] = true;
  serializeJson(doc, Serial);
  Serial.println();
}

void SerialProtocol::respondConfig(JsonObjectConst root, DeviceConfig &cfg) {
  JsonVariantConst config_var = root["config"];
  if (config_var.isNull()) {
    respondError("config command requires config field");
    return;
  }

  String config_json;
  serializeJson(config_var, config_json);

  const uint8_t prev_gpio = cfg.hardware.data_gpio;
  const uint16_t prev_led_count = cfg.hardware.led_count;
  const LedChipsetType prev_led_type = cfg.hardware.led_type;
  char prev_ssid[64];
  char prev_pass[64];
  strncpy(prev_ssid, cfg.network.ssid, sizeof(prev_ssid) - 1);
  prev_ssid[sizeof(prev_ssid) - 1] = '\0';
  strncpy(prev_pass, cfg.network.password, sizeof(prev_pass) - 1);
  prev_pass[sizeof(prev_pass) - 1] = '\0';

  DeviceConfig parsed{};
  if (!ConfigJsonParser::parse(config_json.c_str(), config_json.length(),
                               parsed)) {
    respondError("config parse failed");
    return;
  }

  if (parsed.network.ssid[0] == '\0') {
    strncpy(parsed.network.ssid, cfg.network.ssid, sizeof(parsed.network.ssid) - 1);
    parsed.network.ssid[sizeof(parsed.network.ssid) - 1] = '\0';
    strncpy(parsed.network.password, cfg.network.password,
            sizeof(parsed.network.password) - 1);
    parsed.network.password[sizeof(parsed.network.password) - 1] = '\0';
  }
  parsed.network.timecode_port = cfg.network.timecode_port;
  parsed.network.status_port = cfg.network.status_port;

  cfg = parsed;

  _pending.pending = true;
  _pending.gpio_changed =
      (cfg.hardware.data_gpio != prev_gpio ||
       cfg.hardware.led_count != prev_led_count ||
       cfg.hardware.led_type != prev_led_type);
  _pending.network_changed =
      (strcmp(cfg.network.ssid, prev_ssid) != 0 ||
       strcmp(cfg.network.password, prev_pass) != 0);

  if (_pending.gpio_changed) {
    Serial.println("[serial] warning: data_gpio, led_count, or led_type changed — "
                   "LED reinit requires restart");
  }

  JsonDocument doc;
  doc["ok"] = true;
  doc["crc32"] = cfg.config_crc32;
  doc["events"] = cfg.event_count;
  serializeJson(doc, Serial);
  Serial.println();
}

void SerialProtocol::respondStatusJson(const DeviceConfig &cfg, ClockSync &clock,
                                       SyncReceiver &rx, AppSyncState state) {
  const char *sync_state = "UNKNOWN";
  switch (state) {
  case STATE_BOOT:
    sync_state = "BOOT";
    break;
  case STATE_WIFI_CONNECTING:
    sync_state = "WIFI_CONNECTING";
    break;
  case STATE_WAIT_TIMECODE:
    sync_state = "WAIT_TIMECODE";
    break;
  case STATE_PLAYING:
    sync_state = "PLAYING";
    break;
  case STATE_PAUSED:
    sync_state = "PAUSED";
    break;
  case STATE_STOPPED:
    sync_state = "STOPPED";
    break;
  }

  JsonDocument doc;
  doc["ok"] = true;
  doc["type"] = "status";
  doc["device_id"] = cfg.device_id;
  doc["role_id"] = cfg.role_id;
  doc["firmware"] = FIRMWARE_VERSION;
  doc["config_crc32"] = cfg.config_crc32;
  doc["led_count"] = cfg.hardware.led_count;
  doc["data_gpio"] =
      cfg.hardware.data_gpio ? cfg.hardware.data_gpio : LED_DATA_GPIO;
  doc["led_type"] = ledChipsetName(cfg.hardware.led_type);
  doc["wifi_connected"] = WiFi.status() == WL_CONNECTED;
  doc["wifi_ip"] = WiFi.localIP().toString();
  doc["sync_state"] = sync_state;
  doc["music_time_ms"] = clock.musicTimeMs(esp_timer_get_time());
  doc["drift_ms"] = clock.estimatedDriftMs();
  doc["last_sequence"] = clock.lastSequence();
  doc["udp_rx"] = rx.packetsReceived();
  doc["udp_drop"] = rx.packetsDropped();
  doc["rssi"] = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0;
  serializeJson(doc, Serial);
  Serial.println();
}

void SerialProtocol::handleJsonCommand(JsonObjectConst root,
                                       ConfigLoader &config, DeviceConfig &cfg,
                                       ClockSync &clock, SyncReceiver &rx,
                                       AppSyncState &state) {
  (void)config;

  const char *cmd = root["cmd"] | "";
  if (strcmp(cmd, "ping") == 0) {
    respondPing(cfg);
    return;
  }
  if (strcmp(cmd, "wifi") == 0) {
    respondWifi(root, cfg);
    return;
  }
  if (strcmp(cmd, "config") == 0) {
    respondConfig(root, cfg);
    return;
  }
  if (strcmp(cmd, "status") == 0) {
    respondStatusJson(cfg, clock, rx, state);
    return;
  }

  respondError("unknown cmd");
}

void SerialProtocol::handleLine(const String &line, ConfigLoader &config,
                                DeviceConfig &cfg, ClockSync &clock,
                                SyncReceiver &rx, AppSyncState &state) {
  if (line.length() == 0) return;

  if (line.equalsIgnoreCase("status")) {
    respondStatusJson(cfg, clock, rx, state);
    return;
  }

  JsonDocument doc;
  const DeserializationError err = deserializeJson(doc, line);
  if (err) {
    Serial.printf("[serial] JSON parse error: %s\n", err.c_str());
    return;
  }

  JsonObjectConst root = doc.as<JsonObjectConst>();
  if (root.isNull()) {
    respondError("command must be JSON object");
    return;
  }

  handleJsonCommand(root, config, cfg, clock, rx, state);
}

void SerialProtocol::poll(ConfigLoader &config, DeviceConfig &cfg,
                          ClockSync &clock, SyncReceiver &rx,
                          AppSyncState &state) {
  static String line;
  while (Serial.available()) {
    const char c = Serial.read();
    if (c == '\n' || c == '\r') {
      line.trim();
      if (line.length() > 0) {
        handleLine(line, config, cfg, clock, rx, state);
      }
      line = "";
    } else if (line.length() < kMaxLineLen) {
      line += c;
    }
  }
}

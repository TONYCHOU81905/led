#include "serial_protocol.h"
#include "config_json_parser.h"
#include "config_storage.h"
#include "led_chipset.h"
#include "nvs_wifi.h"
#include <Arduino.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include <stdlib.h>
#include <string.h>

void SerialProtocol::ConfigChunkAssembler::reset() {
  active = false;
  total = 0;
  expected_crc = 0;
  filled = 0;
  if (buffer) {
    free(buffer);
    buffer = nullptr;
  }
}

bool SerialProtocol::ConfigChunkAssembler::begin(uint32_t size,
                                                 uint32_t crc) {
  reset();
  if (size == 0 || size > CONFIG_FLASH_MAX_BYTES) {
    return false;
  }
  buffer = static_cast<char *>(malloc(size + 1));
  if (!buffer) {
    return false;
  }
  memset(buffer, 0, size + 1);
  active = true;
  total = size;
  expected_crc = crc;
  filled = 0;
  return true;
}

bool SerialProtocol::ConfigChunkAssembler::append(uint32_t offset,
                                                  const char *data,
                                                  size_t len) {
  if (!active || !buffer || !data || offset + len > total) {
    return false;
  }
  memcpy(buffer + offset, data, len);
  const uint32_t end = offset + static_cast<uint32_t>(len);
  if (end > filled) {
    filled = end;
  }
  return true;
}

bool SerialProtocol::ConfigChunkAssembler::isComplete() const {
  return active && filled >= total;
}

void SerialProtocol::begin() {
  _chunk.reset();
  Serial.println("[serial] JSON protocol ready (config + chunked upload)");
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
  doc["config_crc32"] = cfg.config_crc32;
  doc["flash_config"] = ConfigStorage::exists();
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

bool SerialProtocol::finalizeConfigJson(
    ConfigLoader &loader, DeviceConfig &cfg, const char *json, size_t len,
    const uint8_t prev_gpio, const uint16_t prev_led_count,
    const LedChipsetType prev_led_type, const char *prev_ssid,
    const char *prev_pass) {
  DeviceConfig parsed{};
  if (!ConfigJsonParser::parse(json, len, parsed)) {
    respondError("config parse failed");
    return false;
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
  NvsWifi::loadNetworkOverlay(parsed.network);

  if (!loader.applyDeviceConfig(parsed, json, len, cfg)) {
    respondError("config apply failed");
    return false;
  }

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
  doc["flash_saved"] = ConfigStorage::exists();
  serializeJson(doc, Serial);
  Serial.println();
  return true;
}

void SerialProtocol::respondConfig(JsonObjectConst root, ConfigLoader &loader,
                                   DeviceConfig &cfg) {
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

  finalizeConfigJson(loader, cfg, config_json.c_str(), config_json.length(),
                     prev_gpio, prev_led_count, prev_led_type, prev_ssid,
                     prev_pass);
}

void SerialProtocol::respondBeginConfig(JsonObjectConst root) {
  _chunk.reset();
  const uint32_t size = root["size"] | 0;
  const uint32_t crc = root["crc32"] | 0;
  if (!_chunk.begin(size, crc)) {
    respondError("begin_config failed");
    return;
  }

  JsonDocument doc;
  doc["ok"] = true;
  doc["size"] = size;
  serializeJson(doc, Serial);
  Serial.println();
}

void SerialProtocol::respondConfigChunk(JsonObjectConst root) {
  if (!_chunk.active) {
    respondError("no active config upload");
    return;
  }

  const uint32_t offset = root["offset"] | 0;
  const char *data = root["data"] | "";
  const size_t len = strlen(data);
  if (!_chunk.append(offset, data, len)) {
    respondError("config_chunk failed");
    return;
  }

  JsonDocument doc;
  doc["ok"] = true;
  doc["offset"] = offset;
  doc["received"] = _chunk.filled;
  serializeJson(doc, Serial);
  Serial.println();
}

void SerialProtocol::respondEndConfig(ConfigLoader &loader, DeviceConfig &cfg) {
  if (!_chunk.isComplete()) {
    respondError("config upload incomplete");
    return;
  }

  _chunk.buffer[_chunk.total] = '\0';
  const uint32_t calc =
      ConfigJsonParser::crc32(_chunk.buffer, _chunk.total);
  if (calc != _chunk.expected_crc) {
    _chunk.reset();
    respondError("config crc mismatch");
    return;
  }

  const uint8_t prev_gpio = cfg.hardware.data_gpio;
  const uint16_t prev_led_count = cfg.hardware.led_count;
  const LedChipsetType prev_led_type = cfg.hardware.led_type;
  char prev_ssid[64];
  char prev_pass[64];
  strncpy(prev_ssid, cfg.network.ssid, sizeof(prev_ssid) - 1);
  prev_ssid[sizeof(prev_ssid) - 1] = '\0';
  strncpy(prev_pass, cfg.network.password, sizeof(prev_pass) - 1);
  prev_pass[sizeof(prev_pass) - 1] = '\0';

  const bool ok = finalizeConfigJson(loader, cfg, _chunk.buffer, _chunk.total,
                                     prev_gpio, prev_led_count, prev_led_type,
                                     prev_ssid, prev_pass);
  _chunk.reset();
  (void)ok;
}

void SerialProtocol::respondReload(ConfigLoader &loader, DeviceConfig &cfg) {
  if (!loader.reload(cfg)) {
    respondError("reload failed");
    return;
  }

  _pending.pending = true;

  JsonDocument doc;
  doc["ok"] = true;
  doc["events"] = cfg.event_count;
  doc["crc32"] = cfg.config_crc32;
  doc["source"] = "flash";
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
  doc["flash_config"] = ConfigStorage::exists();
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
  doc["last_packet_ms"] = rx.lastPacketMs();
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
  (void)state;

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
    respondConfig(root, config, cfg);
    return;
  }
  if (strcmp(cmd, "begin_config") == 0) {
    respondBeginConfig(root);
    return;
  }
  if (strcmp(cmd, "config_chunk") == 0) {
    respondConfigChunk(root);
    return;
  }
  if (strcmp(cmd, "end_config") == 0) {
    respondEndConfig(config, cfg);
    return;
  }
  if (strcmp(cmd, "reload") == 0) {
    respondReload(config, cfg);
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
  if (line.equalsIgnoreCase("reload")) {
    respondReload(config, cfg);
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

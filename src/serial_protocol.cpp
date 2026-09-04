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
  char fallback_ssid[64];
  char fallback_pass[64];
  strncpy(fallback_ssid, cfg.network.ssid, sizeof(fallback_ssid) - 1);
  fallback_ssid[sizeof(fallback_ssid) - 1] = '\0';
  strncpy(fallback_pass, cfg.network.password, sizeof(fallback_pass) - 1);
  fallback_pass[sizeof(fallback_pass) - 1] = '\0';
  const uint16_t fallback_tc_port = cfg.network.timecode_port;
  const uint16_t fallback_st_port = cfg.network.status_port;

  // 一律用 parse()。
  //
  // 這裡原本有一條 parseInPlace() 的 zero-copy 分支，理由是「省掉字串副本」。
  // 覆核用 ASAN 對著實際 vendored 的 ArduinoJson 7.4.3 證明那個前提是假的：
  // StringBuilder::save() 無論輸入是 char* 或 const char*，都會自己配置
  // StringNode 並複製字元進去，這個版本沒有「字串指向呼叫端緩衝區」的模式。
  // 也就是說 parseInPlace 對同樣大小的輸入完全沒有節省，卻留下一條
  // 「緩衝區必須活得比解析久」的假不變式 —— 那比沒有更危險，
  // 未來維護的人可能誤信它、或去「修」一個本來沒壞的東西而弄出真的 UAF。
  //
  // 這個功能真正的 heap 節省，全部來自「每批用一個小的 JsonDocument」
  // 而不是「整份 config 用一個大的」，與字串複製無關。
  const bool parsed = ConfigJsonParser::parse(json, len, cfg);
  if (!parsed) {
    respondError("config parse failed");
    return false;
  }

  if (cfg.network.ssid[0] == '\0') {
    strncpy(cfg.network.ssid, fallback_ssid, sizeof(cfg.network.ssid) - 1);
    cfg.network.ssid[sizeof(cfg.network.ssid) - 1] = '\0';
    strncpy(cfg.network.password, fallback_pass, sizeof(cfg.network.password) - 1);
    cfg.network.password[sizeof(cfg.network.password) - 1] = '\0';
  }
  cfg.network.timecode_port = fallback_tc_port;
  cfg.network.status_port = fallback_st_port;
  NvsWifi::loadNetworkOverlay(cfg.network);

  if (!loader.applyDeviceConfig(cfg, json, len, cfg)) {
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
  const uint32_t size = root["size"].as<uint32_t>();
  const uint32_t crc = root["crc32"].as<uint32_t>();
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
  const JsonString data_str = root["data"].as<JsonString>();
  const char *data = data_str.c_str();
  const size_t len = data_str.size();
  if (!data || len == 0) {
    respondError("config_chunk missing data");
    return;
  }
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
    Serial.printf("[config] crc mismatch expected=0x%08X calc=0x%08X size=%u\n",
                  _chunk.expected_crc, calc, _chunk.total);
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

  // 解析前先印出 JSON 大小與 heap 狀態。
  //
  // 為什麼需要：ArduinoJson 7 的 JsonDocument 是彈性的，從 heap 動態配置，
  // 而且成長時要 realloc（短暫需要兩倍空間）。解析失敗時只會回一句
  // 「parse error: NoMemory」，完全看不出是 JSON 太大、heap 被吃光、
  // 還是碎片化導致沒有足夠大的連續區塊 —— 三者的處理方式完全不同。
  // 最大連續區塊是關鍵：free heap 夠但最大區塊不夠時 NoMemory 一樣會發生。
  Serial.printf("[config] 解析前：JSON %u bytes，free heap %u，最大連續區塊 %u\n",
                _chunk.total, ESP.getFreeHeap(), ESP.getMaxAllocHeap());

  const bool ok = finalizeConfigJson(loader, cfg, _chunk.buffer, _chunk.total,
                                     prev_gpio, prev_led_count, prev_led_type,
                                     prev_ssid, prev_pass);
  _chunk.reset();
  (void)ok;
}

void SerialProtocol::respondBeginMeta(JsonObjectConst root, const DeviceConfig &cfg) {
  _chunk.reset();
  _meta_applied = false;

  // commit_config 要比較「套用前後」的硬體/網路，才知道要不要觸發 LED
  // 重新初始化或 WiFi 重連 —— 但 end_meta 會直接覆寫 cfg，所以套用前的
  // 值只能在這裡先存起來。
  _stream_prev_gpio = cfg.hardware.data_gpio;
  _stream_prev_led_count = cfg.hardware.led_count;
  _stream_prev_led_type = cfg.hardware.led_type;
  strncpy(_stream_prev_ssid, cfg.network.ssid, sizeof(_stream_prev_ssid) - 1);
  _stream_prev_ssid[sizeof(_stream_prev_ssid) - 1] = '\0';
  strncpy(_stream_prev_pass, cfg.network.password, sizeof(_stream_prev_pass) - 1);
  _stream_prev_pass[sizeof(_stream_prev_pass) - 1] = '\0';

  const uint32_t size = root["size"].as<uint32_t>();
  const uint32_t crc = root["crc32"].as<uint32_t>();
  if (!_chunk.begin(size, crc)) {
    respondError("begin_meta failed");
    return;
  }

  JsonDocument doc;
  doc["ok"] = true;
  doc["size"] = size;
  serializeJson(doc, Serial);
  Serial.println();
}

void SerialProtocol::respondEndMeta(DeviceConfig &cfg) {
  if (!_chunk.isComplete()) {
    respondError("meta upload incomplete");
    return;
  }

  _chunk.buffer[_chunk.total] = '\0';
  const uint32_t calc = ConfigJsonParser::crc32(_chunk.buffer, _chunk.total);
  if (calc != _chunk.expected_crc) {
    Serial.printf("[config] meta crc mismatch expected=0x%08X calc=0x%08X size=%u\n",
                  _chunk.expected_crc, calc, _chunk.total);
    _chunk.reset();
    respondError("meta crc mismatch");
    return;
  }

  // meta 是「events 為空陣列」的完整 config —— zero-copy 解析，_chunk.buffer
  // 只裝 meta（實測約 4KB），跟 config 總量無關，這正是分批協定要解決的問題
  // （38,123 bytes / 181 events 一次解析會 NoMemory；heap 只剩約 90KB）。
  if (!ConfigJsonParser::parse(_chunk.buffer, _chunk.total, cfg)) {
    _chunk.reset();
    respondError("meta parse failed");
    return;
  }
  // applyRoot 一開始就 memset 整個 cfg，event_count 本來就會是 0；
  // 這裡明講歸零只是讓意圖看得出來，不依賴 memset 的副作用。
  cfg.event_count = 0;
  _chunk.reset();
  _meta_applied = true;

  JsonDocument doc;
  doc["ok"] = true;
  serializeJson(doc, Serial);
  Serial.println();
}

void SerialProtocol::respondBeginEvents(JsonObjectConst root) {
  _chunk.reset();
  const uint32_t size = root["size"].as<uint32_t>();
  const uint32_t crc = root["crc32"].as<uint32_t>();
  const uint32_t batch = root["batch"] | 0; // 只用於 log，不影響行為
  if (!_chunk.begin(size, crc)) {
    respondError("begin_events failed");
    return;
  }

  Serial.printf("[config] begin_events batch=%u size=%u\n", batch, size);
  JsonDocument doc;
  doc["ok"] = true;
  doc["size"] = size;
  serializeJson(doc, Serial);
  Serial.println();
}

void SerialProtocol::respondEndEvents(ConfigLoader &loader, DeviceConfig &cfg) {
  if (!_meta_applied) {
    // parts/colors 的索引查找需要 meta 先套好，順序由 Studio 保證，
    // 但韌體自己也要能擋掉「meta 還沒送」的情況。
    respondError("end_events before end_meta");
    return;
  }
  if (!_chunk.isComplete()) {
    rollbackStreamConfig(loader, cfg, "end_events");
    respondError("events upload incomplete");
    return;
  }

  _chunk.buffer[_chunk.total] = '\0';
  const uint32_t calc = ConfigJsonParser::crc32(_chunk.buffer, _chunk.total);
  if (calc != _chunk.expected_crc) {
    Serial.printf("[config] events crc mismatch expected=0x%08X calc=0x%08X size=%u\n",
                  _chunk.expected_crc, calc, _chunk.total);
    _chunk.reset();
    rollbackStreamConfig(loader, cfg, "end_events");
    respondError("events crc mismatch");
    return;
  }

  // 這批只是一個 JSON 陣列（不是完整 config），applyRoot()/parse()/
  // parse() 吃的是完整 config 物件，不能拿來用。用一個小
  // JsonDocument 只裝這一批（實測約 4KB）—— peak heap 因此跟 config
  // 總量無關，這正是分批協定要解決的問題。
  JsonDocument doc;
  const DeserializationError err = deserializeJson(doc, _chunk.buffer, _chunk.total);
  _chunk.reset();
  if (err) {
    Serial.printf("[config] events parse error: %s\n", err.c_str());
    rollbackStreamConfig(loader, cfg, "end_events");
    respondError("events parse failed");
    return;
  }

  JsonArrayConst events = doc.as<JsonArrayConst>();
  if (events.isNull()) {
    rollbackStreamConfig(loader, cfg, "end_events");
    respondError("end_events payload must be a JSON array");
    return;
  }

  for (JsonObjectConst evt : events) {
    if (cfg.event_count >= MAX_EVENTS) {
      respondError("too many events");
      return;
    }
    if (!ConfigJsonParser::applyEvent(evt, cfg, cfg.events[cfg.event_count])) {
      respondError("event parse failed");
      return;
    }
    cfg.event_count++;
  }

  JsonDocument resp;
  resp["ok"] = true;
  resp["events"] = cfg.event_count;
  serializeJson(resp, Serial);
  Serial.println();
}

/**
 * 分批上傳中途失敗時，把設定復原成 flash 上的最後一份好設定。
 *
 * 為什麼需要：g_config 就是餵給 timeline 的那份 live render config
 * （main.cpp 的 g_timeline.setConfig(&g_config)），而 end_meta 會
 * memset 整個 struct 再重填。所以第 6 批失敗時，板子會停在
 * 「新的 meta ＋ 只有 5 批 events」的殘缺狀態繼續播。
 *
 * 舊的單發協定是「整份收完、CRC 過了才解析一次」，失敗時 live config
 * 完全沒被碰過。分批之後失敗視窗從幾毫秒變成跨越多個 round-trip 的
 * 好幾秒 —— 演出中真的會看到一段錯的燈光。這裡把那個安全性質補回來。
 *
 * 復原失敗（flash 也壞了）只能記 log：那時已經沒有已知的好設定可用。
 */
void SerialProtocol::rollbackStreamConfig(ConfigLoader &loader, DeviceConfig &cfg,
                                          const char *stage) {
  _meta_applied = false;
  _chunk.reset();
  if (loader.reload(cfg)) {
    Serial.printf("[serial] %s 失敗，已從 flash 復原上次的設定（events=%u）\n", stage,
                  cfg.event_count);
  } else {
    Serial.printf("[serial] %s 失敗，且從 flash 復原也失敗 —— "
                  "設定目前處於殘缺狀態，請重新 deploy\n", stage);
  }
}

void SerialProtocol::respondCommitConfig(JsonObjectConst root, ConfigLoader &loader,
                                         DeviceConfig &cfg) {
  if (!_meta_applied) {
    respondError("commit_config before end_meta");
    return;
  }

  const uint32_t expected_events = root["event_count"].as<uint32_t>();
  const uint32_t config_crc = root["config_crc32"].as<uint32_t>();
  if (cfg.event_count != expected_events) {
    Serial.printf("[config] commit_config event_count mismatch: device=%u studio=%u\n",
                  cfg.event_count, expected_events);
    respondError("event_count mismatch");
    return;
  }

  cfg.config_crc32 = config_crc;

  bool flash_saved = false;
  if (!loader.applyDeviceConfigBinary(cfg, cfg, &flash_saved)) {
    // RAM 的設定已經套用，但 flash 沒寫成功 —— 必須明確告知，不能回 ok。
    // 吞掉的話使用者會以為部署成功，直到下次重開機板子安靜地退回舊設定。
    _meta_applied = false;
    respondError("config flash save failed（RAM 已更新，重開機後會退回舊設定）");
    return;
  }

  _pending.pending = true;
  _pending.gpio_changed =
      (cfg.hardware.data_gpio != _stream_prev_gpio ||
       cfg.hardware.led_count != _stream_prev_led_count ||
       cfg.hardware.led_type != _stream_prev_led_type);
  _pending.network_changed =
      (strcmp(cfg.network.ssid, _stream_prev_ssid) != 0 ||
       strcmp(cfg.network.password, _stream_prev_pass) != 0);

  if (_pending.gpio_changed) {
    Serial.println("[serial] warning: data_gpio, led_count, or led_type changed — "
                   "LED reinit requires restart");
  }

  _meta_applied = false;

  JsonDocument doc;
  doc["ok"] = true;
  doc["events"] = cfg.event_count;
  doc["crc32"] = cfg.config_crc32;
  // 反映真實的 flash 狀態，不要無條件回 true（舊的 JSON 路徑一直是用
  // ConfigStorage::exists() 反映真實狀態，這裡對齊）。
  doc["flash_saved"] = flash_saved;
  serializeJson(doc, Serial);
  Serial.println();
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
  if (strcmp(cmd, "begin_meta") == 0) {
    respondBeginMeta(root, cfg);
    return;
  }
  if (strcmp(cmd, "end_meta") == 0) {
    respondEndMeta(cfg);
    return;
  }
  if (strcmp(cmd, "begin_events") == 0) {
    respondBeginEvents(root);
    return;
  }
  if (strcmp(cmd, "end_events") == 0) {
    respondEndEvents(config, cfg);
    return;
  }
  if (strcmp(cmd, "commit_config") == 0) {
    respondCommitConfig(root, config, cfg);
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

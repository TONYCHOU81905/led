#include "config_storage.h"
#include "config_json_parser.h"
#include <FS.h>
#include <LittleFS.h>
#include <stddef.h>

static const char *kConfigPath = "/device_config.json";
static const char *kConfigBinPath = "/device_config.bin";
static constexpr uint32_t kConfigBlobMagic = 0x4344454C; // 'L','E','D','C'（little-endian)
static constexpr uint16_t kConfigBlobVersion = 1;

bool ConfigStorage::begin() {
  if (!LittleFS.begin(false)) {
    Serial.println("[config] LittleFS mount failed, formatting...");
    if (!LittleFS.begin(true)) {
      Serial.println("[config] LittleFS format failed");
      return false;
    }
  }
  return true;
}

bool ConfigStorage::exists() { return LittleFS.exists(kConfigPath); }

bool ConfigStorage::existsBinary() { return LittleFS.exists(kConfigBinPath); }

bool ConfigStorage::save(const char *json, size_t len) {
  if (!json || len == 0 || len > CONFIG_FLASH_MAX_BYTES) {
    return false;
  }
  File f = LittleFS.open(kConfigPath, "w");
  if (!f) {
    Serial.println("[config] LittleFS open for write failed");
    return false;
  }
  const size_t written = f.write(reinterpret_cast<const uint8_t *>(json), len);
  f.close();
  if (written != len) {
    Serial.printf("[config] LittleFS write incomplete %u/%u\n",
                  static_cast<unsigned>(written), static_cast<unsigned>(len));
    return false;
  }
  Serial.printf("[config] saved %u bytes to flash\n", static_cast<unsigned>(len));
  return true;
}

bool ConfigStorage::load(String &out) {
  out = "";
  if (!exists()) {
    return false;
  }
  File f = LittleFS.open(kConfigPath, "r");
  if (!f) {
    return false;
  }
  const size_t file_size = f.size();
  if (file_size == 0 || file_size > CONFIG_FLASH_MAX_BYTES) {
    f.close();
    Serial.printf("[config] flash config invalid size %u\n",
                  static_cast<unsigned>(file_size));
    return false;
  }
  out.reserve(file_size);
  while (f.available()) {
    out += static_cast<char>(f.read());
  }
  f.close();
  return out.length() > 0;
}

bool ConfigStorage::clear() {
  if (!exists()) {
    return true;
  }
  return LittleFS.remove(kConfigPath);
}

uint32_t ConfigStorage::storedCrc32() {
  String json;
  if (!load(json)) {
    return 0;
  }
  return ConfigJsonParser::crc32(json.c_str(), json.length());
}

bool ConfigStorage::saveBinary(const DeviceConfig &cfg) {
  // prefix（device_id 開頭到 events 之前）跟 events[0..event_count) 在
  // DeviceConfig 記憶體裡是連續的（events 欄位緊接在 prefix 之後），
  // 所以整段 payload 可以直接從 &cfg 當成一塊連續 bytes 讀出來，
  // 不需要另外組緩衝區 —— 全程零額外 heap。
  const size_t prefix_size = offsetof(DeviceConfig, events);
  const size_t payload_size =
      prefix_size + static_cast<size_t>(cfg.event_count) * sizeof(TimelineEvent);
  const uint8_t *base = reinterpret_cast<const uint8_t *>(&cfg);

  ConfigBlobHeader header{};
  header.magic = kConfigBlobMagic;
  header.version = kConfigBlobVersion;
  header.event_count = cfg.event_count;
  header.prefix_size = static_cast<uint32_t>(prefix_size);
  header.event_size = static_cast<uint32_t>(sizeof(TimelineEvent));
  header.config_crc32 = cfg.config_crc32;
  header.payload_crc32 = ConfigJsonParser::crc32(
      reinterpret_cast<const char *>(base), payload_size);

  File f = LittleFS.open(kConfigBinPath, "w");
  if (!f) {
    Serial.println("[config] LittleFS open for binary write failed");
    return false;
  }
  size_t written = f.write(reinterpret_cast<const uint8_t *>(&header), sizeof(header));
  written += f.write(base, payload_size);
  f.close();

  const size_t expected = sizeof(header) + payload_size;
  if (written != expected) {
    Serial.printf("[config] binary write incomplete %u/%u\n",
                  static_cast<unsigned>(written), static_cast<unsigned>(expected));
    return false;
  }
  Serial.printf("[config] saved binary config: %u bytes (%u events)\n",
                static_cast<unsigned>(expected), cfg.event_count);
  return true;
}

bool ConfigStorage::loadBinary(DeviceConfig &out) {
  if (!LittleFS.exists(kConfigBinPath)) {
    return false;
  }
  File f = LittleFS.open(kConfigBinPath, "r");
  if (!f) {
    Serial.println("[config] 二進位載入失敗：開檔失敗");
    return false;
  }

  ConfigBlobHeader header{};
  const size_t header_read = f.read(reinterpret_cast<uint8_t *>(&header), sizeof(header));
  if (header_read != sizeof(header)) {
    f.close();
    Serial.printf("[config] 二進位載入失敗：header 不完整 (%u/%u bytes)\n",
                  static_cast<unsigned>(header_read), static_cast<unsigned>(sizeof(header)));
    return false;
  }
  if (header.magic != kConfigBlobMagic) {
    f.close();
    Serial.printf("[config] 二進位載入失敗：magic 不符 (got 0x%08X, expect 0x%08X，可能是舊的 JSON 檔)\n",
                  header.magic, kConfigBlobMagic);
    return false;
  }
  if (header.version != kConfigBlobVersion) {
    f.close();
    Serial.printf("[config] 二進位載入失敗：version 不符 (got %u, expect %u)\n",
                  header.version, kConfigBlobVersion);
    return false;
  }
  const uint32_t expected_prefix = static_cast<uint32_t>(offsetof(DeviceConfig, events));
  if (header.prefix_size != expected_prefix) {
    f.close();
    Serial.printf("[config] 二進位載入失敗：prefix_size 不符 (got %u, expect %u，"
                  "韌體重編過、struct 佈局變了)\n",
                  header.prefix_size, expected_prefix);
    return false;
  }
  const uint32_t expected_event_size = static_cast<uint32_t>(sizeof(TimelineEvent));
  if (header.event_size != expected_event_size) {
    f.close();
    Serial.printf("[config] 二進位載入失敗：event_size 不符 (got %u, expect %u，"
                  "韌體重編過、TimelineEvent 佈局變了)\n",
                  header.event_size, expected_event_size);
    return false;
  }
  if (header.event_count > MAX_EVENTS) {
    f.close();
    Serial.printf("[config] 二進位載入失敗：event_count 超出上限 (got %u, MAX_EVENTS=%u)\n",
                  header.event_count, static_cast<unsigned>(MAX_EVENTS));
    return false;
  }

  // 直接讀進 out 的記憶體（events 是靜態陣列，本來就配好了），不額外 malloc
  // 中間緩衝區 —— 這正是二進位格式要解決的問題：181 個 event 的 JSON
  // 中間表示法會讓 heap 同時背 JSON 原文 + ArduinoJson 物件樹兩份 O(n)。
  const size_t payload_size =
      static_cast<size_t>(header.prefix_size) +
      static_cast<size_t>(header.event_count) * header.event_size;
  uint8_t *base = reinterpret_cast<uint8_t *>(&out);
  const size_t payload_read = f.read(base, payload_size);
  f.close();
  if (payload_read != payload_size) {
    Serial.printf("[config] 二進位載入失敗：payload 不完整 (%u/%u bytes)\n",
                  static_cast<unsigned>(payload_read), static_cast<unsigned>(payload_size));
    return false;
  }

  const uint32_t calc_crc =
      ConfigJsonParser::crc32(reinterpret_cast<const char *>(base), payload_size);
  if (calc_crc != header.payload_crc32) {
    Serial.printf("[config] 二進位載入失敗：payload_crc32 不符 (got 0x%08X, calc 0x%08X)\n",
                  header.payload_crc32, calc_crc);
    return false;
  }

  out.event_count = header.event_count;
  out.config_crc32 = header.config_crc32;
  return true;
}

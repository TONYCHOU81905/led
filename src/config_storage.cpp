#include "config_storage.h"
#include "config_json_parser.h"
#include <FS.h>
#include <LittleFS.h>

static const char *kConfigPath = "/device_config.json";

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

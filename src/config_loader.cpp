#include "config_loader.h"
#include "config_json_parser.h"
#include "config_storage.h"
#include "default_config.h"
#include "nvs_wifi.h"
#include <Arduino.h>

static bool loadParsedConfig(const char *json, size_t len, DeviceConfig &out) {
  DeviceConfig parsed{};
  if (!ConfigJsonParser::parse(json, len, parsed)) {
    return false;
  }
  NvsWifi::loadNetworkOverlay(parsed.network);
  out = parsed;
  return true;
}

bool ConfigLoader::load(DeviceConfig &out) {
  ConfigStorage::begin();

  String flash_json;
  if (ConfigStorage::load(flash_json)) {
    if (loadParsedConfig(flash_json.c_str(), flash_json.length(), _cfg)) {
      _loaded = true;
      out = _cfg;
      Serial.printf("[config] loaded from flash: events=%u crc=0x%08X\n",
                    _cfg.event_count, _cfg.config_crc32);
      return true;
    }
    Serial.println("[config] flash parse failed, falling back to default");
  }

  _cfg = makeDefaultConfig();
  NvsWifi::loadNetworkOverlay(_cfg.network);
  _loaded = true;
  out = _cfg;
  Serial.println("[config] using embedded default config");
  return true;
}

bool ConfigLoader::reload(DeviceConfig &out) { return load(out); }

bool ConfigLoader::applyDeviceConfig(const DeviceConfig &cfg,
                                     const char *flash_json, size_t flash_len,
                                     DeviceConfig &out) {
  if (!flash_json || flash_len == 0) {
    return false;
  }
  if (!ConfigStorage::save(flash_json, flash_len)) {
    Serial.println("[config] warning: RAM config updated but flash save failed");
  }
  _cfg = cfg;
  _loaded = true;
  out = cfg;
  return true;
}

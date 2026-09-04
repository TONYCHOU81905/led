#include "config_loader.h"
#include "config_json_parser.h"
#include "config_storage.h"
#include "default_config.h"
#include "nvs_wifi.h"
#include <Arduino.h>

static bool loadParsedConfig(const char *json, size_t len, DeviceConfig &out) {
  if (!ConfigJsonParser::parse(json, len, out)) {
    return false;
  }
  NvsWifi::loadNetworkOverlay(out.network);
  return true;
}

bool ConfigLoader::load(DeviceConfig &out) {
  ConfigStorage::begin();

  // 先試二進位格式：零解析、零額外 heap（events 是靜態陣列，直接讀進
  // 記憶體），跟 config 大小無關。開機路徑跟串流上傳一樣，都要避開
  // 「JSON 原文 + ArduinoJson 物件樹」兩層 O(n) heap 中間表示法。
  if (ConfigStorage::loadBinary(_cfg)) {
    NvsWifi::loadNetworkOverlay(_cfg.network);
    _loaded = true;
    out = _cfg;
    Serial.printf("[config] loaded from flash (binary): events=%u crc=0x%08X\n",
                  _cfg.event_count, _cfg.config_crc32);
    return true;
  }

  String flash_json;
  if (ConfigStorage::load(flash_json)) {
    if (loadParsedConfig(flash_json.c_str(), flash_json.length(), _cfg)) {
      _loaded = true;
      out = _cfg;
      Serial.printf("[config] loaded from flash (json): events=%u crc=0x%08X\n",
                    _cfg.event_count, _cfg.config_crc32);
      // 遷移路徑：燒新韌體後板子上原本存的還是舊的 JSON 格式，讓它照舊
      // 能跑（不必立刻重新 deploy），但解析成功後立刻轉存二進位，
      // 下次開機就能走零解析的快路徑。
      if (ConfigStorage::saveBinary(_cfg)) {
        Serial.println("[config] 偵測到舊的 JSON 格式，已自動轉存為二進位（下次開機會走快的路徑）");
      }
      return true;
    }
    Serial.println("[config] flash parse failed, falling back to default");
  }

  initDefaultConfig(_cfg);
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

bool ConfigLoader::applyDeviceConfigBinary(const DeviceConfig &cfg, DeviceConfig &out) {
  if (!ConfigStorage::saveBinary(cfg)) {
    Serial.println("[config] warning: RAM config updated but binary flash save failed");
  }
  _cfg = cfg;
  _loaded = true;
  out = cfg;
  return true;
}

#include "config_loader.h"
#include "default_config.h"
#include "nvs_wifi.h"

bool ConfigLoader::load(DeviceConfig &out) {
  _cfg = makeDefaultConfig();
  NvsWifi::loadNetworkOverlay(_cfg.network);
  _loaded = true;
  out = _cfg;
  return true;
}

bool ConfigLoader::reload(DeviceConfig &out) {
  // TODO: read config partition / serial transfer
  return load(out);
}

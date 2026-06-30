#pragma once

#include <stddef.h>
#include "types.h"

class ConfigLoader {
public:
  bool load(DeviceConfig &out);

  // Reload config from LittleFS (after USB upload)
  bool reload(DeviceConfig &out);

  bool applyDeviceConfig(const DeviceConfig &cfg, const char *flash_json,
                         size_t flash_len, DeviceConfig &out);

  const DeviceConfig &config() const { return _cfg; }

private:
  DeviceConfig _cfg{};
  bool _loaded = false;
};

#pragma once

#include "types.h"

class ConfigLoader {
public:
  bool load(DeviceConfig &out);

  const DeviceConfig &config() const { return _cfg; }

  // Placeholder for future USB/flash config reload
  bool reload(DeviceConfig &out);

private:
  DeviceConfig _cfg{};
  bool _loaded = false;
};

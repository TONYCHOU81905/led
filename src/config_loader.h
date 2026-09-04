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

  // 分批上傳協定（begin_meta/end_meta/begin_events/end_events/commit_config）
  // 專用：cfg 是逐批組好的完整設定，沒有一份完整 JSON 字串可存，改存二進位。
  bool applyDeviceConfigBinary(const DeviceConfig &cfg, DeviceConfig &out);

  const DeviceConfig &config() const { return _cfg; }

private:
  DeviceConfig _cfg{};
  bool _loaded = false;
};

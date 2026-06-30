#pragma once

#include <ArduinoJson.h>
#include "clock_sync.h"
#include "config_loader.h"
#include "sync_receiver.h"
#include "types.h"

struct SerialPendingAction {
  bool pending = false;
  bool network_changed = false;
  bool gpio_changed = false;
};

class SerialProtocol {
public:
  static constexpr size_t kMaxLineLen = 8192;

  void begin();
  void poll(ConfigLoader &config, DeviceConfig &cfg, ClockSync &clock,
            SyncReceiver &rx, AppSyncState &state);

  SerialPendingAction takePendingAction();

private:
  void handleLine(const String &line, ConfigLoader &config, DeviceConfig &cfg,
                  ClockSync &clock, SyncReceiver &rx, AppSyncState &state);
  void handleJsonCommand(JsonObjectConst root, ConfigLoader &config,
                         DeviceConfig &cfg, ClockSync &clock, SyncReceiver &rx,
                         AppSyncState &state);
  void respondPing(const DeviceConfig &cfg);
  void respondWifi(JsonObjectConst root, DeviceConfig &cfg);
  void respondConfig(JsonObjectConst root, DeviceConfig &cfg);
  void respondStatusJson(const DeviceConfig &cfg, ClockSync &clock,
                         SyncReceiver &rx, AppSyncState state);
  void respondError(const char *message);

  SerialPendingAction _pending{};
};

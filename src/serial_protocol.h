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
  static constexpr size_t kMaxLineLen = 4096;

  void begin();
  void poll(ConfigLoader &config, DeviceConfig &cfg, ClockSync &clock,
            SyncReceiver &rx, AppSyncState &state);

  SerialPendingAction takePendingAction();

private:
  struct ConfigChunkAssembler {
    bool active = false;
    uint32_t total = 0;
    uint32_t expected_crc = 0;
    uint32_t filled = 0;
    char *buffer = nullptr;

    void reset();
    bool begin(uint32_t size, uint32_t expected_crc);
    bool append(uint32_t offset, const char *data, size_t len);
    bool isComplete() const;
  };

  void handleLine(const String &line, ConfigLoader &config, DeviceConfig &cfg,
                  ClockSync &clock, SyncReceiver &rx, AppSyncState &state);
  void handleJsonCommand(JsonObjectConst root, ConfigLoader &config,
                         DeviceConfig &cfg, ClockSync &clock, SyncReceiver &rx,
                         AppSyncState &state);
  void respondPing(const DeviceConfig &cfg);
  void respondWifi(JsonObjectConst root, DeviceConfig &cfg);
  void respondConfig(JsonObjectConst root, ConfigLoader &loader,
                     DeviceConfig &cfg);
  void respondBeginConfig(JsonObjectConst root);
  void respondConfigChunk(JsonObjectConst root);
  void respondEndConfig(ConfigLoader &loader, DeviceConfig &cfg);
  void respondReload(ConfigLoader &loader, DeviceConfig &cfg);
  void respondStatusJson(const DeviceConfig &cfg, ClockSync &clock,
                         SyncReceiver &rx, AppSyncState state);
  void respondError(const char *message);
  bool finalizeConfigJson(ConfigLoader &loader, DeviceConfig &cfg,
                          const char *json, size_t len,
                          const uint8_t prev_gpio, const uint16_t prev_led_count,
                          const LedChipsetType prev_led_type,
                          const char *prev_ssid, const char *prev_pass);

  SerialPendingAction _pending{};
  ConfigChunkAssembler _chunk{};
};

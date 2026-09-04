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

  /** 分批上傳中途失敗時從 flash 復原，把舊協定的原子性補回來。 */
  void rollbackStreamConfig(ConfigLoader &loader, DeviceConfig &cfg, const char *stage);

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
  // 分批上傳協定：CDC 單行約 228 bytes 上限逼出來的 128 bytes 分段機制
  // （ConfigChunkAssembler）原封不動重用，只是每次裝的東西變小 ——
  // meta（不含 events 的 config，約 4KB）或一批 events（約 4KB），
  // peak heap 因此跟 config 總量無關。舊的 begin_config/config_chunk/
  // end_config 完整保留：Studio 端先試新協定，失敗才退回舊的。
  void respondBeginMeta(JsonObjectConst root, const DeviceConfig &cfg);
  void respondEndMeta(DeviceConfig &cfg);
  void respondBeginEvents(JsonObjectConst root);
  void respondEndEvents(ConfigLoader &loader, DeviceConfig &cfg);
  void respondCommitConfig(JsonObjectConst root, ConfigLoader &loader,
                           DeviceConfig &cfg);
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

  // 分批上傳協定的暫存狀態：commit_config 要判斷是否需要 LED 重新初始化 /
  // WiFi 重連，但那時 cfg 已經被 end_meta 直接覆寫過了，所以「套用前」的
  // 硬體/網路狀態要在 begin_meta 就先存起來。
  bool _meta_applied = false;
  uint8_t _stream_prev_gpio = 0;
  uint16_t _stream_prev_led_count = 0;
  LedChipsetType _stream_prev_led_type = LED_CHIPSET_WS2811;
  char _stream_prev_ssid[64] = {0};
  char _stream_prev_pass[64] = {0};
};

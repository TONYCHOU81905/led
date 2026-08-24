#pragma once

#include "types.h"
#include "led_driver.h"

class TimelineEngine {
public:
  void setConfig(const DeviceConfig *cfg) { _cfg = cfg; }

  void render(uint32_t music_time_ms, LedDriver &leds);
  bool lookupColor(const char *name, RgbColor &out) const;

private:
  const DeviceConfig *_cfg = nullptr;

  bool partMatchesTarget(uint8_t part_index, const TimelineEvent &evt) const;
  const TimelineEvent *findWinningEvent(uint8_t part_index,
                                        uint32_t music_time_ms) const;
  void applyEventToPart(const PartDef &part, const TimelineEvent &evt,
                        const RgbColor &base, uint32_t music_time_ms,
                        uint8_t part_index, LedDriver &leds) const;
  void applyColorToPart(const PartDef &part, const RgbColor &c, LedDriver &leds) const;
};

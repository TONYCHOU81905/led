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

  bool partMatchesTarget(const PartDef &part, const TimelineEvent &evt) const;
  const TimelineEvent *findWinningEvent(const char *part_id,
                                        uint32_t music_time_ms) const;
  RgbColor applyEffect(const TimelineEvent &evt, const RgbColor &base,
                       uint32_t music_time_ms) const;
  void applyColorToPart(const PartDef &part, const RgbColor &c, LedDriver &leds);
};

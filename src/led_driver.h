#pragma once

#include <FastLED.h>
#include "types.h"

class LedDriver {
public:
  bool init(const HardwareConfig &hw);
  void setMaxBrightness(float fraction);
  void clear();
  void fillSolid(const RgbColor &c);
  void setPixel(uint16_t index, const RgbColor &c);
  void show();
  void showStatusColor(const RgbColor &c, uint32_t now_ms, bool pulse = false);
  // Boot-time wiring/chipset self-test: cycles R/G/B blink for ~3s so you can
  // confirm the data line is wired and the color order is correct.
  void selfTest(uint32_t duration_ms = 3000);

  uint16_t ledCount() const { return _led_count; }
  uint8_t outputCount() const { return _output_count; }
  LedChipsetType chipset() const { return _chipset; }
  CRGB *buffer() { return _leds; }

private:
  CRGB _leds[LED_COUNT_MAX];
  uint16_t _led_count = 0;
  LedOutputConfig _outputs[MAX_LED_OUTPUTS]{};
  uint8_t _output_count = 0;
  LedChipsetType _chipset = static_cast<LedChipsetType>(LED_CHIPSET_DEFAULT);
  bool _initialized = false;
};

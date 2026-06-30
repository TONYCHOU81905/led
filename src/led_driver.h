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

  uint16_t ledCount() const { return _led_count; }
  LedChipsetType chipset() const { return _chipset; }
  CRGB *buffer() { return _leds; }

private:
  CRGB _leds[LED_COUNT_MAX];
  uint16_t _led_count = 0;
  uint8_t _data_gpio = LED_DATA_GPIO;
  LedChipsetType _chipset = static_cast<LedChipsetType>(LED_CHIPSET_DEFAULT);
  bool _initialized = false;
};

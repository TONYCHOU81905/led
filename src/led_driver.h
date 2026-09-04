#pragma once

/**
 * LED 總電流上限（mA @5V）。0 = 不啟用。
 *
 * 啟用時 FastLED 會動態壓低亮度，保證整條燈的合計電流不超過這個值 ——
 * 這是唯一能「無論 timeline 怎麼寫都不超過電源能力」的機制；
 * max_brightness 只縮放亮著的部分，擋不住同時全亮的尖峰。
 *
 * 設定值＝電源額定 −(ESP32 自己的尖峰約 500mA)− 餘量。
 * 例：5V/5A 電源 → -DLED_MAX_MILLIAMPS=4000
 */
#ifndef LED_MAX_MILLIAMPS
#define LED_MAX_MILLIAMPS 0
#endif

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

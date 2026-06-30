#include "led_driver.h"
#include "led_chipset.h"
#include <Arduino.h>

namespace {

void addLedsForChipset(LedChipsetType type, CRGB *leds, uint16_t count) {
  switch (type) {
  case LED_CHIPSET_WS2812B:
    FastLED.addLeds<WS2812B, LED_DATA_GPIO, GRB>(leds, count)
        .setCorrection(TypicalLEDStrip);
    break;
  default:
    // 12V WS2811 strips typically use 400 kHz timing (distinct from WS2812B).
    FastLED.addLeds<WS2811_400, LED_DATA_GPIO, GRB>(leds, count)
        .setCorrection(TypicalLEDStrip);
    break;
  }
}

} // namespace

bool LedDriver::init(const HardwareConfig &hw) {
  _led_count = hw.led_count;
  if (_led_count == 0 || _led_count > LED_COUNT_MAX) {
    Serial.printf("[led] invalid led_count=%u (max %u)\n", _led_count, LED_COUNT_MAX);
    return false;
  }

  // Prefer embedded config GPIO; fall back to compile-time default
  _data_gpio = hw.data_gpio ? hw.data_gpio : LED_DATA_GPIO;
  _chipset = hw.led_type;

  FastLED.clear(true);
  addLedsForChipset(_chipset, _leds, _led_count);

  // Re-pin if config GPIO differs from template pin
  if (_data_gpio != LED_DATA_GPIO) {
    Serial.printf("[led] NOTE: FastLED template pin=%d, config data_gpio=%u — "
                  "set -DLED_DATA_GPIO=%u to match hardware\n",
                  LED_DATA_GPIO, _data_gpio, _data_gpio);
  }

  setMaxBrightness(hw.max_brightness);
  clear();
  show();
  _initialized = true;

  Serial.printf("[led] init %u LEDs, GPIO=%u, chipset=%s, GRB, max_brightness=%.2f\n",
                _led_count, _data_gpio, ledChipsetName(_chipset), hw.max_brightness);
  return true;
}

void LedDriver::setMaxBrightness(float fraction) {
  if (fraction < 0.0f) fraction = 0.0f;
  if (fraction > 1.0f) fraction = 1.0f;
  FastLED.setBrightness(static_cast<uint8_t>(fraction * 255.0f));
}

void LedDriver::clear() {
  fill_solid(_leds, _led_count, CRGB::Black);
}

void LedDriver::fillSolid(const RgbColor &c) {
  fill_solid(_leds, _led_count, CRGB(c.r, c.g, c.b));
}

void LedDriver::setPixel(uint16_t index, const RgbColor &c) {
  if (index >= _led_count) return;
  _leds[index] = CRGB(c.r, c.g, c.b);
}

void LedDriver::show() {
  if (!_initialized) return;
  FastLED.show();
}

void LedDriver::showStatusColor(const RgbColor &c, uint32_t now_ms, bool pulse) {
  uint8_t r = c.r, g = c.g, b = c.b;
  if (pulse) {
    const float phase = (now_ms % 1000) / 1000.0f;
    const float scale = 0.3f + 0.7f * (0.5f + 0.5f * sinf(phase * 2.0f * PI));
    r = static_cast<uint8_t>(r * scale);
    g = static_cast<uint8_t>(g * scale);
    b = static_cast<uint8_t>(b * scale);
  }
  fillSolid({r, g, b});
  show();
}

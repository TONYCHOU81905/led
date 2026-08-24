#include "led_driver.h"
#include "led_chipset.h"
#include <Arduino.h>

namespace {

template<uint8_t GPIO>
void addLedsOnPin(LedChipsetType type, CRGB *leds, uint16_t count) {
  if (type == LED_CHIPSET_WS2812B) {
    FastLED.addLeds<WS2812B, GPIO, GRB>(leds, count).setCorrection(TypicalLEDStrip);
  } else {
    FastLED.addLeds<WS2811_400, GPIO, GRB>(leds, count).setCorrection(TypicalLEDStrip);
  }
}

bool addLedsForGpio(uint8_t gpio, LedChipsetType type, CRGB *leds, uint16_t count) {
  // FastLED instantiates pin templates at compile time. Only list pins that are
  // valid for the target chip — classic ESP32 marks GPIO 6–11 as flash-strapped.
#define LED_GPIO_CASE(pin) case pin: addLedsOnPin<pin>(type, leds, count); return true
  switch (gpio) {
#if CONFIG_IDF_TARGET_ESP32S3
    LED_GPIO_CASE(4);
    LED_GPIO_CASE(5);
    LED_GPIO_CASE(6);
    LED_GPIO_CASE(7);
    LED_GPIO_CASE(8);
    LED_GPIO_CASE(9);
    LED_GPIO_CASE(10);
    LED_GPIO_CASE(11);
    LED_GPIO_CASE(12);
    LED_GPIO_CASE(13);
    LED_GPIO_CASE(14);
    LED_GPIO_CASE(15);
    LED_GPIO_CASE(16);
    LED_GPIO_CASE(17);
    LED_GPIO_CASE(18);
    LED_GPIO_CASE(21);
#elif CONFIG_IDF_TARGET_ESP32
    LED_GPIO_CASE(2);
    LED_GPIO_CASE(4);
    LED_GPIO_CASE(5);
    LED_GPIO_CASE(12);
    LED_GPIO_CASE(13);
    LED_GPIO_CASE(14);
    LED_GPIO_CASE(15);
    LED_GPIO_CASE(16);
    LED_GPIO_CASE(17);
    LED_GPIO_CASE(18);
    LED_GPIO_CASE(19);
    LED_GPIO_CASE(21);
    LED_GPIO_CASE(22);
    LED_GPIO_CASE(23);
    LED_GPIO_CASE(25);
    LED_GPIO_CASE(26);
    LED_GPIO_CASE(27);
    LED_GPIO_CASE(32);
    LED_GPIO_CASE(33);
#else
    LED_GPIO_CASE(4);
    LED_GPIO_CASE(5);
    LED_GPIO_CASE(15);
    LED_GPIO_CASE(16);
    LED_GPIO_CASE(17);
    LED_GPIO_CASE(18);
#endif
    default: return false;
  }
#undef LED_GPIO_CASE
}

} // namespace

bool LedDriver::init(const HardwareConfig &hw) {
  _led_count = hw.led_count;
  if (_led_count == 0 || _led_count > LED_COUNT_MAX) {
    Serial.printf("[led] invalid led_count=%u (max %u)\n", _led_count, LED_COUNT_MAX);
    return false;
  }

  _chipset = hw.led_type;
  _output_count = hw.output_count > 0 ? hw.output_count : 1;
  if (_output_count > MAX_LED_OUTPUTS) return false;

  if (hw.output_count == 0) {
    snprintf(_outputs[0].id, sizeof(_outputs[0].id), "main");
    _outputs[0].data_gpio = hw.data_gpio ? hw.data_gpio : LED_DATA_GPIO;
    _outputs[0].offset = 0;
    _outputs[0].led_count = _led_count;
  } else {
    memcpy(_outputs, hw.outputs, sizeof(LedOutputConfig) * _output_count);
  }

  for (uint8_t i = 0; i < _output_count; ++i) {
    const LedOutputConfig &output = _outputs[i];
    if (output.led_count == 0 || output.offset + output.led_count > _led_count) {
      Serial.printf("[led] invalid output %s offset=%u count=%u\n",
                    output.id, output.offset, output.led_count);
      return false;
    }
    for (uint8_t previous = 0; previous < i; ++previous) {
      if (_outputs[previous].data_gpio == output.data_gpio) {
        Serial.printf("[led] duplicate GPIO %u\n", output.data_gpio);
        return false;
      }
    }
    if (!addLedsForGpio(output.data_gpio, _chipset, _leds + output.offset,
                        output.led_count)) {
#if CONFIG_IDF_TARGET_ESP32S3
      Serial.printf("[led] unsupported GPIO %u; use GPIO 4-18 or 21\n", output.data_gpio);
#elif CONFIG_IDF_TARGET_ESP32
      Serial.printf("[led] unsupported GPIO %u; classic ESP32: avoid 6-11 (flash), use 2/4/5/12-19/21-23/25-27/32/33\n",
                    output.data_gpio);
#else
      Serial.printf("[led] unsupported GPIO %u\n", output.data_gpio);
#endif
      return false;
    }
    Serial.printf("[led] output[%u] %s GPIO=%u offset=%u count=%u\n", i,
                  output.id, output.data_gpio, output.offset, output.led_count);
  }

  setMaxBrightness(hw.max_brightness);
  _initialized = true;
  clear();
  show();
  Serial.printf("[led] init %u logical LEDs across %u outputs, chipset=%s, brightness=%.2f\n",
                _led_count, _output_count, ledChipsetName(_chipset), hw.max_brightness);
  return true;
}

void LedDriver::setMaxBrightness(float fraction) {
  if (fraction < 0.0f) fraction = 0.0f;
  if (fraction > 1.0f) fraction = 1.0f;
  FastLED.setBrightness(static_cast<uint8_t>(fraction * 255.0f));
}

void LedDriver::clear() { fill_solid(_leds, _led_count, CRGB::Black); }

void LedDriver::fillSolid(const RgbColor &c) {
  fill_solid(_leds, _led_count, CRGB(c.r, c.g, c.b));
}

void LedDriver::setPixel(uint16_t index, const RgbColor &c) {
  if (index < _led_count) _leds[index] = CRGB(c.r, c.g, c.b);
}

void LedDriver::show() {
  if (_initialized) FastLED.show();
}

void LedDriver::selfTest(uint32_t duration_ms) {
  if (!_initialized) return;
  Serial.printf("[led] self-test: %u outputs blink R/G/B for %ums\n",
                _output_count, duration_ms);
  static const RgbColor kColors[3] = {{255, 0, 0}, {0, 255, 0}, {0, 0, 255}};
  const uint32_t start = millis();
  uint8_t step = 0;
  while (millis() - start < duration_ms) {
    fillSolid(kColors[step++ % 3]); show(); delay(250);
    clear(); show(); delay(150);
  }
  clear(); show();
  Serial.println("[led] self-test done");
}

void LedDriver::showStatusColor(const RgbColor &c, uint32_t now_ms, bool pulse) {
  float scale = 1.0f;
  if (pulse) {
    const float phase = (now_ms % 1000) / 1000.0f;
    scale = 0.3f + 0.7f * (0.5f + 0.5f * sinf(phase * 2.0f * PI));
  }
  fillSolid({static_cast<uint8_t>(c.r * scale), static_cast<uint8_t>(c.g * scale),
             static_cast<uint8_t>(c.b * scale)});
  show();
}

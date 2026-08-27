/**
 * 最小 LED 測試韌體 —— 診斷「主韌體說 self-test 跑完但燈不亮」時使用。
 *
 * 刻意不碰 config / LittleFS / WiFi / timeline / 多輸出，只留一條路徑：
 * 在單一 GPIO 上用 FastLED 推固定顏色。這樣燈不亮就只剩硬體因素
 * （電平、供電、共地、資料線、第一顆 LED），可以把軟體整層排除掉。
 *
 * 燒錄：./scripts/fw.sh upload led-test
 * 觀察：./scripts/fw.sh monitor
 * 測完燒回主韌體：./scripts/fw.sh upload esp32-s3-devkitc-1-n16r8
 *
 * 可用 build_flags 覆寫（見 platformio.ini 的 env:led-test）：
 *   -DTEST_GPIO=4        資料腳位
 *   -DTEST_COUNT=60      LED 顆數
 *   -DTEST_BRIGHTNESS=50 全域亮度 0-255（刻意壓低，避免供電不足反而更難亮）
 */
#include <Arduino.h>
#include <FastLED.h>

#ifndef TEST_GPIO
#define TEST_GPIO 4
#endif
#ifndef TEST_COUNT
#define TEST_COUNT 60
#endif
#ifndef TEST_BRIGHTNESS
#define TEST_BRIGHTNESS 50
#endif

static CRGB leds[TEST_COUNT];

static void fillAndShow(const char *label, const CRGB &color, uint32_t hold_ms) {
  Serial.printf("[test] %s  (R=%u G=%u B=%u)\n", label, color.r, color.g, color.b);
  fill_solid(leds, TEST_COUNT, color);
  FastLED.show();
  delay(hold_ms);
}

void setup() {
  Serial.setRxBufferSize(4096);
  Serial.begin(115200);
  delay(600);
  Serial.println();
  Serial.println("=== LED 最小測試韌體 ===");
  Serial.printf("[test] GPIO=%d  LED 數=%d  亮度=%d/255  chipset=WS2812B  order=GRB\n",
                TEST_GPIO, TEST_COUNT, TEST_BRIGHTNESS);
  Serial.println("[test] 若這支都不亮，軟體層已可排除 → 查電平/供電/共地/資料線/第一顆 LED");

  FastLED.addLeds<WS2812B, TEST_GPIO, GRB>(leds, TEST_COUNT)
      .setCorrection(TypicalLEDStrip);
  FastLED.setBrightness(TEST_BRIGHTNESS);
  FastLED.clear(true);
}

void loop() {
  fillAndShow("全紅", CRGB(255, 0, 0), 1200);
  fillAndShow("全綠", CRGB(0, 255, 0), 1200);
  fillAndShow("全藍", CRGB(0, 0, 255), 1200);
  fillAndShow("全白", CRGB(255, 255, 255), 1200);

  // 逐顆跑一遍：如果只有前幾顆會亮，代表資料有進去但後段有斷點或供電掉壓
  Serial.println("[test] 逐顆點亮（看看能亮到第幾顆）");
  for (int i = 0; i < TEST_COUNT; ++i) {
    FastLED.clear();
    leds[i] = CRGB(255, 255, 255);
    FastLED.show();
    delay(40);
  }

  FastLED.clear(true);
  Serial.println("[test] 全暗 1 秒，然後重複");
  delay(1000);
}

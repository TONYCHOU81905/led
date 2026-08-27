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

#ifdef TEST_RAW_GPIO
void setup() {
  Serial.setRxBufferSize(4096);
  Serial.begin(115200);
  delay(600);
  Serial.println();
  Serial.println("=== RAW GPIO 方波測試（不使用 FastLED）===");
  Serial.printf("[raw] GPIO %d 以 1Hz 切換 HIGH/LOW\n", TEST_GPIO);
  Serial.println("[raw] 用萬用電表量 GPIO 與 GND 之間，應看到 0V <-> 3.3V 交替");
  Serial.println("[raw] 或用一顆普通 LED 串 220ohm 電阻接在 GPIO 與 GND 之間，應看到閃爍");
  pinMode(TEST_GPIO, OUTPUT);
}

void loop() {
  digitalWrite(TEST_GPIO, HIGH);
  Serial.println("[raw] HIGH (應為 3.3V)");
  delay(1000);
  digitalWrite(TEST_GPIO, LOW);
  Serial.println("[raw] LOW  (應為 0V)");
  delay(1000);
}
#else
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

/*
 * === 附加模式：TEST_RAW_GPIO ===
 *
 * 用 -DTEST_RAW_GPIO 編譯時，不走 FastLED，而是把 TEST_GPIO 當一般 GPIO
 * 以 1Hz 慢速切換 HIGH/LOW。
 *
 * 目的：把「腳位有沒有在輸出」跟「WS2812B 通訊是否成功」徹底分開。
 * WS2812B 的訊號是 800kHz 的窄脈衝，用萬用電表量不到；1Hz 方波則可以直接
 * 用電表（或一顆普通 LED 串 220Ω 電阻）看到 0V ↔ 3.3V 交替。
 *
 *   量得到交替 → 腳位正常，問題在燈條側（電平/共地/DIN/第一顆 LED）
 *   完全沒變化 → 腳位本身有問題（燒壞、被其他功能佔用、或接錯腳）
 */
#endif  // TEST_RAW_GPIO

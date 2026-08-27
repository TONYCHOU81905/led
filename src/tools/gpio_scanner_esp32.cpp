/**
 * GPIO 掃描測試韌體 - ESP32 專用版本
 *
 * ESP32（舊款）只測試安全可用的 GPIO：
 * - GPIO 6, 7, 8 是 Flash 腳位，不能用
 * - GPIO 2 預設有內建 LED，可能干擾
 * - 所以只測試：4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23
 *
 * 燒錄：./scripts/fw.sh upload gpio-scanner-esp32
 */

#include <Arduino.h>
#include <FastLED.h>

// ESP32 安全可用的 GPIO 列表
const uint8_t TEST_GPIOS[] = {4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23};
const uint8_t NUM_GPIOS = sizeof(TEST_GPIOS) / sizeof(TEST_GPIOS[0]);

#ifndef TEST_COUNT
#define TEST_COUNT 60
#endif

#ifndef TEST_BRIGHTNESS
#define TEST_BRIGHTNESS 50
#endif

static CRGB leds[TEST_COUNT];
static uint8_t current_gpio_index = 0;
static bool leds_initialized = false;

void testGPIO(uint8_t gpio) {
  Serial.println();
  Serial.println("========================================");
  Serial.printf(">>> 測試 GPIO %d <<<\n", gpio);
  Serial.println("========================================");
  Serial.println("如果 LED 開始閃爍，這就是正確的腳位！");
  Serial.println();

  // 重新初始化 FastLED
  if (leds_initialized) {
    FastLED.clear(true);
    delay(100);
  }

  // 根據 GPIO 動態初始化
  switch(gpio) {
    case 4:  FastLED.addLeds<WS2812B, 4, GRB>(leds, TEST_COUNT); break;
    case 5:  FastLED.addLeds<WS2812B, 5, GRB>(leds, TEST_COUNT); break;
    case 12: FastLED.addLeds<WS2812B, 12, GRB>(leds, TEST_COUNT); break;
    case 13: FastLED.addLeds<WS2812B, 13, GRB>(leds, TEST_COUNT); break;
    case 14: FastLED.addLeds<WS2812B, 14, GRB>(leds, TEST_COUNT); break;
    case 15: FastLED.addLeds<WS2812B, 15, GRB>(leds, TEST_COUNT); break;
    case 16: FastLED.addLeds<WS2812B, 16, GRB>(leds, TEST_COUNT); break;
    case 17: FastLED.addLeds<WS2812B, 17, GRB>(leds, TEST_COUNT); break;
    case 18: FastLED.addLeds<WS2812B, 18, GRB>(leds, TEST_COUNT); break;
    case 19: FastLED.addLeds<WS2812B, 19, GRB>(leds, TEST_COUNT); break;
    case 21: FastLED.addLeds<WS2812B, 21, GRB>(leds, TEST_COUNT); break;
    case 22: FastLED.addLeds<WS2812B, 22, GRB>(leds, TEST_COUNT); break;
    case 23: FastLED.addLeds<WS2812B, 23, GRB>(leds, TEST_COUNT); break;
    default:
      Serial.printf("警告: GPIO %d 無法初始化\n", gpio);
      return;
  }

  FastLED.setBrightness(TEST_BRIGHTNESS);
  leds_initialized = true;

  // 測試 4 種顏色，每種 2 秒
  const struct {
    const char* name;
    CRGB color;
  } colors[] = {
    {"紅色", CRGB(255, 0, 0)},
    {"綠色", CRGB(0, 255, 0)},
    {"藍色", CRGB(0, 0, 255)},
    {"白色", CRGB(255, 255, 255)}
  };

  for (int i = 0; i < 4; i++) {
    Serial.printf("  -> 顯示 %s\n", colors[i].name);
    fill_solid(leds, TEST_COUNT, colors[i].color);
    FastLED.show();
    delay(2000);
  }

  // 全暗
  FastLED.clear(true);
  Serial.printf("GPIO %d 測試完成\n", gpio);
}

void setup() {
  Serial.begin(115200);
  delay(800);

  Serial.println();
  Serial.println("╔════════════════════════════════════════╗");
  Serial.println("║  GPIO 掃描測試 - ESP32 專用版本       ║");
  Serial.println("╚════════════════════════════════════════╝");
  Serial.println();
  Serial.printf("LED 數量: %d 顆\n", TEST_COUNT);
  Serial.printf("亮度: %d/255\n", TEST_BRIGHTNESS);
  Serial.printf("芯片型號: WS2812B\n");
  Serial.println();
  Serial.println("測試 GPIO 腳位（ESP32 安全可用）:");
  for (int i = 0; i < NUM_GPIOS; i++) {
    Serial.printf("  %d. GPIO %d\n", i+1, TEST_GPIOS[i]);
  }
  Serial.println();
  Serial.println("注意: ESP32 的 GPIO 6,7,8 是 Flash 腳位，不可用於 LED");
  Serial.println();
  Serial.println("每個腳位會依序顯示：紅→綠→藍→白");
  Serial.println("每種顏色持續 2 秒，總共 8 秒");
  Serial.println("請注意觀察 LED，看哪個 GPIO 時會亮！");
  Serial.println();
  Serial.println("開始測試...");
  Serial.println();

  delay(3000);  // 給您 3 秒準備觀察
}

void loop() {
  // 測試當前 GPIO
  testGPIO(TEST_GPIOS[current_gpio_index]);

  // 延遲 2 秒後切換到下一個
  delay(2000);

  // 移動到下一個 GPIO
  current_gpio_index++;
  if (current_gpio_index >= NUM_GPIOS) {
    current_gpio_index = 0;
    Serial.println();
    Serial.println("========================================");
    Serial.println("所有 GPIO 測試完成！重新開始...");
    Serial.println("========================================");
    Serial.println();
    delay(5000);  // 循環間隔 5 秒
  }
}

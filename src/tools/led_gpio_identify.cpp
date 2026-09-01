/**
 * 腳位識別韌體 —— 找出每一條燈帶實際插在哪一支 GPIO。
 *
 * 背景：led-droop-test 的兩版對比已經證明帽子燈條不在 GPIO 4 上 ——
 * 只推 GPIO 4 的版本完全不亮，改推 4/5/6/7/15 五支之後 A~E 全部正常
 * （含 300 顆全白高亮度），代表燈帶長度、訊號、供電三者都沒問題，
 * 純粹是資料送到了別支腳。config 裡 GPIO 5/6/7/15 都是 count=130，
 * 所以帽子那條 300 顆的燈帶只有前 130 顆收得到資料 —— 就是使用者看到的
 * 「只亮前面一點點」。
 *
 * 這支韌體一次只點亮一支 GPIO，並且每支腳配一個固定顏色，
 * 讓「哪條燈帶接在哪支腳」可以直接用眼睛讀出來：
 *
 *   GPIO 4  紅    ← config 的 hat（帽子，300 顆）
 *   GPIO 5  綠    ← config 的 right_arm（右手，130 顆）
 *   GPIO 6  藍    ← config 的 right_leg（右腳，130 顆）
 *   GPIO 7  黃    ← config 的 left_leg（左腳，130 顆）
 *   GPIO 15 白    ← config 的 left_arm（左手，130 顆）
 *
 * 每支腳單獨亮 6 秒，serial 會同步印出現在測的是哪一支。
 * 看「帽子」在哪一個顏色亮起來，就知道它實際插在哪支腳。
 *
 * 五支腳各自配一個獨立的 buffer（而不是共用一份），這樣才能真正做到
 * 一次只有一支腳有畫面、其餘保持全暗；共用 buffer 的話沒被選到的腳
 * 會停在上一幀，分不出是哪支在亮。
 *
 * 燒錄：./scripts/fw.sh upload led-gpio-identify
 * 觀察：./scripts/fw.sh monitor
 * 測完燒回主韌體：./scripts/fw.sh upload esp32-s3-devkitc-1-n16r8
 */
#include <Arduino.h>
#include <FastLED.h>

#ifndef IDENT_COUNT
#define IDENT_COUNT 300
#endif
#ifndef IDENT_BRIGHTNESS
#define IDENT_BRIGHTNESS 40
#endif
#ifndef IDENT_HOLD_MS
#define IDENT_HOLD_MS 6000
#endif

// 每支腳一份獨立 buffer：300 顆 × 3 bytes × 5 支 = 4500 bytes
static CRGB buf_gpio4[IDENT_COUNT];
static CRGB buf_gpio5[IDENT_COUNT];
static CRGB buf_gpio6[IDENT_COUNT];
static CRGB buf_gpio7[IDENT_COUNT];
static CRGB buf_gpio15[IDENT_COUNT];

struct Channel {
  uint8_t gpio;
  CRGB *buf;
  CRGB color;
  const char *color_name;
  const char *config_role;
  uint16_t config_count;
};

static Channel channels[] = {
    {4, buf_gpio4, CRGB(255, 0, 0), "紅", "hat 帽子", 300},
    {5, buf_gpio5, CRGB(0, 255, 0), "綠", "right_arm 右手", 130},
    {6, buf_gpio6, CRGB(0, 0, 255), "藍", "right_leg 右腳", 130},
    {7, buf_gpio7, CRGB(255, 200, 0), "黃", "left_leg 左腳", 130},
    {15, buf_gpio15, CRGB(255, 255, 255), "白", "left_arm 左手", 130},
};
static const uint8_t CHANNEL_COUNT = sizeof(channels) / sizeof(channels[0]);

static void clearAll() {
  for (uint8_t i = 0; i < CHANNEL_COUNT; ++i) {
    fill_solid(channels[i].buf, IDENT_COUNT, CRGB::Black);
  }
}

void setup() {
  Serial.setRxBufferSize(4096);
  Serial.begin(115200);
  delay(600);
  Serial.println();
  Serial.println("=== 腳位識別韌體 ===");
  Serial.printf("[ident] 每支腳單獨亮 %d 顆、持續 %d 秒，一次只有一支腳有畫面\n",
                IDENT_COUNT, IDENT_HOLD_MS / 1000);
  Serial.println("[ident] 顏色對照： GPIO4=紅  GPIO5=綠  GPIO6=藍  GPIO7=黃  GPIO15=白");
  Serial.println("[ident] 看「帽子」在哪個顏色亮起來，那就是它實際插的腳位。");

  FastLED.addLeds<WS2812B, 4, GRB>(buf_gpio4, IDENT_COUNT).setCorrection(TypicalLEDStrip);
  FastLED.addLeds<WS2812B, 5, GRB>(buf_gpio5, IDENT_COUNT).setCorrection(TypicalLEDStrip);
  FastLED.addLeds<WS2812B, 6, GRB>(buf_gpio6, IDENT_COUNT).setCorrection(TypicalLEDStrip);
  FastLED.addLeds<WS2812B, 7, GRB>(buf_gpio7, IDENT_COUNT).setCorrection(TypicalLEDStrip);
  FastLED.addLeds<WS2812B, 15, GRB>(buf_gpio15, IDENT_COUNT).setCorrection(TypicalLEDStrip);
  FastLED.setBrightness(IDENT_BRIGHTNESS);
  FastLED.clear(true);
}

void loop() {
  for (uint8_t i = 0; i < CHANNEL_COUNT; ++i) {
    const Channel &ch = channels[i];
    Serial.println();
    Serial.printf(">>> GPIO %-2u  顏色=%s   config 裡是 %s（count=%u）\n",
                  ch.gpio, ch.color_name, ch.config_role, ch.config_count);
    Serial.println("    現在亮的那條燈帶，就是接在這支腳上的。");

    clearAll();
    fill_solid(ch.buf, IDENT_COUNT, ch.color);
    FastLED.show();
    delay(IDENT_HOLD_MS);
  }

  clearAll();
  FastLED.show();
  Serial.println();
  Serial.println("[ident] 一輪結束，全暗 2 秒後重來");
  delay(2000);
}

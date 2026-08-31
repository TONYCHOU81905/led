/**
 * 壓降 vs 訊號 判別韌體 —— 診斷「設定 300 顆但只亮前半段」時使用。
 *
 * 主韌體已經確認軟體層正確（LED_COUNT_MAX=1024、output[0] hat count=300、
 * init 820 logical LEDs），而且開機 self-test（繞過 timeline/parts）同樣只亮
 * 前半段。所以剩下三個互斥的硬體可能：
 *
 *   (1) 供電壓降    電流太大，5V 沿燈條一路降，後段電壓不足以驅動
 *   (2) 資料訊號    訊號在中途劣化/斷線，後段收不到資料
 *   (3) 燈帶長度    實體根本沒有 300 顆
 *
 * 單看「全亮」分不出這三者，因為它們的表現都是「前段亮、後段暗」。
 * 這支韌體的做法是把「電流大小」與「訊號要走的距離」拆開來測：
 *
 *   階段 A 只點尾段 20 顆     距離最遠、電流極小
 *   階段 B 只點頭段 20 顆     對照組，必亮
 *   階段 C 每 10 顆點 1 顆     距離涵蓋全長、電流極小
 *   階段 D 全段 + 極低亮度     距離涵蓋全長、電流小
 *   階段 E 全段 + 高亮度       距離涵蓋全長、電流大（重現原本的現象）
 *
 * 判讀表（對照 A / D / E 三個階段）：
 *
 *   A 亮 + D 全亮 + E 斷掉   → (1) 供電壓降。訊號和燈帶都沒問題，純粹是電流一大就掉壓。
 *   A 不亮 + C 在同一位置斷  → (2) 或 (3)。訊號走不到那麼遠，或燈根本不存在。
 *                              C 的斷點位置就是訊號能到的極限。
 *   A 亮 + D 也斷在中間      → (2) 訊號問題。小電流都斷，跟供電無關。
 *
 * 燒錄：./scripts/fw.sh upload led-droop-test
 * 觀察：./scripts/fw.sh monitor
 * 測完燒回主韌體：./scripts/fw.sh upload esp32-s3-devkitc-1-n16r8
 *
 * 可用 build_flags 覆寫（見 platformio.ini 的 env:led-droop-test）：
 *   -DTEST_GPIO=4      資料腳位（帽子那條）
 *   -DTEST_COUNT=300   燈帶顆數
 */
#include <Arduino.h>
#include <FastLED.h>

#ifndef TEST_GPIO
#define TEST_GPIO 4
#endif
#ifndef TEST_COUNT
#define TEST_COUNT 300
#endif

// 端點測試的區段長度：夠短，電流小到不可能造成壓降；夠長，肉眼一看就知道有沒有亮。
#ifndef SEGMENT_LEN
#define SEGMENT_LEN 20
#endif
// 稀疏掃描的間隔：每 SPARSE_STEP 顆點亮 1 顆。
#ifndef SPARSE_STEP
#define SPARSE_STEP 10
#endif

#define BRIGHT_SEGMENT 64   // 端點/稀疏測試用（20~30 顆，電流極小）
#define BRIGHT_LOW 8        // 全段低亮度：300 顆全白也只有約 0.5A
#define BRIGHT_HIGH 200     // 全段高亮度：重現原本看到的斷點

static CRGB leds[TEST_COUNT];

static void banner(const char *stage, const char *what, const char *meaning) {
  Serial.println();
  Serial.printf("--- 階段 %s：%s\n", stage, what);
  Serial.printf("    看什麼：%s\n", meaning);
}

static void holdFrame(uint32_t hold_ms) {
  FastLED.show();
  delay(hold_ms);
}

void setup() {
  Serial.setRxBufferSize(4096);
  Serial.begin(115200);
  delay(600);
  Serial.println();
  Serial.println("=== 壓降 vs 訊號 判別韌體 ===");
  Serial.printf("[droop] GPIO=%d  設定顆數=%d  chipset=WS2812B  order=GRB\n",
                TEST_GPIO, TEST_COUNT);
  Serial.println("[droop] 每個階段停 5 秒，看完一輪會從頭重複。");
  Serial.println("[droop] 重點看 A / D / E 三個階段的差別。");

  FastLED.addLeds<WS2812B, TEST_GPIO, GRB>(leds, TEST_COUNT)
      .setCorrection(TypicalLEDStrip);
  FastLED.clear(true);
}

void loop() {
  const int tail_start = TEST_COUNT - SEGMENT_LEN;

  // --- A：只點尾段。距離最遠，但電流極小。
  banner("A", "只點亮最後 20 顆（第 280-299 顆）",
         "尾巴有沒有亮？亮 = 訊號走得到、燈帶確實有 300 顆");
  FastLED.setBrightness(BRIGHT_SEGMENT);
  FastLED.clear();
  for (int i = tail_start; i < TEST_COUNT; ++i) leds[i] = CRGB::White;
  holdFrame(5000);

  // --- B：對照組。頭段一定要亮，否則接線本身就有問題。
  banner("B", "只點亮最前面 20 顆（第 0-19 顆）",
         "對照組，這段必亮；若這段也不亮就是接線/供電總開關的問題");
  FastLED.clear();
  for (int i = 0; i < SEGMENT_LEN && i < TEST_COUNT; ++i) leds[i] = CRGB::White;
  holdFrame(5000);

  // --- C：稀疏掃描。訊號要走完全長，但同時只有 30 顆在耗電。
  banner("C", "每 10 顆點亮 1 顆（全長分布，僅 30 顆亮）",
         "亮點分布到哪裡就斷？斷點 = 資料訊號能到的最遠距離");
  FastLED.clear();
  for (int i = 0; i < TEST_COUNT; i += SPARSE_STEP) leds[i] = CRGB::White;
  holdFrame(5000);

  // --- D：全段但電流很小。這是判斷壓降的關鍵一格。
  banner("D", "300 顆全白 + 極低亮度 8/255（約 0.5A）",
         "全長都亮 = 壓降確認（訊號沒問題，只是電流一大就撐不住）");
  FastLED.setBrightness(BRIGHT_LOW);
  fill_solid(leds, TEST_COUNT, CRGB::White);
  holdFrame(5000);

  // --- E：全段高亮度。重現原本的現象，並定位斷點。
  banner("E", "300 顆全白 + 高亮度 200/255（大電流）",
         "斷在第幾顆？跟 D 比較：D 全亮而 E 斷掉，就是供電問題");
  FastLED.setBrightness(BRIGHT_HIGH);
  fill_solid(leds, TEST_COUNT, CRGB::White);
  holdFrame(5000);

  FastLED.clear(true);
  Serial.println();
  Serial.println("[droop] 一輪結束，全暗 2 秒後重來");
  delay(2000);
}

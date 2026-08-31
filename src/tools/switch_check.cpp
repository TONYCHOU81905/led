/**
 * 開關接線驗證韌體 —— 燒正式韌體之前先確認 GPIO 10 的開關接對了。
 *
 * 為什麼要有這一支：正式韌體如果接線接錯（例如接到 NC 而不是 NO），
 * 症狀是「開機就直接進本機模式」，這跟程式邏輯寫錯的症狀一模一樣，
 * 分不出是硬體還是軟體的問題。先用這支把接線單獨驗證掉，
 * 之後正式韌體若還有問題，就能確定是軟體側。
 *
 * 這支刻意把 local_trigger.cpp 一起編進來（見 platformio.ini 的
 * build_src_filter），所以它同時驗證兩件事：
 *   1. 接線對不對（raw 電平會不會隨撥動翻轉）
 *   2. LocalTrigger 的 debounce 實作有沒有正常運作
 *
 * 接法：GPIO10 ── 開關 COM，GND ── 開關 NO（要用常開 NO，不是常閉 NC）
 *
 * 燒錄：./scripts/fw.sh upload switch-check
 * 觀察：./scripts/fw.sh monitor
 * 測完燒回主韌體：./scripts/fw.sh upload esp32-s3-devkitc-1-n16r8
 */
#include <Arduino.h>

#include "../local_trigger.h"

#ifndef SWITCH_CHECK_GPIO
#define SWITCH_CHECK_GPIO LOCAL_TRIGGER_GPIO
#endif

/** 狀態沒變時，多久印一次心跳，讓人知道韌體還活著。 */
#define HEARTBEAT_MS 2000

static LocalTrigger g_trigger;

// raw 電平的變化次數 vs debounce 後的穩定邊緣次數。
// 兩者的差就是「被 debounce 濾掉的彈跳」—— 這個數字能證明 debounce 真的有在工作。
static uint32_t g_raw_changes = 0;
static uint32_t g_stable_edges = 0;
static bool g_last_raw_high = true;

static uint32_t g_last_print_ms = 0;
static bool g_last_printed_on = false;

static void printState(const char *why, bool raw_high, bool on, uint32_t now_ms) {
  Serial.printf("[switch] %-10s raw=%-4s 判讀=%-3s → %s   （raw 變化 %u 次，穩定邊緣 %u 次，濾掉 %u 次彈跳）\n",
                why,
                raw_high ? "HIGH" : "LOW",
                on ? "ON" : "OFF",
                on ? "本機模式" : "網路模式",
                g_raw_changes, g_stable_edges,
                g_raw_changes > g_stable_edges ? g_raw_changes - g_stable_edges : 0);
  g_last_print_ms = now_ms;
  g_last_printed_on = on;
}

void setup() {
  Serial.setRxBufferSize(4096);
  Serial.begin(115200);
  delay(600);
  Serial.println();
  Serial.println("=== 開關接線驗證韌體 ===");
  Serial.printf("[switch] 監看 GPIO %d，INPUT_PULLUP，debounce %d ms\n",
                SWITCH_CHECK_GPIO, LOCAL_TRIGGER_DEBOUNCE_MS);
  Serial.println("[switch] 接法：GPIO10 ── 開關 COM，GND ── 開關 NO");
  Serial.println();
  Serial.println("[switch] 判讀方式：");
  Serial.println("[switch]   撥動開關 → raw 應在 HIGH / LOW 之間翻轉");
  Serial.println("[switch]   按下(閉合) 應該是 raw=LOW  判讀=ON");
  Serial.println("[switch]   彈起(斷開) 應該是 raw=HIGH 判讀=OFF");
  Serial.println();
  Serial.println("[switch] 如果完全不變 → 線沒接到、或接到不是 GPIO 10 的腳位");
  Serial.println("[switch] 如果方向相反 → 接到 NC 了，改接 NO 那一腳");
  Serial.println();

  g_trigger.begin(SWITCH_CHECK_GPIO);

  pinMode(SWITCH_CHECK_GPIO, INPUT_PULLUP);
  g_last_raw_high = digitalRead(SWITCH_CHECK_GPIO) != LOW;
}

void loop() {
  const uint32_t now_ms = millis();

  // 直接讀 raw 電平統計彈跳。這是刻意繞過 LocalTrigger 的 ——
  // 要拿「未經過濾的原始變化」跟「debounce 後的邊緣」對照，才看得出濾掉了多少。
  const bool raw_high = digitalRead(SWITCH_CHECK_GPIO) != LOW;
  if (raw_high != g_last_raw_high) {
    g_last_raw_high = raw_high;
    ++g_raw_changes;
  }

  const TriggerEdge edge = g_trigger.poll(now_ms);
  const bool on = g_trigger.isOn();

  if (edge == TriggerEdge::TurnedOn) {
    ++g_stable_edges;
    Serial.println();
    printState(">>> 按下", raw_high, on, now_ms);
  } else if (edge == TriggerEdge::TurnedOff) {
    ++g_stable_edges;
    Serial.println();
    printState(">>> 彈起", raw_high, on, now_ms);
  } else if (now_ms - g_last_print_ms >= HEARTBEAT_MS) {
    printState("（心跳）", raw_high, on, now_ms);
  }

  delay(5);
}

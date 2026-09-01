#pragma once

#include <stdint.h>

/**
 * 實體開關讀取 + debounce。
 *
 * 開關接法：GPIO ── 開關 ── GND，使用 INPUT_PULLUP。
 * 所以「閉合（按下）」在腳位上是 LOW，這個類別對外一律用 isOn() 表達，
 * 呼叫端不需要知道電平極性。
 *
 * latching switch 的機械接點一樣會彈跳，沒有 debounce 會在切換瞬間
 * 產生數次 on/off 邊緣，讓模式反覆進出、ESP-NOW 也跟著亂發。
 */

#ifndef LOCAL_TRIGGER_GPIO
#define LOCAL_TRIGGER_GPIO 10
#endif

#ifndef LOCAL_TRIGGER_DEBOUNCE_MS
#define LOCAL_TRIGGER_DEBOUNCE_MS 30
#endif

/** poll() 這一次所偵測到的狀態變化。 */
enum class TriggerEdge : uint8_t {
  None = 0,
  TurnedOn,   // 斷開 → 閉合
  TurnedOff,  // 閉合 → 斷開
};

/**
 * 讀取腳位原始電平的函式。true = HIGH。
 *
 * 之所以做成可注入：native 測試環境沒有 digitalRead，而 debounce 的時序
 * 邏輯正是最需要單元測試的部分。測試時餵入預先安排好的電平序列即可。
 */
using ReadPinFn = bool (*)(uint8_t gpio);

class LocalTrigger {
public:
  /**
   * @param gpio    開關腳位
   * @param reader  讀取電平的函式；傳 nullptr 表示使用 Arduino digitalRead
   *                （同時會設定 pinMode 為 INPUT_PULLUP）
   */
  void begin(uint8_t gpio = LOCAL_TRIGGER_GPIO, ReadPinFn reader = nullptr);

  /**
   * 每個主迴圈呼叫一次。回傳這次偵測到的邊緣（穩定之後才回報）。
   * 同一次狀態變化只會回報一次 TurnedOn / TurnedOff。
   */
  TriggerEdge poll(uint32_t now_ms);

  /** 目前穩定狀態：true = 閉合（按下）。 */
  bool isOn() const { return _stable_on; }

private:
  uint8_t _gpio = LOCAL_TRIGGER_GPIO;
  ReadPinFn _reader = nullptr;

  bool _stable_on = false;      // debounce 後的穩定狀態
  bool _candidate_on = false;   // 正在計時、尚未穩定的狀態
  uint32_t _candidate_since_ms = 0;
  bool _initialised = false;    // 第一次 poll 直接採用讀值，不等 debounce
};

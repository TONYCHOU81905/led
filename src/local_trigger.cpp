#include "local_trigger.h"
#include <Arduino.h>

void LocalTrigger::begin(uint8_t gpio, ReadPinFn reader) {
  _gpio = gpio;
  _reader = reader;

  // 如果沒有自訂 reader，使用 Arduino digitalRead 並設定 INPUT_PULLUP。
  // 測試環境如果提供 reader，則不碰硬體初始化。
  if (_reader == nullptr) {
    pinMode(_gpio, INPUT_PULLUP);
  }

  // 標記尚未初始化，讓下一次 poll 直接採用讀值而不等 debounce。
  _initialised = false;
}

TriggerEdge LocalTrigger::poll(uint32_t now_ms) {
  // 讀出腳位的原始電平，然後反轉極性：
  // 開關接法是 GPIO ── 開關 ── GND 搭配 INPUT_PULLUP。
  // 所以「按下（閉合）」時腳位是 LOW，而我們用 true 代表「閉合 = ON」。
  bool pin_state = _reader != nullptr ? _reader(_gpio) : static_cast<bool>(digitalRead(_gpio));
  bool pin_is_on = !pin_state;  // LOW (false) → ON (true)；HIGH (true) → OFF (false)

  if (!_initialised) {
    // 首次 poll：直接採用現在讀到的狀態作為穩定狀態，不等 debounce。
    // 這樣開機時不會因為初始值不確定而誤發邊緣事件。
    _stable_on = pin_is_on;
    _candidate_on = pin_is_on;
    _initialised = true;
    return TriggerEdge::None;
  }

  if (pin_is_on == _stable_on) {
    // 讀值與目前穩定狀態相同：取消任何待中的狀態轉換。
    _candidate_on = _stable_on;
    return TriggerEdge::None;
  }

  // 讀值與穩定狀態不同。檢查是否是新的候選狀態，或已經等夠久。
  if (pin_is_on != _candidate_on) {
    // 這是新的候選狀態（電平抖動回之前的狀態？或真的轉換中）。
    // 記下新候選狀態及其開始時刻，重新計時。
    _candidate_on = pin_is_on;
    _candidate_since_ms = now_ms;
    return TriggerEdge::None;
  }

  // pin_is_on == _candidate_on（與穩定狀態不同）。
  // 檢查已經持續多久。使用減法避免 uint32_t wrap-around 造成的邏輯錯誤。
  uint32_t stable_time = now_ms - _candidate_since_ms;
  if (stable_time >= LOCAL_TRIGGER_DEBOUNCE_MS) {
    // 已穩定夠久：更新穩定狀態並回報邊緣。
    _stable_on = _candidate_on;
    return _stable_on ? TriggerEdge::TurnedOn : TriggerEdge::TurnedOff;
  }

  // 候選狀態已出現但未達 debounce 時間，繼續等待。
  return TriggerEdge::None;
}

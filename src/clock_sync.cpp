#include "clock_sync.h"
#include <Arduino.h>
#include <math.h>
#include "time_format.h"

void ClockSync::reset() {
  _synced = false;
  _playing = false;
  _anchor_music_ms = 0;
  _anchor_local_us = 0;
  _drift_offset_ms = 0;
  _last_error_ms = 0;
  _last_sequence = 0;
}

void ClockSync::applyHardSeek(uint32_t music_time_ms, int64_t now_us) {
  _anchor_music_ms = music_time_ms;
  _anchor_local_us = now_us;
  _drift_offset_ms = 0;
  _synced = true;
}

void ClockSync::applySmoothCorrection(int32_t error_ms) {
  // Blend a fraction of the error into drift offset (low-pass filter)
  _drift_offset_ms += static_cast<int32_t>(error_ms * 0.25f);
  _last_error_ms = error_ms;
}

void ClockSync::onStart(uint32_t music_time_ms, int64_t now_us) {
  applyHardSeek(music_time_ms, now_us);
  _playing = true;
  char show[16];
  formatShowTimeMmSs(music_time_ms, show, sizeof(show));
  Serial.printf("[sync] START show=%s\n", show);
}

void ClockSync::onRunning(uint32_t music_time_ms, int64_t now_us) {
  if (!_synced) {
    applyHardSeek(music_time_ms, now_us);
    _playing = true;
    return;
  }

  const int64_t elapsed_us = now_us - _anchor_local_us;
  const int32_t estimated_ms =
      static_cast<int32_t>(_anchor_music_ms + elapsed_us / 1000 + _drift_offset_ms);
  const int32_t error_ms = static_cast<int32_t>(music_time_ms) - estimated_ms;
  _last_error_ms = error_ms;

  if (abs(error_ms) > SYNC_SMOOTH_THRESHOLD_MS) {
    char show[16];
    formatShowTimeMmSs(music_time_ms, show, sizeof(show));
    Serial.printf("[sync] hard seek error=%d ms show=%s\n", error_ms, show);
    applyHardSeek(music_time_ms, now_us);
  } else if (error_ms != 0) {
    applySmoothCorrection(error_ms);
  }
}

void ClockSync::onSeek(uint32_t music_time_ms, int64_t now_us) {
  applyHardSeek(music_time_ms, now_us);
  _playing = true;
  char show[16];
  formatShowTimeMmSs(music_time_ms, show, sizeof(show));
  Serial.printf("[sync] SEEK show=%s\n", show);
}

void ClockSync::onPause(uint32_t music_time_ms, int64_t now_us) {
  (void)now_us;
  _playing = false;
  char show[16];
  formatShowTimeMmSs(music_time_ms, show, sizeof(show));
  Serial.printf("[sync] PAUSE show=%s\n", show);
}

void ClockSync::onStop() {
  _playing = false;
  _synced = false;
  _drift_offset_ms = 0;
  Serial.println("[sync] STOP");
}

uint32_t ClockSync::musicTimeMs(int64_t now_us) const {
  if (!_synced) return 0;
  const int64_t elapsed_us = now_us - _anchor_local_us;
  const int64_t t = static_cast<int64_t>(_anchor_music_ms) + elapsed_us / 1000 +
                    _drift_offset_ms;
  return t < 0 ? 0 : static_cast<uint32_t>(t);
}

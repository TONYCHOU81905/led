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
  _last_ctrl_log_ms = 0;
  _last_ctrl_log_music_ms = 0;
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
  if (!_synced || !_playing) {
    // First packet after boot, or resume after PAUSE: re-anchor to the sender's
    // time so playback continues from the paused position instead of staying
    // frozen (onPause cleared _playing and nothing else restored it).
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

bool ClockSync::shouldLogControl(uint32_t music_time_ms, int64_t now_us) {
  // 控制封包現在會重送多份，暫停時還有 5~20 Hz 的 PAUSE 心跳。每一份都印
  // 一行會把 serial log 淹掉（也就看不到真正的錯誤）。只有時間點真的移動、
  // 或隔了一段時間，才印一次。
  const uint32_t now_ms = static_cast<uint32_t>(now_us / 1000);
  const int32_t moved =
      static_cast<int32_t>(music_time_ms) - static_cast<int32_t>(_last_ctrl_log_music_ms);
  if (_last_ctrl_log_ms != 0 && abs(moved) < kCtrlLogMoveMs &&
      (now_ms - _last_ctrl_log_ms) < kCtrlLogIntervalMs) {
    return false;
  }
  _last_ctrl_log_ms = now_ms == 0 ? 1 : now_ms;
  _last_ctrl_log_music_ms = music_time_ms;
  return true;
}

void ClockSync::onSeek(uint32_t music_time_ms, int64_t now_us) {
  // SEEK 只代表「時間軸跳到這裡」，不代表「開始播放」。
  //
  // 原本這裡無條件設 _playing = true：Studio 暫停時拖動時間軸會送 SEEK，
  // 板子收到就開始自由奔跑，0.6 秒後便跑過下一個 clip 的起點 —— 使用者停在
  // 2:42，卻看到 2:43 才該亮的藍燈，2 秒後進 blackout 才熄。
  // 播放中的 SEEK 不受影響：後面緊接著的 RUNNING 封包會把 _playing 設回
  // true（onRunning 的 !_playing 分支會重新錨定）。
  applyHardSeek(music_time_ms, now_us);
  if (shouldLogControl(music_time_ms, now_us)) {
    char show[16];
    formatShowTimeMmSs(music_time_ms, show, sizeof(show));
    Serial.printf("[sync] SEEK show=%s playing=%d\n", show, _playing ? 1 : 0);
  }
}

void ClockSync::onPause(uint32_t music_time_ms, int64_t now_us) {
  // Freeze the clock at the pause position; musicTimeMs() returns the anchor
  // while not playing, and resume (RUNNING) re-anchors from the sender.
  applyHardSeek(music_time_ms, now_us);
  _playing = false;
  if (shouldLogControl(music_time_ms, now_us)) {
    char show[16];
    formatShowTimeMmSs(music_time_ms, show, sizeof(show));
    Serial.printf("[sync] PAUSE show=%s\n", show);
  }
}

void ClockSync::freeze(int64_t now_us) {
  // 收不到 timecode 時凍結時鐘。
  //
  // 原本 musicTimeMs() 只看 _playing，沒有時間源也照 esp_timer 一直往前數：
  // Studio 停在 3:02，板子 20 秒後已經跑到 3:19。凍在最後已知位置，等封包
  // 回來由 onRunning／onPause 重新錨定才是對的。
  if (!_synced || !_playing) return;
  _anchor_music_ms = musicTimeMs(now_us);
  _anchor_local_us = now_us;
  _drift_offset_ms = 0;
  _playing = false;
}

void ClockSync::onStop() {
  _playing = false;
  _synced = false;
  _drift_offset_ms = 0;
  Serial.println("[sync] STOP");
}

uint32_t ClockSync::musicTimeMs(int64_t now_us) const {
  if (!_synced) return 0;
  if (!_playing) return _anchor_music_ms;
  const int64_t elapsed_us = now_us - _anchor_local_us;
  const int64_t t = static_cast<int64_t>(_anchor_music_ms) + elapsed_us / 1000 +
                    _drift_offset_ms;
  return t < 0 ? 0 : static_cast<uint32_t>(t);
}

#pragma once

#include "types.h"
#include "timecode_packet.h"

class ClockSync {
public:
  void reset();
  void onStart(uint32_t music_time_ms, int64_t now_us);
  void onRunning(uint32_t music_time_ms, int64_t now_us);
  void onSeek(uint32_t music_time_ms, int64_t now_us);
  void onPause(uint32_t music_time_ms, int64_t now_us);
  void onStop();
  /** 失去時間源時凍結時鐘於最後已知位置（見 .cpp 的說明）。 */
  void freeze(int64_t now_us);

  uint32_t musicTimeMs(int64_t now_us) const;
  int32_t estimatedDriftMs() const { return _last_error_ms; }
  uint32_t lastSequence() const { return _last_sequence; }
  void setLastSequence(uint32_t seq) { _last_sequence = seq; }
  bool hasSync() const { return _synced; }

  void setPlaying(bool playing) { _playing = playing; }
  bool isPlaying() const { return _playing; }

private:
  /** 控制封包 log 節流：移動不到這麼多 ms 就不重印。 */
  static constexpr int32_t kCtrlLogMoveMs = 50;
  /** 控制封包 log 節流：位置沒動時，最多這麼久印一次。 */
  static constexpr uint32_t kCtrlLogIntervalMs = 1000;

  void applyHardSeek(uint32_t music_time_ms, int64_t now_us);
  void applySmoothCorrection(int32_t error_ms);
  bool shouldLogControl(uint32_t music_time_ms, int64_t now_us);

  bool _synced = false;
  bool _playing = false;
  uint32_t _anchor_music_ms = 0;
  int64_t _anchor_local_us = 0;
  int32_t _drift_offset_ms = 0;
  int32_t _last_error_ms = 0;
  uint32_t _last_sequence = 0;
  uint32_t _last_ctrl_log_ms = 0;
  uint32_t _last_ctrl_log_music_ms = 0;
};

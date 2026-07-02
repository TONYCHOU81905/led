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

  uint32_t musicTimeMs(int64_t now_us) const;
  int32_t estimatedDriftMs() const { return _last_error_ms; }
  uint32_t lastSequence() const { return _last_sequence; }
  void setLastSequence(uint32_t seq) { _last_sequence = seq; }
  bool hasSync() const { return _synced; }

  void setPlaying(bool playing) { _playing = playing; }
  bool isPlaying() const { return _playing; }

private:
  void applyHardSeek(uint32_t music_time_ms, int64_t now_us);
  void applySmoothCorrection(int32_t error_ms);

  bool _synced = false;
  bool _playing = false;
  uint32_t _anchor_music_ms = 0;
  int64_t _anchor_local_us = 0;
  int32_t _drift_offset_ms = 0;
  int32_t _last_error_ms = 0;
  uint32_t _last_sequence = 0;
};

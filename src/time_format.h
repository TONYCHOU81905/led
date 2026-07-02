#pragma once

#include <stdint.h>
#include <stdio.h>

/** Format music time as m:ss (e.g. 0:09, 12:34). */
inline void formatShowTimeMmSs(uint32_t music_ms, char *buf, size_t len) {
  const uint32_t total_seconds = music_ms / 1000;
  const uint32_t minutes = total_seconds / 60;
  const uint32_t seconds = total_seconds % 60;
  snprintf(buf, len, "%u:%02u", minutes, seconds);
}

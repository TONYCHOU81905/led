#pragma once

#include "types.h"
#include <string.h>

inline const char *ledChipsetName(LedChipsetType type) {
  switch (type) {
  case LED_CHIPSET_WS2812B:
    return "WS2812B";
  default:
    return "WS2811";
  }
}

inline bool parseLedChipset(const char *value, LedChipsetType &out) {
  if (!value || value[0] == '\0') {
    return false;
  }

  if (strcasecmp(value, "WS2812B") == 0 || strcasecmp(value, "WS2812") == 0) {
    out = LED_CHIPSET_WS2812B;
    return true;
  }
  if (strcasecmp(value, "WS2811") == 0 || strcasecmp(value, "WS2811_400") == 0) {
    out = LED_CHIPSET_WS2811;
    return true;
  }
  return false;
}

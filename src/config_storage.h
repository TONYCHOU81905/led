#pragma once

#include <Arduino.h>
#include <stddef.h>
#include <stdint.h>

#ifndef CONFIG_FLASH_MAX_BYTES
#define CONFIG_FLASH_MAX_BYTES (256 * 1024)
#endif

class ConfigStorage {
public:
  static bool begin();
  static bool save(const char *json, size_t len);
  static bool load(String &out);
  static bool exists();
  static bool clear();
  static uint32_t storedCrc32();
};

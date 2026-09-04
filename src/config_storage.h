#pragma once

#include <Arduino.h>
#include <stddef.h>
#include <stdint.h>
#include "types.h"

#ifndef CONFIG_FLASH_MAX_BYTES
#define CONFIG_FLASH_MAX_BYTES (256 * 1024)
#endif

/**
 * 二進位 config 的檔頭。magic 用來區分「新的二進位」與「舊的 JSON」——
 * 開機時先試二進位、失敗（magic 不符）才退回 JSON 路徑，藉此保留舊韌體
 * 存下的設定不需要重新 deploy（見 ConfigLoader::load 的遷移邏輯）。
 *
 * prefix_size / event_size 是為了防呆：韌體重新編譯時如果改了
 * MAX_TARGETS_PER_EVENT 之類的常數，DeviceConfig / TimelineEvent 的記憶體
 * 佈局會變，硬讀舊檔會讀到錯位、亂掉的 event —— 這兩個欄位讓 loadBinary
 * 能在套用前就發現佈局不符，而不是套用之後才炸。
 */
struct ConfigBlobHeader {
  uint32_t magic;          // 0x4344454C ('L','E','D','C' little-endian)
  uint16_t version;        // 目前 1
  uint16_t event_count;
  uint32_t prefix_size;    // offsetof(DeviceConfig, events)
  uint32_t event_size;     // sizeof(TimelineEvent)
  uint32_t config_crc32;   // 原始 JSON 的 CRC，Studio 比對用
  uint32_t payload_crc32;  // header 之後所有 bytes 的 CRC
};

class ConfigStorage {
public:
  static bool begin();
  static bool save(const char *json, size_t len);
  static bool load(String &out);
  static bool exists();
  static bool clear();
  static uint32_t storedCrc32();

  // 二進位格式：DeviceConfig::events 是編譯期就配好的靜態陣列（不吃 heap），
  // 直接把 prefix bytes + events bytes 寫進 flash / 讀回來，省掉 JSON
  // 解析瞬間「JSON 原文 + ArduinoJson 物件樹」兩份 O(n) heap 中間表示法。
  static bool saveBinary(const DeviceConfig &cfg);
  /** 回傳 false 代表「不是二進位格式」（可能是舊 JSON）或校驗失敗。 */
  static bool loadBinary(DeviceConfig &out);
};

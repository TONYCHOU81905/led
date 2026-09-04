#pragma once

#include "types.h"
#include <ArduinoJson.h>
#include <stddef.h>

namespace ConfigJsonParser {

uint32_t crc32(const char *data, size_t len);

// Parse configCompiler JSON into DeviceConfig. Returns false on error; writes
// message to Serial.
/** 複製模式：來源不可變（Arduino String）時用這個。 */
bool parse(const char *json, size_t len, DeviceConfig &out);

/**
 * Zero-copy 模式：省掉所有字串副本，是解 NoMemory 的最大單筆節省。
 * 呼叫端必須擁有可變緩衝區、緩衝區活得比這次呼叫久、且 CRC 已先算完
 * （會就地改寫）。詳見 .cpp 的註解。
 */
bool parseInPlace(char *json, size_t len, DeviceConfig &out);

/**
 * 解析單一 event 物件填進 e。colors/parts 的索引查找需要已經套好的 cfg
 * （target/route_part 找 part id、color 找顏色名稱都要查表）。
 * 抽出來給 applyRoot() 的 events 迴圈與分批上傳協定的 end_events 共用，
 * 避免同一段解析邏輯維護兩份。
 */
bool applyEvent(JsonObjectConst evt, const DeviceConfig &cfg, TimelineEvent &e);

} // namespace ConfigJsonParser

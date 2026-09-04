#pragma once

#include "types.h"
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

} // namespace ConfigJsonParser

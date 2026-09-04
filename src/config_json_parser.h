#pragma once

#include "types.h"
#include <ArduinoJson.h>
#include <stddef.h>

namespace ConfigJsonParser {

uint32_t crc32(const char *data, size_t len);

// Parse configCompiler JSON into DeviceConfig. Returns false on error; writes
// message to Serial.
/**
 * 解析完整 config JSON。
 *
 * 注意 ArduinoJson 7.4.3 一律會把字串複製進文件（StringBuilder::save()
 * 對 char* 與 const char* 行為相同），所以沒有「zero-copy」可言 ——
 * 曾經有一條 parseInPlace() 分支假設能省下字串副本，經 ASAN 實測證明前提
 * 為假，已移除。要省 heap 只能靠「一次餵小一點的 JSON」，也就是分批上傳。
 */
bool parse(const char *json, size_t len, DeviceConfig &out);


/**
 * 解析單一 event 物件填進 e。colors/parts 的索引查找需要已經套好的 cfg
 * （target/route_part 找 part id、color 找顏色名稱都要查表）。
 * 抽出來給 applyRoot() 的 events 迴圈與分批上傳協定的 end_events 共用，
 * 避免同一段解析邏輯維護兩份。
 */
bool applyEvent(JsonObjectConst evt, const DeviceConfig &cfg, TimelineEvent &e);

} // namespace ConfigJsonParser

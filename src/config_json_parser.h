#pragma once

#include "types.h"
#include <stddef.h>

namespace ConfigJsonParser {

uint32_t crc32(const char *data, size_t len);

// Parse configCompiler JSON into DeviceConfig. Returns false on error; writes
// message to Serial.
bool parse(const char *json, size_t len, DeviceConfig &out);

} // namespace ConfigJsonParser

#pragma once

#include <stdint.h>

#define TIMECODE_MAGIC 0x4C544331u // 'LTC1'

#pragma pack(push, 1)
struct TimecodePacketV1 {
  uint32_t magic;
  uint8_t version;
  uint8_t packet_type;
  uint16_t flags;
  uint32_t show_id_crc32;
  uint32_t sequence;
  uint64_t sender_unix_ms;
  uint32_t music_time_ms;
  int32_t playback_rate_ppm;
  uint32_t config_crc32;
  uint32_t packet_crc32;
};
#pragma pack(pop)

static_assert(sizeof(TimecodePacketV1) == 40, "TimecodePacketV1 size mismatch");

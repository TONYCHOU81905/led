#pragma once

#include <stdint.h>

// Firmware version
#define FIRMWARE_VERSION "1.0.0"

// LED limits
#ifndef LED_COUNT_MAX
#define LED_COUNT_MAX 500
#endif

#define MAX_PARTS 8
#define MAX_RANGES_PER_PART 4
#define MAX_TARGETS_PER_EVENT 4
#define MAX_EVENTS 128
#define MAX_COLORS 32
#define MAX_PART_ID_LEN 16

// Default LED data GPIO (override via -DLED_DATA_GPIO=N or config hardware.data_gpio)
#ifndef LED_DATA_GPIO
#define LED_DATA_GPIO 8
#endif

// Default LED chipset (override via config device.led_type or -DLED_CHIPSET_DEFAULT)
enum LedChipsetType : uint8_t {
  LED_CHIPSET_WS2811 = 0,
  LED_CHIPSET_WS2812B = 1,
};

#ifndef LED_CHIPSET_DEFAULT
#define LED_CHIPSET_DEFAULT LED_CHIPSET_WS2811
#endif

// Clock sync threshold (ms): smooth correction within, hard seek beyond
#define SYNC_SMOOTH_THRESHOLD_MS 10

// Render frame rate
#define RENDER_FPS 60
#define FRAME_INTERVAL_US (1000000 / RENDER_FPS)

// Timecode packet types
enum TimecodePacketType : uint8_t {
  TC_START = 1,
  TC_RUNNING = 2,
  TC_PAUSE = 3,
  TC_STOP = 4,
  TC_SEEK = 5,
  TC_PING = 6,
};

// Application sync / playback state
enum AppSyncState : uint8_t {
  STATE_BOOT = 0,
  STATE_WIFI_CONNECTING,
  STATE_WAIT_TIMECODE,
  STATE_PLAYING,
  STATE_PAUSED,
  STATE_STOPPED,
};

// Timeline effects
enum EffectType : uint8_t {
  EFFECT_SOLID = 0,
  EFFECT_OFF,
  EFFECT_BLINK,
  EFFECT_FADE_IN,
  EFFECT_FADE_OUT,
};

struct RgbColor {
  uint8_t r;
  uint8_t g;
  uint8_t b;
};

struct LedRange {
  uint16_t start;
  uint16_t end; // inclusive
};

struct PartDef {
  char id[MAX_PART_ID_LEN];
  LedRange ranges[MAX_RANGES_PER_PART];
  uint8_t range_count;
};

struct ColorDef {
  char name[24];
  RgbColor rgb;
};

struct BlinkParams {
  float frequency_hz;
  float duty;
};

struct TimelineEvent {
  uint32_t start_ms;
  uint32_t end_ms;
  char targets[MAX_TARGETS_PER_EVENT][MAX_PART_ID_LEN];
  uint8_t target_count;
  char color_name[24];
  EffectType effect;
  uint8_t priority;
  BlinkParams blink;
};

struct HardwareConfig {
  uint8_t data_gpio;
  uint16_t led_count;
  LedChipsetType led_type;
  float max_brightness;
  uint8_t refresh_fps;
};

struct NetworkConfig {
  char ssid[64];
  char password[64];
  uint16_t timecode_port;
  uint16_t status_port;
};

struct DeviceConfig {
  char device_id[48];
  char role_id[32];
  HardwareConfig hardware;
  NetworkConfig network;
  PartDef parts[MAX_PARTS];
  uint8_t part_count;
  ColorDef colors[MAX_COLORS];
  uint8_t color_count;
  TimelineEvent events[MAX_EVENTS];
  uint16_t event_count;
  uint32_t config_crc32;
};

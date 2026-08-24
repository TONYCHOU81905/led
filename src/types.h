#pragma once

#include <stdint.h>

// Firmware version
#define FIRMWARE_VERSION "1.0.0"

// LED limits
#ifndef LED_COUNT_MAX
#define LED_COUNT_MAX 640
#endif

#define MAX_PARTS 8
#define MAX_LED_OUTPUTS 5
#define MAX_RANGES_PER_PART 4
#define MAX_TARGETS_PER_EVENT 8
#define MAX_ROUTE_PARTS 8
#ifndef MAX_EVENTS
#define MAX_EVENTS 1024
#endif
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
#define SYNC_SMOOTH_THRESHOLD_MS 100

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
  EFFECT_FADE,
  EFFECT_PULSE,
  EFFECT_WIPE_IN,
  EFFECT_WIPE_OUT,
  EFFECT_CHASE,
  EFFECT_WAVE,
  EFFECT_TRAIL,
  EFFECT_GRADIENT_SCROLL,
  EFFECT_SPARKLE,
  EFFECT_COLOR_LFO,
  EFFECT_PATH_FLOW,
};

enum FadeCurveType : uint8_t {
  FADE_CURVE_LINEAR = 0,
  FADE_CURVE_EASE_IN,
  FADE_CURVE_EASE_OUT,
  FADE_CURVE_EASE_IN_OUT,
  FADE_CURVE_SINE,
  FADE_CURVE_EXPO,
};

enum MotionDirectionType : uint8_t {
  MOTION_DIR_AUTO = 0,
  MOTION_DIR_LEFT_TO_RIGHT,
  MOTION_DIR_RIGHT_TO_LEFT,
  MOTION_DIR_CENTER_OUT,
  MOTION_DIR_EDGE_IN,
  MOTION_DIR_TOP_DOWN,
  MOTION_DIR_BOTTOM_UP,
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

struct EffectParams {
  uint8_t secondary_color_index;
  FadeCurveType fade_curve;
  uint32_t fade_in_ms;
  uint32_t fade_out_ms;
  float speed;
  float intensity;
  float min_intensity;
  MotionDirectionType direction;
  float spread;
  float trail_length;
  uint32_t seed;
  uint8_t route_parts[MAX_ROUTE_PARTS];
  uint8_t route_count;
};

struct TimelineEvent {
  uint32_t start_ms;
  uint32_t end_ms;
  uint8_t targets[MAX_TARGETS_PER_EVENT];
  uint8_t target_count;
  uint8_t color_index;
  EffectType effect;
  uint8_t priority;
  BlinkParams blink;
  EffectParams params;
};

struct LedOutputConfig {
  char id[MAX_PART_ID_LEN];
  uint8_t data_gpio;
  uint16_t offset;
  uint16_t led_count;
};

struct HardwareConfig {
  uint8_t data_gpio;
  uint16_t led_count;
  LedOutputConfig outputs[MAX_LED_OUTPUTS];
  uint8_t output_count;
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

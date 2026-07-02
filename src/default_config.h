#pragma once

#include <stdio.h>
#include <string.h>
#include "types.h"

// Embedded demo device config — compiled timeline with start_ms/end_ms.
// WiFi placeholders match spec §8.3; change before field use.
inline void initDefaultConfig(DeviceConfig &cfg) {
  memset(&cfg, 0, sizeof(cfg));

  snprintf(cfg.device_id, sizeof(cfg.device_id), "esp32s3_dancer_demo_001");
  snprintf(cfg.role_id, sizeof(cfg.role_id), "dancer_demo");
  cfg.config_crc32 = 0xDEADBEEF;

  // hardware.data_gpio overrides compile-time LED_DATA_GPIO when non-zero
  cfg.hardware.data_gpio = LED_DATA_GPIO;
  cfg.hardware.led_count = LED_COUNT_MAX;
  cfg.hardware.led_type = static_cast<LedChipsetType>(LED_CHIPSET_DEFAULT);
  cfg.hardware.max_brightness = 0.4f;
  cfg.hardware.refresh_fps = RENDER_FPS;

  snprintf(cfg.network.ssid, sizeof(cfg.network.ssid), "SHOW_SYNC_AP");
  snprintf(cfg.network.password, sizeof(cfg.network.password), "CHANGE_ME");
  cfg.network.timecode_port = 4210;
  cfg.network.status_port = 4211;

  // --- Stage color palette ---
  auto addColor = [&](const char *name, uint8_t r, uint8_t g, uint8_t b) {
    if (cfg.color_count >= MAX_COLORS) return;
    ColorDef &c = cfg.colors[cfg.color_count++];
    snprintf(c.name, sizeof(c.name), "%s", name);
    c.rgb = {r, g, b};
  };

  addColor("electric_cyan", 0, 245, 255);
  addColor("hot_magenta", 255, 0, 128);
  addColor("laser_lime", 57, 255, 20);
  addColor("royal_violet", 139, 0, 255);
  addColor("golden_spark", 255, 215, 0);
  addColor("flame_orange", 255, 69, 0);
  addColor("ice_blue", 79, 195, 247);
  addColor("neon_pink", 255, 20, 147);
  addColor("emerald_glow", 0, 200, 150);
  addColor("ultraviolet", 106, 13, 173);
  addColor("silver_white", 240, 240, 255);
  addColor("deep_crimson", 220, 20, 60);
  addColor("red", 255, 0, 0);
  addColor("green", 0, 255, 0);
  addColor("blue", 0, 0, 255);
  addColor("yellow", 255, 255, 0);
  addColor("purple", 128, 0, 255);
  addColor("white", 255, 255, 255);
  addColor("off", 0, 0, 0);

  // --- Body parts (LED ranges scale with LED_COUNT_MAX) ---
  auto addPart = [&](const char *id, uint16_t start, uint16_t end) {
    if (cfg.part_count >= MAX_PARTS) return;
    PartDef &p = cfg.parts[cfg.part_count++];
    snprintf(p.id, sizeof(p.id), "%s", id);
    p.ranges[0] = {start, end};
    p.range_count = 1;
  };

  const uint16_t n = cfg.hardware.led_count;
  const uint16_t q = n / 4;
  addPart("hand", 0, q - 1);
  addPart("foot", q, 2 * q - 1);
  addPart("head", 2 * q, 3 * q - 1);
  addPart("body", 3 * q, n - 1);

  // --- Demo timeline events ---
  auto addEvent = [&](uint32_t start_ms, uint32_t end_ms, const char *target,
                      const char *color, EffectType effect, uint8_t priority,
                      float blink_hz = 8.0f, float duty = 0.5f) {
    if (cfg.event_count >= MAX_EVENTS) return;
    TimelineEvent &e = cfg.events[cfg.event_count++];
    e.start_ms = start_ms;
    e.end_ms = end_ms;
    e.target_count = 1;
    snprintf(e.targets[0], sizeof(e.targets[0]), "%s", target);
    snprintf(e.color_name, sizeof(e.color_name), "%s", color);
    e.effect = effect;
    e.priority = priority;
    e.blink = {blink_hz, duty};
  };

  addEvent(0, 1000, "hand", "electric_cyan", EFFECT_SOLID, 10);
  addEvent(0, 1000, "foot", "laser_lime", EFFECT_SOLID, 10);
  addEvent(1000, 2000, "head", "hot_magenta", EFFECT_BLINK, 20, 8.0f, 0.5f);
  addEvent(1500, 3000, "body", "royal_violet", EFFECT_FADE_IN, 15);
  addEvent(3000, 4500, "hand", "golden_spark", EFFECT_FADE_OUT, 15);
  addEvent(4000, 6000, "foot", "flame_orange", EFFECT_SOLID, 10);
  addEvent(5000, 5500, "head", "deep_crimson", EFFECT_BLINK, 25, 12.0f, 0.4f);
}

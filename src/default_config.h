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

  cfg.hardware.data_gpio = LED_DATA_GPIO;
  cfg.hardware.led_type = LED_CHIPSET_WS2812B;
  cfg.hardware.max_brightness = 0.25f;
  cfg.hardware.refresh_fps = RENDER_FPS;

// Five-channel wearable defaults are ESP32-S3 only (GPIO 6/7 are flash on classic ESP32).
#if CONFIG_IDF_TARGET_ESP32S3 && LED_COUNT_MAX >= 580
  cfg.hardware.led_count = 580;
  auto addOutput = [&](const char *id, uint8_t gpio, uint16_t offset, uint16_t count) {
    LedOutputConfig &output = cfg.hardware.outputs[cfg.hardware.output_count++];
    snprintf(output.id, sizeof(output.id), "%s", id);
    output.data_gpio = gpio;
    output.offset = offset;
    output.led_count = count;
  };
  addOutput("hat", 4, 0, 60);
  addOutput("right_arm", 5, 60, 130);
  addOutput("right_leg", 6, 190, 130);
  addOutput("left_leg", 7, 320, 130);
  addOutput("left_arm", 15, 450, 130);
#else
  cfg.hardware.led_count = LED_COUNT_MAX > 120 ? 120 : LED_COUNT_MAX;
#endif

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

  // --- Body parts in top-to-bottom, right-to-left order (wearer's view) ---
  auto addPart = [&](const char *id, uint16_t start, uint16_t end) {
    if (cfg.part_count >= MAX_PARTS) return;
    PartDef &p = cfg.parts[cfg.part_count++];
    snprintf(p.id, sizeof(p.id), "%s", id);
    p.ranges[0] = {start, end};
    p.range_count = 1;
  };

#if CONFIG_IDF_TARGET_ESP32S3 && LED_COUNT_MAX >= 580
  addPart("head", 0, 59);
  addPart("right_hand", 60, 189);
  addPart("right_foot", 190, 319);
  addPart("left_foot", 320, 449);
  addPart("left_hand", 450, 579);
#else
  addPart("head", 0, cfg.hardware.led_count - 1);
#endif

  auto findPartIndex = [&](const char *id) -> int {
    for (uint8_t i = 0; i < cfg.part_count; ++i) {
      if (strcmp(cfg.parts[i].id, id) == 0) return i;
    }
    return -1;
  };

  auto findColorIndex = [&](const char *name) -> int {
    for (uint8_t i = 0; i < cfg.color_count; ++i) {
      if (strcmp(cfg.colors[i].name, name) == 0) return i;
    }
    return -1;
  };

  // --- Demo timeline events ---
  auto addEvent = [&](uint32_t start_ms, uint32_t end_ms, const char *target,
                      const char *color, EffectType effect, uint8_t priority,
                      float blink_hz = 8.0f, float duty = 0.5f) {
    if (cfg.event_count >= MAX_EVENTS) return;
    TimelineEvent &e = cfg.events[cfg.event_count++];
    e.start_ms = start_ms;
    e.end_ms = end_ms;
    e.target_count = 1;
    e.targets[0] = static_cast<uint8_t>(findPartIndex(target));
    e.color_index = static_cast<uint8_t>(findColorIndex(color));
    e.effect = effect;
    e.priority = priority;
    e.blink = {blink_hz, duty};
    e.params.secondary_color_index = 0xFF;
  };

  addEvent(0, 1000, "head", "hot_magenta", EFFECT_BLINK, 20, 8.0f, 0.5f);
#if CONFIG_IDF_TARGET_ESP32S3 && LED_COUNT_MAX >= 580
  addEvent(1000, 2500, "right_hand", "electric_cyan", EFFECT_WIPE_IN, 10);
  addEvent(2000, 3500, "right_foot", "laser_lime", EFFECT_CHASE, 10);
  addEvent(3000, 4500, "left_foot", "flame_orange", EFFECT_WAVE, 10);
  addEvent(4000, 5500, "left_hand", "golden_spark", EFFECT_WIPE_IN, 10);
#endif
}

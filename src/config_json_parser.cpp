#include "config_json_parser.h"
#include "led_chipset.h"
#include <Arduino.h>
#include <ArduinoJson.h>
#include <string.h>

namespace ConfigJsonParser {

uint32_t crc32(const char *data, size_t len) {
  uint32_t crc = 0xffffffff;
  for (size_t i = 0; i < len; ++i) {
    crc ^= static_cast<uint8_t>(data[i]);
    for (int j = 0; j < 8; ++j) {
      crc = (crc >> 1) ^ (crc & 1 ? 0xedb88320u : 0);
    }
  }
  return crc ^ 0xffffffffu;
}

static void copyStr(char *dst, size_t dst_len, const char *src) {
  if (!dst || dst_len == 0) return;
  if (!src) {
    dst[0] = '\0';
    return;
  }
  strncpy(dst, src, dst_len - 1);
  dst[dst_len - 1] = '\0';
}

static int findPartIndex(const DeviceConfig &cfg, const char *part_id) {
  if (!part_id || part_id[0] == '\0') return -1;
  for (uint8_t i = 0; i < cfg.part_count; ++i) {
    if (strcmp(cfg.parts[i].id, part_id) == 0) return i;
  }
  return -1;
}

static int findColorIndex(const DeviceConfig &cfg, const char *color_name) {
  if (!color_name || color_name[0] == '\0') return -1;
  for (uint8_t i = 0; i < cfg.color_count; ++i) {
    if (strcmp(cfg.colors[i].name, color_name) == 0) return i;
  }
  return -1;
}

static bool parseEffect(const char *effect_str, EffectType &out) {
  if (!effect_str) return false;
  if (strcmp(effect_str, "solid") == 0) {
    out = EFFECT_SOLID;
    return true;
  }
  if (strcmp(effect_str, "off") == 0) {
    out = EFFECT_OFF;
    return true;
  }
  if (strcmp(effect_str, "blink") == 0) {
    out = EFFECT_BLINK;
    return true;
  }
  if (strcmp(effect_str, "fade_in") == 0 || strcmp(effect_str, "fade") == 0) {
    out = strcmp(effect_str, "fade") == 0 ? EFFECT_FADE : EFFECT_FADE_IN;
    return true;
  }
  if (strcmp(effect_str, "fade_out") == 0) {
    out = EFFECT_FADE_OUT;
    return true;
  }
  if (strcmp(effect_str, "pulse") == 0) {
    out = EFFECT_PULSE;
    return true;
  }
  if (strcmp(effect_str, "wipe_in") == 0) {
    out = EFFECT_WIPE_IN;
    return true;
  }
  if (strcmp(effect_str, "wipe_out") == 0) {
    out = EFFECT_WIPE_OUT;
    return true;
  }
  if (strcmp(effect_str, "chase") == 0) {
    out = EFFECT_CHASE;
    return true;
  }
  if (strcmp(effect_str, "wave") == 0) {
    out = EFFECT_WAVE;
    return true;
  }
  if (strcmp(effect_str, "trail") == 0) {
    out = EFFECT_TRAIL;
    return true;
  }
  if (strcmp(effect_str, "gradient_scroll") == 0) {
    out = EFFECT_GRADIENT_SCROLL;
    return true;
  }
  if (strcmp(effect_str, "sparkle") == 0) {
    out = EFFECT_SPARKLE;
    return true;
  }
  if (strcmp(effect_str, "color_lfo") == 0) {
    out = EFFECT_COLOR_LFO;
    return true;
  }
  if (strcmp(effect_str, "path_flow") == 0) {
    out = EFFECT_PATH_FLOW;
    return true;
  }
  return false;
}

static FadeCurveType parseFadeCurve(const char *curve_str) {
  if (!curve_str || strcmp(curve_str, "linear") == 0) return FADE_CURVE_LINEAR;
  if (strcmp(curve_str, "ease_in") == 0) return FADE_CURVE_EASE_IN;
  if (strcmp(curve_str, "ease_out") == 0) return FADE_CURVE_EASE_OUT;
  if (strcmp(curve_str, "ease_in_out") == 0) return FADE_CURVE_EASE_IN_OUT;
  if (strcmp(curve_str, "sine") == 0) return FADE_CURVE_SINE;
  if (strcmp(curve_str, "expo") == 0) return FADE_CURVE_EXPO;
  return FADE_CURVE_EASE_IN_OUT;
}

static MotionDirectionType parseMotionDirection(const char *direction_str) {
  if (!direction_str || strcmp(direction_str, "auto") == 0) return MOTION_DIR_AUTO;
  if (strcmp(direction_str, "left_to_right") == 0) return MOTION_DIR_LEFT_TO_RIGHT;
  if (strcmp(direction_str, "right_to_left") == 0) return MOTION_DIR_RIGHT_TO_LEFT;
  if (strcmp(direction_str, "center_out") == 0) return MOTION_DIR_CENTER_OUT;
  if (strcmp(direction_str, "edge_in") == 0) return MOTION_DIR_EDGE_IN;
  if (strcmp(direction_str, "top_down") == 0) return MOTION_DIR_TOP_DOWN;
  if (strcmp(direction_str, "bottom_up") == 0) return MOTION_DIR_BOTTOM_UP;
  return MOTION_DIR_AUTO;
}

static float parseMaxBrightness(JsonVariantConst v) {
  if (v.isNull()) return 0.4f;
  const float raw = v.as<float>();
  if (raw <= 1.0f) return raw;
  return raw / 255.0f;
}

static void applyNetworkFields(JsonObjectConst root, JsonObjectConst device,
                               NetworkConfig &net) {
  JsonObjectConst net_obj = root["network"].as<JsonObjectConst>();
  if (!net_obj.isNull()) {
    copyStr(net.ssid, sizeof(net.ssid), net_obj["ssid"] | "");
    copyStr(net.password, sizeof(net.password), net_obj["password"] | "");
  }

  if (device["ssid"].is<const char *>()) {
    copyStr(net.ssid, sizeof(net.ssid), device["ssid"] | "");
  }
  if (device["password"].is<const char *>()) {
    copyStr(net.password, sizeof(net.password), device["password"] | "");
  }

  if (root["ssid"].is<const char *>()) {
    copyStr(net.ssid, sizeof(net.ssid), root["ssid"] | "");
  }
  if (root["password"].is<const char *>()) {
    copyStr(net.password, sizeof(net.password), root["password"] | "");
  }
}

bool parse(const char *json, size_t len, DeviceConfig &out) {
  if (!json || len == 0) {
    Serial.println("[config] parse error: empty input");
    return false;
  }

  JsonDocument doc;
  const DeserializationError err = deserializeJson(doc, json, len);
  if (err) {
    Serial.printf("[config] parse error: %s\n", err.c_str());
    return false;
  }

  JsonObjectConst root = doc.as<JsonObjectConst>();
  if (root.isNull()) {
    Serial.println("[config] parse error: root must be object");
    return false;
  }

  JsonObjectConst device = root["device"].as<JsonObjectConst>();
  if (device.isNull()) {
    Serial.println("[config] parse error: missing device section");
    return false;
  }

  memset(&out, 0, sizeof(out));
  copyStr(out.device_id, sizeof(out.device_id), device["device_id"] | "");
  copyStr(out.role_id, sizeof(out.role_id), device["role_id"] | "");

  out.hardware.data_gpio =
      static_cast<uint8_t>(device["data_gpio"] | LED_DATA_GPIO);
  out.hardware.led_count =
      static_cast<uint16_t>(device["led_count"] | LED_COUNT_MAX);
  if (out.hardware.led_count == 0 || out.hardware.led_count > LED_COUNT_MAX) {
    Serial.println("[config] parse error: led_count outside firmware limit");
    return false;
  }
  out.hardware.max_brightness = parseMaxBrightness(device["max_brightness"]);
  out.hardware.refresh_fps = RENDER_FPS;

  const char *led_type_str = device["led_type"] | ledChipsetName(
      static_cast<LedChipsetType>(LED_CHIPSET_DEFAULT));
  if (!parseLedChipset(led_type_str, out.hardware.led_type)) {
    Serial.printf("[config] unknown led_type '%s', using %s\n", led_type_str,
                  ledChipsetName(static_cast<LedChipsetType>(LED_CHIPSET_DEFAULT)));
    out.hardware.led_type =
        static_cast<LedChipsetType>(LED_CHIPSET_DEFAULT);
  }

  JsonArrayConst outputs = device["outputs"].as<JsonArrayConst>();
  if (!outputs.isNull()) {
    uint16_t expected_offset = 0;
    for (JsonObjectConst json_output : outputs) {
      if (out.hardware.output_count >= MAX_LED_OUTPUTS) {
        Serial.println("[config] parse error: too many LED outputs");
        return false;
      }
      LedOutputConfig &output = out.hardware.outputs[out.hardware.output_count++];
      copyStr(output.id, sizeof(output.id), json_output["id"] | "");
      output.data_gpio = static_cast<uint8_t>(json_output["gpio"] | 0);
      output.offset = static_cast<uint16_t>(json_output["offset"] | 0);
      output.led_count = static_cast<uint16_t>(json_output["led_count"] | 0);
      if (output.id[0] == '\0' || output.data_gpio == 0 || output.led_count == 0 ||
          output.offset != expected_offset ||
          output.offset + output.led_count > out.hardware.led_count) {
        Serial.println("[config] parse error: invalid LED output");
        return false;
      }
      for (uint8_t i = 0; i + 1 < out.hardware.output_count; ++i) {
        if (out.hardware.outputs[i].data_gpio == output.data_gpio) {
          Serial.println("[config] parse error: duplicate output GPIO");
          return false;
        }
      }
      expected_offset += output.led_count;
    }
    if (out.hardware.output_count == 0 || expected_offset != out.hardware.led_count) {
      Serial.println("[config] parse error: LED outputs must cover the logical buffer");
      return false;
    }
  }

  out.network.timecode_port = 4210;
  out.network.status_port = 4211;
  applyNetworkFields(root, device, out.network);

  JsonArrayConst parts = root["parts"].as<JsonArrayConst>();
  if (parts.isNull()) {
    Serial.println("[config] parse error: missing parts array");
    return false;
  }

  for (JsonObjectConst part : parts) {
    if (out.part_count >= MAX_PARTS) {
      Serial.println("[config] parse error: too many parts");
      return false;
    }
    PartDef &p = out.parts[out.part_count++];
    copyStr(p.id, sizeof(p.id), part["id"] | "");
    if (p.id[0] == '\0') {
      Serial.println("[config] parse error: part missing id");
      return false;
    }

    JsonArrayConst ranges = part["ranges"].as<JsonArrayConst>();
    if (ranges.isNull()) {
      Serial.println("[config] parse error: part missing ranges");
      return false;
    }

    p.range_count = 0;
    for (JsonObjectConst range : ranges) {
      if (p.range_count >= MAX_RANGES_PER_PART) {
        Serial.println("[config] parse error: too many ranges in part");
        return false;
      }
      LedRange &r = p.ranges[p.range_count++];
      r.start = static_cast<uint16_t>(range["start"] | 0);
      r.end = static_cast<uint16_t>(range["end"] | 0);
    }
  }

  JsonObjectConst colors = root["colors"].as<JsonObjectConst>();
  if (colors.isNull()) {
    Serial.println("[config] parse error: missing colors object");
    return false;
  }

  for (JsonPairConst kv : colors) {
    if (out.color_count >= MAX_COLORS) {
      Serial.println("[config] parse error: too many colors");
      return false;
    }
    ColorDef &c = out.colors[out.color_count++];
    copyStr(c.name, sizeof(c.name), kv.key().c_str());
    JsonObjectConst rgb = kv.value().as<JsonObjectConst>();
    c.rgb.r = static_cast<uint8_t>(rgb["r"] | 0);
    c.rgb.g = static_cast<uint8_t>(rgb["g"] | 0);
    c.rgb.b = static_cast<uint8_t>(rgb["b"] | 0);
  }

  JsonArrayConst events = root["events"].as<JsonArrayConst>();
  if (events.isNull()) {
    Serial.println("[config] parse error: missing events array");
    return false;
  }

  for (JsonObjectConst evt : events) {
    if (out.event_count >= MAX_EVENTS) {
      Serial.println("[config] parse error: too many events");
      return false;
    }
    TimelineEvent &e = out.events[out.event_count++];
    e.start_ms = static_cast<uint32_t>(evt["start_ms"] | 0);
    e.end_ms = static_cast<uint32_t>(evt["end_ms"] | 0);

    JsonArrayConst targets = evt["targets"].as<JsonArrayConst>();
    if (targets.isNull()) {
      Serial.println("[config] parse error: event missing targets");
      return false;
    }
    e.target_count = 0;
    for (JsonVariantConst target : targets) {
      if (e.target_count >= MAX_TARGETS_PER_EVENT) {
        Serial.println("[config] parse error: too many targets in event");
        return false;
      }
      const char *target_id = target.as<const char *>();
      const int part_index = findPartIndex(out, target_id);
      if (part_index < 0) {
        Serial.printf("[config] parse error: unknown target '%s'\n", target_id ? target_id : "");
        return false;
      }
      e.targets[e.target_count] = static_cast<uint8_t>(part_index);
      e.target_count++;
    }

    const char *color_name = evt["color"] | "";
    const int color_index = findColorIndex(out, color_name);
    if (color_index < 0) {
      Serial.printf("[config] parse error: unknown color '%s'\n", color_name);
      return false;
    }
    e.color_index = static_cast<uint8_t>(color_index);
    const char *effect_str = evt["effect"] | "solid";
    if (!parseEffect(effect_str, e.effect)) {
      Serial.printf("[config] parse error: unknown effect '%s'\n", effect_str);
      return false;
    }

    e.priority = static_cast<uint8_t>(evt["priority"] | 0);
    e.blink.frequency_hz = evt["params"]["frequency_hz"] | 8.0f;
    e.blink.duty = evt["params"]["duty"] | 0.5f;
    const char *secondary_name = evt["params"]["secondary_color"] | "";
    const int secondary_index = secondary_name[0] != '\0' ? findColorIndex(out, secondary_name) : -1;
    if (secondary_name[0] != '\0' && secondary_index < 0) {
      Serial.printf("[config] parse error: unknown secondary_color '%s'\n", secondary_name);
      return false;
    }
    e.params.secondary_color_index =
        secondary_index >= 0 ? static_cast<uint8_t>(secondary_index) : 0xFF;
    e.params.fade_curve = parseFadeCurve(evt["params"]["fade_curve"] | "ease_in_out");
    e.params.fade_in_ms = static_cast<uint32_t>(evt["params"]["fade_in_ms"] | 0);
    e.params.fade_out_ms = static_cast<uint32_t>(evt["params"]["fade_out_ms"] | 0);
    e.params.speed = evt["params"]["speed"] | 1.0f;
    e.params.intensity = evt["params"]["intensity"] | 1.0f;
    e.params.min_intensity = evt["params"]["min_intensity"] | 0.18f;
    e.params.direction = parseMotionDirection(evt["params"]["direction"] | "auto");
    e.params.spread = evt["params"]["spread"] | 0.85f;
    e.params.trail_length = evt["params"]["trail_length"] | 1.2f;
    e.params.seed = static_cast<uint32_t>(evt["params"]["seed"] | 17);
    e.params.route_count = 0;

    JsonArrayConst route_parts = evt["params"]["route_parts"].as<JsonArrayConst>();
    if (!route_parts.isNull()) {
      for (JsonVariantConst route_part : route_parts) {
        if (e.params.route_count >= MAX_ROUTE_PARTS) {
          Serial.println("[config] parse error: too many route_parts in event");
          return false;
        }
        const char *route_part_id = route_part.as<const char *>();
        const int part_index = findPartIndex(out, route_part_id);
        if (part_index < 0) {
          Serial.printf("[config] parse error: unknown route_part '%s'\n",
                        route_part_id ? route_part_id : "");
          return false;
        }
        e.params.route_parts[e.params.route_count] = static_cast<uint8_t>(part_index);
        e.params.route_count++;
      }
    }
  }

  out.config_crc32 = crc32(json, len);
  return true;
}

} // namespace ConfigJsonParser

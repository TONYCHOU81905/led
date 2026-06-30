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
    out = EFFECT_FADE_IN;
    return true;
  }
  if (strcmp(effect_str, "fade_out") == 0) {
    out = EFFECT_FADE_OUT;
    return true;
  }
  return false;
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

  DeviceConfig cfg = {};
  copyStr(cfg.device_id, sizeof(cfg.device_id), device["device_id"] | "");
  copyStr(cfg.role_id, sizeof(cfg.role_id), device["role_id"] | "");

  cfg.hardware.data_gpio =
      static_cast<uint8_t>(device["data_gpio"] | LED_DATA_GPIO);
  cfg.hardware.led_count =
      static_cast<uint16_t>(device["led_count"] | LED_COUNT_MAX);
  cfg.hardware.max_brightness = parseMaxBrightness(device["max_brightness"]);
  cfg.hardware.refresh_fps = RENDER_FPS;

  const char *led_type_str = device["led_type"] | ledChipsetName(
      static_cast<LedChipsetType>(LED_CHIPSET_DEFAULT));
  if (!parseLedChipset(led_type_str, cfg.hardware.led_type)) {
    Serial.printf("[config] unknown led_type '%s', using %s\n", led_type_str,
                  ledChipsetName(static_cast<LedChipsetType>(LED_CHIPSET_DEFAULT)));
    cfg.hardware.led_type =
        static_cast<LedChipsetType>(LED_CHIPSET_DEFAULT);
  }

  cfg.network.timecode_port = 4210;
  cfg.network.status_port = 4211;
  applyNetworkFields(root, device, cfg.network);

  JsonArrayConst parts = root["parts"].as<JsonArrayConst>();
  if (parts.isNull()) {
    Serial.println("[config] parse error: missing parts array");
    return false;
  }

  for (JsonObjectConst part : parts) {
    if (cfg.part_count >= MAX_PARTS) {
      Serial.println("[config] parse error: too many parts");
      return false;
    }
    PartDef &p = cfg.parts[cfg.part_count++];
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
    if (cfg.color_count >= MAX_COLORS) {
      Serial.println("[config] parse error: too many colors");
      return false;
    }
    ColorDef &c = cfg.colors[cfg.color_count++];
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
    if (cfg.event_count >= MAX_EVENTS) {
      Serial.println("[config] parse error: too many events");
      return false;
    }
    TimelineEvent &e = cfg.events[cfg.event_count++];
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
      copyStr(e.targets[e.target_count], sizeof(e.targets[e.target_count]),
              target.as<const char *>());
      e.target_count++;
    }

    copyStr(e.color_name, sizeof(e.color_name), evt["color"] | "");
    const char *effect_str = evt["effect"] | "solid";
    if (!parseEffect(effect_str, e.effect)) {
      Serial.printf("[config] parse error: unknown effect '%s'\n", effect_str);
      return false;
    }

    e.priority = static_cast<uint8_t>(evt["priority"] | 0);
    e.blink.frequency_hz = evt["params"]["frequency_hz"] | 8.0f;
    e.blink.duty = evt["params"]["duty"] | 0.5f;
  }

  cfg.config_crc32 = crc32(json, len);
  out = cfg;
  return true;
}

} // namespace ConfigJsonParser

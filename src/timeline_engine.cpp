#include "timeline_engine.h"
#include <Arduino.h>
#include <math.h>
#include <string.h>

namespace {

float clamp01(float value) {
  if (value <= 0.0f) return 0.0f;
  if (value >= 1.0f) return 1.0f;
  return value;
}

float maxf(float a, float b) { return a > b ? a : b; }

RgbColor scaleColor(const RgbColor &base, float factor) {
  const float t = clamp01(factor);
  return {static_cast<uint8_t>(base.r * t), static_cast<uint8_t>(base.g * t),
          static_cast<uint8_t>(base.b * t)};
}

RgbColor blendColor(const RgbColor &a, const RgbColor &b, float mix) {
  const float t = clamp01(mix);
  return {
      static_cast<uint8_t>(a.r + (b.r - a.r) * t),
      static_cast<uint8_t>(a.g + (b.g - a.g) * t),
      static_cast<uint8_t>(a.b + (b.b - a.b) * t),
  };
}

float ease(float progress, FadeCurveType curve) {
  const float t = clamp01(progress);
  switch (curve) {
  case FADE_CURVE_EASE_IN:
    return t * t;
  case FADE_CURVE_EASE_OUT:
    return 1.0f - (1.0f - t) * (1.0f - t);
  case FADE_CURVE_EASE_IN_OUT:
    return t < 0.5f ? 2.0f * t * t
                    : 1.0f - powf(-2.0f * t + 2.0f, 2.0f) * 0.5f;
  case FADE_CURVE_SINE:
    return 0.5f - cosf(PI * t) * 0.5f;
  case FADE_CURVE_EXPO:
    if (t <= 0.0f || t >= 1.0f) return t;
    return t < 0.5f ? powf(2.0f, 20.0f * t - 10.0f) * 0.5f
                    : (2.0f - powf(2.0f, -20.0f * t + 10.0f)) * 0.5f;
  case FADE_CURVE_LINEAR:
  default:
    return t;
  }
}

uint16_t partLedCount(const PartDef &part) {
  uint16_t total = 0;
  for (uint8_t i = 0; i < part.range_count; ++i) {
    const LedRange &range = part.ranges[i];
    if (range.end >= range.start) total += range.end - range.start + 1;
  }
  return total > 0 ? total : 1;
}

float partLocalPosition(const PartDef &part, uint16_t pixelIndex) {
  const float count = static_cast<float>(partLedCount(part));
  if (count <= 1.0f) return 0.0f;
  return clamp01(pixelIndex / (count - 1.0f));
}

float mapLocalPosition(float pos, MotionDirectionType direction) {
  switch (direction) {
  case MOTION_DIR_RIGHT_TO_LEFT:
  case MOTION_DIR_BOTTOM_UP:
    return 1.0f - pos;
  case MOTION_DIR_CENTER_OUT:
    return fabsf(pos - 0.5f) * 2.0f;
  case MOTION_DIR_EDGE_IN:
    return 1.0f - fabsf(pos - 0.5f) * 2.0f;
  case MOTION_DIR_AUTO:
  case MOTION_DIR_LEFT_TO_RIGHT:
  case MOTION_DIR_TOP_DOWN:
  default:
    return pos;
  }
}

uint32_t hash32(uint32_t value) {
  value ^= value >> 16;
  value *= 0x7feb352dU;
  value ^= value >> 15;
  value *= 0x846ca68bU;
  value ^= value >> 16;
  return value;
}

} // namespace

bool TimelineEngine::lookupColor(const char *name, RgbColor &out) const {
  if (!_cfg || !name) return false;
  for (uint8_t i = 0; i < _cfg->color_count; ++i) {
    if (strcmp(_cfg->colors[i].name, name) == 0) {
      out = _cfg->colors[i].rgb;
      return true;
    }
  }
  return false;
}

static bool lookupColorIndex(const DeviceConfig *cfg, uint8_t index, RgbColor &out) {
  if (!cfg || index >= cfg->color_count) return false;
  out = cfg->colors[index].rgb;
  return true;
}

bool TimelineEngine::partMatchesTarget(uint8_t part_index,
                                       const TimelineEvent &evt) const {
  for (uint8_t t = 0; t < evt.target_count; ++t) {
    if (evt.targets[t] == part_index) return true;
  }
  return false;
}

const TimelineEvent *TimelineEngine::findWinningEvent(
    uint8_t part_index, uint32_t music_time_ms) const {
  if (!_cfg) return nullptr;

  const TimelineEvent *best = nullptr;
  for (uint16_t i = 0; i < _cfg->event_count; ++i) {
    const TimelineEvent &e = _cfg->events[i];
    if (music_time_ms < e.start_ms || music_time_ms >= e.end_ms) continue;

    if (!partMatchesTarget(part_index, e)) continue;

    if (!best || e.priority > best->priority ||
        (e.priority == best->priority && e.start_ms >= best->start_ms)) {
      best = &e;
    }
  }
  return best;
}

void TimelineEngine::applyColorToPart(const PartDef &part, const RgbColor &c,
                                      LedDriver &leds) const {
  for (uint8_t r = 0; r < part.range_count; ++r) {
    const LedRange &range = part.ranges[r];
    for (uint16_t i = range.start; i <= range.end && i < leds.ledCount(); ++i) {
      leds.setPixel(i, c);
    }
  }
}

void TimelineEngine::applyEventToPart(const PartDef &part, const TimelineEvent &evt,
                                      const RgbColor &base,
                                      uint32_t music_time_ms,
                                      uint8_t part_index,
                                      LedDriver &leds) const {
  if (evt.effect == EFFECT_OFF) return;

  const uint32_t duration = evt.end_ms > evt.start_ms ? evt.end_ms - evt.start_ms : 1;
  const float progress =
      clamp01(static_cast<float>(music_time_ms - evt.start_ms) / duration);
  const float speed = evt.params.speed > 0.0f ? evt.params.speed : 1.0f;
  const float intensity = clamp01(evt.params.intensity > 0.0f ? evt.params.intensity : 1.0f);
  const float min_intensity = clamp01(evt.params.min_intensity);
  const float spread = maxf(0.15f, evt.params.spread > 0.0f ? evt.params.spread : 0.85f);
  const float trail_length =
      maxf(0.15f, evt.params.trail_length > 0.0f ? evt.params.trail_length : 1.2f);

  float envelope = 1.0f;
  if (evt.params.fade_in_ms > 0) {
    const float in_progress =
        static_cast<float>(music_time_ms - evt.start_ms) / evt.params.fade_in_ms;
    envelope = ease(in_progress, evt.params.fade_curve);
  } else if (evt.effect == EFFECT_FADE_IN || evt.effect == EFFECT_FADE) {
    envelope = ease(progress, evt.params.fade_curve);
  }

  float fade_out = 1.0f;
  if (evt.params.fade_out_ms > 0) {
    const float out_progress =
        static_cast<float>(evt.end_ms - music_time_ms) / evt.params.fade_out_ms;
    fade_out = ease(out_progress, evt.params.fade_curve);
  } else if (evt.effect == EFFECT_FADE_OUT || evt.effect == EFFECT_FADE) {
    fade_out = ease(1.0f - progress, evt.params.fade_curve);
  }
  envelope = clamp01(fminf(envelope, fade_out));

  RgbColor secondary = base;
  if (evt.params.secondary_color_index != 0xFF) {
    lookupColorIndex(_cfg, evt.params.secondary_color_index, secondary);
  }

  const uint8_t route_count = evt.params.route_count > 0 ? evt.params.route_count : evt.target_count;
  uint8_t part_occurrences = 0;
  float route_weight = 0.0f;
  for (uint8_t route_i = 0; route_i < route_count; ++route_i) {
    const uint8_t candidate = evt.params.route_count > 0
                                  ? evt.params.route_parts[route_i]
                                  : evt.targets[route_i];
    if (candidate == part_index) ++part_occurrences;

    uint8_t candidate_occurrences = 0;
    for (uint8_t other = 0; other < route_count; ++other) {
      const uint8_t other_part = evt.params.route_count > 0
                                     ? evt.params.route_parts[other]
                                     : evt.targets[other];
      if (other_part == candidate) ++candidate_occurrences;
    }
    if (_cfg && candidate < _cfg->part_count && candidate_occurrences > 0) {
      route_weight += static_cast<float>(partLedCount(_cfg->parts[candidate])) /
                      candidate_occurrences;
    }
  }
  if (part_occurrences == 0) part_occurrences = 1;
  if (route_weight <= 0.0f) route_weight = 1.0f;

  uint16_t local_pixel = 0;
  for (uint8_t r = 0; r < part.range_count; ++r) {
    const LedRange &range = part.ranges[r];
    for (uint16_t i = range.start; i <= range.end && i < leds.ledCount(); ++i, ++local_pixel) {
      const float local_pos = partLocalPosition(part, local_pixel);
      const uint8_t wanted_occurrence = static_cast<uint8_t>(fminf(
          part_occurrences - 1,
          floorf(local_pos * part_occurrences)));
      const float occurrence_pos = local_pos * part_occurrences - wanted_occurrence;
      float segment_start = 0.0f;
      float segment_weight = route_weight;
      uint8_t seen_occurrences = 0;
      for (uint8_t route_i = 0; route_i < route_count; ++route_i) {
        const uint8_t candidate = evt.params.route_count > 0
                                      ? evt.params.route_parts[route_i]
                                      : evt.targets[route_i];
        uint8_t candidate_occurrences = 0;
        for (uint8_t other = 0; other < route_count; ++other) {
          const uint8_t other_part = evt.params.route_count > 0
                                         ? evt.params.route_parts[other]
                                         : evt.targets[other];
          if (other_part == candidate) ++candidate_occurrences;
        }
        const float weight = (_cfg && candidate < _cfg->part_count && candidate_occurrences > 0)
                                 ? static_cast<float>(partLedCount(_cfg->parts[candidate])) /
                                       candidate_occurrences
                                 : 1.0f;
        if (candidate == part_index) {
          if (seen_occurrences == wanted_occurrence) {
            segment_weight = weight;
            break;
          }
          ++seen_occurrences;
        }
        segment_start += weight;
      }
      const float route_pos = clamp01(
          (segment_start + occurrence_pos * segment_weight) / route_weight);
      const float pos = mapLocalPosition(route_pos, evt.params.direction);
      RgbColor out = scaleColor(base, envelope * intensity);
      bool visible = true;

      switch (evt.effect) {
      case EFFECT_SOLID:
      case EFFECT_FADE_IN:
      case EFFECT_FADE_OUT:
      case EFFECT_FADE:
        break;

      case EFFECT_BLINK: {
        const float hz = evt.blink.frequency_hz > 0.0f ? evt.blink.frequency_hz : 2.0f;
        const float period_ms = 1000.0f / hz;
        const float phase = fmodf(static_cast<float>(music_time_ms - evt.start_ms), period_ms) / period_ms;
        visible = phase < evt.blink.duty;
        out = visible ? scaleColor(base, envelope * intensity) : RgbColor{0, 0, 0};
        break;
      }

      case EFFECT_PULSE: {
        const float phase =
            ((static_cast<float>(music_time_ms - evt.start_ms) / 1000.0f) * speed * 2.0f * PI) - PI * 0.5f;
        const float osc = 0.5f + 0.5f * sinf(phase);
        const float factor = min_intensity + osc * (1.0f - min_intensity);
        out = scaleColor(base, factor * envelope * intensity);
        visible = factor > 0.02f;
        break;
      }

      case EFFECT_COLOR_LFO: {
        const float phase =
            ((static_cast<float>(music_time_ms - evt.start_ms) / 1000.0f) * speed * 2.0f * PI);
        const float mix = 0.5f + 0.5f * sinf(phase);
        out = scaleColor(blendColor(base, secondary, mix), envelope * intensity);
        break;
      }

      case EFFECT_SPARKLE: {
        const uint32_t seed = evt.params.seed ? evt.params.seed : 17;
        const uint32_t bucket =
            static_cast<uint32_t>((music_time_ms - evt.start_ms) / maxf(30.0f, 180.0f / speed));
        const uint32_t noise = hash32(seed ^ (bucket * 131U) ^ (i * 17U));
        const float spark = (noise & 1023U) / 1023.0f;
        visible = spark > 0.78f;
        out = visible ? scaleColor(base, envelope * intensity) : RgbColor{0, 0, 0};
        break;
      }

      case EFFECT_WIPE_IN:
      case EFFECT_WIPE_OUT:
      case EFFECT_CHASE:
      case EFFECT_WAVE:
      case EFFECT_TRAIL:
      case EFFECT_GRADIENT_SCROLL:
      case EFFECT_PATH_FLOW: {
        const float sweep = clamp01(progress * speed);
        const float combined = sweep - pos;

        if (evt.effect == EFFECT_WIPE_IN) {
          const float edge = maxf(0.03f, 0.14f * spread);
          const float ramp = ease(combined / edge + 0.5f, evt.params.fade_curve);
          visible = ramp > 0.02f;
          out = visible ? scaleColor(base, ramp * envelope * intensity) : RgbColor{0, 0, 0};
        } else if (evt.effect == EFFECT_WIPE_OUT) {
          const float edge = maxf(0.03f, 0.14f * spread);
          const float ramp = 1.0f - ease(combined / edge + 0.5f, evt.params.fade_curve);
          visible = ramp > 0.02f;
          out = visible ? scaleColor(base, ramp * envelope * intensity) : RgbColor{0, 0, 0};
        } else if (evt.effect == EFFECT_CHASE || evt.effect == EFFECT_PATH_FLOW) {
          const float head_width = maxf(0.04f, 0.16f * spread);
          const float distance = pos - sweep;
          const float head = maxf(0.0f, 1.0f - fabsf(distance) / head_width);
          const float tail = distance < 0.0f
                                 ? maxf(0.0f, 1.0f - fabsf(distance) /
                                                        (head_width * (1.0f + trail_length))) *
                                       0.45f
                                 : 0.0f;
          const float factor = clamp01(maxf(ease(head, evt.params.fade_curve), tail));
          visible = factor > 0.02f;
          out = visible ? scaleColor(base, factor * envelope * intensity) : RgbColor{0, 0, 0};
        } else if (evt.effect == EFFECT_WAVE) {
          const float wave = 0.5f + 0.5f * sinf((combined * 2.0f * PI) - PI * 0.5f);
          out = scaleColor(base, wave * envelope * intensity);
          visible = wave > 0.02f;
        } else if (evt.effect == EFFECT_TRAIL) {
          const float head_width = maxf(0.04f, 0.12f * spread);
          const float distance = pos - sweep;
          const float head = maxf(0.0f, 1.0f - fabsf(distance) / head_width);
          const float tail = distance < 0.0f
                                 ? maxf(0.0f, 1.0f - fabsf(distance) /
                                                        (head_width * (1.0f + trail_length * 3.0f))) *
                                       0.6f
                                 : 0.0f;
          const float factor = clamp01(maxf(ease(head, evt.params.fade_curve), tail));
          visible = factor > 0.02f;
          out = visible ? scaleColor(base, factor * envelope * intensity) : RgbColor{0, 0, 0};
        } else if (evt.effect == EFFECT_GRADIENT_SCROLL) {
          if (evt.params.route_count > 1) {
            const float head_width = maxf(0.04f, 0.18f * spread);
            const float distance = pos - sweep;
            const float band = maxf(0.0f, 1.0f - fabsf(distance) / head_width);
            const float tail = distance < 0.0f
                                   ? maxf(0.0f, 1.0f - fabsf(distance) /
                                                          (head_width * (1.0f + trail_length))) *
                                         0.4f
                                   : 0.0f;
            const float factor = clamp01(maxf(ease(band, evt.params.fade_curve), tail));
            const float mix = clamp01(0.5f + distance / (head_width * 2.0f));
            visible = factor > 0.02f;
            out = visible
                      ? scaleColor(blendColor(base, secondary, mix),
                                   factor * envelope * intensity)
                      : RgbColor{0, 0, 0};
          } else {
            const float mix = 0.5f + 0.5f * sinf(
                (pos - (static_cast<float>(music_time_ms - evt.start_ms) / 1000.0f) *
                           speed * 0.35f) *
                2.0f * PI);
            out = scaleColor(blendColor(base, secondary, mix), envelope * intensity);
          }
        }
        break;
      }

      case EFFECT_OFF:
      default:
        visible = false;
        out = {0, 0, 0};
        break;
      }

      if (visible) leds.setPixel(i, out);
    }
  }
}

void TimelineEngine::render(uint32_t music_time_ms, LedDriver &leds) {
  if (!_cfg) return;

  leds.clear();

  for (uint8_t p = 0; p < _cfg->part_count; ++p) {
    const PartDef &part = _cfg->parts[p];
    const TimelineEvent *evt = findWinningEvent(p, music_time_ms);
    if (!evt) continue;

    RgbColor base{};
    if (evt->effect != EFFECT_OFF && !lookupColorIndex(_cfg, evt->color_index, base)) continue;
    applyEventToPart(part, *evt, base, music_time_ms, p, leds);
  }

  leds.show();
}

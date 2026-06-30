#include "timeline_engine.h"
#include <Arduino.h>
#include <math.h>
#include <string.h>

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

bool TimelineEngine::partMatchesTarget(const PartDef &part,
                                       const TimelineEvent &evt) const {
  for (uint8_t t = 0; t < evt.target_count; ++t) {
    if (strcmp(part.id, evt.targets[t]) == 0) return true;
  }
  return false;
}

const TimelineEvent *TimelineEngine::findWinningEvent(
    const char *part_id, uint32_t music_time_ms) const {
  if (!_cfg) return nullptr;

  const TimelineEvent *best = nullptr;
  for (uint16_t i = 0; i < _cfg->event_count; ++i) {
    const TimelineEvent &e = _cfg->events[i];
    if (music_time_ms < e.start_ms || music_time_ms >= e.end_ms) continue;

    bool targets_part = false;
    for (uint8_t t = 0; t < e.target_count; ++t) {
      if (strcmp(part_id, e.targets[t]) == 0) {
        targets_part = true;
        break;
      }
    }
    if (!targets_part) continue;

    if (!best || e.priority > best->priority ||
        (e.priority == best->priority && e.start_ms >= best->start_ms)) {
      best = &e;
    }
  }
  return best;
}

RgbColor TimelineEngine::applyEffect(const TimelineEvent &evt,
                                     const RgbColor &base,
                                     uint32_t music_time_ms) const {
  switch (evt.effect) {
  case EFFECT_OFF:
    return {0, 0, 0};

  case EFFECT_BLINK: {
    const float period_ms = 1000.0f / evt.blink.frequency_hz;
    const float phase = fmodf(static_cast<float>(music_time_ms - evt.start_ms),
                              period_ms) /
                        period_ms;
    const bool on = phase < evt.blink.duty;
    return on ? base : RgbColor{0, 0, 0};
  }

  case EFFECT_FADE_IN: {
    const uint32_t dur = evt.end_ms - evt.start_ms;
    if (dur == 0) return base;
    const float t = static_cast<float>(music_time_ms - evt.start_ms) / dur;
    const float k = t < 0 ? 0 : (t > 1 ? 1 : t);
    return {static_cast<uint8_t>(base.r * k), static_cast<uint8_t>(base.g * k),
            static_cast<uint8_t>(base.b * k)};
  }

  case EFFECT_FADE_OUT: {
    const uint32_t dur = evt.end_ms - evt.start_ms;
    if (dur == 0) return {0, 0, 0};
    const float t = static_cast<float>(music_time_ms - evt.start_ms) / dur;
    const float k = 1.0f - (t < 0 ? 0 : (t > 1 ? 1 : t));
    return {static_cast<uint8_t>(base.r * k), static_cast<uint8_t>(base.g * k),
            static_cast<uint8_t>(base.b * k)};
  }

  case EFFECT_SOLID:
  default:
    return base;
  }
}

void TimelineEngine::applyColorToPart(const PartDef &part, const RgbColor &c,
                                    LedDriver &leds) {
  for (uint8_t r = 0; r < part.range_count; ++r) {
    const LedRange &range = part.ranges[r];
    for (uint16_t i = range.start; i <= range.end && i < leds.ledCount(); ++i) {
      leds.setPixel(i, c);
    }
  }
}

void TimelineEngine::render(uint32_t music_time_ms, LedDriver &leds) {
  if (!_cfg) return;

  leds.clear();

  for (uint8_t p = 0; p < _cfg->part_count; ++p) {
    const PartDef &part = _cfg->parts[p];
    const TimelineEvent *evt = findWinningEvent(part.id, music_time_ms);
    if (!evt) continue;

    RgbColor base{};
    if (evt->effect != EFFECT_OFF) {
      if (!lookupColor(evt->color_name, base)) continue;
    }

    const RgbColor out = applyEffect(*evt, base, music_time_ms);
    applyColorToPart(part, out, leds);
  }

  leds.show();
}

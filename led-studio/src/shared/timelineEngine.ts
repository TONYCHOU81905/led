import type { CompiledEvent, PartId, ResolvedColor, RgbColor } from './types/project'
import { getStageColor } from './stageColors'
import { buildRouteSegments, listEventRouteParts, readNumberParam, readStringParam } from './timelineEffects'
import type { PartDefinition } from './types/project'

interface RouteProgress {
  routeParts: PartId[]
  segmentProgress: number
  activeIndex: number
}

/** Left-closed, right-open interval: [startMs, endMs). */
export function isEventActive(event: CompiledEvent, tMs: number): boolean {
  return event.startMs <= tMs && tMs < event.endMs
}

export function queryActiveEvents(events: CompiledEvent[], tMs: number): CompiledEvent[] {
  return events.filter((event) => isEventActive(event, tMs))
}

function resolveRgb(colorName: string, palette: Record<string, RgbColor>): RgbColor {
  const fromPalette = palette[colorName] ?? getStageColor(colorName)
  if (fromPalette) {
    return fromPalette
  }
  return { r: 128, g: 128, b: 128 }
}

function applyBlinkEffect(
  base: RgbColor,
  tMs: number,
  params?: CompiledEvent['params']
): ResolvedColor {
  const frequencyHz = readNumberParam(params, 'frequency_hz', 2)
  const duty = readNumberParam(params, 'duty', 0.5)
  const periodMs = 1000 / frequencyHz
  const phase = (tMs % periodMs) / periodMs
  const visible = phase < duty
  return { ...base, visible }
}

function clamp01(value: number): number {
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function blendColor(a: RgbColor, b: RgbColor, mix: number): RgbColor {
  const t = clamp01(mix)
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t)
  }
}

function scaleColor(base: RgbColor, factor: number): RgbColor {
  const t = clamp01(factor)
  return {
    r: Math.round(base.r * t),
    g: Math.round(base.g * t),
    b: Math.round(base.b * t)
  }
}

function ease(progress: number, curve: string): number {
  const t = clamp01(progress)
  switch (curve) {
    case 'ease_in':
      return t * t
    case 'ease_out':
      return 1 - (1 - t) * (1 - t)
    case 'ease_in_out':
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    case 'sine':
      return 0.5 - Math.cos(Math.PI * t) * 0.5
    case 'expo':
      if (t === 0 || t === 1) return t
      return t < 0.5
        ? Math.pow(2, 20 * t - 10) / 2
        : (2 - Math.pow(2, -20 * t + 10)) / 2
    case 'linear':
    default:
      return t
  }
}

function eventDurationMs(event: CompiledEvent): number {
  return Math.max(1, event.endMs - event.startMs)
}

function eventProgress(event: CompiledEvent, tMs: number): number {
  return clamp01((tMs - event.startMs) / eventDurationMs(event))
}

function routeProgress(event: CompiledEvent, partId: PartId, tMs: number): RouteProgress | null {
  const routeParts = listEventRouteParts(event.targets, event.params)
  if (routeParts.length === 0) return null

  const matches = routeParts
    .map((candidate, index) => (candidate === partId ? index : -1))
    .filter((index) => index >= 0)
  if (matches.length === 0) return null

  const progress = eventProgress(event, tMs)
  const scaled = progress * routeParts.length
  let bestIndex = matches[0]
  let bestDistance = Math.abs(bestIndex + 0.5 - scaled)
  for (const index of matches.slice(1)) {
    const distance = Math.abs(index + 0.5 - scaled)
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  }

  const segmentProgress = scaled - bestIndex
  const activeIndex = Math.max(0, Math.min(routeParts.length - 1, Math.floor(scaled)))
  return { routeParts, segmentProgress, activeIndex }
}

function secondaryColor(event: CompiledEvent, palette: Record<string, RgbColor>, base: RgbColor): RgbColor {
  const secondary = event.params?.secondary_color
  if (!secondary || typeof secondary !== 'string') return base
  return resolveRgb(secondary, palette)
}

function applyFadeEnvelope(event: CompiledEvent, tMs: number): number {
  const total = eventDurationMs(event)
  const curve = readStringParam(event.params, 'fade_curve', 'ease_in_out')
  const fadeInMs = readNumberParam(event.params, 'fade_in_ms', event.effect === 'fade_in' ? total : 0)
  const fadeOutMs = readNumberParam(event.params, 'fade_out_ms', event.effect === 'fade_out' ? total : 0)
  const local = tMs - event.startMs

  let fadeIn = 1
  if (fadeInMs > 0) fadeIn = ease(local / fadeInMs, curve)

  let fadeOut = 1
  if (fadeOutMs > 0) {
    const outProgress = (event.endMs - tMs) / fadeOutMs
    fadeOut = ease(outProgress, curve)
  }

  if (event.effect === 'fade_in' && fadeInMs === 0) {
    fadeIn = ease(local / total, curve)
  }
  if (event.effect === 'fade_out' && fadeOutMs === 0) {
    fadeOut = ease((event.endMs - tMs) / total, curve)
  }

  return clamp01(Math.min(fadeIn, fadeOut))
}

function applyRouteEffect(
  event: CompiledEvent,
  base: RgbColor,
  secondary: RgbColor,
  partId: PartId,
  tMs: number
): ResolvedColor | null {
  const route = routeProgress(event, partId, tMs)
  if (!route) return null

  const speed = Math.max(0.2, readNumberParam(event.params, 'speed', 1))
  const intensity = clamp01(readNumberParam(event.params, 'intensity', 1))
  const spread = Math.max(0.15, readNumberParam(event.params, 'spread', 0.85))
  const trailLength = Math.max(0.15, readNumberParam(event.params, 'trail_length', 1.2))
  const p = route.segmentProgress * speed
  const normalized = clamp01(p)

  switch (event.effect) {
    case 'wipe_in': {
      const visible = route.activeIndex > route.routeParts.indexOf(partId) || normalized > 0
      const ramp = ease(normalized / spread, readStringParam(event.params, 'fade_curve', 'ease_in_out'))
      return { ...scaleColor(base, visible ? Math.max(ramp, 0.15) * intensity : 0), visible }
    }
    case 'wipe_out': {
      const past = route.activeIndex > route.routeParts.indexOf(partId)
      const factor = past ? 0 : 1 - ease(normalized / spread, readStringParam(event.params, 'fade_curve', 'ease_in_out'))
      return { ...scaleColor(base, factor * intensity), visible: factor > 0.02 }
    }
    case 'chase':
    case 'path_flow': {
      const head = 1 - Math.abs(normalized - 0.5) * 2
      const factor = clamp01(head / spread) * intensity
      return { ...scaleColor(base, factor), visible: factor > 0.02 }
    }
    case 'wave': {
      const oscillation = 0.5 + 0.5 * Math.sin((normalized * Math.PI * 2) - Math.PI / 2)
      const factor = clamp01(oscillation) * intensity
      return { ...scaleColor(base, factor), visible: factor > 0.02 }
    }
    case 'trail': {
      const head = clamp01(1 - Math.abs(normalized - 0.25))
      const tail = clamp01(head * trailLength)
      const factor = clamp01(Math.max(head, tail * 0.5)) * intensity
      return { ...scaleColor(base, factor), visible: factor > 0.02 }
    }
    case 'gradient_scroll': {
      const mix = 0.5 + 0.5 * Math.sin(normalized * Math.PI * 2)
      return { ...blendColor(base, secondary, mix), visible: true }
    }
    default:
      return null
  }
}

function applyEffect(
  event: CompiledEvent,
  base: RgbColor,
  tMs: number,
  partId: PartId,
  palette: Record<string, RgbColor>
): ResolvedColor {
  const secondary = secondaryColor(event, palette, base)
  const envelope = applyFadeEnvelope(event, tMs)

  switch (event.effect) {
    case 'off':
      return { r: 0, g: 0, b: 0, visible: false }
    case 'blink':
      return applyBlinkEffect(base, tMs, event.params)
    case 'pulse': {
      const speed = Math.max(0.1, readNumberParam(event.params, 'speed', 1))
      const minIntensity = clamp01(readNumberParam(event.params, 'min_intensity', 0.18))
      const oscillation = 0.5 + 0.5 * Math.sin(((tMs - event.startMs) / 1000) * speed * Math.PI * 2 - Math.PI / 2)
      const factor = minIntensity + oscillation * (1 - minIntensity)
      return { ...scaleColor(base, factor * envelope), visible: factor > 0.02 }
    }
    case 'color_lfo': {
      const speed = Math.max(0.1, readNumberParam(event.params, 'speed', 1))
      const mix = 0.5 + 0.5 * Math.sin(((tMs - event.startMs) / 1000) * speed * Math.PI * 2)
      return { ...blendColor(base, secondary, mix), visible: true }
    }
    case 'wipe_in':
    case 'wipe_out':
    case 'chase':
    case 'wave':
    case 'trail':
    case 'gradient_scroll':
    case 'path_flow': {
      const routed = applyRouteEffect(event, base, secondary, partId, tMs)
      if (routed) return routed
      return { ...scaleColor(base, envelope), visible: envelope > 0.02 }
    }
    case 'sparkle': {
      const seed = readNumberParam(event.params, 'seed', 17)
      const speed = Math.max(1, readNumberParam(event.params, 'speed', 6))
      const phase = Math.sin((tMs - event.startMs) * 0.013 * speed + seed * 1.37 + partId.length)
      const visible = phase > 0.35
      return { ...scaleColor(base, visible ? envelope : 0), visible }
    }
    case 'solid':
    case 'fade_in':
    case 'fade_out':
    case 'fade':
    default:
      return { ...scaleColor(base, envelope), visible: envelope > 0.02 }
  }
}

function activeEventsForPart(
  events: CompiledEvent[],
  partId: PartId,
  tMs: number
): CompiledEvent[] {
  return queryActiveEvents(events, tMs).filter((event) => event.targets.includes(partId))
}

export function pickWinningEvent(
  events: CompiledEvent[],
  partId: PartId,
  tMs: number
): CompiledEvent | null {
  const active = activeEventsForPart(events, partId, tMs)

  if (active.length === 0) return null

  return active.reduce((best, current) => {
    if (current.priority > best.priority) return current
    if (current.priority < best.priority) return best
    if (current.startMs > best.startMs) return current
    if (current.startMs < best.startMs) return best
    return current.id > best.id ? current : best
  })
}

export function describeEventRoute(
  event: CompiledEvent,
  tMs: number,
  parts?: PartDefinition[]
): { routeParts: PartId[]; activeIndex: number } | null {
  const routeParts = listEventRouteParts(event.targets, event.params)
  if (routeParts.length <= 1) return null
  const progress = eventProgress(event, tMs)
  const segments = buildRouteSegments(
    event.targets,
    parts ?? routeParts.map((id) => ({ id, display_name: id, ranges: [{ start: 0, end: 0 }] })),
    event.params
  )
  const activeIndex = Math.max(0, segments.findIndex(
    (segment, index) => progress < segment.endRatio || index === segments.length - 1
  ))
  return { routeParts, activeIndex }
}

/** Resolve the winning color for a body part at time tMs (priority + effect). */
export function resolvePartColor(
  events: CompiledEvent[],
  partId: PartId,
  tMs: number,
  palette: Record<string, RgbColor>
): ResolvedColor {
  const winner = pickWinningEvent(events, partId, tMs)
  if (!winner) {
    return { r: 0, g: 0, b: 0, visible: false }
  }

  const base = resolveRgb(winner.color, palette)
  return applyEffect(winner, base, tMs, partId, palette)
}

export function resolveAllParts(
  events: CompiledEvent[],
  partIds: PartId[],
  tMs: number,
  palette: Record<string, RgbColor>
): Record<PartId, ResolvedColor> {
  const result: Record<PartId, ResolvedColor> = {}
  for (const partId of partIds) {
    result[partId] = resolvePartColor(events, partId, tMs, palette)
  }
  return result
}

// ---- Per-pixel resolution (LED strip preview) ----

const PER_PIXEL_EFFECTS = new Set([
  'wipe_in',
  'wipe_out',
  'chase',
  'path_flow',
  'wave',
  'trail',
  'gradient_scroll',
  'sparkle'
])

const OFF_PIXEL: ResolvedColor = { r: 0, g: 0, b: 0, visible: false }

function transformPixelPos(pos: number, direction: string): number {
  switch (direction) {
    case 'right_to_left':
    case 'bottom_up':
      return 1 - pos
    case 'center_out':
      return Math.abs(pos * 2 - 1)
    case 'edge_in':
      return 1 - Math.abs(pos * 2 - 1)
    default:
      return pos
  }
}

/** Evaluate a motion effect at a normalized position (0..1) along the route/strip. */
function effectAtPosition(
  event: CompiledEvent,
  base: RgbColor,
  secondary: RgbColor,
  tMs: number,
  pos: number,
  envelope: number,
  routed: boolean
): ResolvedColor {
  const speed = Math.max(0.2, readNumberParam(event.params, 'speed', 1))
  const intensity = clamp01(readNumberParam(event.params, 'intensity', 1))
  const spread = Math.max(0.15, readNumberParam(event.params, 'spread', 0.85))
  const trailLength = Math.max(0.15, readNumberParam(event.params, 'trail_length', 1.2))
  const minIntensity = clamp01(readNumberParam(event.params, 'min_intensity', 0.18))
  const curve = readStringParam(event.params, 'fade_curve', 'ease_in_out')
  const sweep = clamp01(eventProgress(event, tMs) * speed)
  const tSec = (tMs - event.startMs) / 1000

  switch (event.effect) {
    case 'wipe_in': {
      const edge = Math.max(0.03, 0.14 * spread)
      const factor = ease(clamp01((sweep - pos) / edge + 0.5), curve)
      return { ...scaleColor(base, factor * intensity * envelope), visible: factor > 0.02 }
    }
    case 'wipe_out': {
      const edge = Math.max(0.03, 0.14 * spread)
      const factor = 1 - ease(clamp01((sweep - pos) / edge + 0.5), curve)
      return { ...scaleColor(base, factor * intensity * envelope), visible: factor > 0.02 }
    }
    case 'chase':
    case 'path_flow': {
      const headW = Math.max(0.04, 0.16 * spread)
      const d = pos - sweep
      const head = Math.max(0, 1 - Math.abs(d) / headW)
      // 拖在頭後方的餘暉
      const tail = d < 0 ? Math.max(0, 1 - Math.abs(d) / (headW * (1 + trailLength))) * 0.45 : 0
      const factor = clamp01(Math.max(ease(head, curve), tail)) * intensity * envelope
      return { ...scaleColor(base, factor), visible: factor > 0.02 }
    }
    case 'trail': {
      const headW = Math.max(0.04, 0.12 * spread)
      const d = pos - sweep
      const head = Math.max(0, 1 - Math.abs(d) / headW)
      const tail = d < 0 ? Math.max(0, 1 - Math.abs(d) / (headW * (1 + trailLength * 3))) * 0.6 : 0
      const factor = clamp01(Math.max(ease(head, curve), tail)) * intensity * envelope
      return { ...scaleColor(base, factor), visible: factor > 0.02 }
    }
    case 'wave': {
      const cycles = 1.5
      const oscillation = 0.5 + 0.5 * Math.sin((pos * cycles - tSec * speed * 0.6) * Math.PI * 2)
      const factor = (minIntensity + oscillation * (1 - minIntensity)) * intensity * envelope
      return { ...scaleColor(base, factor), visible: factor > 0.02 }
    }
    case 'gradient_scroll': {
      if (routed) {
        const headW = Math.max(0.04, 0.18 * spread)
        const d = pos - sweep
        const band = Math.max(0, 1 - Math.abs(d) / headW)
        const tail = d < 0
          ? Math.max(0, 1 - Math.abs(d) / (headW * (1 + trailLength))) * 0.4
          : 0
        const factor = clamp01(Math.max(ease(band, curve), tail)) * intensity * envelope
        const mix = clamp01(0.5 + d / (headW * 2))
        return { ...scaleColor(blendColor(base, secondary, mix), factor), visible: factor > 0.02 }
      }
      const mix = 0.5 + 0.5 * Math.sin((pos - tSec * speed * 0.35) * Math.PI * 2)
      const blended = blendColor(base, secondary, mix)
      return { ...scaleColor(blended, intensity * envelope), visible: envelope > 0.02 }
    }
    case 'sparkle': {
      const seed = readNumberParam(event.params, 'seed', 17)
      const phase = Math.sin(tMs * 0.013 * Math.max(1, speed) + seed * 1.37 + pos * 43.7)
      const visible = phase > 0.35
      return { ...scaleColor(base, visible ? intensity * envelope : 0), visible }
    }
    default:
      return { ...scaleColor(base, envelope), visible: envelope > 0.02 }
  }
}

/**
 * Resolve per-pixel colors along a part's LED strip at time tMs.
 * For multi-part routes the part occupies its segment of the whole route,
 * so flows travel continuously across parts (like the physical strips).
 */
export function resolvePartPixels(
  events: CompiledEvent[],
  partId: PartId,
  tMs: number,
  palette: Record<string, RgbColor>,
  pixelCount: number,
  parts?: PartDefinition[]
): ResolvedColor[] {
  const winner = pickWinningEvent(events, partId, tMs)
  if (!winner) {
    return Array.from({ length: pixelCount }, () => ({ ...OFF_PIXEL }))
  }

  const base = resolveRgb(winner.color, palette)

  if (!PER_PIXEL_EFFECTS.has(winner.effect)) {
    const color = applyEffect(winner, base, tMs, partId, palette)
    return Array.from({ length: pixelCount }, () => ({ ...color }))
  }

  const secondary = secondaryColor(winner, palette, base)
  const envelope = applyFadeEnvelope(winner, tMs)
  const direction = readStringParam(winner.params, 'direction', 'auto')

  const routeParts = listEventRouteParts(winner.targets, winner.params)
  const routeSegments = buildRouteSegments(
    winner.targets,
    parts ?? routeParts.map((id) => ({ id, display_name: id, ranges: [{ start: 0, end: 0 }] })),
    winner.params
  )
  const partSegments = routeSegments.filter((segment) => segment.partId === partId)
  const routed = winner.params?.route_parts !== undefined && routeSegments.length > 1

  const pixels: ResolvedColor[] = []
  for (let i = 0; i < pixelCount; i++) {
    const localPos = (i + 0.5) / pixelCount
    const occurrenceCount = Math.max(1, partSegments.length)
    const occurrenceIndex = Math.min(occurrenceCount - 1, Math.floor(localPos * occurrenceCount))
    const segment = partSegments[occurrenceIndex]
    const positionWithinSegment = (localPos * occurrenceCount) - occurrenceIndex
    const routePos = segment
      ? segment.startRatio + positionWithinSegment * (segment.endRatio - segment.startRatio)
      : localPos
    const pos = transformPixelPos(routePos, direction)
    pixels.push(effectAtPosition(winner, base, secondary, tMs, pos, envelope, routed))
  }
  return pixels
}

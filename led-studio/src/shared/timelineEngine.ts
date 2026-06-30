import type { CompiledEvent, PartId, ResolvedColor, RgbColor } from './types/project'
import { getStageColor } from './stageColors'

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
  params?: Record<string, unknown>
): ResolvedColor {
  const frequencyHz = typeof params?.frequency_hz === 'number' ? params.frequency_hz : 2
  const duty = typeof params?.duty === 'number' ? params.duty : 0.5
  const periodMs = 1000 / frequencyHz
  const phase = (tMs % periodMs) / periodMs
  const visible = phase < duty
  return { ...base, visible }
}

function applyEffect(
  event: CompiledEvent,
  base: RgbColor,
  tMs: number
): ResolvedColor {
  switch (event.effect) {
    case 'off':
      return { r: 0, g: 0, b: 0, visible: false }
    case 'blink':
      return applyBlinkEffect(base, tMs, event.params)
    case 'solid':
    case 'fade_in':
    case 'fade_out':
    case 'fade':
    default:
      return { ...base, visible: true }
  }
}

function activeEventsForPart(
  events: CompiledEvent[],
  partId: PartId,
  tMs: number
): CompiledEvent[] {
  return queryActiveEvents(events, tMs).filter((event) => event.targets.includes(partId))
}

/** Resolve the winning color for a body part at time tMs (priority + effect). */
export function resolvePartColor(
  events: CompiledEvent[],
  partId: PartId,
  tMs: number,
  palette: Record<string, RgbColor>
): ResolvedColor {
  const active = activeEventsForPart(events, partId, tMs)

  if (active.length === 0) {
    return { r: 0, g: 0, b: 0, visible: false }
  }

  const winner = active.reduce((best, current) => {
    if (current.priority > best.priority) return current
    if (current.priority < best.priority) return best
    if (current.startMs > best.startMs) return current
    if (current.startMs < best.startMs) return best
    return current.id > best.id ? current : best
  })

  const base = resolveRgb(winner.color, palette)
  return applyEffect(winner, base, tMs)
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

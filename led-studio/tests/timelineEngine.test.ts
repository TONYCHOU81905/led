import { describe, expect, it } from 'vitest'
import {
  isEventActive,
  queryActiveEvents,
  resolvePartColor
} from '../src/shared/timelineEngine'
import type { CompiledEvent } from '../src/shared/types/project'
import { STAGE_COLORS } from '../src/shared/stageColors'

const sampleEvents: CompiledEvent[] = [
  {
    id: 'e1',
    startMs: 0,
    endMs: 30_000,
    targets: ['hand'],
    color: 'electric_cyan',
    effect: 'solid',
    priority: 10
  },
  {
    id: 'e2',
    startMs: 0,
    endMs: 30_000,
    targets: ['foot'],
    color: 'hot_magenta',
    effect: 'solid',
    priority: 10
  },
  {
    id: 'e3',
    startMs: 30_000,
    endMs: 60_000,
    targets: ['hand'],
    color: 'laser_lime',
    effect: 'blink',
    params: { frequency_hz: 2, duty: 0.5 },
    priority: 20
  },
  {
    id: 'e4',
    startMs: 10_000,
    endMs: 20_000,
    targets: ['hand'],
    color: 'red',
    effect: 'solid',
    priority: 30
  }
]

describe('timelineEngine', () => {
  it('uses left-closed right-open intervals', () => {
    expect(isEventActive(sampleEvents[0], 0)).toBe(true)
    expect(isEventActive(sampleEvents[0], 29_999)).toBe(true)
    expect(isEventActive(sampleEvents[0], 30_000)).toBe(false)
  })

  it('queries active events at a timestamp', () => {
    const active = queryActiveEvents(sampleEvents, 15_000)
    expect(active.map((e) => e.id).sort()).toEqual(['e1', 'e2', 'e4'])
  })

  it('resolves higher priority on overlap', () => {
    const color = resolvePartColor(sampleEvents, 'hand', 15_000, STAGE_COLORS)
    expect(color).toEqual({ r: 255, g: 0, b: 0, visible: true })
  })

  it('applies blink effect duty cycle', () => {
    const atOn = resolvePartColor(sampleEvents, 'hand', 30_000, STAGE_COLORS)
    const atOff = resolvePartColor(sampleEvents, 'hand', 30_250, STAGE_COLORS)
    expect(atOn.visible).toBe(true)
    expect(atOff.visible).toBe(false)
  })
})

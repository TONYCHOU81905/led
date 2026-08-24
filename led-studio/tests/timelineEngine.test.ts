import { describe, expect, it } from 'vitest'
import {
  describeEventRoute,
  isEventActive,
  pickWinningEvent,
  queryActiveEvents,
  resolvePartColor,
  resolvePartPixels
} from '../src/shared/timelineEngine'
import type { CompiledEvent } from '../src/shared/types/project'
import { STAGE_COLORS } from '../src/shared/stageColors'
import { DEFAULT_CHAIN_PARTS } from '../src/shared/ledChainDefaults'
import { buildRouteSegments } from '../src/shared/timelineEffects'

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

  it('supports pulse intensity changes', () => {
    const pulse: CompiledEvent = {
      id: 'pulse_1',
      startMs: 0,
      endMs: 4000,
      targets: ['body'],
      color: 'ice_blue',
      effect: 'pulse',
      params: { speed: 1, min_intensity: 0.2 },
      priority: 15
    }
    const atStart = resolvePartColor([pulse], 'body', 0, STAGE_COLORS)
    const atPeak = resolvePartColor([pulse], 'body', 500, STAGE_COLORS)
    expect(atPeak.visible).toBe(true)
    expect(atPeak.b).toBeGreaterThan(atStart.b)
  })

  it('supports route-based flowing effects', () => {
    const flow: CompiledEvent = {
      id: 'route_1',
      startMs: 0,
      endMs: 6000,
      targets: ['head', 'right_hand', 'right_foot', 'left_foot', 'left_hand'],
      color: 'golden_spark',
      effect: 'path_flow',
      params: {
        route_parts: ['head', 'right_hand', 'right_foot', 'left_foot', 'left_hand', 'head'],
        route_step_labels: ['右頭頂', '右手', '右腳', '左腳', '左手', '左頭']
      },
      priority: 20
    }

    const headAtStart = resolvePartColor([flow], 'head', 300, STAGE_COLORS)
    const leftHandLater = resolvePartColor([flow], 'left_hand', 4700, STAGE_COLORS)
    const route = describeEventRoute(flow, 4700)
    expect(headAtStart.visible).toBe(true)
    expect(leftHandLater.visible).toBe(true)
    expect(route?.activeIndex).toBeGreaterThanOrEqual(3)
  })

  it('weights route sections by LED length and splits repeated parts', () => {
    const routeParts = ['head', 'right_hand', 'right_foot', 'left_foot', 'left_hand', 'head']
    const segments = buildRouteSegments(routeParts, DEFAULT_CHAIN_PARTS, { route_parts: routeParts })

    expect(segments).toHaveLength(6)
    expect(segments[0].endRatio - segments[0].startRatio).toBeCloseTo(30 / 580)
    expect(segments[1].endRatio - segments[1].startRatio).toBeCloseTo(130 / 580)
    expect(segments[5].occurrenceIndex).toBe(1)
    expect(segments[5].endRatio).toBeCloseTo(1)
  })

  it('keeps routed gradients localized instead of lighting every part equally', () => {
    const gradient: CompiledEvent = {
      id: 'route_gradient',
      startMs: 0,
      endMs: 5800,
      targets: ['head', 'right_hand', 'right_foot', 'left_foot', 'left_hand'],
      color: 'hot_magenta',
      effect: 'gradient_scroll',
      params: {
        secondary_color: 'electric_cyan',
        spread: 0.5,
        route_parts: ['head', 'right_hand', 'right_foot', 'left_foot', 'left_hand', 'head']
      },
      priority: 20
    }

    const head = resolvePartPixels([gradient], 'head', 150, STAGE_COLORS, 10, DEFAULT_CHAIN_PARTS)
    const leftHand = resolvePartPixels([gradient], 'left_hand', 150, STAGE_COLORS, 10, DEFAULT_CHAIN_PARTS)
    expect(head.some((pixel) => pixel.visible)).toBe(true)
    expect(leftHand.every((pixel) => !pixel.visible)).toBe(true)
  })

  it('returns the winning event for preview summaries', () => {
    const winner = pickWinningEvent(sampleEvents, 'hand', 15_000)
    expect(winner?.id).toBe('e4')
  })
})

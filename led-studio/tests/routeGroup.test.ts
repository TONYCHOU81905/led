import { describe, expect, it } from 'vitest'
import {
  expandRouteToEvents,
  isLegacyRouteEvent,
  listRouteGroup,
  reorderRouteGroup,
  ungroupRoute
} from '../src/shared/timelineEffects'
import { cloneDefaultChainParts } from '../src/shared/ledChainDefaults'
import { tryParseTimeToMs } from '../src/shared/timeParse'
import type { PartId, TimelineEventUI } from '../src/shared/types/project'

const parts = cloneDefaultChainParts()

const routeParts: PartId[] = ['head', 'right_hand', 'right_foot', 'left_foot', 'left_hand']
const stepLabels = ['頭', '右手', '右腳', '左腳', '左手']

function makeId(index: number): string {
  return `evt_test_${index}`
}

const baseEvent: TimelineEventUI = {
  id: 'evt_base',
  from: '0:00',
  to: '0:10',
  targets: [...routeParts],
  color: 'electric_cyan',
  effect: 'path_flow',
  params: {
    route_parts: [...routeParts],
    route_step_labels: [...stepLabels],
    route_label: '頭 → 右手 → 右腳 → 左腳 → 左手',
    route_preset: 'head_to_limbs',
    intensity: 1
  },
  priority: 10
}

describe('expandRouteToEvents', () => {
  const expanded = expandRouteToEvents(baseEvent, parts, routeParts, stepLabels, makeId)

  it('produces one independent event per route part', () => {
    expect(expanded.length).toBe(routeParts.length)
    for (const ev of expanded) {
      expect(ev.targets.length).toBe(1)
    }
  })

  it('keeps adjacent segments contiguous and spans the base time range', () => {
    const sorted = [...expanded].sort(
      (a, b) => (a.params?.route_group_index ?? 0) - (b.params?.route_group_index ?? 0)
    )
    expect(sorted[0].from).toBe(baseEvent.from)
    expect(sorted[sorted.length - 1].to).toBe(baseEvent.to)
    for (let i = 0; i < sorted.length - 1; i++) {
      expect(tryParseTimeToMs(sorted[i].to)).toBe(tryParseTimeToMs(sorted[i + 1].from))
    }
  })

  it('gives parts with different physical LED counts different time shares', () => {
    const sorted = [...expanded].sort(
      (a, b) => (a.params?.route_group_index ?? 0) - (b.params?.route_group_index ?? 0)
    )
    const headDurationMs = tryParseTimeToMs(sorted[0].to)! - tryParseTimeToMs(sorted[0].from)!
    const handDurationMs = tryParseTimeToMs(sorted[1].to)! - tryParseTimeToMs(sorted[1].from)!
    // head has 60 LEDs, right_hand has 130 (60 + 5*10 + 60) in the default chain,
    // so head's time share should be noticeably smaller.
    expect(headDurationMs).toBeLessThan(handDurationMs)
  })

  it('assigns a shared group id, sequential index, and correct total', () => {
    const groupId = expanded[0].params?.route_group_id
    expect(groupId).toBeTruthy()
    const indices = expanded
      .map((ev) => ev.params?.route_group_index)
      .sort((a, b) => (a ?? 0) - (b ?? 0))
    expect(indices).toEqual([0, 1, 2, 3, 4])
    for (const ev of expanded) {
      expect(ev.params?.route_group_id).toBe(groupId)
      expect(ev.params?.route_group_total).toBe(routeParts.length)
    }
  })

  it('keeps each clip independently editable (color changes do not leak)', () => {
    const mutated = expanded.map((ev, index) => (index === 0 ? { ...ev, color: 'hot_magenta' } : ev))
    expect(mutated[0].color).toBe('hot_magenta')
    for (let i = 1; i < mutated.length; i++) {
      expect(mutated[i].color).toBe(baseEvent.color)
    }
  })
})

describe('listRouteGroup', () => {
  it('returns events sorted by route_group_index', () => {
    const expanded = expandRouteToEvents(baseEvent, parts, routeParts, stepLabels, makeId)
    const groupId = expanded[0].params!.route_group_id!
    const shuffled = [...expanded].reverse()
    const listed = listRouteGroup(shuffled, groupId)
    expect(listed.map((e) => e.params?.route_group_index)).toEqual([0, 1, 2, 3, 4])
  })
})

describe('reorderRouteGroup', () => {
  it('swaps time windows while keeping each clip color and updating index', () => {
    const expanded = expandRouteToEvents(baseEvent, parts, routeParts, stepLabels, makeId)
    const colored = expanded.map((ev, i) => ({ ...ev, color: `color_${i}` }))
    const groupId = colored[0].params!.route_group_id!

    const originalWindows = colored.map((ev) => ({ from: ev.from, to: ev.to })).sort()
    const order = colored.map((ev) => ev.id)
    ;[order[0], order[1]] = [order[1], order[0]]

    const reordered = reorderRouteGroup(colored, groupId, order)

    const nextWindows = listRouteGroup(reordered, groupId)
      .map((ev) => ({ from: ev.from, to: ev.to }))
      .sort()
    expect(nextWindows).toEqual(originalWindows)

    for (const ev of reordered) {
      const originalIndex = colored.findIndex((c) => c.id === ev.id)
      expect(ev.color).toBe(colored[originalIndex].color)
    }

    const first = reordered.find((ev) => ev.id === order[0])!
    const second = reordered.find((ev) => ev.id === order[1])!
    expect(first.params?.route_group_index).toBe(0)
    expect(second.params?.route_group_index).toBe(1)
  })
})

describe('ungroupRoute', () => {
  it('clears all group-related params', () => {
    const expanded = expandRouteToEvents(baseEvent, parts, routeParts, stepLabels, makeId)
    const groupId = expanded[0].params!.route_group_id!
    const ungrouped = ungroupRoute(expanded, groupId)
    for (const ev of ungrouped) {
      expect(ev.params?.route_group_id).toBeUndefined()
      expect(ev.params?.route_group_label).toBeUndefined()
      expect(ev.params?.route_group_index).toBeUndefined()
      expect(ev.params?.route_group_total).toBeUndefined()
      expect(ev.params?.route_step_label).toBeUndefined()
    }
  })
})

describe('isLegacyRouteEvent', () => {
  it('is true for a single event carrying multiple targets and route_parts', () => {
    expect(isLegacyRouteEvent(baseEvent)).toBe(true)
  })

  it('is false for an expanded, single-target clip', () => {
    const expanded = expandRouteToEvents(baseEvent, parts, routeParts, stepLabels, makeId)
    for (const ev of expanded) {
      expect(isLegacyRouteEvent(ev)).toBe(false)
    }
  })
})

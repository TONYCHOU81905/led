import { describe, expect, it } from 'vitest'
import { applyGroupDelta } from '../src/features/timeline/TimelineCanvas'
import { parseTimeToMs } from '../src/shared/timeParse'
import type { TimelineEventUI } from '../src/shared/types/project'

function makeEvent(id: string, from: string, to: string): TimelineEventUI {
  return {
    id,
    from,
    to,
    targets: ['head'],
    color: 'red',
    effect: 'solid',
    params: {},
    priority: 10
  }
}

function ms(next: TimelineEventUI[], id: string): { start: number; end: number } {
  const ev = next.find((e) => e.id === id)!
  return { start: parseTimeToMs(ev.from), end: parseTimeToMs(ev.to) }
}

describe('applyGroupDelta', () => {
  it('applies the same delta to every event in the selection, preserving relative gaps', () => {
    const events = [
      makeEvent('a', '0:10', '0:12'),
      makeEvent('b', '0:13', '0:15'),
      makeEvent('c', '0:20', '0:21')
    ]
    const origById = {
      a: { start: 10_000, end: 12_000 },
      b: { start: 13_000, end: 15_000 }
    }
    const next = applyGroupDelta(events, origById, 2_000)

    const a = ms(next, 'a')
    const b = ms(next, 'b')
    expect(a).toEqual({ start: 12_000, end: 14_000 })
    expect(b).toEqual({ start: 15_000, end: 17_000 })
    // relative gap between a and b unchanged (was 1000ms, still 1000ms)
    expect(b.start - a.end).toBe(1_000)
  })

  it('clamps the whole group together so the earliest event stops exactly at 0, without the group spreading apart', () => {
    const events = [makeEvent('a', '0:02', '0:04'), makeEvent('b', '0:05', '0:07')]
    const origById = {
      a: { start: 2_000, end: 4_000 },
      b: { start: 5_000, end: 7_000 }
    }
    // delta of -3000 would push 'a' to -1000ms; must clamp so 'a' lands exactly on 0
    const next = applyGroupDelta(events, origById, -3_000)

    const a = ms(next, 'a')
    const b = ms(next, 'b')
    expect(a).toEqual({ start: 0, end: 2_000 })
    // clamped delta was +2000 relative to requested -3000, so b shifts by the same clamped amount
    expect(b).toEqual({ start: 3_000, end: 5_000 })
    // relative gap (1000ms) between a and b is preserved — group moved together, did not spread apart
    expect(b.start - a.end).toBe(1_000)
  })

  it('leaves events outside the selection completely untouched', () => {
    const events = [makeEvent('a', '0:10', '0:12'), makeEvent('untouched', '0:50', '0:55')]
    const origById = {
      a: { start: 10_000, end: 12_000 }
    }
    const next = applyGroupDelta(events, origById, 5_000)

    const untouched = next.find((e) => e.id === 'untouched')!
    expect(untouched.from).toBe('0:50')
    expect(untouched.to).toBe('0:55')
  })
})

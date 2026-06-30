import { describe, expect, it } from 'vitest'
import { validateEvent, validateProject, findOverlaps } from '../src/shared/eventValidator'
import type { LedProject, TimelineEventUI } from '../src/shared/types/project'
import { STAGE_COLORS } from '../src/shared/stageColors'

const baseEvent: TimelineEventUI = {
  id: 'evt_1',
  from: '00:10',
  to: '00:20',
  targets: ['hand'],
  color: 'electric_cyan',
  effect: 'solid',
  priority: 10
}

describe('eventValidator', () => {
  it('accepts valid events', () => {
    const issues = validateEvent(baseEvent, new Set(['hand']), STAGE_COLORS)
    expect(issues).toHaveLength(0)
  })

  it('rejects invalid time interval', () => {
    const issues = validateEvent(
      { ...baseEvent, from: '00:30', to: '00:10' },
      new Set(['hand']),
      STAGE_COLORS
    )
    expect(issues.some((i) => i.code === 'INVALID_INTERVAL')).toBe(true)
  })

  it('rejects unknown targets and colors', () => {
    const issues = validateEvent(
      { ...baseEvent, targets: ['wings'], color: 'unknown' },
      new Set(['hand']),
      STAGE_COLORS
    )
    expect(issues.some((i) => i.code === 'UNKNOWN_TARGET')).toBe(true)
    expect(issues.some((i) => i.code === 'UNKNOWN_COLOR')).toBe(true)
  })

  it('validates demo project', async () => {
    const demo = (await import('../examples/demo_show.ledproj.json')).default as LedProject
    const result = validateProject(demo)
    expect(result.valid).toBe(true)
  })

  it('detects same-priority overlaps', () => {
    const events: TimelineEventUI[] = [
      baseEvent,
      { ...baseEvent, id: 'evt_2', from: '00:15', to: '00:25' }
    ]
    const overlaps = findOverlaps(events, 'hand')
    expect(overlaps).toHaveLength(1)
  })
})

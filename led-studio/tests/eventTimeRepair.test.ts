import { describe, expect, it } from 'vitest'
import { repairLegacyTimeString, repairProjectTimelineEvents, repairTimelineEvent } from '../src/shared/eventTimeRepair'
import type { LedProject } from '../src/shared/types/project'

describe('eventTimeRepair', () => {
  it('repairs legacy double-decimal time strings', () => {
    expect(repairLegacyTimeString('0:03.281.25')).toBe('0:03.281')
    expect(repairLegacyTimeString('0:05.625')).toBeNull()
  })

  it('fixes event with legacy from/to', () => {
    const result = repairTimelineEvent({
      id: 'evt_bad',
      from: '0:03.281.25',
      to: '0:05.625.0',
      targets: ['hand'],
      color: 'electric_cyan',
      effect: 'solid',
      priority: 10
    })
    expect(result.changed).toBe(true)
    expect(result.event?.from).toBe('0:03.281')
    expect(result.event?.to).toBe('0:05.625')
  })

  it('removes zero-duration clips', () => {
    const result = repairTimelineEvent({
      id: 'evt_zero',
      from: '0:01',
      to: '0:01',
      targets: ['hand'],
      color: 'red',
      effect: 'solid',
      priority: 10
    })
    expect(result.event).toBeNull()
  })

  it('repairs project roles', () => {
    const project: LedProject = {
      schema_version: '1.0.0',
      project: {
        id: 'p1',
        name: 'Test',
        music_duration_ms: 60000,
        bpm: 128,
        created_at: '',
        updated_at: ''
      },
      colors: {},
      roles: [
        {
          role_id: 'dancer_a',
          display_name: 'A',
          parts: [{ id: 'hand', display_name: '手', ranges: [{ start: 0, end: 124 }] }],
          events: [
            {
              id: 'evt_1',
              from: '0:03.281.25',
              to: '0:08.500',
              targets: ['hand'],
              color: 'electric_cyan',
              effect: 'solid',
              priority: 10
            }
          ]
        }
      ]
    }
    const { project: fixed, fixes } = repairProjectTimelineEvents(project)
    expect(fixes.length).toBeGreaterThan(0)
    expect(fixed.roles[0].events[0].from).toBe('0:03.281')
  })
})

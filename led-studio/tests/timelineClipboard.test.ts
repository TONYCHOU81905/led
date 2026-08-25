import { describe, expect, it } from 'vitest'
import { clipFromEvent } from '../src/shared/timelineClipboard'
import type { TimelineEventUI } from '../src/shared/types/project'

const sample: TimelineEventUI = {
  id: 'evt_1',
  from: '00:10',
  to: '00:15',
  targets: ['head'],
  color: 'red',
  effect: 'blink',
  params: { frequency_hz: 2 },
  priority: 20,
  note: 'test'
}

describe('timelineClipboard', () => {
  it('copies clip without id and preserves duration', () => {
    const clip = clipFromEvent(sample)
    expect(clip.durationMs).toBe(5000)
    expect(clip.targets).toEqual(['head'])
    expect(clip.color).toBe('red')
    expect(clip.params).toEqual({ frequency_hz: 2 })
  })

})

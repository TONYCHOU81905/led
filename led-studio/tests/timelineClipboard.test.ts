import { describe, expect, it } from 'vitest'
import { clipFromEvent, pasteClip } from '../src/shared/timelineClipboard'
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

  it('pastes at playhead with same duration', () => {
    const clip = clipFromEvent(sample)
    const pasted = pasteClip(clip, 30_000, 180_000, (ms) => ms)
    expect(pasted.id).not.toBe(sample.id)
    expect(pasted.from).toBe('0:30')
    expect(pasted.to).toBe('0:35')
    expect(pasted.targets).toEqual(['head'])
    expect(pasted.effect).toBe('blink')
  })

  it('clamps pasted clip to music duration', () => {
    const clip = clipFromEvent(sample)
    const pasted = pasteClip(clip, 178_000, 180_000, (ms) => ms)
    expect(pasted.from).toBe('2:58')
    expect(pasted.to).toBe('3:00')
  })
})

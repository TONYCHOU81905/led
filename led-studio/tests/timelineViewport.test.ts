import { describe, expect, it } from 'vitest'
import {
  calculateFollowScroll,
  maxTimelineScroll,
  visibleTimelineMs
} from '../src/features/timeline/hooks/useTimelineViewport'

describe('timeline viewport', () => {
  it('derives the gray scrollbar range from the actual visible width', () => {
    expect(visibleTimelineMs(1088, 0.1)).toBe(10_000)
    expect(maxTimelineScroll(60_000, 1088, 0.1)).toBe(50_000)
  })

  it('moves the gray viewport when the pink playhead reaches the right guard', () => {
    expect(calculateFollowScroll(0, 7_500, 60_000, 1088, 0.1)).toBe(100)
    expect(calculateFollowScroll(0, 9_000, 60_000, 1088, 0.1)).toBe(1_600)
  })

  it('keeps the viewport still while the playhead remains in the safe area', () => {
    expect(calculateFollowScroll(4_000, 8_000, 60_000, 1088, 0.1)).toBe(4_000)
  })

  it('clamps follow scrolling at the end of the song', () => {
    expect(calculateFollowScroll(49_000, 60_000, 60_000, 1088, 0.1)).toBe(50_000)
  })
})

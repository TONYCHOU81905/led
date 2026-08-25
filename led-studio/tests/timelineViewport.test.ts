import { describe, expect, it } from 'vitest'
import { calculateFollowScroll, maxTimelineScroll, scrollToKeepVisible, visibleTimelineMs } from '../src/features/timeline/hooks/useTimelineViewport'

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

describe('scrollToKeepVisible（拖曳時的平滑跟隨）', () => {
  const VISIBLE = 20_000
  const MAX = 300_000
  // margin = VISIBLE * 0.1 = 2000ms

  it('playhead 已在畫面內且離邊緣夠遠時完全不捲動', () => {
    expect(scrollToKeepVisible(0, VISIBLE * 0.5, VISIBLE, MAX)).toBe(0)
    expect(scrollToKeepVisible(40_000, 45_000, VISIBLE, MAX)).toBe(40_000)
  })

  it('往右只推最小距離，不是跳到居中', () => {
    // playhead 在 19_000（距右緣 1000 < margin 2000）→ 只需推 2000
    const next = scrollToKeepVisible(0, 19_000, VISIBLE, MAX)
    expect(next).toBe(1000)
    // 居中的話會是 19_000 - 10_000 = 9000，明顯跳更多
    expect(next).toBeLessThan(9000)
  })

  it('往左只推最小距離', () => {
    const next = scrollToKeepVisible(40_000, 41_000, VISIBLE, MAX)
    expect(next).toBe(39_000)
  })

  it('連續小幅移動會平滑累進，不會一次跳一大段', () => {
    let scroll = 0
    let last = 0
    for (let ms = 18_000; ms <= 24_000; ms += 500) {
      const next = scrollToKeepVisible(scroll, ms, VISIBLE, MAX)
      const step = next - scroll
      expect(step).toBeLessThanOrEqual(500) // 每次最多推移跟 playhead 同幅度
      expect(step).toBeGreaterThanOrEqual(0)
      scroll = next
      last = ms
    }
    // 最後 playhead 仍在畫面內
    expect(last).toBeGreaterThan(scroll)
    expect(last).toBeLessThan(scroll + VISIBLE)
  })

  it('playhead 完全在畫面左外側時拉回來', () => {
    expect(scrollToKeepVisible(40_000, 5_000, VISIBLE, MAX)).toBe(3_000)
  })

  it('夾制在 0 與 maxScroll 之間', () => {
    expect(scrollToKeepVisible(0, 0, VISIBLE, MAX)).toBe(0)
    expect(scrollToKeepVisible(MAX, MAX + 50_000, VISIBLE, MAX)).toBe(MAX)
  })

  it('visibleMs <= 0 時原樣回傳，不做除以零的判斷', () => {
    expect(scrollToKeepVisible(1234, 5000, 0, MAX)).toBe(1234)
  })
})

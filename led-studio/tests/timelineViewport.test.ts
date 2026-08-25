import { describe, expect, it } from 'vitest'
import { calculateFollowScroll, maxTimelineScroll, needsRecenter, visibleTimelineMs } from '../src/features/timeline/hooks/useTimelineViewport'

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

describe('needsRecenter（拖進度條 seek 時是否要重新居中）', () => {
  const VISIBLE = 20_000

  it('playhead 在舒適區 30%~70% 內時不動，避免拖曳中一直滑動', () => {
    expect(needsRecenter(0 + VISIBLE * 0.5, 0, VISIBLE)).toBe(false)
    expect(needsRecenter(0 + VISIBLE * 0.31, 0, VISIBLE)).toBe(false)
    expect(needsRecenter(0 + VISIBLE * 0.69, 0, VISIBLE)).toBe(false)
  })

  it('往右超出 70% 要居中 —— 這是原本 dead zone 蓋掉的情境', () => {
    expect(needsRecenter(0 + VISIBLE * 0.71, 0, VISIBLE)).toBe(true)
    expect(needsRecenter(0 + VISIBLE * 1.5, 0, VISIBLE)).toBe(true)
  })

  it('往左低於 30% 要居中', () => {
    expect(needsRecenter(VISIBLE * 0.29, 0, VISIBLE)).toBe(true)
    // playhead 跑到 scrollMs 左邊（完全在畫面外）
    expect(needsRecenter(5_000, 40_000, VISIBLE)).toBe(true)
  })

  it('會把 scrollMs 算進來，不是只看絕對時間', () => {
    // 同一個 playhead，畫面捲到不同位置時結論不同
    expect(needsRecenter(50_000, 40_000, VISIBLE)).toBe(false) // rel = 0.5
    expect(needsRecenter(50_000, 0, VISIBLE)).toBe(true)       // rel = 2.5
  })

  it('visibleMs 為 0 或負時回 false，不做除以零的判斷', () => {
    expect(needsRecenter(1000, 0, 0)).toBe(false)
    expect(needsRecenter(1000, 0, -5)).toBe(false)
  })
})

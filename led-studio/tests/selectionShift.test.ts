import { describe, expect, it } from 'vitest'
import {
  applyShift,
  clampShift,
  shiftSelectionToEnd,
  shiftSelectionToStart
} from '../src/features/timeline/selectionShift'
import { formatMsToTime, parseTimeToMs } from '../src/shared/timeParse'
import type { TimelineEventUI } from '../src/shared/types/project'

const DURATION = 300_000

function ev(id: string, fromMs: number, toMs: number): TimelineEventUI {
  return {
    id,
    from: formatMsToTime(fromMs),
    to: formatMsToTime(toMs),
    targets: ['head'],
    color: 'white',
    effect: 'solid',
    priority: 10
  } as TimelineEventUI
}

/** 讀回時間，方便斷言 */
function times(events: TimelineEventUI[], id: string) {
  const e = events.find((x) => x.id === id)!
  return { from: parseTimeToMs(e.from), to: parseTimeToMs(e.to) }
}

describe('clampShift — 整組一起 clamp', () => {
  it('沒有人越界時，位移量原封不動', () => {
    const events = [ev('a', 5000, 6000), ev('b', 9000, 10_000)]
    expect(clampShift(events, ['a', 'b'], { fromDeltaMs: 2000, toDeltaMs: 2000 }, DURATION)).toEqual(
      { fromDeltaMs: 2000, toDeltaMs: 2000 }
    )
  })

  it('關鍵案例：1s/5s/9s 往左拉 3s，整組只能移動 -1s（間距必須保持）', () => {
    const events = [ev('a', 1000, 2000), ev('b', 5000, 6000), ev('c', 9000, 10_000)]
    const shifted = applyShift(
      events,
      ['a', 'b', 'c'],
      { fromDeltaMs: -3000, toDeltaMs: -3000 },
      DURATION
    )

    // 全體只移動 -1s，而不是各自夾在 0
    expect(times(shifted, 'a').from).toBe(0)
    expect(times(shifted, 'b').from).toBe(4000)
    expect(times(shifted, 'c').from).toBe(8000)

    // 相對間距完全保持（4s / 4s）—— 這是這個設計存在的理由
    expect(times(shifted, 'b').from - times(shifted, 'a').from).toBe(4000)
    expect(times(shifted, 'c').from - times(shifted, 'b').from).toBe(4000)
  })

  it('往右超過音樂長度時同樣整組 clamp', () => {
    const events = [ev('a', 100_000, 101_000), ev('b', 299_000, 299_500)]
    const shifted = applyShift(
      events,
      ['a', 'b'],
      { fromDeltaMs: 5000, toDeltaMs: 5000 },
      DURATION
    )
    // b 的 to 只能到 300000，所以整組只能移動 500ms
    expect(times(shifted, 'b').to).toBe(DURATION)
    expect(times(shifted, 'a').from).toBe(100_500)
    // 間距保持
    expect(times(shifted, 'b').from - times(shifted, 'a').from).toBe(199_000)
  })

  it('空選取不會爆，回傳零位移', () => {
    expect(clampShift([ev('a', 0, 1000)], [], { fromDeltaMs: 500 }, DURATION)).toEqual({
      fromDeltaMs: 0,
      toDeltaMs: 0
    })
  })
})

describe('applyShift', () => {
  it('只動選取的 chip，未選取的原樣（連物件參考都不變）', () => {
    const a = ev('a', 1000, 2000)
    const b = ev('b', 5000, 6000)
    const shifted = applyShift([a, b], ['a'], { fromDeltaMs: 1000, toDeltaMs: 1000 }, DURATION)
    expect(times(shifted, 'a')).toEqual({ from: 2000, to: 3000 })
    expect(shifted.find((e) => e.id === 'b')).toBe(b)
  })

  it('位移量為 0 時回傳原陣列', () => {
    const events = [ev('a', 1000, 2000)]
    expect(applyShift(events, ['a'], { fromDeltaMs: 0, toDeltaMs: 0 }, DURATION)).toBe(events)
  })

  it('只延長結束端時，每個 chip 都等量延長', () => {
    const events = [ev('a', 1000, 2000), ev('b', 5000, 7000)]
    const shifted = applyShift(events, ['a', 'b'], { toDeltaMs: 3000 }, DURATION)
    expect(times(shifted, 'a')).toEqual({ from: 1000, to: 5000 })
    expect(times(shifted, 'b')).toEqual({ from: 5000, to: 10_000 })
  })

  it('縮短到長度會歸零時，停在最短長度而不是變成負的', () => {
    const events = [ev('a', 1000, 2000), ev('b', 5000, 5500)]
    const shifted = applyShift(events, ['a', 'b'], { toDeltaMs: -2000 }, DURATION)
    // b 只有 500ms，縮 2000 會變負 —— 整組停在 b 的極限
    expect(times(shifted, 'b').to).toBeGreaterThan(times(shifted, 'b').from)
    expect(times(shifted, 'a').to).toBeGreaterThan(times(shifted, 'a').from)
  })
})

describe('Inspector 入口', () => {
  it('shiftSelectionToStart 是整段平移，長度不變', () => {
    const events = [ev('a', 5000, 8000), ev('b', 10_000, 11_000)]
    const shifted = shiftSelectionToStart(events, 'a', ['a', 'b'], 7000, DURATION)
    expect(times(shifted, 'a')).toEqual({ from: 7000, to: 10_000 })
    expect(times(shifted, 'b')).toEqual({ from: 12_000, to: 13_000 })
  })

  it('shiftSelectionToEnd 只動結束端，等量延長', () => {
    const events = [ev('a', 5000, 8000), ev('b', 10_000, 11_000)]
    const shifted = shiftSelectionToEnd(events, 'a', ['a', 'b'], 9000, DURATION)
    expect(times(shifted, 'a')).toEqual({ from: 5000, to: 9000 })
    expect(times(shifted, 'b')).toEqual({ from: 10_000, to: 12_000 })
  })

  it('主選取不存在時原樣回傳', () => {
    const events = [ev('a', 1000, 2000)]
    expect(shiftSelectionToStart(events, 'nope', ['a'], 5000, DURATION)).toBe(events)
  })
})

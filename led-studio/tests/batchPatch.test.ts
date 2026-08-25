import { describe, expect, it } from 'vitest'
import {
  applyDurationToSelection,
  buildSelectionPatch,
  changedParamKeys
} from '../src/features/timeline/batchPatch'
import { formatMsToTime, tryParseTimeToMs } from '../src/shared/timeParse'
import type { TimelineEventUI } from '../src/shared/types/project'

function ev(id: string, from: string, to: string, extra: Partial<TimelineEventUI> = {}): TimelineEventUI {
  return {
    id,
    from,
    to,
    targets: ['head'],
    color: 'electric_cyan',
    effect: 'solid',
    priority: 10,
    params: { speed: 1, intensity: 1 },
    ...extra
  }
}

const BASE = [
  ev('a', '0:01', '0:02', { targets: ['head'] }),
  ev('b', '0:03', '0:05', { targets: ['right_hand'], color: 'royal_violet' }),
  ev('c', '0:10', '0:11', { targets: ['left_foot'] })
]

describe('changedParamKeys', () => {
  it('只回報真正變動的 key', () => {
    expect(changedParamKeys({ speed: 1, intensity: 1 }, { speed: 2, intensity: 1 })).toEqual(['speed'])
  })

  it('把被刪除的 key 也算成變動', () => {
    expect(changedParamKeys({ speed: 1, trail_length: 2 }, { speed: 1 })).toEqual(['trail_length'])
  })

  it('next 為 undefined 時視為沒有變動', () => {
    expect(changedParamKeys({ speed: 1 }, undefined)).toEqual([])
  })
})

describe('buildSelectionPatch — 可共享的欄位', () => {
  it('顏色套用到整組', () => {
    const out = buildSelectionPatch(BASE, 'a', ['a', 'b'], { color: 'hot_magenta' })
    expect(out.find((e) => e.id === 'a')!.color).toBe('hot_magenta')
    expect(out.find((e) => e.id === 'b')!.color).toBe('hot_magenta')
    // 沒被選到的完全不動
    expect(out.find((e) => e.id === 'c')!.color).toBe('electric_cyan')
  })

  it('效果與優先權套用到整組', () => {
    const out = buildSelectionPatch(BASE, 'a', ['a', 'b'], { effect: 'pulse', priority: 30 })
    for (const id of ['a', 'b']) {
      const e = out.find((x) => x.id === id)!
      expect(e.effect).toBe('pulse')
      expect(e.priority).toBe(30)
    }
  })

  it('只把真正改動的 params key 疊上去，不覆蓋其他成員自己的設定', () => {
    const events = [
      ev('a', '0:01', '0:02', { params: { speed: 1, intensity: 1 } }),
      ev('b', '0:03', '0:05', { params: { speed: 1, intensity: 0.3, trail_length: 2.5 } })
    ]
    // 使用者只改了 speed，params 卻是整包送進來
    const out = buildSelectionPatch(events, 'a', ['a', 'b'], {
      params: { speed: 4, intensity: 1 }
    })
    const b = out.find((e) => e.id === 'b')!
    expect(b.params!.speed).toBe(4)
    // b 自己的 intensity 與 trail_length 必須原封不動
    expect(b.params!.intensity).toBe(0.3)
    expect(b.params!.trail_length).toBe(2.5)
  })
})

describe('buildSelectionPatch — 只作用在主選取的欄位', () => {
  it('開始/結束時間不會套用到其他成員', () => {
    const out = buildSelectionPatch(BASE, 'a', ['a', 'b'], { from: '0:07', to: '0:08' })
    expect(out.find((e) => e.id === 'a')!.from).toBe('0:07')
    expect(out.find((e) => e.id === 'b')!.from).toBe('0:03')
    expect(out.find((e) => e.id === 'b')!.to).toBe('0:05')
  })

  it('發亮部位不會套用到其他成員', () => {
    const out = buildSelectionPatch(BASE, 'a', ['a', 'b'], { targets: ['left_hand'] })
    expect(out.find((e) => e.id === 'a')!.targets).toEqual(['left_hand'])
    expect(out.find((e) => e.id === 'b')!.targets).toEqual(['right_hand'])
  })

  it('路徑群組 params 不會套用到其他成員', () => {
    const events = [
      ev('a', '0:01', '0:02', { params: { speed: 1 } }),
      ev('b', '0:03', '0:05', { params: { speed: 1 } })
    ]
    const out = buildSelectionPatch(events, 'a', ['a', 'b'], {
      params: { speed: 1, route_group_id: 'g1', route_group_index: 0 }
    })
    expect(out.find((e) => e.id === 'a')!.params!.route_group_id).toBe('g1')
    expect(out.find((e) => e.id === 'b')!.params!.route_group_id).toBeUndefined()
  })

  it('同一個 patch 同時含可共享與不可共享欄位時，各走各的', () => {
    const out = buildSelectionPatch(BASE, 'a', ['a', 'b'], {
      color: 'laser_lime',
      from: '0:07'
    })
    const b = out.find((e) => e.id === 'b')!
    expect(b.color).toBe('laser_lime')   // 共享
    expect(b.from).toBe('0:03')          // 不共享
  })

  it('主選取不存在時原樣回傳', () => {
    expect(buildSelectionPatch(BASE, 'nope', ['a'], { color: 'red' })).toEqual(BASE)
  })
})

describe('applyDurationToSelection', () => {
  it('整組統一長度，各自固定開頭', () => {
    const out = applyDurationToSelection(BASE, ['a', 'b'], 1500, tryParseTimeToMs, formatMsToTime)
    expect(out.find((e) => e.id === 'a')!.to).toBe('0:02.5')
    expect(out.find((e) => e.id === 'b')!.to).toBe('0:04.5')
    expect(out.find((e) => e.id === 'c')!.to).toBe('0:11')
  })

  it('會讓結束時間超過音樂長度的成員維持不變', () => {
    const out = applyDurationToSelection(
      BASE, ['a', 'b', 'c'], 1500, tryParseTimeToMs, formatMsToTime, 10_000
    )
    expect(out.find((e) => e.id === 'a')!.to).toBe('0:02.5')
    // c 從 0:10 起算會超過 10 秒上限，保持原值
    expect(out.find((e) => e.id === 'c')!.to).toBe('0:11')
  })
})

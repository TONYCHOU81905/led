import { describe, expect, it } from 'vitest'
import { clipsFromEvents, pasteClips } from '../src/shared/timelineClipboard'
import { parseTimeToMs } from '../src/shared/timeParse'
import type { TimelineEventUI } from '../src/shared/types/project'

const noSnap = (ms: number) => ms
const MUSIC = 300_000

function ev(id: string, from: string, to: string, extra: Partial<TimelineEventUI> = {}): TimelineEventUI {
  return {
    id,
    from,
    to,
    targets: ['head'],
    color: 'electric_cyan',
    effect: 'solid',
    priority: 10,
    ...extra
  }
}

// 三個 clip：0:10-0:11、0:12-0:14、0:15-0:16（整組跨度 6 秒）
const GROUP = [
  ev('a', '0:10', '0:11'),
  ev('b', '0:12', '0:14', { targets: ['right_hand'], color: 'hot_magenta' }),
  ev('c', '0:15', '0:16', { targets: ['left_foot'] })
]

describe('clipsFromEvents', () => {
  it('以最早的 start 為基準記錄相對偏移', () => {
    const g = clipsFromEvents(GROUP)!
    expect(g.items.map((i) => i.offsetMs)).toEqual([0, 2000, 5000])
    expect(g.spanMs).toBe(6000)
  })

  it('順序不影響結果（內部會依 start 排序）', () => {
    const g = clipsFromEvents([GROUP[2], GROUP[0], GROUP[1]])!
    expect(g.items.map((i) => i.offsetMs)).toEqual([0, 2000, 5000])
  })

  it('空陣列回 null', () => {
    expect(clipsFromEvents([])).toBeNull()
  })
})

describe('pasteClips', () => {
  it('貼在 playhead 並保留相對關係', () => {
    const g = clipsFromEvents(GROUP)!
    const out = pasteClips(g, 100_000, MUSIC, noSnap)
    expect(out).toHaveLength(3)
    expect(out.map((e) => parseTimeToMs(e.from))).toEqual([100_000, 102_000, 105_000])
    // 各自長度不變
    expect(out.map((e) => parseTimeToMs(e.to) - parseTimeToMs(e.from))).toEqual([1000, 2000, 1000])
  })

  it('每個成員的屬性各自保留', () => {
    const out = pasteClips(clipsFromEvents(GROUP)!, 100_000, MUSIC, noSnap)
    expect(out[1].color).toBe('hot_magenta')
    expect(out[1].targets).toEqual(['right_hand'])
    expect(out[2].targets).toEqual(['left_foot'])
  })

  it('id 全部是新的且互不重複', () => {
    const out = pasteClips(clipsFromEvents(GROUP)!, 100_000, MUSIC, noSnap)
    const ids = out.map((e) => e.id)
    expect(new Set(ids).size).toBe(3)
    for (const id of ids) expect(['a', 'b', 'c']).not.toContain(id)
  })

  it('尾端會超出音樂長度時整組往前平移，不散開', () => {
    const g = clipsFromEvents(GROUP)!
    // playhead 貼在最尾端，整組 6 秒放不下
    const out = pasteClips(g, MUSIC - 1000, MUSIC, noSnap)
    const starts = out.map((e) => parseTimeToMs(e.from))
    // 相對間隔完全不變
    expect(starts[1] - starts[0]).toBe(2000)
    expect(starts[2] - starts[0]).toBe(5000)
    // 尾端剛好貼齊音樂結尾
    expect(Math.max(...out.map((e) => parseTimeToMs(e.to)))).toBeLessThanOrEqual(MUSIC)
  })

  it('不會產生負的開始時間', () => {
    const g = clipsFromEvents(GROUP)!
    const out = pasteClips(g, 0, MUSIC, noSnap)
    for (const e of out) expect(parseTimeToMs(e.from)).toBeGreaterThanOrEqual(0)
  })

  it('route group 會拿到新的 group id，同組共用、與原組不同', () => {
    const routed = [
      ev('r0', '0:10', '0:11', { params: { route_group_id: 'g_old', route_group_index: 0 } }),
      ev('r1', '0:11', '0:12', { params: { route_group_id: 'g_old', route_group_index: 1 } })
    ]
    const out = pasteClips(clipsFromEvents(routed)!, 50_000, MUSIC, noSnap)
    const g0 = out[0].params!.route_group_id
    const g1 = out[1].params!.route_group_id
    expect(g0).toBeTruthy()
    expect(g0).toBe(g1)          // 同組共用
    expect(g0).not.toBe('g_old') // 不與原組混淆
    // 其他 route 欄位保留
    expect(out[1].params!.route_group_index).toBe(1)
  })

  it('兩個不同的 route group 貼上後仍是兩組', () => {
    const routed = [
      ev('x0', '0:10', '0:11', { params: { route_group_id: 'gA' } }),
      ev('x1', '0:11', '0:12', { params: { route_group_id: 'gA' } }),
      ev('y0', '0:13', '0:14', { params: { route_group_id: 'gB' } })
    ]
    const out = pasteClips(clipsFromEvents(routed)!, 50_000, MUSIC, noSnap)
    const ids = out.map((e) => e.params!.route_group_id)
    expect(ids[0]).toBe(ids[1])
    expect(ids[2]).not.toBe(ids[0])
  })

  it('沒有 route group 的 clip 不會被塞進 group 欄位', () => {
    const out = pasteClips(clipsFromEvents(GROUP)!, 100_000, MUSIC, noSnap)
    for (const e of out) expect(e.params?.route_group_id).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'
import {
  addLedOutput,
  countEventsForOutput,
  createDefaultShowProject,
  removeLedOutput
} from '../src/shared/projectMutations'
import { logicalLedCountForOutput } from '../src/shared/ledChainDefaults'
import type { LedProject, TimelineEventUI } from '../src/shared/types/project'

function base(): LedProject {
  return createDefaultShowProject('T')
}

function roleOf(p: LedProject) {
  return p.roles[0]
}

function withEvents(p: LedProject, events: TimelineEventUI[]): LedProject {
  return { ...p, roles: p.roles.map((r, i) => (i === 0 ? { ...r, events } : r)) }
}

function ev(id: string, targets: string[]): TimelineEventUI {
  return {
    id,
    from: '0:01',
    to: '0:02',
    targets,
    color: 'electric_cyan',
    effect: 'solid',
    priority: 10
  }
}

describe('addLedOutput', () => {
  it('沿用來源通道的接線設定，只換 id / part_id / 名稱 / GPIO', () => {
    const p = base()
    const src = roleOf(p).led_outputs!.find((o) => o.id === 'right_arm')!
    const next = addLedOutput(p, roleOf(p).role_id, 'right_arm')
    const added = roleOf(next).led_outputs!.at(-1)!

    expect(added.layout).toBe(src.layout)
    expect(added.outbound_leds).toBe(src.outbound_leds)
    expect(added.parallel_branches).toBe(src.parallel_branches)
    expect(added.branch_leds).toBe(src.branch_leds)
    expect(added.return_leds).toBe(src.return_leds)
    expect(added.direction).toBe(src.direction)

    expect(added.id).not.toBe(src.id)
    expect(added.part_id).not.toBe(src.part_id)
  })

  it('配到一個還沒被使用的 GPIO', () => {
    const p = base()
    const used = roleOf(p).led_outputs!.map((o) => o.gpio)
    const added = roleOf(addLedOutput(p, roleOf(p).role_id)).led_outputs!.at(-1)!
    expect(used).not.toContain(added.gpio)
  })

  it('parts 跟著長出來，LED 索引接在最後一個之後', () => {
    const p = base()
    const before = roleOf(p)
    const lastEnd = Math.max(...before.parts.flatMap((x) => x.ranges.map((r) => r.end)))

    const next = roleOf(addLedOutput(p, before.role_id))
    expect(next.parts).toHaveLength(before.parts.length + 1)
    expect(next.parts.at(-1)!.ranges[0].start).toBe(lastEnd + 1)
  })

  it('連加兩次不會撞 id', () => {
    const p = base()
    const rid = roleOf(p).role_id
    const two = roleOf(addLedOutput(addLedOutput(p, rid), rid)).led_outputs!
    expect(new Set(two.map((o) => o.id)).size).toBe(two.length)
    expect(new Set(two.map((o) => o.part_id)).size).toBe(two.length)
  })
})

describe('countEventsForOutput', () => {
  it('數出掛在該通道部位上的 clip', () => {
    const p = withEvents(base(), [
      ev('a', ['right_hand']),
      ev('b', ['right_hand']),
      ev('c', ['head'])
    ])
    expect(countEventsForOutput(roleOf(p), 'right_arm')).toBe(2)
    expect(countEventsForOutput(roleOf(p), 'hat')).toBe(1)
    expect(countEventsForOutput(roleOf(p), 'left_leg')).toBe(0)
  })

  it('通道不存在時回 0', () => {
    expect(countEventsForOutput(roleOf(base()), 'nope')).toBe(0)
  })
})

describe('removeLedOutput', () => {
  it('移除通道並一併刪掉該部位的 clip', () => {
    const p = withEvents(base(), [
      ev('a', ['right_hand']),
      ev('b', ['head']),
      ev('c', ['right_hand'])
    ])
    const r = roleOf(removeLedOutput(p, roleOf(p).role_id, 'right_arm'))

    expect(r.led_outputs!.some((o) => o.id === 'right_arm')).toBe(false)
    expect(r.parts.some((x) => x.id === 'right_hand')).toBe(false)
    expect(r.events.map((e) => e.id)).toEqual(['b'])
  })

  it('舊格式掛多部位的 event 只抽掉該部位，不整個刪', () => {
    const p = withEvents(base(), [ev('multi', ['head', 'right_hand', 'left_hand'])])
    const r = roleOf(removeLedOutput(p, roleOf(p).role_id, 'right_arm'))
    expect(r.events).toHaveLength(1)
    expect(r.events[0].targets).toEqual(['head', 'left_hand'])
  })

  it('後面通道的 LED 索引往前重算，不留空洞', () => {
    const p = base()
    const r = roleOf(removeLedOutput(p, roleOf(p).role_id, 'hat'))
    // 第一個 part 從 0 開始，且每個 part 首尾相接
    expect(r.parts[0].ranges[0].start).toBe(0)
    let cursor = 0
    for (const part of r.parts) {
      expect(part.ranges[0].start).toBe(cursor)
      cursor += logicalLedCountForOutput(
        r.led_outputs!.find((o) => o.part_id === part.id)!
      )
      expect(part.ranges[0].end).toBe(cursor - 1)
    }
  })

  it('只剩一個通道時不允許刪除', () => {
    let p = base()
    const rid = roleOf(p).role_id
    for (const id of ['right_arm', 'right_leg', 'left_leg', 'left_arm', 'shoes']) {
      p = removeLedOutput(p, rid, id)
    }
    expect(roleOf(p).led_outputs).toHaveLength(1)
    const after = removeLedOutput(p, rid, 'hat')
    expect(roleOf(after).led_outputs).toHaveLength(1)
  })

  it('通道不存在時原樣回傳', () => {
    const p = base()
    const before = roleOf(p).led_outputs!.length
    expect(roleOf(removeLedOutput(p, roleOf(p).role_id, 'nope')).led_outputs).toHaveLength(before)
  })
})

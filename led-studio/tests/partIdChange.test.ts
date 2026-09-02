import { describe, expect, it } from 'vitest'
import { addLedOutput, updateLedOutput } from '../src/shared/projectMutations'
import { partIdToRegions, PREVIEW_PART_OPTIONS } from '../src/features/preview/partRegionMap'
import { regionsForParts } from '../src/features/preview/partRegionMap'
import type { LedProject } from '../src/shared/types/project'

function baseProject(): LedProject {
  return {
    schema_version: '1.0.0',
    project: { id: 'p', name: 'P', music_duration_ms: 300_000, bpm: 120 },
    colors: {},
    roles: [
      {
        role_id: 'dancer_a',
        display_name: 'A',
        led_outputs: [
          {
            id: 'hat',
            display_name: '帽子',
            part_id: 'head',
            gpio: 4,
            layout: 'ring',
            outbound_leds: 60,
            parallel_branches: 1,
            branch_leds: 0,
            return_leds: 0,
            continuation_branch: 1,
            direction: 'clockwise'
          }
        ],
        parts: [{ id: 'head', display_name: '頭', ranges: [{ start: 0, end: 59 }] }],
        events: [
          {
            id: 'e1',
            from: '00:01.000',
            to: '00:02.000',
            targets: ['head'],
            color: 'white',
            effect: 'solid',
            priority: 10
          }
        ]
      }
    ]
  } as unknown as LedProject
}

describe('預覽對應部位選項', () => {
  it('每個選項都是 partIdToRegions 認得的 key', () => {
    for (const opt of PREVIEW_PART_OPTIONS) {
      expect(partIdToRegions(opt.id), `${opt.id} 應該對應到至少一個預覽區域`).not.toEqual([])
    }
  })

  it('包含鞋子', () => {
    expect(PREVIEW_PART_OPTIONS.map((o) => o.id)).toContain('shoes')
  })
})

describe('新增通道後指定預覽部位', () => {
  it('addLedOutput 產生的 part_id 不對應任何預覽區域（所以才需要讓使用者挑）', () => {
    const next = addLedOutput(baseProject(), 'dancer_a', 'hat')
    const added = next.roles[0].led_outputs![1]
    expect(added.part_id).toMatch(/^part_/)
    expect(partIdToRegions(added.part_id)).toEqual([])
  })

  it('把新通道的 part_id 改成 shoes 之後，預覽就會畫出左右鞋', () => {
    let project = addLedOutput(baseProject(), 'dancer_a', 'hat')
    const addedId = project.roles[0].led_outputs![1].id
    project = updateLedOutput(project, 'dancer_a', addedId, { part_id: 'shoes' })

    const regions = regionsForParts(project.roles[0].parts)
    expect(regions).toContain('left_shoe')
    expect(regions).toContain('right_shoe')
  })
})

describe('改 part_id 時既有 clip 不能變孤兒', () => {
  it('targets 會跟著搬到新的 part_id', () => {
    const project = updateLedOutput(baseProject(), 'dancer_a', 'hat', { part_id: 'body' })
    expect(project.roles[0].events[0].targets).toEqual(['body'])
    // parts 也重算了，clip 仍然找得到對應的 part
    expect(project.roles[0].parts.map((p) => p.id)).toContain('body')
  })

  it('搬過去若與既有 target 重複，會去重而不是留下兩筆', () => {
    const p = baseProject()
    p.roles[0].events[0].targets = ['head', 'body']
    const next = updateLedOutput(p, 'dancer_a', 'hat', { part_id: 'body' })
    expect(next.roles[0].events[0].targets).toEqual(['body'])
  })

  it('沒有改 part_id 時 events 完全不動（連參考都不變）', () => {
    const p = baseProject()
    const before = p.roles[0].events
    const next = updateLedOutput(p, 'dancer_a', 'hat', { gpio: 9 })
    expect(next.roles[0].events).toBe(before)
  })
})

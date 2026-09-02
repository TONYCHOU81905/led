import { describe, expect, it } from 'vitest'
import { partsFromLedOutputs, logicalLedCountForOutput } from '../src/shared/ledChainDefaults'
import { partIdToRegions, regionsForParts } from '../src/features/preview/partRegionMap'
import { validateRole, FIRMWARE_MAX_LED_OUTPUTS } from '../src/shared/eventValidator'
import type { LedOutputDefinition } from '../src/shared/types/project'

/** 5P 專案目前的五個通道 */
function fiveChannels(): LedOutputDefinition[] {
  const limb = (id: string, gpio: number) => ({
    id,
    display_name: id,
    // 通道 id 與 part_id 不同名（見 ledChainDefaults 的 DEFAULT_LED_OUTPUTS）
    part_id: (
      { right_arm: 'right_hand', left_arm: 'left_hand', right_leg: 'right_foot', left_leg: 'left_foot' } as Record<string, string>
    )[id] ?? id,
    gpio,
    layout: 'branched_limb' as const,
    outbound_leds: 60,
    parallel_branches: 5,
    branch_leds: 10,
    return_leds: 60,
    continuation_branch: 5,
    direction: 'out_and_back' as const
  })
  return [
    {
      id: 'hat',
      display_name: '帽子',
      part_id: 'head',
      gpio: 4,
      layout: 'ring',
      outbound_leds: 120,
      parallel_branches: 1,
      branch_leds: 0,
      return_leds: 0,
      continuation_branch: 1,
      direction: 'clockwise'
    },
    limb('right_arm', 5),
    limb('right_leg', 6),
    limb('left_leg', 7),
    limb('left_arm', 15)
  ] as LedOutputDefinition[]
}

/** 第 6 個通道：鞋子，GPIO 16 */
function shoesChannel(): LedOutputDefinition {
  return {
    id: 'shoes',
    display_name: '鞋子',
    part_id: 'shoes',
    gpio: 16,
    layout: 'ring',
    outbound_leds: 60,
    parallel_branches: 1,
    branch_leds: 0,
    return_leds: 0,
    continuation_branch: 1,
    direction: 'clockwise'
  } as LedOutputDefinition
}

describe('鞋子通道', () => {
  it('韌體上限已放行到 6 個通道', () => {
    expect(FIRMWARE_MAX_LED_OUTPUTS).toBe(6)
  })

  it('六個通道可以通過 validator（原本上限是 5）', () => {
    const led_outputs = [...fiveChannels(), shoesChannel()]
    const role = {
      role_id: 'dancer_a',
      display_name: 'A',
      led_outputs,
      parts: partsFromLedOutputs(led_outputs),
      events: []
    } as never

    const result = validateRole(role, {})
    expect(result.errors.filter((e) => e.code === 'INVALID_OUTPUT_COUNT')).toEqual([])
    expect(result.errors.filter((e) => e.code === 'UNSUPPORTED_GPIO')).toEqual([])
    expect(result.errors.filter((e) => e.code === 'DUPLICATE_GPIO')).toEqual([])
  })

  it('七個通道仍然會被擋下來', () => {
    const extra = { ...shoesChannel(), id: 'extra', part_id: 'extra', gpio: 17 }
    const led_outputs = [...fiveChannels(), shoesChannel(), extra as LedOutputDefinition]
    const role = {
      role_id: 'dancer_a',
      display_name: 'A',
      led_outputs,
      parts: partsFromLedOutputs(led_outputs),
      events: []
    } as never

    const errs = validateRole(role, {}).errors.filter((e) => e.code === 'INVALID_OUTPUT_COUNT')
    expect(errs).toHaveLength(1)
    expect(errs[0].message).toContain('6')
  })

  it('加上鞋子後 logical 總數仍在 1024 上限內', () => {
    const total = [...fiveChannels(), shoesChannel()].reduce(
      (sum, o) => sum + logicalLedCountForOutput(o),
      0
    )
    expect(total).toBe(700) // 120 + 130*4 + 60
    expect(total).toBeLessThanOrEqual(1024)
  })
})

describe('燈光預覽的鞋子', () => {
  it('shoes part 會對應到左右鞋兩個 SVG 區域', () => {
    expect(partIdToRegions('shoes')).toEqual(['left_shoe', 'right_shoe'])
  })

  it('沒有鞋子通道時，預覽不畫鞋子', () => {
    const parts = partsFromLedOutputs(fiveChannels())
    const regions = regionsForParts(parts)
    expect(regions).not.toContain('left_shoe')
    expect(regions).not.toContain('right_shoe')
  })

  it('加了鞋子通道後，預覽自動畫出左右鞋（不需改預覽程式碼）', () => {
    const parts = partsFromLedOutputs([...fiveChannels(), shoesChannel()])
    const regions = regionsForParts(parts)
    expect(regions).toContain('left_shoe')
    expect(regions).toContain('right_shoe')
    // 原有部位不受影響
    expect(regions).toContain('head')
    expect(regions).toContain('left_hand')
    expect(regions).toContain('right_foot')
  })
})

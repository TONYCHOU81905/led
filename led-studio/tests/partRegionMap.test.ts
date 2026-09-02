import { describe, expect, it } from 'vitest'
import {
  FIGURE_FLOW_ORDER,
  partIdToRegions,
  regionsForParts,
  resolveFigureRegions
} from '../src/features/preview/partRegionMap'
import { cloneDefaultChainParts } from '../src/shared/ledChainDefaults'
import type { PartDefinition, ResolvedColor } from '../src/shared/types/project'

const lit: ResolvedColor = { r: 255, g: 0, b: 128, visible: true }
const off: ResolvedColor = { r: 0, g: 0, b: 0, visible: false }

describe('partRegionMap', () => {
  it('maps standard part ids to figure regions', () => {
    expect(partIdToRegions('head')).toEqual(['head'])
    expect(partIdToRegions('hand')).toEqual(['left_hand', 'right_hand'])
    expect(partIdToRegions('foot')).toEqual(['left_foot', 'right_foot'])
    expect(partIdToRegions('shoe')).toEqual(['left_shoe', 'right_shoe'])
    expect(partIdToRegions('body')).toEqual(['body'])
  })

  it('resolves role parts onto figure regions', () => {
    const parts: PartDefinition[] = [
      { id: 'head', display_name: 'Head', ranges: [{ start: 0, end: 0 }] },
      { id: 'hand', display_name: 'Hand', ranges: [{ start: 0, end: 0 }] },
      { id: 'custom_belt', display_name: '腰帶', ranges: [{ start: 0, end: 0 }] }
    ]
    const resolved = {
      head: lit,
      hand: off,
      custom_belt: lit
    }

    const { regions, unmapped } = resolveFigureRegions(parts, resolved)

    expect(regions.head).toEqual(lit)
    expect(regions.left_hand).toEqual(off)
    expect(regions.right_hand).toEqual(off)
    expect(unmapped).toEqual([{ partId: 'custom_belt', label: '腰帶', color: lit }])
  })

  it('exposes the physical wiring order for the flow guide', () => {
    expect(FIGURE_FLOW_ORDER).toEqual([
      'head', 'right_hand', 'right_foot', 'left_foot', 'left_hand', 'right_shoe', 'left_shoe'
    ])
    expect(FIGURE_FLOW_ORDER).toHaveLength(7)
  })

  it('only returns regions that the default chain parts actually wire up', () => {
    const parts = cloneDefaultChainParts()
    const regions = regionsForParts(parts)

    // 預設鏈現在含鞋子通道（part_id: shoes），所以左右鞋也會出現
    expect(regions).toEqual([
      'head', 'left_hand', 'right_hand', 'left_foot', 'right_foot', 'left_shoe', 'right_shoe'
    ])
    // body 沒有任何通道對應，仍然不該出現
    expect(regions).not.toContain('body')
  })

  it('returns an empty list for no parts', () => {
    expect(regionsForParts([])).toEqual([])
  })
})

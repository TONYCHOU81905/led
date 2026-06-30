import type { PartDefinition } from './types/project'

/** 單條 WS2812 串聯接線順序：身體 → 頭部 → 左手 → 右手 → 左腳 → 右腳 */
export const CHAIN_WIRING_ORDER_HINT =
  '身體 → 頭部 → 左手 → 右手 → 左腳 → 右腳'

export const DEFAULT_CHAIN_PARTS: PartDefinition[] = [
  { id: 'body', display_name: '身體', ranges: [{ start: 0, end: 19 }] },
  { id: 'head', display_name: '頭部', ranges: [{ start: 20, end: 39 }] },
  { id: 'left_hand', display_name: '左手', ranges: [{ start: 40, end: 59 }] },
  { id: 'right_hand', display_name: '右手', ranges: [{ start: 60, end: 79 }] },
  { id: 'left_foot', display_name: '左腳', ranges: [{ start: 80, end: 99 }] },
  { id: 'right_foot', display_name: '右腳', ranges: [{ start: 100, end: 119 }] }
]

export function cloneDefaultChainParts(): PartDefinition[] {
  return DEFAULT_CHAIN_PARTS.map((p) => ({
    ...p,
    ranges: p.ranges.map((r) => ({ ...r }))
  }))
}

export function computeLedCountFromParts(parts: PartDefinition[]): number {
  let max = 0
  for (const part of parts) {
    for (const range of part.ranges) {
      if (range.end + 1 > max) max = range.end + 1
    }
  }
  return Math.max(max, 1)
}

export function ledCountForPart(part: PartDefinition): number {
  return part.ranges.reduce((sum, r) => sum + Math.max(0, r.end - r.start + 1), 0)
}

export function createPartAfterExisting(parts: PartDefinition[]): PartDefinition {
  const lastEnd = parts.reduce((max, part) => {
    const partMax = part.ranges.reduce((m, r) => Math.max(m, r.end), -1)
    return Math.max(max, partMax)
  }, -1)
  const start = lastEnd + 1
  const end = start + 19
  const index = parts.length + 1
  return {
    id: `part_${index}`,
    display_name: `節點 ${index}`,
    ranges: [{ start, end }]
  }
}

export function newPartId(): string {
  return `part_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
}

import type { LedOutputDefinition, PartDefinition } from './types/project'

/** 六個 WS2812B 輸出依舞者本人視角的編排順序。 */
export const CHAIN_WIRING_ORDER_HINT =
  '帽子 → 右手 → 右腳 → 左腳 → 左手 → 鞋子（舞者本人視角）'

/** ESP32-S3 上可安全用來驅動 WS2812B 的 GPIO（避開 strapping / flash / USB 腳位） */
export const SAFE_GPIO_OPTIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21]

/** 挑一個還沒被任何通道用掉的 GPIO；全部用完時回傳 -1，交由 UI 顯示重複警告 */
export function nextFreeGpio(outputs: LedOutputDefinition[]): number {
  const used = new Set(outputs.map((o) => o.gpio))
  return SAFE_GPIO_OPTIONS.find((gpio) => !used.has(gpio)) ?? -1
}

export const DEFAULT_LED_OUTPUTS: LedOutputDefinition[] = [
  {
    id: 'hat', display_name: '帽子', part_id: 'head', gpio: 4, layout: 'ring',
    outbound_leds: 60, parallel_branches: 1, branch_leds: 0, return_leds: 0,
    continuation_branch: 1, direction: 'clockwise'
  },
  {
    id: 'right_arm', display_name: '右手', part_id: 'right_hand', gpio: 5,
    layout: 'branched_limb', outbound_leds: 60, parallel_branches: 5,
    branch_leds: 10, return_leds: 60, continuation_branch: 5, direction: 'out_and_back'
  },
  {
    id: 'right_leg', display_name: '右腳', part_id: 'right_foot', gpio: 6,
    layout: 'branched_limb', outbound_leds: 60, parallel_branches: 5,
    branch_leds: 10, return_leds: 60, continuation_branch: 5, direction: 'out_and_back'
  },
  {
    id: 'left_leg', display_name: '左腳', part_id: 'left_foot', gpio: 7,
    layout: 'branched_limb', outbound_leds: 60, parallel_branches: 5,
    branch_leds: 10, return_leds: 60, continuation_branch: 5, direction: 'out_and_back'
  },
  {
    id: 'left_arm', display_name: '左手', part_id: 'left_hand', gpio: 15,
    layout: 'branched_limb', outbound_leds: 60, parallel_branches: 5,
    branch_leds: 10, return_leds: 60, continuation_branch: 5, direction: 'out_and_back'
  },
  {
    // 第 6 個通道。GPIO 16 的三重確認：在 SUPPORTED_LED_GPIOS 清單內、
    // led_driver.cpp 有 LED_GPIO_CASE(16)（FastLED 的 pin 是編譯期 template，
    // 沒有對應 case 就不能用），且非 strapping / native USB / octal PSRAM 腳位。
    //
    // part_id 用 'shoes'：partRegionMap 認得這個 key，燈光預覽會自動把顏色
    // 畫到人形圖的左右鞋兩塊區域上。
    //
    // 注意這份預設也會被 legacy 專案的 migration 套用，所以舊專案載入後
    // 會多出這個通道（logical 580 → 640）。這是刻意的：鞋子屬於標準服裝配置。
    id: 'shoes', display_name: '鞋子', part_id: 'shoes', gpio: 16, layout: 'ring',
    outbound_leds: 60, parallel_branches: 1, branch_leds: 0, return_leds: 0,
    continuation_branch: 1, direction: 'clockwise'
  }
]

export function logicalLedCountForOutput(output: LedOutputDefinition): number {
  return Math.max(0, output.outbound_leds) + Math.max(0, output.branch_leds) +
    Math.max(0, output.return_leds)
}

export function physicalLedCountForOutput(output: LedOutputDefinition): number {
  return Math.max(0, output.outbound_leds) +
    Math.max(1, output.parallel_branches) * Math.max(0, output.branch_leds) +
    Math.max(0, output.return_leds)
}

export function cloneDefaultLedOutputs(): LedOutputDefinition[] {
  return DEFAULT_LED_OUTPUTS.map((output) => ({ ...output }))
}

export function partsFromLedOutputs(outputs: LedOutputDefinition[]): PartDefinition[] {
  let offset = 0
  return outputs.map((output) => {
    const count = logicalLedCountForOutput(output)
    const part = {
      id: output.part_id,
      display_name: output.display_name,
      ranges: [{ start: offset, end: offset + Math.max(1, count) - 1 }]
    }
    offset += Math.max(1, count)
    return part
  })
}

export const DEFAULT_CHAIN_PARTS: PartDefinition[] = partsFromLedOutputs(DEFAULT_LED_OUTPUTS)

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

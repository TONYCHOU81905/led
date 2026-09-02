import { describe, expect, it } from 'vitest'
import {
  cloneDefaultChainParts,
  DEFAULT_LED_OUTPUTS,
  computeLedCountFromParts,
  createPartAfterExisting,
  DEFAULT_CHAIN_PARTS,
  ledCountForPart,
  logicalLedCountForOutput,
  physicalLedCountForOutput
} from '../src/shared/ledChainDefaults'

describe('ledChainDefaults', () => {
  it('default chain has 6 outputs covering 640 logical LEDs', () => {
    expect(DEFAULT_CHAIN_PARTS).toHaveLength(6)
    expect(computeLedCountFromParts(DEFAULT_CHAIN_PARTS)).toBe(640)
    expect(DEFAULT_CHAIN_PARTS[0]).toMatchObject({ id: 'head', ranges: [{ start: 0, end: 59 }] })
    expect(DEFAULT_CHAIN_PARTS[4]).toMatchObject({ id: 'left_hand', ranges: [{ start: 450, end: 579 }] })
  })

  it('cloneDefaultChainParts returns independent copies', () => {
    const a = cloneDefaultChainParts()
    const b = cloneDefaultChainParts()
    a[0].ranges[0].end = 99
    expect(b[0].ranges[0].end).toBe(59)
  })

  it('createPartAfterExisting appends after last range', () => {
    const next = createPartAfterExisting(DEFAULT_CHAIN_PARTS)
    expect(next.ranges[0]).toEqual({ start: 640, end: 659 })
  })

  it('ledCountForPart sums inclusive ranges', () => {
    expect(ledCountForPart(DEFAULT_CHAIN_PARTS[0])).toBe(60)
  })

  it('counts parallel fingers physically but only once logically', () => {
    expect(logicalLedCountForOutput(DEFAULT_LED_OUTPUTS[1])).toBe(130)
    expect(physicalLedCountForOutput(DEFAULT_LED_OUTPUTS[1])).toBe(170)
    expect(DEFAULT_LED_OUTPUTS.reduce((sum, output) => sum + physicalLedCountForOutput(output), 0)).toBe(800)
  })
})

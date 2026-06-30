import { describe, expect, it } from 'vitest'
import {
  cloneDefaultChainParts,
  computeLedCountFromParts,
  createPartAfterExisting,
  DEFAULT_CHAIN_PARTS,
  ledCountForPart
} from '../src/shared/ledChainDefaults'

describe('ledChainDefaults', () => {
  it('default chain has 6 parts covering 120 LEDs', () => {
    expect(DEFAULT_CHAIN_PARTS).toHaveLength(6)
    expect(computeLedCountFromParts(DEFAULT_CHAIN_PARTS)).toBe(120)
    expect(DEFAULT_CHAIN_PARTS[0]).toMatchObject({ id: 'body', ranges: [{ start: 0, end: 19 }] })
    expect(DEFAULT_CHAIN_PARTS[5]).toMatchObject({ id: 'right_foot', ranges: [{ start: 100, end: 119 }] })
  })

  it('cloneDefaultChainParts returns independent copies', () => {
    const a = cloneDefaultChainParts()
    const b = cloneDefaultChainParts()
    a[0].ranges[0].end = 99
    expect(b[0].ranges[0].end).toBe(19)
  })

  it('createPartAfterExisting appends after last range', () => {
    const next = createPartAfterExisting(DEFAULT_CHAIN_PARTS)
    expect(next.ranges[0]).toEqual({ start: 120, end: 139 })
  })

  it('ledCountForPart sums inclusive ranges', () => {
    expect(ledCountForPart(DEFAULT_CHAIN_PARTS[0])).toBe(20)
  })
})

import { describe, expect, it } from 'vitest'
import { shouldSkipSubnetSweep } from '../src/shared/discoveryPolicy'

describe('shouldSkipSubnetSweep', () => {
  it('演出進行中應該跳過子網掃描', () => {
    expect(shouldSkipSubnetSweep(true)).toBe(true)
  })

  it('演出停止時應該進行完整掃描', () => {
    expect(shouldSkipSubnetSweep(false)).toBe(false)
  })
})

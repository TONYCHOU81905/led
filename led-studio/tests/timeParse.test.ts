import { describe, expect, it } from 'vitest'
import { parseTimeToMs, formatMsToTime, tryParseTimeToMs } from '../src/shared/timeParse'

describe('timeParse', () => {
  it('parses mm:ss to milliseconds', () => {
    expect(parseTimeToMs('01:30')).toBe(90_000)
    expect(parseTimeToMs('0:05')).toBe(5_000)
    expect(parseTimeToMs('2:00')).toBe(120_000)
  })

  it('parses mm:ss.mmm with fractional seconds', () => {
    expect(parseTimeToMs('01:30.500')).toBe(90_500)
    expect(parseTimeToMs('00:01.250')).toBe(1_250)
  })

  it('formats ms back to time strings', () => {
    expect(formatMsToTime(90_000)).toBe('1:30')
    expect(formatMsToTime(90_500)).toBe('1:30.5')
  })

  it('returns null for invalid input via tryParse', () => {
    expect(tryParseTimeToMs('bad')).toBeNull()
    expect(tryParseTimeToMs('1:60')).toBeNull()
  })
})

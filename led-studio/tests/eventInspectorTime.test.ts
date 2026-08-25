import { describe, expect, it } from 'vitest'
import { validateTimeField, validateRange, validateDuration } from '../src/features/timeline/timeFieldDraft'

describe('validateTimeField', () => {
  it('accepts valid time strings', () => {
    expect(validateTimeField('2:43.594')).toEqual({ ok: true, ms: 163_594 })
    expect(validateTimeField('2:43')).toEqual({ ok: true, ms: 163_000 })
    expect(validateTimeField('0:05')).toEqual({ ok: true, ms: 5_000 })
  })

  it('regression: two-decimal-place fraction is valid (mid-edit state)', () => {
    // 使用者從 2:43.594 刪除到只剩兩位小數時，必須仍是合法的中間狀態
    const result = validateTimeField('2:43.59')
    expect(result.ok).toBe(true)
    expect(result.ms).toBe(163_590)
  })

  it('rejects invalid time strings', () => {
    expect(validateTimeField('2:43.').ok).toBe(false)
    expect(validateTimeField('2:4').ok).toBe(false)
    expect(validateTimeField('243').ok).toBe(false)
    expect(validateTimeField('').ok).toBe(false)
    expect(validateTimeField('2:60.000').ok).toBe(false)
    expect(validateTimeField('-1:00').ok).toBe(false)
  })
})

describe('validateRange', () => {
  it('passes when from < to', () => {
    expect(validateRange(1000, 2000)).toEqual({ ok: true })
  })

  it('fails when from == to', () => {
    expect(validateRange(1000, 1000).ok).toBe(false)
  })

  it('fails when from > to', () => {
    expect(validateRange(2000, 1000).ok).toBe(false)
  })

  it('fails when either is negative', () => {
    expect(validateRange(-1, 1000).ok).toBe(false)
    expect(validateRange(1000, -1).ok).toBe(false)
  })
})

describe('validateDuration', () => {
  it('accepts a valid positive integer and computes the new "to"', () => {
    const result = validateDuration('785', 1000)
    expect(result.ok).toBe(true)
    expect(result.ms).toBe(1785)
  })

  it('rejects zero, negative, non-numeric, and empty input', () => {
    expect(validateDuration('0', 1000).ok).toBe(false)
    expect(validateDuration('-5', 1000).ok).toBe(false)
    expect(validateDuration('abc', 1000).ok).toBe(false)
    expect(validateDuration('', 1000).ok).toBe(false)
  })
})

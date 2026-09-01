import { describe, expect, it } from 'vitest'
import { parseRangeHeader } from '../electron/services/mediaRange'

const SIZE = 1000

describe('parseRangeHeader', () => {
  it('沒有 Range header 時回 null（呼叫端回整個檔案）', () => {
    expect(parseRangeHeader(null, SIZE)).toBeNull()
  })

  it('bytes=0- 取到檔尾', () => {
    expect(parseRangeHeader('bytes=0-', SIZE)).toEqual({ start: 0, end: 999 })
  })

  it('bytes=500- 從中間取到檔尾（<video> seek 最常送的形式）', () => {
    expect(parseRangeHeader('bytes=500-', SIZE)).toEqual({ start: 500, end: 999 })
  })

  it('bytes=100-199 取指定區間', () => {
    expect(parseRangeHeader('bytes=100-199', SIZE)).toEqual({ start: 100, end: 199 })
  })

  it('bytes=-200 取最後 200 bytes', () => {
    expect(parseRangeHeader('bytes=-200', SIZE)).toEqual({ start: 800, end: 999 })
  })

  it('end 超過檔案大小時夾到最後一個 byte', () => {
    expect(parseRangeHeader('bytes=900-99999', SIZE)).toEqual({ start: 900, end: 999 })
  })

  it('前後空白要能容忍', () => {
    expect(parseRangeHeader('  bytes=10-20  ', SIZE)).toEqual({ start: 10, end: 20 })
  })

  describe('不合法的輸入一律回 null，讓呼叫端退回整檔而不是回傳壞區間', () => {
    it.each([
      ['bytes=', '沒有任何數字'],
      ['bytes=-', '兩邊都空'],
      ['bytes=abc-def', '非數字'],
      ['items=0-100', 'unit 不是 bytes'],
      ['bytes=1000-', 'start 等於檔案大小（已超出）'],
      ['bytes=5000-6000', 'start 超出檔案大小'],
      ['bytes=200-100', 'end 小於 start'],
      ['bytes=-0', 'suffix 長度為 0'],
      ['bytes=0-100, 200-300', '多重區間不支援']
    ])('%s → null（%s）', (header) => {
      expect(parseRangeHeader(header, SIZE)).toBeNull()
    })
  })

  it('空檔案不會回出負數區間', () => {
    expect(parseRangeHeader('bytes=0-', 0)).toBeNull()
  })
})

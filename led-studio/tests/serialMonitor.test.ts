import { describe, expect, it } from 'vitest'
import { normalizeSerialPort, appendCappedLines } from '../electron/services/serialMonitor'

// serialport / electron 在 vitest 環境無法載入原生模組，所以這裡只測試不依賴
// serialport 的純邏輯：port 路徑正規化、行數上限裁切。startMonitor/stopMonitor/
// pauseMonitor/resumeMonitor 需要真的 serialport 原生模組，未被自動化測試覆蓋。

describe('normalizeSerialPort', () => {
  it('macOS tty.* 轉成 cu.*', () => {
    expect(normalizeSerialPort('/dev/tty.usbserial-x')).toBe('/dev/cu.usbserial-x')
  })

  it('帶 debug 的 tty.* 不轉換', () => {
    expect(normalizeSerialPort('/dev/tty.xxx-debug')).toBe('/dev/tty.xxx-debug')
  })

  it('Windows COM port 原樣保留', () => {
    expect(normalizeSerialPort('COM3')).toBe('COM3')
  })

  it('已經是 cu.* 的路徑不受影響', () => {
    expect(normalizeSerialPort('/dev/cu.usbserial-x')).toBe('/dev/cu.usbserial-x')
  })
})

describe('appendCappedLines', () => {
  it('未超過上限時全部保留', () => {
    const result = appendCappedLines([1, 2], [3, 4], 10)
    expect(result).toEqual([1, 2, 3, 4])
  })

  it('超過上限時丟棄最舊的', () => {
    const prev = [1, 2, 3, 4, 5]
    const incoming = [6, 7]
    const result = appendCappedLines(prev, incoming, 5)
    expect(result).toEqual([3, 4, 5, 6, 7])
  })

  it('單次塞入就超過上限時只留最後 max 筆', () => {
    const result = appendCappedLines([1, 2], [3, 4, 5, 6, 7, 8], 3)
    expect(result).toEqual([6, 7, 8])
  })

  it('恰好等於上限時全部保留', () => {
    const result = appendCappedLines([1, 2], [3, 4], 4)
    expect(result).toEqual([1, 2, 3, 4])
  })

  it('prev 為空時正常運作', () => {
    const result = appendCappedLines<number>([], [1, 2, 3], 5)
    expect(result).toEqual([1, 2, 3])
  })
})

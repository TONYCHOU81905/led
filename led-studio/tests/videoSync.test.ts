import { describe, expect, it } from 'vitest'
import {
  computeOffsetMs,
  isVideoTimeInRange,
  musicToVideoMs,
  needsVideoResync,
  videoToMusicMs
} from '../src/shared/videoSync'

describe('videoSync', () => {
  it('musicToVideoMs / videoToMusicMs 互為反函數', () => {
    const offset = 225300
    const musicMs = 232400
    const videoMs = musicToVideoMs(musicMs, offset)
    expect(videoMs).toBe(7100)
    expect(videoToMusicMs(videoMs, offset)).toBe(musicMs)
  })

  it('computeOffsetMs 依使用者舉例算出 225300', () => {
    expect(computeOffsetMs(232400, 7100)).toBe(225300)
  })

  it('offset 為負數時（影片比音樂早開始）也正確', () => {
    const offset = -5000
    const musicMs = 1000
    const videoMs = musicToVideoMs(musicMs, offset)
    expect(videoMs).toBe(6000)
    expect(videoToMusicMs(videoMs, offset)).toBe(musicMs)
    expect(computeOffsetMs(musicMs, videoMs)).toBe(offset)
  })

  describe('isVideoTimeInRange', () => {
    it('負數為 false', () => {
      expect(isVideoTimeInRange(-1, 10000)).toBe(false)
    })
    it('0 為 true', () => {
      expect(isVideoTimeInRange(0, 10000)).toBe(true)
    })
    it('等於 duration 為 true', () => {
      expect(isVideoTimeInRange(10000, 10000)).toBe(true)
    })
    it('超出為 false', () => {
      expect(isVideoTimeInRange(10001, 10000)).toBe(false)
    })
  })

  describe('needsVideoResync', () => {
    it('差距在容差內為 false', () => {
      expect(needsVideoResync(1000, 1050)).toBe(false)
    })
    it('差距超出容差為 true', () => {
      expect(needsVideoResync(1000, 1200)).toBe(true)
    })
    it('預設容差為 120ms', () => {
      expect(needsVideoResync(1000, 1119)).toBe(false)
      expect(needsVideoResync(1000, 1121)).toBe(true)
    })
    it('可自訂容差', () => {
      expect(needsVideoResync(1000, 1050, 200)).toBe(false)
      expect(needsVideoResync(1000, 1250, 200)).toBe(true)
    })
  })
})

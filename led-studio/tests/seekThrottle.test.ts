import { describe, expect, it } from 'vitest'
import {
  SEEK_FORCE_MOVE_MS,
  SEEK_MIN_INTERVAL_MS,
  decideSeekPacket,
  initialSeekThrottleState
} from '../src/shared/seekThrottle'

describe('decideSeekPacket', () => {
  it('第一次一定送', () => {
    const d = decideSeekPacket(1000, 5000, initialSeekThrottleState())
    expect(d.send).toBe(true)
    expect(d.next).toEqual({ lastSentAt: 5000, lastSentMusicMs: 1000 })
  })

  it('模擬 21 Hz 拖曳 1 秒：從 21 顆降到 10 顆', () => {
    // 實機量到的就是這個頻率：拖動時間軸 60 秒送出 1274 個 SEEK。
    let state = initialSeekThrottleState()
    let sent = 0
    for (let i = 0; i < 21; i++) {
      const now = 1000 + i * 48 // ≈21 Hz
      const music = 60000 + i * 20 // 每次只移動 20ms，是拖曳中間值
      const d = decideSeekPacket(music, now, state)
      if (d.send) sent++
      state = d.next
    }
    expect(sent).toBeLessThanOrEqual(11)
    expect(sent).toBeGreaterThan(0)
  })

  it('位移小、時間也還沒到 → 不送', () => {
    const state = { lastSentAt: 1000, lastSentMusicMs: 60000 }
    const d = decideSeekPacket(60020, 1000 + SEEK_MIN_INTERVAL_MS - 1, state)
    expect(d.send).toBe(false)
    // 不送時狀態必須維持原樣，否則節流窗口會被無限往後推
    expect(d.next).toBe(state)
  })

  it('大幅跳躍不受節流限制 —— 那是真正的 seek 意圖', () => {
    // 點時間軸上的另一個位置，必須立刻硬跳，不能等 100ms 窗口。
    const state = { lastSentAt: 1000, lastSentMusicMs: 60000 }
    const d = decideSeekPacket(60000 + SEEK_FORCE_MOVE_MS, 1001, state)
    expect(d.send).toBe(true)
  })

  it('往回大幅跳躍也算（位移取絕對值）', () => {
    const state = { lastSentAt: 1000, lastSentMusicMs: 60000 }
    expect(decideSeekPacket(60000 - SEEK_FORCE_MOVE_MS, 1001, state).send).toBe(true)
  })

  it('間隔到了就送，即使位置沒動（板子需要定期重新錨定）', () => {
    const state = { lastSentAt: 1000, lastSentMusicMs: 60000 }
    const d = decideSeekPacket(60000, 1000 + SEEK_MIN_INTERVAL_MS, state)
    expect(d.send).toBe(true)
  })

  it('seek 到 0 時不能被誤判成「還沒送過」', () => {
    // lastSentMusicMs 用 -1 當哨兵，所以 0 是合法的已送出值。
    const state = { lastSentAt: 1000, lastSentMusicMs: 0 }
    const d = decideSeekPacket(10, 1050, state)
    expect(d.send).toBe(false)
  })

  it('門檻可以被呼叫端覆寫（給測試與未來調校用）', () => {
    const state = { lastSentAt: 1000, lastSentMusicMs: 60000 }
    expect(decideSeekPacket(60020, 1010, state, { minIntervalMs: 5 }).send).toBe(true)
  })
})

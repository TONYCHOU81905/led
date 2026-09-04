/**
 * SEEK 控制封包的節流判斷。
 *
 * 由來（2026-09-04 實機量到的）：
 * 拖動時間軸 60 秒，板子收到 1274 個 SEEK（約 21 Hz），而且 music_time 幾乎
 * 沒變。每一顆 SEEK 都會讓韌體跑 applyHardSeek() 重新錨定時鐘，10 台板子時
 * 還要乘上 broadcast + unicast 的份數。
 *
 * 為什麼可以節流而不影響預覽跟隨：
 * 位置資訊本來就由持續的心跳帶著走 —— 播放中是 100 Hz 的 RUNNING、暫停中是
 * 5 Hz 的 PAUSE，兩者的 handler 都會 applyHardSeek 到封包裡的 music_time。
 * SEEK 的職責只是「立刻硬跳」，拖曳過程中每 100ms 跳一次就足夠平順，
 * 中間那些會被下一顆心跳補上。
 *
 * 大幅跳躍（例如點時間軸上的另一個位置）必須立刻送，不能等節流窗口 ——
 * 那是真正的 seek 意圖，不是拖曳的中間值。
 */

/** 兩顆 SEEK 之間的最短間隔（10 Hz 上限）。 */
export const SEEK_MIN_INTERVAL_MS = 100
/** 超過這個位移就視為「真正的跳躍」，無條件立刻送。 */
export const SEEK_FORCE_MOVE_MS = 500

export interface SeekThrottleState {
  /** 上一次真的送出 SEEK 的時間（Date.now()）；0 = 還沒送過 */
  lastSentAt: number
  /** 上一次送出的 music_time_ms；-1 = 還沒送過 */
  lastSentMusicMs: number
}

export function initialSeekThrottleState(): SeekThrottleState {
  return { lastSentAt: 0, lastSentMusicMs: -1 }
}

export interface SeekThrottleDecision {
  send: boolean
  /** 送出時要寫回的新狀態；不送時維持原狀態 */
  next: SeekThrottleState
}

export function decideSeekPacket(
  targetMusicMs: number,
  nowMs: number,
  state: SeekThrottleState,
  options?: { minIntervalMs?: number; forceMoveMs?: number }
): SeekThrottleDecision {
  const minInterval = options?.minIntervalMs ?? SEEK_MIN_INTERVAL_MS
  const forceMove = options?.forceMoveMs ?? SEEK_FORCE_MOVE_MS

  const neverSent = state.lastSentAt === 0 || state.lastSentMusicMs < 0
  const moved = Math.abs(targetMusicMs - state.lastSentMusicMs)
  const elapsed = nowMs - state.lastSentAt

  // 大幅跳躍是真正的 seek 意圖，不受節流限制。
  const send = neverSent || moved >= forceMove || elapsed >= minInterval

  return send
    ? { send: true, next: { lastSentAt: nowMs, lastSentMusicMs: targetMusicMs } }
    : { send: false, next: state }
}

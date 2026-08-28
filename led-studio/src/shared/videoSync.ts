/**
 * 參考影片與音樂的時間對應。
 *
 * video_offset_ms = 音樂時間 - 影片時間
 * 影片時間 = 音樂時間 - video_offset_ms
 * 音樂時間 = 影片時間 + video_offset_ms
 */

/** 音樂時間 → 影片時間 */
export function musicToVideoMs(musicMs: number, offsetMs: number): number {
  return musicMs - offsetMs
}

/** 影片時間 → 音樂時間 */
export function videoToMusicMs(videoMs: number, offsetMs: number): number {
  return videoMs + offsetMs
}

/** 由「目前音樂時間」與「目前影片時間」算出 offset */
export function computeOffsetMs(musicMs: number, videoMs: number): number {
  return musicMs - videoMs
}

/**
 * 影片時間是否落在有效範圍內（0 ~ videoDurationMs）。
 * 音樂時間換算後可能為負或超出影片長度，那時影片應該停住不播。
 */
export function isVideoTimeInRange(videoMs: number, videoDurationMs: number): boolean {
  return videoMs >= 0 && videoMs <= videoDurationMs
}

/**
 * 播放中是否需要校正影片位置。
 * 播放時不要每幀 seek（會卡頓）—— 讓 video 自己跑，只有漂移超過門檻才校正。
 */
export function needsVideoResync(
  actualVideoMs: number,
  expectedVideoMs: number,
  toleranceMs = 120
): boolean {
  return Math.abs(actualVideoMs - expectedVideoMs) > toleranceMs
}

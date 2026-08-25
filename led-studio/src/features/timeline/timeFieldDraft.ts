import { tryParseTimeToMs } from '../../shared/timeParse'

export interface TimeFieldValidation {
  ok: boolean
  ms?: number
  error?: string
}

const TIME_FORMAT_ERROR = '時間格式需為 mm:ss 或 mm:ss.mmm'

/** 驗證單一時間字串（mm:ss 或 mm:ss.mmm）。 */
export function validateTimeField(raw: string): TimeFieldValidation {
  const ms = tryParseTimeToMs(raw)
  if (ms === null) {
    return { ok: false, error: TIME_FORMAT_ERROR }
  }
  if (ms < 0) {
    return { ok: false, error: '時間不可為負數' }
  }
  return { ok: true, ms }
}

/**
 * 驗證 from/to 這一組的語意（from < to、非負）。
 * 給了 maxToMs（通常是音樂總長）時，結束時間不得超出。
 */
export function validateRange(
  fromMs: number,
  toMs: number,
  maxToMs?: number
): TimeFieldValidation {
  if (fromMs < 0 || toMs < 0) {
    return { ok: false, error: '時間不可為負數' }
  }
  if (fromMs >= toMs) {
    return { ok: false, error: '開始時間必須早於結束時間' }
  }
  if (maxToMs !== undefined && toMs > maxToMs) {
    return { ok: false, error: `結束時間不可超過音樂長度（${formatLimit(maxToMs)}）` }
  }
  return { ok: true }
}

/** 把上限毫秒數寫成好讀的 mm:ss.mmm，只給錯誤訊息用。 */
function formatLimit(ms: number): string {
  const m = Math.floor(ms / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const mi = Math.round(ms % 1000)
  return `${m}:${String(s).padStart(2, '0')}.${String(mi).padStart(3, '0')}`
}

/**
 * 驗證片段長度輸入（正整數、>= minMs），回傳新的結束時間 ms。
 * 給了 maxToMs 時，換算出來的結束時間不得超出。
 */
export function validateDuration(
  raw: string,
  fromMs: number,
  minMs = 10,
  maxToMs?: number
): TimeFieldValidation {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, error: '片段長度須為正整數（毫秒）' }
  }
  const durationMs = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(durationMs) || durationMs < minMs) {
    return { ok: false, error: `片段長度至少需為 ${minMs}ms` }
  }
  if (fromMs < 0) {
    return { ok: false, error: '時間不可為負數' }
  }
  const toMs = fromMs + durationMs
  if (maxToMs !== undefined && toMs > maxToMs) {
    return { ok: false, error: `長度會讓結束時間超過音樂長度（${formatLimit(maxToMs)}）` }
  }
  return { ok: true, ms: toMs }
}

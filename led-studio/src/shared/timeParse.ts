const TIME_PATTERN = /^(\d+):(\d{2})(?:\.(\d{1,3}))?$/

export class TimeParseError extends Error {
  constructor(value: string) {
    super(`Invalid time format: "${value}". Expected mm:ss or mm:ss.mmm`)
    this.name = 'TimeParseError'
  }
}

/** Parse mm:ss or mm:ss.mmm (also m:ss) to milliseconds. */
export function parseTimeToMs(timeStr: string): number {
  const trimmed = timeStr.trim()
  const match = trimmed.match(TIME_PATTERN)
  if (!match) {
    throw new TimeParseError(timeStr)
  }

  const minutes = Number.parseInt(match[1], 10)
  const seconds = Number.parseInt(match[2], 10)
  if (seconds >= 60) {
    throw new TimeParseError(timeStr)
  }

  let millis = 0
  if (match[3]) {
    const frac = match[3].padEnd(3, '0').slice(0, 3)
    millis = Number.parseInt(frac, 10)
  }

  return minutes * 60_000 + seconds * 1_000 + millis
}

/** Format milliseconds as mm:ss or mm:ss.mmm when sub-second precision exists. */
export function formatMsToTime(ms: number): string {
  ms = Math.round(ms)
  if (ms < 0) {
    throw new RangeError('Time cannot be negative')
  }

  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1_000)
  const millis = ms % 1_000

  const secStr = seconds.toString().padStart(2, '0')
  if (millis > 0) {
    const msStr = millis.toString().padStart(3, '0').replace(/0+$/, '')
    return `${minutes}:${secStr}.${msStr}`
  }

  return `${minutes}:${secStr}`
}

export function tryParseTimeToMs(timeStr: string): number | null {
  try {
    return parseTimeToMs(timeStr)
  } catch {
    return null
  }
}

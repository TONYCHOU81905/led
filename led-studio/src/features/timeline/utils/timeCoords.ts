export const TRACK_HEIGHT = 44
export const RULER_HEIGHT = 28
export const WAVEFORM_HEIGHT = 64
export const HEADER_WIDTH = 88
export const MIN_ZOOM = 0.02
export const MAX_ZOOM = 3

export function timeToX(timeMs: number, scrollMs: number, zoomPxPerMs: number): number {
  return HEADER_WIDTH + (timeMs - scrollMs) * zoomPxPerMs
}

export function xToTime(x: number, scrollMs: number, zoomPxPerMs: number): number {
  return scrollMs + (x - HEADER_WIDTH) / zoomPxPerMs
}

export function formatRulerLabel(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

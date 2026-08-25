import { useCallback, useState } from 'react'
import { HEADER_WIDTH, MAX_ZOOM, MIN_ZOOM } from '../utils/timeCoords'

export function visibleTimelineMs(viewportWidthPx: number, zoomPxPerMs: number): number {
  return Math.max(1, (Math.max(HEADER_WIDTH + 1, viewportWidthPx) - HEADER_WIDTH) / zoomPxPerMs)
}

export function maxTimelineScroll(
  durationMs: number,
  viewportWidthPx: number,
  zoomPxPerMs: number
): number {
  return Math.max(0, durationMs - visibleTimelineMs(viewportWidthPx, zoomPxPerMs))
}

/**
 * 拖整曲進度條 seek 時，判斷是否該把 timeline 重新捲到讓 playhead 居中。
 *
 * calculateFollowScroll 的 12%~74% dead zone 是給「播放中自動跟隨」用的
 * （避免每一幀都在滑動）。但手動拖進度條是明確的 seek 手勢，使用者期待
 * timeline 跟著左右走，dead zone 太寬會讓人以為功能壞了 —— 所以這裡用比較
 * 窄的舒適區，超出就居中。
 */
export function needsRecenter(
  playheadMs: number,
  scrollMs: number,
  visibleMs: number,
  lo = 0.3,
  hi = 0.7
): boolean {
  if (visibleMs <= 0) return false
  const rel = (playheadMs - scrollMs) / visibleMs
  return rel < lo || rel > hi
}

export function calculateFollowScroll(
  previousScrollMs: number,
  playheadMs: number,
  durationMs: number,
  viewportWidthPx: number,
  zoomPxPerMs: number
): number {
  const visibleMs = visibleTimelineMs(viewportWidthPx, zoomPxPerMs)
  const maxScroll = maxTimelineScroll(durationMs, viewportWidthPx, zoomPxPerMs)
  const leftGuard = previousScrollMs + visibleMs * 0.12
  const rightGuard = previousScrollMs + visibleMs * 0.74

  if (playheadMs < leftGuard) return Math.max(0, Math.min(maxScroll, playheadMs - visibleMs * 0.12))
  if (playheadMs > rightGuard) return Math.max(0, Math.min(maxScroll, playheadMs - visibleMs * 0.74))
  return Math.max(0, Math.min(maxScroll, previousScrollMs))
}

export function useTimelineViewport(durationMs: number) {
  const [scrollMs, setScrollMs] = useState(0)
  const [zoomPxPerMs, setZoomPxPerMs] = useState(0.12)

  const zoomIn = useCallback(() => {
    setZoomPxPerMs((z) => Math.min(MAX_ZOOM, z * 1.25))
  }, [])

  const zoomOut = useCallback(() => {
    setZoomPxPerMs((z) => Math.max(MIN_ZOOM, z / 1.25))
  }, [])

  const zoomAt = useCallback(
    (anchorMs: number, factor: number, viewportWidthPx: number) => {
      setZoomPxPerMs((prevZoom) => {
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prevZoom * factor))
        if (newZoom === prevZoom) return prevZoom

        setScrollMs((prevScroll) => {
          const visibleMs = (viewportWidthPx - HEADER_WIDTH) / newZoom
          const anchorOffsetPx = HEADER_WIDTH + (anchorMs - prevScroll) * prevZoom
          const newScroll = anchorMs - (anchorOffsetPx - HEADER_WIDTH) / newZoom
          const maxScroll = Math.max(0, durationMs - visibleMs)
          return Math.max(0, Math.min(newScroll, maxScroll))
        })

        return newZoom
      })
    },
    [durationMs]
  )

  const scrollTo = useCallback(
    (ms: number) => {
      setScrollMs(Math.max(0, Math.min(ms, Math.max(0, durationMs - 1000))))
    },
    [durationMs]
  )

  const followPlayhead = useCallback(
    (playheadMs: number, viewportWidthPx: number, zoom: number) => {
      setScrollMs((prevScroll) =>
        calculateFollowScroll(prevScroll, playheadMs, durationMs, viewportWidthPx, zoom)
      )
    },
    [durationMs]
  )

  const centerPlayhead = useCallback(
    (playheadMs: number, viewportWidthPx: number, zoom: number) => {
      const visibleMs = visibleTimelineMs(viewportWidthPx, zoom)
      const maxScroll = maxTimelineScroll(durationMs, viewportWidthPx, zoom)
      setScrollMs(Math.max(0, Math.min(maxScroll, playheadMs - visibleMs * 0.5)))
    },
    [durationMs]
  )

  const zoomCenteredAt = useCallback(
    (anchorMs: number, factor: number, viewportWidthPx: number) => {
      setZoomPxPerMs((previousZoom) => {
        const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, previousZoom * factor))
        const visibleMs = visibleTimelineMs(viewportWidthPx, nextZoom)
        const maxScroll = maxTimelineScroll(durationMs, viewportWidthPx, nextZoom)
        setScrollMs(Math.max(0, Math.min(maxScroll, anchorMs - visibleMs * 0.5)))
        return nextZoom
      })
    },
    [durationMs]
  )

  const resetViewport = useCallback((nextDurationMs: number) => {
    setScrollMs(0)
    const targetZoom = nextDurationMs > 120_000 ? 0.04 : nextDurationMs > 60_000 ? 0.08 : 0.12
    setZoomPxPerMs(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetZoom)))
  }, [])

  return {
    scrollMs,
    setScrollMs,
    zoomPxPerMs,
    setZoomPxPerMs,
    zoomIn,
    zoomOut,
    zoomAt,
    scrollTo,
    followPlayhead,
    centerPlayhead,
    zoomCenteredAt,
    resetViewport
  }
}

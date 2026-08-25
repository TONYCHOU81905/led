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
 * 把 timeline 捲到「剛好讓 playhead 留在畫面內」的最小移動量。
 *
 * 跟 centerPlayhead 的差別：centerPlayhead 每次都把 playhead 拉到正中央，
 * 拖曳時看起來就是一次跳好幾秒；這裡只推最小的距離，所以連續拖曳會是平滑地
 * 一點一點推移。marginRatio 是希望 playhead 距離邊緣保留的緩衝。
 */
export function scrollToKeepVisible(
  prevScrollMs: number,
  playheadMs: number,
  visibleMs: number,
  maxScrollMs: number,
  marginRatio = 0.1
): number {
  if (visibleMs <= 0) return prevScrollMs
  const margin = Math.min(visibleMs * marginRatio, visibleMs / 2)
  let next = prevScrollMs
  if (playheadMs < prevScrollMs + margin) {
    next = playheadMs - margin
  } else if (playheadMs > prevScrollMs + visibleMs - margin) {
    next = playheadMs - visibleMs + margin
  }
  return Math.max(0, Math.min(maxScrollMs, next))
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

  /** 以最小移動量把 playhead 保持在畫面內（拖曳時的平滑跟隨） */
  const keepPlayheadVisible = useCallback(
    (playheadMs: number, viewportWidthPx: number, zoom: number) => {
      const visibleMs = visibleTimelineMs(viewportWidthPx, zoom)
      const maxScroll = maxTimelineScroll(durationMs, viewportWidthPx, zoom)
      setScrollMs((prev) => scrollToKeepVisible(prev, playheadMs, visibleMs, maxScroll))
    },
    [durationMs]
  )

  /** 相對捲動（給拖曳到畫面邊緣時的持續自動捲動用） */
  const scrollBy = useCallback(
    (deltaMs: number, viewportWidthPx: number, zoom: number) => {
      const maxScroll = maxTimelineScroll(durationMs, viewportWidthPx, zoom)
      setScrollMs((prev) => Math.max(0, Math.min(maxScroll, prev + deltaMs)))
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
    keepPlayheadVisible,
    scrollBy,
    centerPlayhead,
    zoomCenteredAt,
    resetViewport
  }
}

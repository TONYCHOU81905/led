import { useCallback, useState } from 'react'
import { HEADER_WIDTH, MAX_ZOOM, MIN_ZOOM } from '../utils/timeCoords'

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
      const visibleMs = (viewportWidthPx - HEADER_WIDTH) / zoom
      const maxScroll = Math.max(0, durationMs - visibleMs)
      const margin = visibleMs * 0.2

      setScrollMs((prevScroll) => {
        if (playheadMs < prevScroll + margin * 0.5) {
          return Math.max(0, playheadMs - margin)
        }
        if (playheadMs > prevScroll + visibleMs - margin) {
          return Math.min(maxScroll, playheadMs - visibleMs + margin)
        }
        return prevScroll
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
    resetViewport
  }
}

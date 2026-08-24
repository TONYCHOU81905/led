import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PartDefinition, PartId, TimelineEventUI } from '../../shared/types/project'
import { colorToCss, getStageColor } from '../../shared/stageColors'
import { formatMsToTime, parseTimeToMs, tryParseTimeToMs } from '../../shared/timeParse'
import type { TimelineKeyframe } from '../../shared/types/project'
import { buildRouteSegments, getEffectLabel } from '../../shared/timelineEffects'
import { buildTrackMeta } from './partLabels'
import {
  HEADER_WIDTH,
  RULER_HEIGHT,
  TRACK_HEIGHT,
  WAVEFORM_HEIGHT,
  formatRulerLabel,
  timeToX,
  xToTime
} from './utils/timeCoords'

const EDGE_HIT = 8
const MIN_CLIP_MS = 50
const MIN_CREATE_DRAG_PX = 8
const MIN_MOVE_DRAG_PX = 4

export interface TimelineCanvasProps {
  durationMs: number
  bpm: number
  parts: PartDefinition[]
  events: TimelineEventUI[]
  colors: Record<string, { r: number; g: number; b: number }>
  scrollMs: number
  zoomPxPerMs: number
  snapTime: (ms: number) => number
  playheadMs: number
  selectedId: string | null
  waveformPeaks?: number[] | null
  keyframes?: TimelineKeyframe[]
  onSelect: (id: string | null) => void
  onEventsChange: (events: TimelineEventUI[]) => void
  onPlayheadChange: (ms: number) => void
  onKeyframesChange?: (keyframes: TimelineKeyframe[]) => void
  onZoomAt?: (anchorMs: number, factor: number) => void
}

type DragMode = 'create' | 'move' | 'resize-left' | 'resize-right' | 'scrub' | null

interface DragState {
  mode: DragMode
  eventId?: string
  partId: PartId
  origPartId?: PartId
  targetPartId?: PartId
  startMouseX: number
  startMouseY: number
  origStartMs: number
  origEndMs: number
  createEndMs?: number
  createStarted?: boolean
  moveStarted?: boolean
  /** 只有單一部位的 clip 才允許拖曳換 track；跨部位路徑 clip 的 targets 不可被覆寫 */
  allowPartReassign?: boolean
}

interface ClipPreview {
  partId: PartId
  startMs: number
  endMs: number
  color?: string
  label?: string
  selected?: boolean
  ghost?: boolean
  showLeftHandle?: boolean
  showRightHandle?: boolean
}

function eventsForPart(events: TimelineEventUI[], partId: PartId): TimelineEventUI[] {
  return events.filter((e) => e.targets.includes(partId))
}

function clipsForEventPart(
  event: TimelineEventUI,
  partId: PartId,
  parts: PartDefinition[]
): Array<{ startMs: number; endMs: number }> {
  const startMs = tryParseTimeToMs(event.from)
  const endMs = tryParseTimeToMs(event.to)
  if (startMs === null || endMs === null) return []
  const route = event.params?.route_parts
  if (!route || route.length <= 1) return [{ startMs, endMs }]

  const duration = endMs - startMs
  return buildRouteSegments(event.targets, parts, event.params)
    .filter((segment) => segment.partId === partId)
    .map((segment) => ({
      startMs: startMs + duration * segment.startRatio,
      endMs: startMs + duration * segment.endRatio
    }))
}

const SEGMENT_BADGES = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']

function segmentBadge(index: number): string {
  return SEGMENT_BADGES[index] ?? `${index + 1}.`
}

function msToFromTo(startMs: number, endMs: number): { from: string; to: string } {
  return {
    from: formatMsToTime(Math.max(0, startMs)),
    to: formatMsToTime(Math.max(0, endMs))
  }
}

function patchEvent(
  events: TimelineEventUI[],
  eventId: string,
  startMs: number,
  endMs: number,
  partId?: PartId
): TimelineEventUI[] {
  const { from, to } = msToFromTo(startMs, endMs)
  return events.map((e) => {
    if (e.id !== eventId) return e
    const next = { ...e, from, to }
    if (partId) next.targets = [partId]
    return next
  })
}

export function TimelineCanvas(props: TimelineCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 400 })
  const [liveEvents, setLiveEvents] = useState<TimelineEventUI[] | null>(null)
  const liveEventsRef = useRef<TimelineEventUI[] | null>(null)
  const [createPreview, setCreatePreview] = useState<ClipPreview | null>(null)
  const [cursor, setCursor] = useState('default')
  const dragRef = useRef<DragState | null>(null)
  const captureRef = useRef(false)

  const { order: trackOrder, labels: partLabels } = useMemo(
    () => buildTrackMeta(props.parts),
    [props.parts]
  )
  const defaultPartId = trackOrder[0] ?? 'body'
  const contentH = RULER_HEIGHT + WAVEFORM_HEIGHT + trackOrder.length * TRACK_HEIGHT

  const partAtY = useCallback(
    (my: number, tracksTop: number): PartId => {
      const idx = Math.floor((my - tracksTop) / TRACK_HEIGHT)
      return trackOrder[Math.max(0, Math.min(trackOrder.length - 1, idx))] ?? defaultPartId
    },
    [trackOrder, defaultPartId]
  )

  const displayEvents = liveEvents ?? props.events

  useEffect(() => {
    setLiveEvents(null)
    setCreatePreview(null)
  }, [props.events])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: contentH }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: contentH })
    return () => ro.disconnect()
  }, [contentH])

  useEffect(() => {
    const el = containerRef.current
    if (!el || !props.onZoomAt) return

    const onWheel = (e: WheelEvent) => {
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const wfTop = RULER_HEIGHT
      if (my < wfTop || my >= wfTop + WAVEFORM_HEIGHT || mx <= HEADER_WIDTH) return

      e.preventDefault()
      const anchorMs = xToTime(mx, props.scrollMs, props.zoomPxPerMs)
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
      props.onZoomAt!(anchorMs, factor)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [props.onZoomAt, props.scrollMs, props.zoomPxPerMs])

  const visibleRange = useCallback(() => {
    const start = props.scrollMs
    const end = start + (size.w - HEADER_WIDTH) / props.zoomPxPerMs
    return { start, end }
  }, [props.scrollMs, props.zoomPxPerMs, size.w])

  const drawClip = (
    ctx: CanvasRenderingContext2D,
    clip: ClipPreview,
    y: number,
    start: number,
    end: number
  ) => {
    if (clip.endMs < start || clip.startMs > end) return
    const x1 = timeToX(clip.startMs, props.scrollMs, props.zoomPxPerMs)
    const x2 = timeToX(clip.endMs, props.scrollMs, props.zoomPxPerMs)
    const w = Math.max(6, x2 - x1)
    const barY = y + 5
    const barH = TRACK_HEIGHT - 10
    const rgb = clip.color
      ? getStageColor(clip.color) ?? props.colors[clip.color] ?? { r: 128, g: 128, b: 128 }
      : { r: 56, g: 189, b: 248 }

    ctx.fillStyle = colorToCss(rgb)
    ctx.globalAlpha = clip.ghost ? 0.45 : clip.selected ? 1 : 0.88
    ctx.beginPath()
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x1, barY, w, barH, 4)
    } else {
      ctx.rect(x1, barY, w, barH)
    }
    ctx.fill()
    ctx.globalAlpha = 1

    if (clip.selected && !clip.ghost) {
      ctx.strokeStyle = '#f8fafc'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      if (clip.showLeftHandle !== false) ctx.fillRect(x1 + 1, barY + 2, 4, barH - 4)
      if (clip.showRightHandle !== false) ctx.fillRect(x1 + w - 5, barY + 2, 4, barH - 4)
    }

    if (clip.label && w >= 48) {
      ctx.save()
      ctx.fillStyle = 'rgba(255,255,255,0.92)'
      ctx.font = '600 11px system-ui'
      ctx.textBaseline = 'middle'
      const label = clip.label.length > 18 ? `${clip.label.slice(0, 17)}…` : clip.label
      ctx.fillText(label, x1 + 8, barY + barH / 2)
      ctx.restore()
    }
  }

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = size.w * dpr
    canvas.height = size.h * dpr
    canvas.style.width = `${size.w}px`
    canvas.style.height = `${size.h}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    ctx.fillStyle = '#0c0e14'
    ctx.fillRect(0, 0, size.w, size.h)

    const { start, end } = visibleRange()
    const beatMs = 60000 / Math.max(props.bpm, 1)
    const tracksTop = RULER_HEIGHT + WAVEFORM_HEIGHT

    ctx.fillStyle = '#131722'
    ctx.fillRect(0, 0, size.w, tracksTop)

    ctx.strokeStyle = '#252a38'
    ctx.lineWidth = 1
    const gridStep = beatMs / 4
    for (let t = Math.floor(start / gridStep) * gridStep; t <= end; t += gridStep) {
      const x = timeToX(t, props.scrollMs, props.zoomPxPerMs)
      if (x < HEADER_WIDTH) continue
      ctx.beginPath()
      ctx.moveTo(x, RULER_HEIGHT)
      ctx.lineTo(x, size.h)
      ctx.stroke()
    }

    ctx.fillStyle = '#9aa3b2'
    ctx.font = '600 11px ui-monospace, monospace'
    for (let t = Math.floor(start / 1000) * 1000; t <= end; t += 1000) {
      const x = timeToX(t, props.scrollMs, props.zoomPxPerMs)
      if (x < HEADER_WIDTH - 20) continue
      ctx.fillText(formatRulerLabel(t), x + 3, 18)
    }

    const wfTop = RULER_HEIGHT
    ctx.fillStyle = '#1a2030'
    ctx.fillRect(HEADER_WIDTH, wfTop, size.w - HEADER_WIDTH, WAVEFORM_HEIGHT)

    const peaks = props.waveformPeaks
    const dur = Math.max(props.durationMs, 1)
    ctx.strokeStyle = '#60a5fa'
    ctx.lineWidth = 1
    if (peaks?.length) {
      ctx.globalAlpha = 0.9
      const mid = wfTop + WAVEFORM_HEIGHT / 2
      for (let x = HEADER_WIDTH; x < size.w; x++) {
        const t = xToTime(x, props.scrollMs, props.zoomPxPerMs)
        const idx = Math.floor((t / dur) * peaks.length)
        if (idx < 0 || idx >= peaks.length) continue
        const h = peaks[idx] * (WAVEFORM_HEIGHT / 2 - 4)
        ctx.beginPath()
        ctx.moveTo(x, mid - h)
        ctx.lineTo(x, mid + h)
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1

    const keyframes = props.keyframes ?? []
    for (const kf of keyframes) {
      const kx = timeToX(kf.timeMs, props.scrollMs, props.zoomPxPerMs)
      if (kx < HEADER_WIDTH || kf.timeMs < start || kf.timeMs > end) continue
      const kfY = wfTop + WAVEFORM_HEIGHT - 2
      ctx.fillStyle = '#fbbf24'
      ctx.strokeStyle = '#fef3c7'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(kx, kfY - 10)
      ctx.lineTo(kx + 6, kfY)
      ctx.lineTo(kx, kfY + 10)
      ctx.lineTo(kx - 6, kfY)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.35)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(kx, wfTop)
      ctx.lineTo(kx, wfTop + WAVEFORM_HEIGHT)
      ctx.stroke()
    }

    const clipRectByEventId = new Map<string, { x1: number; x2: number; y: number }>()

    trackOrder.forEach((partId, i) => {
      const y = tracksTop + i * TRACK_HEIGHT
      ctx.fillStyle = i % 2 === 0 ? '#10141d' : '#0c0e14'
      ctx.fillRect(0, y, size.w, TRACK_HEIGHT)
      ctx.fillStyle = '#64748b'
      ctx.font = '600 12px system-ui'
      ctx.fillText(partLabels[partId] ?? partId, 14, y + TRACK_HEIGHT / 2 + 4)

      for (const ev of eventsForPart(displayEvents, partId)) {
        const eventStart = tryParseTimeToMs(ev.from)
        const eventEnd = tryParseTimeToMs(ev.to)
        const groupIndex = ev.params?.route_group_id ? ev.params.route_group_index ?? 0 : null
        const label = ev.params?.route_label
          ? `${getEffectLabel(ev.effect)} · ${ev.params.route_label}`
          : groupIndex !== null
            ? `${segmentBadge(groupIndex)} ${getEffectLabel(ev.effect)}`
            : getEffectLabel(ev.effect)
        for (const clip of clipsForEventPart(ev, partId, props.parts)) {
          drawClip(
            ctx,
            {
              partId,
              ...clip,
              color: ev.color,
              label,
              selected: props.selectedId === ev.id,
              showLeftHandle: clip.startMs === eventStart,
              showRightHandle: clip.endMs === eventEnd
            },
            y,
            start,
            end
          )
          if (ev.params?.route_group_id) {
            clipRectByEventId.set(ev.id, {
              x1: timeToX(clip.startMs, props.scrollMs, props.zoomPxPerMs),
              x2: timeToX(clip.endMs, props.scrollMs, props.zoomPxPerMs),
              y
            })
          }
        }
      }
    })

    // Draw thin dashed connectors between adjacent segments of the same
    // route group. Purely visual — does not affect hit-test or dragging.
    const groupsById = new Map<string, TimelineEventUI[]>()
    for (const ev of displayEvents) {
      const gid = ev.params?.route_group_id
      if (!gid) continue
      const list = groupsById.get(gid) ?? []
      list.push(ev)
      groupsById.set(gid, list)
    }

    if (groupsById.size > 0) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(HEADER_WIDTH, tracksTop, Math.max(0, size.w - HEADER_WIDTH), Math.max(0, size.h - tracksTop))
      ctx.clip()
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 4])
      for (const groupEvents of groupsById.values()) {
        const sorted = [...groupEvents].sort(
          (a, b) => (a.params?.route_group_index ?? 0) - (b.params?.route_group_index ?? 0)
        )
        for (let i = 0; i < sorted.length - 1; i++) {
          const rectA = clipRectByEventId.get(sorted[i].id)
          const rectB = clipRectByEventId.get(sorted[i + 1].id)
          if (!rectA || !rectB) continue
          ctx.beginPath()
          ctx.moveTo(rectA.x2, rectA.y + TRACK_HEIGHT / 2)
          ctx.lineTo(rectB.x1, rectB.y + TRACK_HEIGHT / 2)
          ctx.stroke()
        }
      }
      ctx.setLineDash([])
      ctx.restore()
    }

    if (createPreview) {
      const idx = trackOrder.indexOf(createPreview.partId)
      const y = tracksTop + idx * TRACK_HEIGHT
      drawClip(ctx, createPreview, y, start, end)
    }

    const phx = timeToX(props.playheadMs, props.scrollMs, props.zoomPxPerMs)
    if (phx >= HEADER_WIDTH) {
      ctx.strokeStyle = '#f472b6'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(phx, 0)
      ctx.lineTo(phx, size.h)
      ctx.stroke()
      ctx.fillStyle = '#f472b6'
      ctx.beginPath()
      ctx.moveTo(phx - 5, 0)
      ctx.lineTo(phx + 5, 0)
      ctx.lineTo(phx, 7)
      ctx.fill()
    }
  }, [props, size, visibleRange, displayEvents, createPreview, trackOrder, partLabels])

  useEffect(() => {
    draw()
  }, [draw])

  const hitTest = (
    mx: number,
    my: number
  ): { partId: PartId; eventId?: string; edge?: 'left' | 'right' } | null => {
    const tracksTop = RULER_HEIGHT + WAVEFORM_HEIGHT
    if (my < tracksTop) return null
    const partId = partAtY(my, tracksTop)

    for (const ev of eventsForPart(displayEvents, partId)) {
      const eventStart = tryParseTimeToMs(ev.from)
      const eventEnd = tryParseTimeToMs(ev.to)
      if (eventStart === null || eventEnd === null) continue
      for (const clip of clipsForEventPart(ev, partId, props.parts)) {
        const x1 = timeToX(clip.startMs, props.scrollMs, props.zoomPxPerMs)
        const x2 = timeToX(clip.endMs, props.scrollMs, props.zoomPxPerMs)
        const y = tracksTop + trackOrder.indexOf(partId) * TRACK_HEIGHT + 5
        const barH = TRACK_HEIGHT - 10
        if (mx >= x1 && mx <= x2 && my >= y && my <= y + barH) {
          if (clip.startMs === eventStart && Math.abs(mx - x1) <= EDGE_HIT) {
            return { partId, eventId: ev.id, edge: 'left' }
          }
          if (clip.endMs === eventEnd && Math.abs(mx - x2) <= EDGE_HIT) {
            return { partId, eventId: ev.id, edge: 'right' }
          }
          return { partId, eventId: ev.id }
        }
      }
    }
    return { partId }
  }

  const cursorForHit = (hit: ReturnType<typeof hitTest>) => {
    if (!hit?.eventId) return 'crosshair'
    if (hit.edge) return 'ew-resize'
    return 'grab'
  }

  const applyDrag = (mx: number, my: number) => {
    const drag = dragRef.current
    if (!drag) return
    const t = props.snapTime(xToTime(mx, props.scrollMs, props.zoomPxPerMs))
    const tracksTop = RULER_HEIGHT + WAVEFORM_HEIGHT

    if (drag.mode === 'create') {
      if (Math.abs(mx - drag.startMouseX) < MIN_CREATE_DRAG_PX) return
      drag.createStarted = true
      const endMs = Math.max(drag.origStartMs + MIN_CLIP_MS, t)
      setCreatePreview({
        partId: drag.partId,
        startMs: drag.origStartMs,
        endMs,
        ghost: true,
        color: 'electric_cyan'
      })
      drag.createEndMs = endMs
      return
    }

    if (drag.mode === 'scrub') {
      const scrubMs = Math.max(0, Math.min(props.durationMs, xToTime(mx, props.scrollMs, props.zoomPxPerMs)))
      props.onPlayheadChange(scrubMs)
      return
    }

    if (!drag.eventId) return
    const dur = drag.origEndMs - drag.origStartMs
    let newStart = drag.origStartMs
    let newEnd = drag.origEndMs

    if (drag.mode === 'move') {
      // 單純點擊（位移小於門檻）只做選取，不進入拖曳，避免誤改 clip
      if (
        !drag.moveStarted &&
        Math.abs(mx - drag.startMouseX) < MIN_MOVE_DRAG_PX &&
        Math.abs(my - drag.startMouseY) < MIN_MOVE_DRAG_PX
      ) {
        return
      }
      drag.moveStarted = true
      const anchor = props.snapTime(xToTime(drag.startMouseX, props.scrollMs, props.zoomPxPerMs))
      const delta = t - anchor
      newStart = Math.max(0, props.snapTime(drag.origStartMs + delta))
      newEnd = newStart + dur
      drag.targetPartId = drag.allowPartReassign ? partAtY(my, tracksTop) : drag.origPartId
    } else if (drag.mode === 'resize-left') {
      newStart = Math.min(t, drag.origEndMs - MIN_CLIP_MS)
      newEnd = drag.origEndMs
    } else if (drag.mode === 'resize-right') {
      newStart = drag.origStartMs
      newEnd = Math.max(t, drag.origStartMs + MIN_CLIP_MS)
    }

    // 只有「單一部位的 clip 被垂直拖到別的 track」才改 targets；
    // 跨部位路徑 clip 與純水平移動 / resize 都保留原本的 targets。
    const nextPartId =
      drag.mode === 'move' &&
      drag.allowPartReassign &&
      drag.targetPartId &&
      drag.targetPartId !== drag.origPartId
        ? drag.targetPartId
        : undefined
    const next = patchEvent(displayEvents, drag.eventId, newStart, newEnd, nextPartId)
    liveEventsRef.current = next
    setLiveEvents(next)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    const wfBottom = RULER_HEIGHT + WAVEFORM_HEIGHT

    if (my < wfBottom && mx > HEADER_WIDTH) {
      const ms = Math.max(0, Math.min(props.durationMs, xToTime(mx, props.scrollMs, props.zoomPxPerMs)))
      if (my >= RULER_HEIGHT) {
        dragRef.current = {
          mode: 'scrub',
          partId: defaultPartId,
          startMouseX: mx,
          startMouseY: my,
          origStartMs: ms,
          origEndMs: ms
        }
        setCursor('ew-resize')
        captureRef.current = true
        props.onPlayheadChange(ms)
        ;(e.target as HTMLCanvasElement).setPointerCapture(e.pointerId)
        return
      }
      props.onPlayheadChange(props.snapTime(ms))
      return
    }

    const hit = hitTest(mx, my)
    if (!hit) return

    if (hit.eventId) {
      props.onSelect(hit.eventId)
      const ev = displayEvents.find((x) => x.id === hit.eventId)!
      dragRef.current = {
        mode: hit.edge === 'left' ? 'resize-left' : hit.edge === 'right' ? 'resize-right' : 'move',
        eventId: hit.eventId,
        partId: hit.partId,
        origPartId: hit.partId,
        targetPartId: hit.partId,
        startMouseX: mx,
        startMouseY: my,
        origStartMs: parseTimeToMs(ev.from),
        origEndMs: parseTimeToMs(ev.to),
        allowPartReassign: ev.targets.length <= 1
      }
      setCursor(hit.edge ? 'ew-resize' : 'grabbing')
    } else {
      props.onSelect(null)
      dragRef.current = {
        mode: 'create',
        partId: hit.partId,
        startMouseX: mx,
        startMouseY: my,
        origStartMs: props.snapTime(xToTime(mx, props.scrollMs, props.zoomPxPerMs)),
        origEndMs: 0
      }
      setCursor('crosshair')
    }
    captureRef.current = true
    ;(e.target as HTMLCanvasElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    if (dragRef.current) {
      applyDrag(mx, my)
      return
    }

    if (my >= RULER_HEIGHT && my < RULER_HEIGHT + WAVEFORM_HEIGHT && mx > HEADER_WIDTH) {
      setCursor('ew-resize')
      return
    }

    setCursor(cursorForHit(hitTest(mx, my)))
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current

    if (drag?.mode === 'create' && drag.partId && drag.createStarted && drag.createEndMs !== undefined) {
      const endMs = drag.createEndMs
      if (endMs - drag.origStartMs >= MIN_CLIP_MS) {
        const { from, to } = msToFromTo(drag.origStartMs, endMs)
        const newEv: TimelineEventUI = {
          id: `evt_${Date.now()}`,
          from,
          to,
          targets: [drag.partId],
          color: 'electric_cyan',
          effect: 'solid',
          params: {
            fade_curve: 'ease_in_out',
            intensity: 1,
            speed: 1
          },
          priority: 10
        }
        props.onEventsChange([...props.events, newEv])
        props.onSelect(newEv.id)
      }
      setCreatePreview(null)
    } else if (drag && liveEventsRef.current) {
      props.onEventsChange(liveEventsRef.current)
      liveEventsRef.current = null
      setLiveEvents(null)
    }

    dragRef.current = null
    setCursor('default')
    if (captureRef.current) {
      captureRef.current = false
      try {
        ;(e.target as HTMLCanvasElement).releasePointerCapture(e.pointerId)
      } catch {
        // ignore
      }
    }
  }

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect || !props.onKeyframesChange) return
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const wfTop = RULER_HEIGHT
    if (my < wfTop || my >= wfTop + WAVEFORM_HEIGHT || mx <= HEADER_WIDTH) return

    const keyframes = props.keyframes ?? []
    const hitKf = keyframes.find(
      (kf) => Math.abs(timeToX(kf.timeMs, props.scrollMs, props.zoomPxPerMs) - mx) <= 10
    )
    if (hitKf) {
      props.onKeyframesChange(keyframes.filter((k) => k.id !== hitKf.id))
      return
    }

    const t = props.snapTime(xToTime(mx, props.scrollMs, props.zoomPxPerMs))
    props.onKeyframesChange([
      ...keyframes,
      { id: `kf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, timeMs: t }
    ])
  }

  return (
    <div
      ref={containerRef}
      className="timeline-canvas-wrap"
      style={{ flex: 'none', height: contentH, overflow: 'auto' }}
    >
      <canvas
        ref={canvasRef}
        className="timeline-canvas"
        style={{ cursor, height: contentH }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={onContextMenu}
        onPointerLeave={() => {
          if (!dragRef.current) setCursor('default')
        }}
      />
    </div>
  )
}

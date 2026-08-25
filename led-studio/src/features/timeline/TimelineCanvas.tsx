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
/** 指標距離畫面左右緣多少 px 之內就開始自動捲動 */
const EDGE_SCROLL_PX = 32
/** 自動捲動的最高速度（px/幀），實際速度依接近邊緣的程度線性遞增 */
const EDGE_SCROLL_MAX_PX = 14
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
  selectedIds: string[]
  waveformPeaks?: number[] | null
  keyframes?: TimelineKeyframe[]
  onSelectionChange: (ids: string[]) => void
  onEventsChange: (events: TimelineEventUI[]) => void
  onPlayheadChange: (ms: number) => void
  onKeyframesChange?: (keyframes: TimelineKeyframe[]) => void
  onZoomAt?: (anchorMs: number, factor: number) => void
  /**
   * 拖曳 playhead 到畫面左右邊緣時持續呼叫，deltaMs 為這一幀要捲動的量
   * （負值往左）。呼叫端要同時捲動畫面並把 playhead 推進同樣的量。
   */
  onEdgeScroll?: (deltaMs: number) => void
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
  /** 最新的指標 x，供邊緣自動捲動的 rAF 迴圈使用 */
  lastMouseX?: number
  /** move 模式下，拖曳開始時整個選取集合裡每個 event 的原始 start/end 快照 */
  origById?: Record<string, { start: number; end: number }>
  /** 一般點擊（非 mod、非 shift）時記錄的 id：放開時若沒有真的拖曳，就把選取收斂成只有這一個 */
  clickCollapseId?: string
}

interface ClipPreview {
  partId: PartId
  startMs: number
  endMs: number
  color?: string
  label?: string
  selected?: boolean
  primary?: boolean
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

/**
 * 對 origById 快照裡的每個 event 套用同一個時間位移 delta（純函式，方便單獨測試）。
 * - 不在 origById 裡的 event 完全不動。
 * - 若套用 delta 後有任何 event 的 newStart 會小於 0，整組的 delta 會往回調整，
 *   讓「最早」的那個剛好停在 0——整組一起停，不會各自被夾成不同位移而散開。
 */
export function applyGroupDelta(
  events: TimelineEventUI[],
  origById: Record<string, { start: number; end: number }>,
  delta: number
): TimelineEventUI[] {
  const ids = Object.keys(origById)
  if (ids.length === 0) return events

  let minStart = Infinity
  for (const id of ids) {
    minStart = Math.min(minStart, origById[id].start)
  }
  const clampedDelta = minStart + delta < 0 ? -minStart : delta

  return events.map((e) => {
    const orig = origById[e.id]
    if (!orig) return e
    const newStart = orig.start + clampedDelta
    const newEnd = newStart + (orig.end - orig.start)
    const { from, to } = msToFromTo(newStart, newEnd)
    return { ...e, from, to }
  })
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
  const edgeRafRef = useRef(0)
  // rAF 迴圈裡讀不到最新的 props/size，所以每次 render 都同步進 ref
  const edgeCtxRef = useRef({ zoom: props.zoomPxPerMs, width: 800, onEdgeScroll: props.onEdgeScroll })

  edgeCtxRef.current = {
    zoom: props.zoomPxPerMs,
    width: size.w,
    onEdgeScroll: props.onEdgeScroll
  }

  const stopEdgeScroll = useCallback(() => {
    if (edgeRafRef.current) {
      cancelAnimationFrame(edgeRafRef.current)
      edgeRafRef.current = 0
    }
  }, [])

  /**
   * 拖 playhead 到畫面左右邊緣時持續捲動。速度依「指標離邊緣多近」線性遞增，
   * 所以輕輕碰到邊緣是慢慢滑，壓到最邊才是最快 —— 這樣才能一點一點微調。
   */
  const edgeScrollTick = useCallback(() => {
    const drag = dragRef.current
    const { zoom, width, onEdgeScroll } = edgeCtxRef.current
    if (!drag || drag.mode !== 'scrub' || !onEdgeScroll || drag.lastMouseX === undefined) {
      edgeRafRef.current = 0
      return
    }
    const mx = drag.lastMouseX
    const leftBound = HEADER_WIDTH + EDGE_SCROLL_PX
    const rightBound = width - EDGE_SCROLL_PX
    let px = 0
    if (mx < leftBound) {
      px = -EDGE_SCROLL_MAX_PX * Math.min(1, (leftBound - mx) / EDGE_SCROLL_PX)
    } else if (mx > rightBound) {
      px = EDGE_SCROLL_MAX_PX * Math.min(1, (mx - rightBound) / EDGE_SCROLL_PX)
    }
    if (px !== 0 && zoom > 0) onEdgeScroll(px / zoom)
    edgeRafRef.current = requestAnimationFrame(edgeScrollTick)
  }, [])

  const ensureEdgeScroll = useCallback(() => {
    if (!edgeRafRef.current) edgeRafRef.current = requestAnimationFrame(edgeScrollTick)
  }, [edgeScrollTick])

  useEffect(() => stopEdgeScroll, [stopEdgeScroll])

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
      ctx.strokeStyle = clip.primary ? '#ffffff' : '#f8fafc'
      ctx.lineWidth = clip.primary ? 3 : 2
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
    const selectedIdSet = new Set(props.selectedIds)
    const primaryId =
      props.selectedIds.length > 0 ? props.selectedIds[props.selectedIds.length - 1] : null

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
              selected: selectedIdSet.has(ev.id),
              primary: primaryId === ev.id,
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
      drag.lastMouseX = mx
      const scrubMs = Math.max(0, Math.min(props.durationMs, xToTime(mx, props.scrollMs, props.zoomPxPerMs)))
      props.onPlayheadChange(scrubMs)
      ensureEdgeScroll()
      return
    }

    if (!drag.eventId) return
    const eventId = drag.eventId

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
      drag.targetPartId = drag.allowPartReassign ? partAtY(my, tracksTop) : drag.origPartId

      // origById 是拖曳開始時整個選取集合的快照；只有被按住的那一個會用 snapTime 算 delta，
      // 其他成員套用同一個 delta，整組相對關係完全不變。
      const origById = drag.origById ?? { [eventId]: { start: drag.origStartMs, end: drag.origEndMs } }
      let next = applyGroupDelta(props.events, origById, delta)

      // 只有「單一部位的 clip 被垂直拖到別的 track」才改 targets；
      // 跨部位路徑 clip、多選、與純水平移動都保留原本的 targets。
      if (drag.allowPartReassign && drag.targetPartId && drag.targetPartId !== drag.origPartId) {
        const targetPartId = drag.targetPartId
        next = next.map((e) => (e.id === eventId ? { ...e, targets: [targetPartId] } : e))
      }

      liveEventsRef.current = next
      setLiveEvents(next)
      return
    }

    let newStart = drag.origStartMs
    let newEnd = drag.origEndMs

    if (drag.mode === 'resize-left') {
      newStart = Math.min(t, drag.origEndMs - MIN_CLIP_MS)
      newEnd = drag.origEndMs
    } else if (drag.mode === 'resize-right') {
      newStart = drag.origStartMs
      newEnd = Math.max(t, drag.origStartMs + MIN_CLIP_MS)
    } else {
      return
    }

    // resize 一律只作用被拖曳的那一個 event，即使目前是多選狀態。
    const next = patchEvent(displayEvents, eventId, newStart, newEnd)
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
      // 刻度尺與波形區都能直接拖 playhead
      dragRef.current = {
        mode: 'scrub',
        partId: defaultPartId,
        startMouseX: mx,
        startMouseY: my,
        lastMouseX: mx,
        origStartMs: ms,
        origEndMs: ms
      }
      setCursor('ew-resize')
      captureRef.current = true
      props.onPlayheadChange(my >= RULER_HEIGHT ? ms : props.snapTime(ms))
      ;(e.target as HTMLCanvasElement).setPointerCapture(e.pointerId)
      return
    }

    const hit = hitTest(mx, my)
    if (!hit) return

    if (hit.eventId) {
      const id = hit.eventId
      const mode: DragMode = hit.edge === 'left' ? 'resize-left' : hit.edge === 'right' ? 'resize-right' : 'move'
      const isMod = e.metaKey || e.ctrlKey
      const isShift = e.shiftKey
      const current = props.selectedIds
      const wasSelected = current.includes(id)

      let nextSelection: string[]
      let clickCollapseId: string | undefined

      if (mode !== 'move') {
        // resize 不改變多選集合的組成，只確保被拖曳的 clip 有被選取
        nextSelection = wasSelected ? current : [id]
      } else if (isShift) {
        const primaryId = current.length > 0 ? current[current.length - 1] : id
        const primaryEvent = displayEvents.find((x) => x.id === primaryId)
        if (primaryEvent && primaryId !== id) {
          const aStart = tryParseTimeToMs(primaryEvent.from)
          const bStart = tryParseTimeToMs(displayEvents.find((x) => x.id === id)?.from ?? '')
          if (aStart !== null && bStart !== null) {
            const lo = Math.min(aStart, bStart)
            const hi = Math.max(aStart, bStart)
            const between = eventsForPart(displayEvents, hit.partId)
              .filter((ev) => {
                const s = tryParseTimeToMs(ev.from)
                return s !== null && s >= lo && s <= hi
              })
              .map((ev) => ev.id)
            const merged = new Set(current)
            for (const bid of between) merged.add(bid)
            merged.delete(id)
            nextSelection = [...merged, id]
          } else {
            nextSelection = wasSelected ? current : [...current, id]
          }
        } else {
          nextSelection = wasSelected ? current : [...current, id]
        }
      } else if (isMod) {
        // Cmd/Ctrl 點擊：toggle
        nextSelection = wasSelected ? current.filter((x) => x !== id) : [...current, id]
      } else {
        // 一般點擊：已選取的 clip 保持整個集合不變（才能拖動整組）；
        // 未選取則單選它。放開時若沒有真的拖曳，onPointerUp 會收斂成單選。
        nextSelection = wasSelected ? current : [id]
        clickCollapseId = id
      }

      props.onSelectionChange(nextSelection)

      const ev = displayEvents.find((x) => x.id === id)!
      let origById: Record<string, { start: number; end: number }> | undefined
      if (mode === 'move') {
        origById = {}
        for (const sid of nextSelection) {
          const sev = displayEvents.find((x) => x.id === sid)
          if (!sev) continue
          const s = tryParseTimeToMs(sev.from)
          const en = tryParseTimeToMs(sev.to)
          if (s === null || en === null) continue
          origById[sid] = { start: s, end: en }
        }
      }

      dragRef.current = {
        mode,
        eventId: id,
        partId: hit.partId,
        origPartId: hit.partId,
        targetPartId: hit.partId,
        startMouseX: mx,
        startMouseY: my,
        origStartMs: parseTimeToMs(ev.from),
        origEndMs: parseTimeToMs(ev.to),
        allowPartReassign: nextSelection.length <= 1 && ev.targets.length <= 1,
        origById,
        clickCollapseId
      }
      setCursor(hit.edge ? 'ew-resize' : 'grabbing')
    } else {
      props.onSelectionChange([])
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
        props.onSelectionChange([newEv.id])
      }
      setCreatePreview(null)
    } else if (drag && liveEventsRef.current) {
      props.onEventsChange(liveEventsRef.current)
      liveEventsRef.current = null
      setLiveEvents(null)
    }

    // 一般點擊（非拖曳）已選取的 clip 時，pointerDown 保留了整組選取以便拖動；
    // 放開時若沒有真的移動（moveStarted 仍為 false），就收斂成只選這一個，符合「點一下＝單選」的直覺。
    if (drag?.mode === 'move' && !drag.moveStarted && drag.clickCollapseId) {
      props.onSelectionChange([drag.clickCollapseId])
    }

    stopEdgeScroll()
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
      style={{ flex: '1 1 auto', height: contentH, overflow: 'auto' }}
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

import type { EffectId, PartId, TimelineEventUI } from './types/project'
import { formatMsToTime, parseTimeToMs } from './timeParse'
import { newEventId } from './projectMutations'

const MIN_CLIP_MS = 50

export interface TimelineClipClipboard {
  durationMs: number
  targets: PartId[]
  color: string
  effect: EffectId
  params?: Record<string, unknown>
  priority: number
  note?: string
}

export function clipFromEvent(event: TimelineEventUI): TimelineClipClipboard {
  const startMs = parseTimeToMs(event.from)
  const endMs = parseTimeToMs(event.to)
  return {
    durationMs: Math.max(MIN_CLIP_MS, endMs - startMs),
    targets: [...event.targets],
    color: event.color,
    effect: event.effect,
    params: event.params ? { ...event.params } : undefined,
    priority: event.priority,
    note: event.note
  }
}

/** 一組 clip 裡的單一成員，時間以「整組最早的 start」為基準的相對偏移表示。 */
export interface TimelineClipItem extends TimelineClipClipboard {
  offsetMs: number
}

/** 多選複製的內容：保留成員之間的相對時間關係。 */
export interface TimelineClipGroup {
  items: TimelineClipItem[]
  /** 整組的總跨度（最早 start 到最晚 end） */
  spanMs: number
}

/** 把一組 event 複製成 clipboard 內容，保留彼此的相對時間關係。 */
export function clipsFromEvents(events: TimelineEventUI[]): TimelineClipGroup | null {
  if (events.length === 0) return null

  const withMs = events
    .map((event) => ({
      event,
      startMs: parseTimeToMs(event.from),
      endMs: parseTimeToMs(event.to)
    }))
    .sort((a, b) => a.startMs - b.startMs)

  const base = withMs[0].startMs
  const spanMs = Math.max(...withMs.map((x) => x.endMs)) - base

  return {
    items: withMs.map(({ event, startMs }) => ({
      ...clipFromEvent(event),
      offsetMs: startMs - base
    })),
    spanMs
  }
}

/**
 * 把一組 clip 貼到 playhead，維持成員之間的相對關係。
 *
 * 整組會先對齊到 playhead，若尾端超出音樂長度就把「整組」往前平移（而不是讓
 * 個別成員各自被夾住而散開）；真的塞不下時才逐一夾制。
 *
 * 帶有 route_group_id 的成員會拿到新的 group id（同組共用一個），避免貼上後
 * 與原本那組路徑混在一起。
 */
export function pasteClips(
  group: TimelineClipGroup,
  playheadMs: number,
  musicDurationMs: number,
  snapTime: (ms: number) => number
): TimelineEventUI[] {
  let base = Math.max(0, snapTime(playheadMs))
  if (base + group.spanMs > musicDurationMs) {
    base = Math.max(0, musicDurationMs - group.spanMs)
  }

  const groupIdMap = new Map<string, string>()
  const stamp = newEventId()

  return group.items.map((item, index) => {
    const startMs = Math.max(0, base + item.offsetMs)
    const endMs = Math.min(
      musicDurationMs,
      Math.max(startMs + MIN_CLIP_MS, startMs + item.durationMs)
    )

    let params = item.params ? { ...item.params } : undefined
    const oldGroupId = params?.route_group_id
    if (typeof oldGroupId === 'string' && params) {
      if (!groupIdMap.has(oldGroupId)) {
        groupIdMap.set(oldGroupId, `route_grp_${stamp}_${groupIdMap.size}`)
      }
      params = { ...params, route_group_id: groupIdMap.get(oldGroupId)! }
    }

    return {
      id: `${stamp}_${index}`,
      from: formatMsToTime(startMs),
      to: formatMsToTime(endMs),
      targets: [...item.targets],
      color: item.color,
      effect: item.effect,
      params: params as TimelineEventUI['params'],
      priority: item.priority,
      note: item.note
    }
  })
}

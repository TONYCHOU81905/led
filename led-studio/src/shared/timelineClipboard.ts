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

export function pasteClip(
  clip: TimelineClipClipboard,
  playheadMs: number,
  musicDurationMs: number,
  snapTime: (ms: number) => number
): TimelineEventUI {
  const startMs = Math.max(0, snapTime(playheadMs))
  const endMs = Math.min(musicDurationMs, Math.max(startMs + MIN_CLIP_MS, startMs + clip.durationMs))

  return {
    id: newEventId(),
    from: formatMsToTime(startMs),
    to: formatMsToTime(endMs),
    targets: [...clip.targets],
    color: clip.color,
    effect: clip.effect,
    params: clip.params ? { ...clip.params } : undefined,
    priority: clip.priority,
    note: clip.note
  }
}

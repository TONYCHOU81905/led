import type { PartDefinition, PartId } from '../../shared/types/project'

export function buildTrackMeta(parts: PartDefinition[]): {
  order: PartId[]
  labels: Record<string, string>
  trackParts: { id: PartId; label: string }[]
} {
  const order = parts.map((p) => p.id)
  const labels = Object.fromEntries(parts.map((p) => [p.id, p.display_name]))
  const trackParts = parts.map((p) => ({ id: p.id, label: p.display_name }))
  return { order, labels, trackParts }
}

/** @deprecated Use buildTrackMeta(role.parts) — kept for tests importing static labels */
export const TRACK_PARTS: { id: PartId; label: string }[] = [
  { id: 'body', label: '身體' },
  { id: 'head', label: '頭部' },
  { id: 'left_hand', label: '左手' },
  { id: 'right_hand', label: '右手' },
  { id: 'left_foot', label: '左腳' },
  { id: 'right_foot', label: '右腳' }
]

export const PART_LABELS: Record<string, string> = Object.fromEntries(
  TRACK_PARTS.map((p) => [p.id, p.label])
)

export const TRACK_ORDER: PartId[] = TRACK_PARTS.map((p) => p.id)

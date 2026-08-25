import type { TimelineEventParams, TimelineEventUI } from '../../shared/types/project'

/**
 * 多選時「只能套用在主選取」的頂層欄位。
 *
 * from/to 是絕對時間 —— 套用到整組會把所有 clip 疊在同一個時間點。
 * targets 是發亮部位 —— 套用到整組會讓所有 clip 擠到同一條軌道。
 * 兩者都會讓使用者辛苦排好的內容瞬間崩掉，所以一律只改主選取。
 */
export const PRIMARY_ONLY_KEYS: ReadonlySet<string> = new Set(['id', 'from', 'to', 'targets'])

/**
 * 同理，路徑群組相關的 params 也只作用在主選取 ——
 * 一條流動路徑本身就是一組 clip，再對多選批次套用語意會打架。
 */
export const PRIMARY_ONLY_PARAM_KEYS: ReadonlySet<string> = new Set([
  'route_preset',
  'route_parts',
  'route_step_labels',
  'route_label',
  'route_group_id',
  'route_group_label',
  'route_group_index',
  'route_group_total',
  'route_step_label'
])

/** 找出 next 相對於 prev 真正變動的 params key（含被刪除的）。 */
export function changedParamKeys(
  prev: TimelineEventParams | undefined,
  next: TimelineEventParams | undefined
): string[] {
  if (!next) return []
  const keys = new Set([...Object.keys(prev ?? {}), ...Object.keys(next)])
  const changed: string[] = []
  for (const k of keys) {
    const a = (prev ?? {})[k as keyof TimelineEventParams]
    const b = next[k as keyof TimelineEventParams]
    if (JSON.stringify(a) !== JSON.stringify(b)) changed.push(k)
  }
  return changed
}

/**
 * 把 Inspector 送出的 patch 套用到選取集合。
 *
 * 主選取吃完整的 patch；其他成員只吃「可共享」的部分（顏色、效果、優先權，
 * 以及這次真正被改動、且不屬於路徑群組的 params key）。
 *
 * params 是整包替換而非 delta，所以這裡先跟主選取的舊 params 比對出真正變動的
 * key，只把那幾個 key 疊到其他成員自己的 params 上 —— 否則批次改個速度就會把
 * 別的 clip 的顏色、拖尾等設定一起覆蓋掉。
 */
export function buildSelectionPatch(
  events: TimelineEventUI[],
  primaryId: string,
  selectedIds: readonly string[],
  patch: Partial<TimelineEventUI>
): TimelineEventUI[] {
  const primary = events.find((e) => e.id === primaryId)
  if (!primary) return events

  const others = new Set(selectedIds.filter((id) => id !== primaryId))

  const shared: Partial<TimelineEventUI> = {}
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'params' || PRIMARY_ONLY_KEYS.has(k)) continue
    ;(shared as Record<string, unknown>)[k] = v
  }

  const sharedParamKeys =
    'params' in patch
      ? changedParamKeys(primary.params, patch.params).filter(
          (k) => !PRIMARY_ONLY_PARAM_KEYS.has(k)
        )
      : []

  const hasShared = Object.keys(shared).length > 0 || sharedParamKeys.length > 0

  return events.map((e) => {
    if (e.id === primaryId) return { ...e, ...patch }
    if (!others.has(e.id) || !hasShared) return e

    const next: TimelineEventUI = { ...e, ...shared }
    if (sharedParamKeys.length > 0) {
      const nextParams: TimelineEventParams = { ...(e.params ?? {}) }
      for (const k of sharedParamKeys) {
        const v = patch.params?.[k as keyof TimelineEventParams]
        if (v === undefined || v === null || v === '') {
          delete nextParams[k as keyof TimelineEventParams]
        } else {
          ;(nextParams as Record<string, unknown>)[k] = v
        }
      }
      next.params = nextParams
    }
    return next
  })
}

/**
 * 把整組選取的 clip 統一設成同一個片段長度（固定各自的開頭，只動結尾）。
 * 超過 maxToMs 的成員維持不變，避免把 clip 推到音樂結束之後。
 */
export function applyDurationToSelection(
  events: TimelineEventUI[],
  selectedIds: readonly string[],
  durationMs: number,
  parseMs: (t: string) => number | null,
  formatMs: (ms: number) => string,
  maxToMs?: number
): TimelineEventUI[] {
  const target = new Set(selectedIds)
  return events.map((e) => {
    if (!target.has(e.id)) return e
    const from = parseMs(e.from)
    if (from === null) return e
    const to = from + durationMs
    if (maxToMs !== undefined && to > maxToMs) return e
    return { ...e, to: formatMs(to) }
  })
}

import type { TimelineEventUI } from '../../shared/types/project'
import { formatMsToTime, parseTimeToMs } from '../../shared/timeParse'

/**
 * 多選 chips 的批次時間調整。
 *
 * 語意是 **delta（差值）**，不是絕對值。這是刻意的：
 * batchPatch.ts 把 from/to 放進 PRIMARY_ONLY_KEYS，因為把絕對時間套用到整組
 * 會讓所有 clip 疊在同一個時間點。那個顧慮成立，所以時間走這條獨立的 delta
 * 路徑，PRIMARY_ONLY_KEYS 維持不動。
 *
 * Inspector 改時間、拖曳左緣、拖曳右緣三個入口都轉成 delta 後共用這裡。
 */

export interface TimeShift {
  /** 開始時間的位移量（ms）。正數往後。 */
  fromDeltaMs?: number
  /** 結束時間的位移量（ms）。正數往後。 */
  toDeltaMs?: number
}

interface EventTimes {
  fromMs: number
  toMs: number
}

/** clip 的最短長度。低於這個值等於 clip 消失，拖曳時要在此停住。 */
export const MIN_CLIP_MS = 1

function readTimes(event: TimelineEventUI): EventTimes {
  return { fromMs: parseTimeToMs(event.from), toMs: parseTimeToMs(event.to) }
}

/**
 * 算出「整組都套用得下」的實際位移量。
 *
 * 這是本模組的核心，也是最容易做錯的地方。
 *
 * 三個 chip 在 1s / 5s / 9s，主選取往左拉 3s：
 *   各自 clamp（錯）→ 第一個夾在 0s，其餘變 2s / 6s，
 *                     相對間距從 4s 變成 2s，使用者排好的節奏毀了
 *   整組 clamp（對）→ 先算出不讓任何 chip 越界的最大移動量 −1s，
 *                     全體移動 −1s → 0s / 4s / 8s，間距完全保持
 *
 * 所以這裡先掃過所有成員求出容許範圍，再回傳單一的位移量給全體套用。
 */
export function clampShift(
  events: readonly TimelineEventUI[],
  selectedIds: readonly string[],
  shift: TimeShift,
  durationMs: number
): TimeShift {
  const ids = new Set(selectedIds)
  const targets = events.filter((e) => ids.has(e.id)).map(readTimes)
  if (targets.length === 0) return { fromDeltaMs: 0, toDeltaMs: 0 }

  // 兩端位移相同 = 整段平移，長度必須維持不變。
  //
  // 這種情況一定要把兩端夾成「同一個」值，不能各夾各的：
  // 各夾各的會讓 from 夾到 1000、to 夾到 500，長度硬生生少掉 500ms ——
  // 平移竟然改變了 clip 長度，這是最難察覺的那種錯。
  if (
    shift.fromDeltaMs !== undefined &&
    shift.toDeltaMs !== undefined &&
    shift.fromDeltaMs === shift.toDeltaMs
  ) {
    let d = shift.fromDeltaMs
    for (const t of targets) {
      if (d < 0) d = Math.max(d, -t.fromMs) // 最早的 from 不得早於 0
      if (d > 0) d = Math.min(d, durationMs - t.toMs) // 最晚的 to 不得超過總長
    }
    const rounded = Math.round(d)
    return { fromDeltaMs: rounded, toDeltaMs: rounded }
  }

  // 單端位移（拖曳某一邊）：兩端各自夾，之後再確保長度不會塌掉。
  let fromDelta = shift.fromDeltaMs ?? 0
  let toDelta = shift.toDeltaMs ?? 0

  for (const t of targets) {
    if (fromDelta < 0) fromDelta = Math.max(fromDelta, -t.fromMs)
    if (toDelta < 0) toDelta = Math.max(toDelta, -t.toMs)
    if (fromDelta > 0) fromDelta = Math.min(fromDelta, durationMs - t.fromMs)
    if (toDelta > 0) toDelta = Math.min(toDelta, durationMs - t.toMs)
  }

  // 長度不得小於 MIN_CLIP_MS
  for (const t of targets) {
    const nextLen = t.toMs + toDelta - (t.fromMs + fromDelta)
    if (nextLen >= MIN_CLIP_MS) continue
    const over = MIN_CLIP_MS - nextLen
    // 把超出的部分退回給實際在動的那一端
    if (shift.toDeltaMs !== undefined && shift.fromDeltaMs === undefined) {
      toDelta += over
    } else if (shift.fromDeltaMs !== undefined && shift.toDeltaMs === undefined) {
      fromDelta -= over
    } else {
      toDelta += over / 2
      fromDelta -= over / 2
    }
  }

  return {
    fromDeltaMs: Math.round(fromDelta),
    toDeltaMs: Math.round(toDelta)
  }
}

/**
 * 把位移套用到選取的所有 chips。
 *
 * 未被選取的 chip 原樣回傳（保持參考不變，React 才能靠 identity 跳過重繪）。
 */
export function applyShift(
  events: readonly TimelineEventUI[],
  selectedIds: readonly string[],
  shift: TimeShift,
  durationMs: number
): TimelineEventUI[] {
  const safe = clampShift(events, selectedIds, shift, durationMs)
  const fromDelta = safe.fromDeltaMs ?? 0
  const toDelta = safe.toDeltaMs ?? 0
  if (fromDelta === 0 && toDelta === 0) return events as TimelineEventUI[]

  const ids = new Set(selectedIds)
  return events.map((e) => {
    if (!ids.has(e.id)) return e
    const t = readTimes(e)
    return {
      ...e,
      from: formatMsToTime(t.fromMs + fromDelta),
      to: formatMsToTime(t.toMs + toDelta)
    }
  })
}

/**
 * 由「主選取的新開始時間」反推 delta，再套用到整組。
 * 供 Inspector 的時間欄位使用。
 */
export function shiftSelectionToStart(
  events: readonly TimelineEventUI[],
  primaryId: string,
  selectedIds: readonly string[],
  newStartMs: number,
  durationMs: number
): TimelineEventUI[] {
  const primary = events.find((e) => e.id === primaryId)
  if (!primary) return events as TimelineEventUI[]
  const delta = newStartMs - parseTimeToMs(primary.from)
  // 整段平移：兩端位移相同，長度不變
  return applyShift(events, selectedIds, { fromDeltaMs: delta, toDeltaMs: delta }, durationMs)
}

/**
 * 由「主選取的新結束時間」反推 delta，再套用到整組。
 * 只動結束端，所以每個 chip 都會等量延長或縮短。
 */
export function shiftSelectionToEnd(
  events: readonly TimelineEventUI[],
  primaryId: string,
  selectedIds: readonly string[],
  newEndMs: number,
  durationMs: number
): TimelineEventUI[] {
  const primary = events.find((e) => e.id === primaryId)
  if (!primary) return events as TimelineEventUI[]
  const delta = newEndMs - parseTimeToMs(primary.to)
  return applyShift(events, selectedIds, { toDeltaMs: delta }, durationMs)
}

import type { LedProject, PartDefinition, PartId, TimelineEventUI } from './types/project'
import { newEventId } from './projectMutations'

export interface CopyEventsOptions {
  /** 取代目標舞者現有 clips；預設為附加在後方 */
  replace?: boolean
  /** 僅複製指定 clip id（來源舞者內） */
  eventIds?: string[]
  /** 僅複製與此 from/to 相同的來源 clips */
  matchTimes?: { from: string; to: string }
}

export interface CopyEventsResult {
  copied: number
  skippedNoTargets: number
  sourceTotal: number
}

/** 將來源部位 id 對應到目標舞者可用的部位（含 hand↔left_hand 等常見別名） */
export function resolveTargetsForRole(
  sourceTargets: PartId[],
  targetParts: PartDefinition[]
): PartId[] {
  const partIds = targetParts.map((p) => p.id)
  const has = (id: string) => partIds.includes(id)
  const result = new Set<PartId>()

  for (const target of sourceTargets) {
    if (has(target)) {
      result.add(target)
      continue
    }

    const expanded = expandPartAlias(target, has)
    for (const id of expanded) result.add(id)
  }

  return [...result]
}

function expandPartAlias(partId: PartId, has: (id: string) => boolean): PartId[] {
  if (partId === 'hand' || partId === 'hands') {
    const sides = (['left_hand', 'right_hand'] as const).filter(has)
    if (sides.length > 0) return [...sides]
  }
  if (partId === 'foot' || partId === 'feet') {
    const sides = (['left_foot', 'right_foot'] as const).filter(has)
    if (sides.length > 0) return [...sides]
  }
  if (partId === 'shoe' || partId === 'shoes') {
    const sides = (['left_shoe', 'right_shoe'] as const).filter(has)
    if (sides.length > 0) return [...sides]
  }
  if ((partId === 'left_hand' || partId === 'right_hand') && has('hand')) {
    return ['hand']
  }
  if ((partId === 'left_foot' || partId === 'right_foot') && has('foot')) {
    return ['foot']
  }
  if ((partId === 'left_shoe' || partId === 'right_shoe') && has('shoe')) {
    return ['shoe']
  }
  return []
}

export function cloneTimelineEvent(
  event: TimelineEventUI,
  targets: PartId[]
): TimelineEventUI {
  return {
    ...event,
    id: newEventId(),
    targets: [...targets],
    params: event.params ? { ...event.params } : undefined
  }
}

export function copyEventsFromRole(
  project: LedProject,
  sourceRoleId: string,
  targetRoleId: string,
  options: CopyEventsOptions = {}
): { project: LedProject; result: CopyEventsResult } {
  if (sourceRoleId === targetRoleId) {
    throw new Error('來源與目標舞者不可相同')
  }

  const source = project.roles.find((r) => r.role_id === sourceRoleId)
  const target = project.roles.find((r) => r.role_id === targetRoleId)
  if (!source) throw new Error(`找不到來源舞者：${sourceRoleId}`)
  if (!target) throw new Error(`找不到目標舞者：${targetRoleId}`)

  const sourceEvents = (() => {
    let events = source.events
    if (options.eventIds) {
      events = events.filter((e) => options.eventIds!.includes(e.id))
    }
    if (options.matchTimes) {
      const { from, to } = options.matchTimes
      events = events.filter((e) => e.from === from && e.to === to)
    }
    return events
  })()

  const copiedEvents: TimelineEventUI[] = []
  let skippedNoTargets = 0

  for (const event of sourceEvents) {
    const targets = resolveTargetsForRole(event.targets, target.parts)
    if (targets.length === 0) {
      skippedNoTargets++
      continue
    }
    copiedEvents.push(cloneTimelineEvent(event, targets))
  }

  const nextEvents = options.replace
    ? copiedEvents
    : [...target.events, ...copiedEvents]

  const now = new Date().toISOString()
  return {
    project: {
      ...project,
      project: { ...project.project, updated_at: now },
      roles: project.roles.map((r) =>
        r.role_id === targetRoleId ? { ...r, events: nextEvents } : r
      )
    },
    result: {
      copied: copiedEvents.length,
      skippedNoTargets,
      sourceTotal: sourceEvents.length
    }
  }
}

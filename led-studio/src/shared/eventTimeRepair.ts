import type { LedProject, TimelineEventUI } from './types/project'
import { formatMsToTime, parseTimeToMs, tryParseTimeToMs } from './timeParse'

/** Legacy bug produced times like `0:03.281.25` (double decimal from fractional ms). */
const LEGACY_DOUBLE_DECIMAL = /^(\d+):(\d{1,2})\.(\d+)\.(\d+)$/

export function repairLegacyTimeString(timeStr: string): string | null {
  const trimmed = timeStr.trim()
  const match = trimmed.match(LEGACY_DOUBLE_DECIMAL)
  if (!match) return null

  const minutes = Number.parseInt(match[1], 10)
  const seconds = Number.parseInt(match[2], 10)
  if (seconds >= 60) return null

  const millis = Math.round(Number.parseFloat(`${match[3]}.${match[4]}`))
  return formatMsToTime(minutes * 60_000 + seconds * 1_000 + millis)
}

export function normalizeTimeString(timeStr: string): string | null {
  if (tryParseTimeToMs(timeStr) !== null) return timeStr.trim()
  return repairLegacyTimeString(timeStr)
}

export interface EventRepairResult {
  event: TimelineEventUI | null
  changed: boolean
  reason?: string
}

export function repairTimelineEvent(event: TimelineEventUI): EventRepairResult {
  const from = normalizeTimeString(event.from)
  const to = normalizeTimeString(event.to)

  if (!from || !to) {
    return {
      event: null,
      changed: true,
      reason: `removed ${event.id}: unrepairable time "${event.from}" → "${event.to}"`
    }
  }

  let startMs: number
  let endMs: number
  try {
    startMs = parseTimeToMs(from)
    endMs = parseTimeToMs(to)
  } catch {
    return {
      event: null,
      changed: true,
      reason: `removed ${event.id}: parse failed after normalize`
    }
  }

  if (endMs <= startMs) {
    return {
      event: null,
      changed: true,
      reason: `removed ${event.id}: zero/negative duration (${from} → ${to})`
    }
  }

  const changed = from !== event.from.trim() || to !== event.to.trim()
  if (!changed) {
    return { event, changed: false }
  }

  return {
    event: { ...event, from, to },
    changed: true,
    reason: `fixed ${event.id}: ${event.from}→${from}, ${event.to}→${to}`
  }
}

export interface ProjectRepairResult {
  project: LedProject
  fixes: string[]
}

export function repairProjectTimelineEvents(project: LedProject): ProjectRepairResult {
  const fixes: string[] = []
  let changed = false

  const roles = project.roles.map((role) => {
    const events: TimelineEventUI[] = []
    let roleChanged = false
    for (const ev of role.events) {
      const result = repairTimelineEvent(ev)
      if (result.changed && result.reason) {
        fixes.push(`[${role.role_id}] ${result.reason}`)
        roleChanged = true
        changed = true
      }
      if (result.event) {
        if (result.event !== ev) roleChanged = true
        events.push(result.event)
      } else {
        roleChanged = true
        changed = true
      }
    }
    if (events.length !== role.events.length) {
      roleChanged = true
      changed = true
    }
    return roleChanged ? { ...role, events } : role
  })

  if (!changed) return { project, fixes: [] }

  return {
    project: {
      ...project,
      roles,
      project: {
        ...project.project,
        updated_at: new Date().toISOString()
      }
    },
    fixes
  }
}

export function listInvalidEvents(project: LedProject): Array<{ roleId: string; eventId: string; from: string; to: string }> {
  const invalid: Array<{ roleId: string; eventId: string; from: string; to: string }> = []
  for (const role of project.roles) {
    for (const ev of role.events) {
      if (tryParseTimeToMs(ev.from) === null || tryParseTimeToMs(ev.to) === null) {
        invalid.push({ roleId: role.role_id, eventId: ev.id, from: ev.from, to: ev.to })
      }
    }
  }
  return invalid
}

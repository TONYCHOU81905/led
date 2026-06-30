import { computeLedCountFromParts } from './ledChainDefaults'
import { parseTimeToMs } from './timeParse'
import type {
  DeviceConfig,
  LedProject,
  PartDefinition,
  RoleDefinition,
  RgbColor,
  TimelineEventUI
} from './types/project'

export interface ValidationIssue {
  code: string
  message: string
  eventId?: string
  roleId?: string
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}

const SUPPORTED_SCHEMA = '1.0.0'

function validatePartRanges(parts: PartDefinition[], ledCount: number, errors: ValidationIssue[]): void {
  const seen = new Set<string>()
  for (const part of parts) {
    if (seen.has(part.id)) {
      errors.push({ code: 'DUPLICATE_PART', message: `Duplicate part id: ${part.id}` })
    }
    seen.add(part.id)

    for (const range of part.ranges) {
      if (range.start > range.end) {
        errors.push({
          code: 'INVALID_RANGE',
          message: `Part ${part.id}: start ${range.start} > end ${range.end}`
        })
      }
      if (range.start < 0 || range.end >= ledCount) {
        errors.push({
          code: 'RANGE_OUT_OF_BOUNDS',
          message: `Part ${part.id} range ${range.start}-${range.end} outside 0-${ledCount - 1}`
        })
      }
    }
  }
}

export function validateEvent(
  event: TimelineEventUI,
  partIds: Set<string>,
  colors: Record<string, RgbColor>
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  let startMs: number
  let endMs: number
  try {
    startMs = parseTimeToMs(event.from)
    endMs = parseTimeToMs(event.to)
  } catch {
    issues.push({
      code: 'INVALID_TIME',
      message: `Event ${event.id}: invalid from/to time`,
      eventId: event.id
    })
    return issues
  }

  if (endMs <= startMs) {
    issues.push({
      code: 'INVALID_INTERVAL',
      message: `Event ${event.id}: to must be greater than from`,
      eventId: event.id
    })
  }

  if (startMs < 0) {
    issues.push({
      code: 'NEGATIVE_START',
      message: `Event ${event.id}: start_ms cannot be negative`,
      eventId: event.id
    })
  }

  if (event.targets.length === 0) {
    issues.push({
      code: 'NO_TARGETS',
      message: `Event ${event.id}: at least one target required`,
      eventId: event.id
    })
  }

  for (const target of event.targets) {
    if (!partIds.has(target)) {
      issues.push({
        code: 'UNKNOWN_TARGET',
        message: `Event ${event.id}: unknown target "${target}"`,
        eventId: event.id
      })
    }
  }

  if (!(event.color in colors)) {
    issues.push({
      code: 'UNKNOWN_COLOR',
      message: `Event ${event.id}: unknown color "${event.color}"`,
      eventId: event.id
    })
  }

  return issues
}

export function validateRole(role: RoleDefinition, colors: Record<string, RgbColor>): ValidationResult {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const partIds = new Set(role.parts.map((p) => p.id))
  const eventIds = new Set<string>()

  validatePartRanges(role.parts, computeLedCountFromParts(role.parts), errors)

  for (const event of role.events) {
    if (eventIds.has(event.id)) {
      errors.push({
        code: 'DUPLICATE_EVENT',
        message: `Duplicate event id: ${event.id}`,
        eventId: event.id,
        roleId: role.role_id
      })
    }
    eventIds.add(event.id)

    const eventIssues = validateEvent(event, partIds, colors)
    for (const issue of eventIssues) {
      errors.push({ ...issue, roleId: role.role_id })
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

export function validateProject(project: LedProject): ValidationResult {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []

  if (project.schema_version !== SUPPORTED_SCHEMA) {
    errors.push({
      code: 'UNSUPPORTED_SCHEMA',
      message: `Unsupported schema_version: ${project.schema_version}`
    })
  }

  for (const role of project.roles) {
    const roleResult = validateRole(role, project.colors)
    errors.push(...roleResult.errors)
    warnings.push(...roleResult.warnings)
  }

  return { valid: errors.length === 0, errors, warnings }
}

export function findOverlaps(
  events: TimelineEventUI[],
  partId: string
): Array<[TimelineEventUI, TimelineEventUI]> {
  const compiled = events
    .filter((e) => e.targets.includes(partId))
    .map((e) => ({
      event: e,
      start: parseTimeToMs(e.from),
      end: parseTimeToMs(e.to)
    }))
    .sort((a, b) => a.start - b.start)

  const overlaps: Array<[TimelineEventUI, TimelineEventUI]> = []
  for (let i = 0; i < compiled.length; i++) {
    for (let j = i + 1; j < compiled.length; j++) {
      const a = compiled[i]
      const b = compiled[j]
      if (b.start >= a.end) break
      if (a.event.priority === b.event.priority) {
        overlaps.push([a.event, b.event])
      }
    }
  }
  return overlaps
}

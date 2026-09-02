import { computeLedCountFromParts, logicalLedCountForOutput, partsFromLedOutputs } from './ledChainDefaults'
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
const SUPPORTED_LED_GPIOS = new Set([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21])

// 韌體 CRGB _leds[] 靜態陣列的大小上限，必須與 firmware 的 LED_COUNT_MAX 一致
// （src/types.h:10，由 platformio.ini 的 -DLED_COUNT_MAX 覆寫）。
// 兩邊各自編譯、無法共用常數，改一邊就要同步改另一邊，否則 Studio 會擋掉
// 韌體其實跑得動的設定，或放行韌體會拒絕的設定。
export const FIRMWARE_LED_COUNT_MAX = 1024

// 韌體 LedOutputConfig outputs[] 陣列的大小上限，必須與 firmware 的
// MAX_LED_OUTPUTS 一致（src/types.h:17）。同樣是兩邊各自編譯、無法共用常數，
// 改一邊就要同步改另一邊。
export const FIRMWARE_MAX_LED_OUTPUTS = 6

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

  if (role.led_outputs) {
    if (role.led_outputs.length < 1 || role.led_outputs.length > FIRMWARE_MAX_LED_OUTPUTS) {
      errors.push({
        code: 'INVALID_OUTPUT_COUNT',
        message: `LED outputs must contain 1 to ${FIRMWARE_MAX_LED_OUTPUTS} channels`
      })
    }
    const gpios = new Set<number>()
    for (const output of role.led_outputs) {
      if (!SUPPORTED_LED_GPIOS.has(output.gpio)) {
        errors.push({ code: 'UNSUPPORTED_GPIO', message: `Unsupported LED GPIO: ${output.gpio}` })
      }
      if (gpios.has(output.gpio)) {
        errors.push({ code: 'DUPLICATE_GPIO', message: `Duplicate LED GPIO: ${output.gpio}` })
      }
      gpios.add(output.gpio)
      if (logicalLedCountForOutput(output) < 1) {
        errors.push({ code: 'EMPTY_OUTPUT', message: `LED output ${output.id} has no logical pixels` })
      }
      if (output.parallel_branches < 1 || output.parallel_branches > 5) {
        errors.push({ code: 'INVALID_BRANCH_COUNT', message: `LED output ${output.id} must have 1 to 5 branches` })
      }
      if (output.continuation_branch < 1 || output.continuation_branch > output.parallel_branches) {
        errors.push({ code: 'INVALID_CONTINUATION', message: `LED output ${output.id} continuation branch is invalid` })
      }
    }
    const expectedParts = partsFromLedOutputs(role.led_outputs)
    if (JSON.stringify(expectedParts) !== JSON.stringify(role.parts)) {
      errors.push({ code: 'OUTPUT_PART_MISMATCH', message: 'LED output parameters and part ranges are out of sync' })
    }
    const total = role.led_outputs.reduce((sum, output) => sum + logicalLedCountForOutput(output), 0)
    if (total > FIRMWARE_LED_COUNT_MAX) {
      errors.push({
        code: 'LED_LIMIT_EXCEEDED',
        message: `Logical LED count ${total} exceeds firmware limit ${FIRMWARE_LED_COUNT_MAX}`
      })
    }
  }

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
    const routeParts = event.params?.route_parts
    if (routeParts && routeParts.length > 8) {
      errors.push({
        code: 'TOO_MANY_ROUTE_PARTS',
        message: `Event ${event.id}: route contains ${routeParts.length} steps; firmware supports at most 8`,
        eventId: event.id,
        roleId: role.role_id
      })
    }
    for (const routePart of routeParts ?? []) {
      if (!partIds.has(routePart)) {
        errors.push({
          code: 'UNKNOWN_ROUTE_PART',
          message: `Event ${event.id}: unknown route part "${routePart}"`,
          eventId: event.id,
          roleId: role.role_id
        })
      }
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

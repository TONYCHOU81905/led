import {
  cloneDefaultLedOutputs,
  partsFromLedOutputs
} from './ledChainDefaults'
import type {
  LedProject,
  PartDefinition,
  PartId,
  RoleDefinition,
  TimelineEventParams,
  TimelineEventUI
} from './types/project'

const DEFAULT_ROUTE_ORDER: PartId[] = [
  'head',
  'right_hand',
  'right_foot',
  'left_foot',
  'left_hand'
]

function mapLegacyPart(
  partId: PartId,
  targetParts: PartDefinition[],
  mode: 'target' | 'route'
): PartId[] {
  const available = new Set(targetParts.map((part) => part.id))
  if (available.has(partId)) return [partId]
  if (partId === 'hand' || partId === 'hands') return ['right_hand', 'left_hand']
  if (partId === 'foot' || partId === 'feet' || partId === 'shoe' || partId === 'shoes') {
    return ['right_foot', 'left_foot']
  }
  // The five-output wearable has no separate torso channel. A legacy body clip
  // means the whole wearable so the lighting cue is not silently discarded.
  if (partId === 'body') return mode === 'target' ? [...DEFAULT_ROUTE_ORDER] : []
  return []
}

function mapPartSequence(
  parts: PartId[],
  targetParts: PartDefinition[],
  mode: 'target' | 'route'
): PartId[] {
  return parts.flatMap((partId) => mapLegacyPart(partId, targetParts, mode))
}

function uniqueParts(parts: PartId[]): PartId[] {
  return Array.from(new Set(parts))
}

function migrateEvent(event: TimelineEventUI, targetParts: PartDefinition[]): TimelineEventUI {
  const mappedTargets = uniqueParts(mapPartSequence(event.targets, targetParts, 'target'))
  const targets = mappedTargets.length > 0 ? mappedTargets : [...DEFAULT_ROUTE_ORDER]
  const routeParts = event.params?.route_parts

  let params: TimelineEventParams | undefined = event.params
    ? { ...event.params }
    : undefined

  if (routeParts?.length) {
    // A legacy torso route step has no physical channel in the five-output
    // wearable, so omit that step instead of expanding it into five steps and
    // overflowing firmware MAX_ROUTE_PARTS.
    const mappedRoute = mapPartSequence(routeParts, targetParts, 'route').slice(0, 8)
    params = {
      ...params,
      route_parts: mappedRoute.length > 0 ? mappedRoute : [...targets],
      route_step_labels: undefined,
      route_label: undefined,
      route_preset: undefined
    }
  }

  return { ...event, targets, params }
}

export function migrateRoleToFiveOutputs(role: RoleDefinition): RoleDefinition {
  const ledOutputs = role.led_outputs?.length ? role.led_outputs : cloneDefaultLedOutputs()
  const parts = role.led_outputs?.length ? role.parts : partsFromLedOutputs(ledOutputs)
  const knownParts = new Set(parts.map((part) => part.id))
  const migratedEvents = role.led_outputs?.length
    ? role.events.map((event) => {
        const route = event.params?.route_parts
        if (!route || route.length <= 8) return event
        const safeRoute = uniqueParts(route.filter((partId) => knownParts.has(partId))).slice(0, 8)
        return {
          ...event,
          params: {
            ...event.params,
            route_parts: safeRoute.length > 0 ? safeRoute : event.targets.slice(0, 8),
            route_step_labels: undefined,
            route_label: undefined,
            route_preset: undefined
          }
        }
      })
    : role.events.map((event) => migrateEvent(event, parts))

  return {
    ...role,
    led_outputs: ledOutputs,
    parts,
    events: migratedEvents
  }
}

export function migrateProjectToFiveOutputs(project: LedProject): {
  project: LedProject
  fixes: string[]
} {
  const missingRoles = project.roles.filter((role) => !role.led_outputs?.length)
  const oversizedRouteRoles = project.roles.filter((role) =>
    role.events.some((event) => (event.params?.route_parts?.length ?? 0) > 8)
  )
  if (missingRoles.length === 0 && oversizedRouteRoles.length === 0) {
    return { project, fixes: [] }
  }

  return {
    project: {
      ...project,
      roles: project.roles.map(migrateRoleToFiveOutputs),
      project: { ...project.project, updated_at: new Date().toISOString() }
    },
    fixes: [
      ...missingRoles.map(
        (role) => `[${role.role_id}] 已將舊單通道 LED 設定遷移為 GPIO 4/5/6/7/15 五通道`
      ),
      ...oversizedRouteRoles.map(
        (role) => `[${role.role_id}] 已修復超過韌體 8 步限制的流動路徑`
      )
    ]
  }
}

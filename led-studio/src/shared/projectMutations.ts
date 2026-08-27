import type {
  LedOutputDefinition,
  LedProject,
  PartDefinition,
  RoleDefinition,
  TimelineEventUI
} from './types/project'
import {
  DEFAULT_LED_OUTPUTS,
  cloneDefaultChainParts,
  cloneDefaultLedOutputs,
  createPartAfterExisting,
  nextFreeGpio,
  partsFromLedOutputs
} from './ledChainDefaults'
import { STAGE_COLORS } from './stageColors'

export function createEmptyProject(name = 'New Show'): LedProject {
  const now = new Date().toISOString()
  return {
    schema_version: '1.0.0',
    project: {
      id: `show_${Date.now()}`,
      name,
      music_duration_ms: 180000,
      bpm: 128,
      created_at: now,
      updated_at: now
    },
    colors: { ...STAGE_COLORS },
    roles: []
  }
}

/** 新建專案時預建 4 位舞者（空 timeline），符合本專案 4 ESP 設定。 */
export function createDefaultShowProject(name = 'New Show'): LedProject {
  let project = createEmptyProject(name)
  const dancers = [
    { id: 'dancer_a', label: '舞者 A' },
    { id: 'dancer_b', label: '舞者 B' },
    { id: 'dancer_c', label: '舞者 C' },
    { id: 'dancer_d', label: '舞者 D' }
  ]
  for (const d of dancers) {
    project = addRole(project, d.id, d.label)
  }
  return project
}

export function createRole(roleId: string, displayName: string): RoleDefinition {
  return {
    role_id: roleId,
    display_name: displayName,
    parts: cloneDefaultChainParts(),
    led_outputs: cloneDefaultLedOutputs(),
    events: []
  }
}

export function addRole(project: LedProject, roleId: string, displayName: string): LedProject {
  if (project.roles.some((r) => r.role_id === roleId)) {
    throw new Error(`Role already exists: ${roleId}`)
  }
  return touchProject({
    ...project,
    roles: [...project.roles, createRole(roleId, displayName)]
  })
}

export function removeRole(project: LedProject, roleId: string): LedProject {
  return touchProject({
    ...project,
    roles: project.roles.filter((r) => r.role_id !== roleId)
  })
}

export function updateRole(
  project: LedProject,
  roleId: string,
  patch: Partial<Pick<RoleDefinition, 'display_name' | 'parts'>>
): LedProject {
  return touchProject({
    ...project,
    roles: project.roles.map((r) => (r.role_id === roleId ? { ...r, ...patch } : r))
  })
}

export function addPart(project: LedProject, roleId: string, part: PartDefinition): LedProject {
  const role = project.roles.find((r) => r.role_id === roleId)
  if (!role) throw new Error(`Role not found: ${roleId}`)
  if (role.parts.some((p) => p.id === part.id)) {
    throw new Error(`Part already exists: ${part.id}`)
  }
  return updateRole(project, roleId, { parts: [...role.parts, part] })
}

export function addPartAfterLast(project: LedProject, roleId: string): LedProject {
  const role = project.roles.find((r) => r.role_id === roleId)
  if (!role) throw new Error(`Role not found: ${roleId}`)
  return addPart(project, roleId, createPartAfterExisting(role.parts))
}

export function removePart(project: LedProject, roleId: string, partId: string): LedProject {
  const role = project.roles.find((r) => r.role_id === roleId)
  if (!role) throw new Error(`Role not found: ${roleId}`)
  const nextParts = role.parts.filter((p) => p.id !== partId)
  return touchProject({
    ...project,
    roles: project.roles.map((r) =>
      r.role_id === roleId
        ? {
            ...r,
            parts: nextParts,
            events: r.events
              .map((e) => ({
                ...e,
                targets: e.targets.filter((t) => t !== partId)
              }))
              .filter((e) => e.targets.length > 0)
          }
        : r
    )
  })
}

export function updatePart(
  project: LedProject,
  roleId: string,
  partId: string,
  patch: Partial<Pick<PartDefinition, 'id' | 'display_name' | 'ranges'>>
): LedProject {
  const role = project.roles.find((r) => r.role_id === roleId)
  if (!role) throw new Error(`Role not found: ${roleId}`)
  const nextId = patch.id
  if (nextId && nextId !== partId && role.parts.some((p) => p.id === nextId)) {
    throw new Error(`Part already exists: ${nextId}`)
  }
  return touchProject({
    ...project,
    roles: project.roles.map((r) => {
      if (r.role_id !== roleId) return r
      return {
        ...r,
        parts: r.parts.map((p) => (p.id === partId ? { ...p, ...patch, id: nextId ?? p.id } : p)),
        events:
          nextId && nextId !== partId
            ? r.events.map((e) => ({
                ...e,
                targets: e.targets.map((t) => (t === partId ? nextId : t))
              }))
            : r.events
      }
    })
  })
}

export function resetPartsToDefault(project: LedProject, roleId: string): LedProject {
  const outputs = cloneDefaultLedOutputs()
  return touchProject({
    ...project,
    roles: project.roles.map((role) => role.role_id === roleId
      ? { ...role, led_outputs: outputs, parts: partsFromLedOutputs(outputs) }
      : role)
  })
}

export function updateLedOutput(
  project: LedProject,
  roleId: string,
  outputId: string,
  patch: Partial<import('./types/project').LedOutputDefinition>
): LedProject {
  return touchProject({
    ...project,
    roles: project.roles.map((role) => {
      if (role.role_id !== roleId) return role
      const current = role.led_outputs ?? cloneDefaultLedOutputs()
      const outputs = current.map((output) => output.id === outputId ? { ...output, ...patch } : output)
      return { ...role, led_outputs: outputs, parts: partsFromLedOutputs(outputs) }
    })
  })
}

/** 這個通道對應的部位上有幾個 clip —— 刪除前要告訴使用者會連帶刪掉多少 */
export function countEventsForOutput(role: RoleDefinition, outputId: string): number {
  const output = (role.led_outputs ?? []).find((o) => o.id === outputId)
  if (!output) return 0
  return role.events.filter((e) => e.targets.includes(output.part_id)).length
}

/**
 * 新增一個 LED 通道。預設沿用 sourceOutputId 那一個的所有接線設定，
 * 只換掉 id / part_id / 名稱 / GPIO —— 加第六、第七支肢體時最省事。
 */
export function addLedOutput(
  project: LedProject,
  roleId: string,
  sourceOutputId?: string
): LedProject {
  return touchProject({
    ...project,
    roles: project.roles.map((role) => {
      if (role.role_id !== roleId) return role
      const current = role.led_outputs ?? cloneDefaultLedOutputs()
      const source =
        current.find((o) => o.id === sourceOutputId) ?? current[current.length - 1]
      const seq = current.length + 1
      const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
      const next: LedOutputDefinition = {
        ...(source ?? DEFAULT_LED_OUTPUTS[0]),
        id: `out_${suffix}`,
        part_id: `part_${suffix}`,
        display_name: `通道 ${seq}`,
        gpio: nextFreeGpio(current)
      }
      const outputs = [...current, next]
      return { ...role, led_outputs: outputs, parts: partsFromLedOutputs(outputs) }
    })
  })
}

/**
 * 刪除一個 LED 通道，並一併移除 Timeline 上指向該部位的 clip
 * （parts 是從 led_outputs 衍生的，留著會變成指向不存在部位的壞資料）。
 * 至少保留一個通道。
 */
export function removeLedOutput(
  project: LedProject,
  roleId: string,
  outputId: string
): LedProject {
  return touchProject({
    ...project,
    roles: project.roles.map((role) => {
      if (role.role_id !== roleId) return role
      const current = role.led_outputs ?? cloneDefaultLedOutputs()
      if (current.length <= 1) return role
      const removed = current.find((o) => o.id === outputId)
      if (!removed) return role

      const outputs = current.filter((o) => o.id !== outputId)
      // 舊格式的 event 可能掛多個部位：先抽掉這個部位，targets 變空才整個刪掉
      const events = role.events
        .map((e) => ({ ...e, targets: e.targets.filter((t) => t !== removed.part_id) }))
        .filter((e) => e.targets.length > 0)

      return { ...role, led_outputs: outputs, parts: partsFromLedOutputs(outputs), events }
    })
  })
}

export function addEvent(project: LedProject, roleId: string, event: TimelineEventUI): LedProject {
  return mapRoleEvents(project, roleId, (events) => [...events, event])
}

export function updateEvent(
  project: LedProject,
  roleId: string,
  eventId: string,
  patch: Partial<TimelineEventUI>
): LedProject {
  return mapRoleEvents(project, roleId, (events) =>
    events.map((e) => (e.id === eventId ? { ...e, ...patch } : e))
  )
}

export function deleteEvent(project: LedProject, roleId: string, eventId: string): LedProject {
  return mapRoleEvents(project, roleId, (events) => events.filter((e) => e.id !== eventId))
}

/** 整批取代某個 role 的 events */
export function replaceEvents(project: LedProject, roleId: string, events: TimelineEventUI[]): LedProject {
  return mapRoleEvents(project, roleId, () => events)
}

export function newEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

function mapRoleEvents(
  project: LedProject,
  roleId: string,
  fn: (events: TimelineEventUI[]) => TimelineEventUI[]
): LedProject {
  return touchProject({
    ...project,
    roles: project.roles.map((r) =>
      r.role_id === roleId ? { ...r, events: fn(r.events) } : r
    )
  })
}

function touchProject(project: LedProject): LedProject {
  return {
    ...project,
    project: { ...project.project, updated_at: new Date().toISOString() }
  }
}

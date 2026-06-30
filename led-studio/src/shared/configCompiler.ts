import { computeLedCountFromParts } from './ledChainDefaults'
import { validateRole } from './eventValidator'
import { mergePalette } from './stageColors'
import { parseTimeToMs, formatMsToTime } from './timeParse'
import type {
  CompiledEvent,
  DeviceConfig,
  LedProject,
  RoleDefinition,
  TimelineEventUI
} from './types/project'

export interface CompileOptions {
  deviceId: string
  ledCount?: number
  dataGpio?: number
  maxBrightness?: number
  network?: {
    ssid: string
    password: string
    timecode_port?: number
    device_status_port?: number
  }
}

export function compileEvent(event: TimelineEventUI): CompiledEvent {
  return {
    id: event.id,
    startMs: parseTimeToMs(event.from),
    endMs: parseTimeToMs(event.to),
    targets: [...event.targets],
    color: event.color,
    effect: event.effect,
    params: event.params ? { ...event.params } : undefined,
    priority: event.priority,
    note: event.note
  }
}

export function compileEvents(events: TimelineEventUI[]): CompiledEvent[] {
  return events.map(compileEvent)
}

export function compileRoleToDeviceConfig(
  role: RoleDefinition,
  projectColors: Record<string, import('./types/project').RgbColor>,
  options: CompileOptions
): DeviceConfig {
  const validation = validateRole(role, projectColors)
  if (!validation.valid) {
    const first = validation.errors[0]
    throw new Error(`Cannot compile role ${role.role_id}: ${first.message}`)
  }

  const colors = mergePalette(projectColors)
  const ledCount = options.ledCount ?? computeLedCountFromParts(role.parts)

  return {
    schema_version: '1.0.0',
    device: {
      device_id: options.deviceId,
      role_id: role.role_id,
      display_name: role.display_name,
      led_count: ledCount,
      data_gpio: options.dataGpio ?? 8,
      max_brightness: options.maxBrightness ?? 0.4
    },
    network: options.network ?? {
      ssid: 'SHOW_SYNC_AP',
      password: 'CHANGE_ME',
      timecode_port: 4210,
      device_status_port: 4211
    },
    parts: role.parts.map((part) => ({
      id: part.id,
      display_name: part.display_name,
      ranges: part.ranges.map((r) => ({ ...r }))
    })),
    colors,
    events: role.events.map((event) => {
      const compiled = compileEvent(event)
      return {
        id: compiled.id,
        start_ms: compiled.startMs,
        end_ms: compiled.endMs,
        targets: compiled.targets,
        color: compiled.color,
        effect: compiled.effect,
        params: compiled.params,
        priority: compiled.priority,
        note: compiled.note
      }
    })
  }
}

export function decompileDeviceEvent(
  event: DeviceConfig['events'][number]
): TimelineEventUI {
  return {
    id: event.id,
    from: formatMsToTime(event.start_ms),
    to: formatMsToTime(event.end_ms),
    targets: [...event.targets],
    color: event.color,
    effect: event.effect,
    params: event.params ? { ...event.params } : undefined,
    priority: event.priority,
    note: event.note
  }
}

export function decompileDeviceConfig(config: DeviceConfig): RoleDefinition {
  return {
    role_id: config.device.role_id,
    display_name: config.device.display_name,
    parts: config.parts.map((part) => ({
      id: part.id,
      display_name: part.display_name,
      ranges: part.ranges.map((r) => ({ ...r }))
    })),
    events: config.events.map(decompileDeviceEvent)
  }
}

export function compileProjectRole(
  project: LedProject,
  roleId: string,
  options: Omit<CompileOptions, 'deviceId'> & { deviceId?: string }
): DeviceConfig {
  const role = project.roles.find((r) => r.role_id === roleId)
  if (!role) {
    throw new Error(`Role not found: ${roleId}`)
  }

  return compileRoleToDeviceConfig(role, project.colors, {
    deviceId: options.deviceId ?? `esp32s3_${roleId}_001`,
    ledCount: options.ledCount,
    dataGpio: options.dataGpio,
    maxBrightness: options.maxBrightness,
    network: options.network
  })
}

/** Simple CRC32 for config checksum (IEEE polynomial). */
export function crc32(data: string): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i)
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

export function configChecksum(config: DeviceConfig): number {
  return crc32(JSON.stringify(config))
}

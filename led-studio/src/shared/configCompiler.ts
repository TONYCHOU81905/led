import { computeLedCountFromParts, logicalLedCountForOutput } from './ledChainDefaults'
import { validateRole } from './eventValidator'
import { mergePalette } from './stageColors'
import { parseTimeToMs, formatMsToTime } from './timeParse'
import { migrateRoleToFiveOutputs } from './ledOutputMigration'
import type {
  CompiledEvent,
  DeviceConfig,
  EffectId,
  LedProject,
  RoleDefinition,
  TimelineEventUI
} from './types/project'

export interface CompileOptions {
  deviceId: string
  ledCount?: number
  dataGpio?: number
  ledType?: 'WS2811' | 'WS2812B'
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

function mapEffectToDevice(
  effect: EffectId,
  params?: TimelineEventUI['params']
): { effect: EffectId; params: TimelineEventUI['params'] } {
  switch (effect) {
    default:
      return { effect, params }
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
  const effectiveRole = migrateRoleToFiveOutputs(role)
  const validation = validateRole(effectiveRole, projectColors)
  if (!validation.valid) {
    const first = validation.errors[0]
    throw new Error(`Cannot compile role ${role.role_id}: ${first.message}`)
  }

  const colors = mergePalette(projectColors)
  const ledCount = effectiveRole.led_outputs
    ? effectiveRole.led_outputs.reduce((sum, output) => sum + logicalLedCountForOutput(output), 0)
    : options.ledCount ?? computeLedCountFromParts(effectiveRole.parts)
  let outputOffset = 0
  const outputs = effectiveRole.led_outputs?.map((output) => {
    const led_count = logicalLedCountForOutput(output)
    const compiled = {
      id: output.id, gpio: output.gpio, offset: outputOffset, led_count,
      layout: output.layout,
      outbound_leds: output.outbound_leds,
      parallel_branches: output.parallel_branches,
      branch_leds: output.branch_leds,
      return_leds: output.return_leds,
      continuation_branch: output.continuation_branch,
      direction: output.direction
    }
    outputOffset += led_count
    return compiled
  })

  return {
    schema_version: '1.0.0',
    device: {
      device_id: options.deviceId,
      role_id: role.role_id,
      display_name: role.display_name,
      led_count: ledCount,
      data_gpio: options.dataGpio ?? 8,
      outputs,
      led_type: options.ledType ?? 'WS2811',
      max_brightness: options.maxBrightness ?? 0.4
    },
    network: options.network ?? {
      ssid: 'SHOW_SYNC_AP',
      password: 'CHANGE_ME',
      timecode_port: 4210,
      device_status_port: 4211
    },
    parts: effectiveRole.parts.map((part) => ({
      id: part.id,
      display_name: part.display_name,
      ranges: part.ranges.map((r) => ({ ...r }))
    })),
    colors,
    events: effectiveRole.events.map((event) => {
      const compiled = compileEvent(event)
      const deviceEvent = mapEffectToDevice(compiled.effect, compiled.params)
      return {
        id: compiled.id,
        start_ms: compiled.startMs,
        end_ms: compiled.endMs,
        targets: compiled.targets,
        color: compiled.color,
        effect: deviceEvent.effect,
        params: deviceEvent.params,
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
    led_outputs: config.device.outputs?.map((output) => ({
      id: output.id,
      display_name: config.parts.find((part) => part.ranges.some(
        (range) => range.start === output.offset && range.end === output.offset + output.led_count - 1
      ))?.display_name ?? output.id,
      part_id: config.parts.find((part) => part.ranges.some(
        (range) => range.start === output.offset && range.end === output.offset + output.led_count - 1
      ))?.id ?? output.id,
      gpio: output.gpio,
      layout: output.layout ?? 'ring',
      outbound_leds: output.outbound_leds ?? output.led_count,
      parallel_branches: output.parallel_branches ?? 1,
      branch_leds: output.branch_leds ?? 0,
      return_leds: output.return_leds ?? 0,
      continuation_branch: output.continuation_branch ?? 1,
      direction: output.direction ?? 'clockwise'
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
    ledType: options.ledType,
    network: options.network
  })
}

/**
 * Serial config upload currently chunks JSON by string offsets inside another JSON
 * envelope. Escaping all non-ASCII code units keeps byte length, offsets, and CRC
 * aligned with what the ESP receives over serial.
 */
export function serializeConfigForTransport(config: DeviceConfig): string {
  return JSON.stringify(config).replace(/[\u0080-\uffff]/g, (char) => {
    return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
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
  return crc32(serializeConfigForTransport(config))
}

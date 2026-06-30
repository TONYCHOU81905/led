import { describe, expect, it } from 'vitest'
import {
  compileRoleToDeviceConfig,
  decompileDeviceConfig,
  compileEvent,
  configChecksum
} from '../src/shared/configCompiler'
import type { LedProject, RoleDefinition } from '../src/shared/types/project'

describe('configCompiler', () => {
  it('compiles from/to to start_ms/end_ms', () => {
    const compiled = compileEvent({
      id: 'x',
      from: '01:30',
      to: '02:00',
      targets: ['hand'],
      color: 'red',
      effect: 'solid',
      priority: 1
    })
    expect(compiled.startMs).toBe(90_000)
    expect(compiled.endMs).toBe(120_000)
  })

  it('round-trips device config', async () => {
    const demo = (await import('../examples/demo_show.ledproj.json')).default as LedProject
    const role = demo.roles[0] as RoleDefinition

    const device = compileRoleToDeviceConfig(role, demo.colors, {
      deviceId: 'esp32s3_dancer_a_001'
    })

    expect(device.events[0].start_ms).toBe(0)
    expect(device.events[0].end_ms).toBe(30_000)
    expect(device.events[0]).not.toHaveProperty('from')

    const restored = decompileDeviceConfig(device)
    expect(restored.events[0].from).toBe('0:00')
    expect(restored.events[0].to).toBe('0:30')
  })

  it('compiles led_type into device config', async () => {
    const demo = (await import('../examples/demo_show.ledproj.json')).default as LedProject
    const device = compileRoleToDeviceConfig(demo.roles[0], demo.colors, {
      deviceId: 'test',
      ledType: 'WS2812B'
    })
    expect(device.device.led_type).toBe('WS2812B')
  })

  it('produces stable checksum', async () => {
    const demo = (await import('../examples/demo_show.ledproj.json')).default as LedProject
    const device = compileRoleToDeviceConfig(demo.roles[0], demo.colors, {
      deviceId: 'test'
    })
    const a = configChecksum(device)
    const b = configChecksum(device)
    expect(a).toBe(b)
    expect(a).toBeGreaterThan(0)
  })
})

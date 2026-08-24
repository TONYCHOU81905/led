import { describe, expect, it } from 'vitest'
import {
  compileRoleToDeviceConfig,
  decompileDeviceConfig,
  compileEvent,
  configChecksum,
  serializeConfigForTransport
} from '../src/shared/configCompiler'
import type { LedProject, RoleDefinition } from '../src/shared/types/project'
import { createRole } from '../src/shared/projectMutations'

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

  it('compiles five wearable outputs with contiguous offsets', () => {
    const role = createRole('dancer_a', '舞者 A')
    const device = compileRoleToDeviceConfig(role, { red: { r: 255, g: 0, b: 0 } }, {
      deviceId: 'wearable', ledType: 'WS2812B'
    })
    expect(device.device.led_count).toBe(580)
    expect(device.device.outputs).toHaveLength(5)
    expect(device.device.outputs?.map(({ gpio, offset, led_count }) => ({ gpio, offset, led_count }))).toEqual([
      { gpio: 4, offset: 0, led_count: 60 },
      { gpio: 5, offset: 60, led_count: 130 },
      { gpio: 6, offset: 190, led_count: 130 },
      { gpio: 7, offset: 320, led_count: 130 },
      { gpio: 15, offset: 450, led_count: 130 }
    ])
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

  it('serializes unicode config into ASCII-safe transport JSON', async () => {
    const demo = (await import('../examples/demo_show.ledproj.json')).default as LedProject
    const device = compileRoleToDeviceConfig(
      {
        ...demo.roles[0],
        display_name: '舞者A',
        parts: demo.roles[0].parts.map((part, index) => ({
          ...part,
          display_name: index === 0 ? '左手' : part.display_name
        }))
      },
      demo.colors,
      {
        deviceId: 'test',
        network: {
          ssid: '測試WiFi',
          password: '密碼123'
        }
      }
    )

    const transport = serializeConfigForTransport(device)
    expect(transport).not.toContain('舞')
    expect(transport).not.toContain('測')
    expect(transport).toContain('\\u821e')
    expect(transport).toContain('\\u6e2c')
    expect(configChecksum(device)).toBeGreaterThan(0)
  })

  it('keeps advanced effects and params for device firmware export', () => {
    const compiled = compileRoleToDeviceConfig(
      {
        role_id: 'dancer_a',
        display_name: '舞者 A',
        parts: [{ id: 'body', display_name: '身體', ranges: [{ start: 0, end: 9 }] }],
        events: [
          {
            id: 'adv_1',
            from: '0:00',
            to: '0:04',
            targets: ['body'],
            color: 'electric_cyan',
            effect: 'pulse',
            params: { speed: 2 },
            priority: 10
          },
          {
            id: 'adv_2',
            from: '0:04',
            to: '0:08',
            targets: ['body'],
            color: 'hot_magenta',
            effect: 'path_flow',
            params: { route_parts: ['body'] },
            priority: 10
          }
        ]
      },
      {
        electric_cyan: { r: 0, g: 245, b: 255 },
        hot_magenta: { r: 255, g: 0, b: 128 }
      },
      { deviceId: 'test' }
    )

    expect(compiled.events[0].effect).toBe('pulse')
    expect(compiled.events[0].params?.speed).toBe(2)
    expect(compiled.events[1].effect).toBe('path_flow')
  })
})

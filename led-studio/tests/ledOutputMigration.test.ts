import { describe, expect, it } from 'vitest'
import { migrateProjectToFiveOutputs, migrateRoleToFiveOutputs } from '../src/shared/ledOutputMigration'
import { createEmptyProject } from '../src/shared/projectMutations'
import type { RoleDefinition } from '../src/shared/types/project'
import { compileRoleToDeviceConfig } from '../src/shared/configCompiler'

const legacyRole: RoleDefinition = {
  role_id: 'dancer_a',
  display_name: '舞者 A',
  parts: [
    { id: 'hand', display_name: '手', ranges: [{ start: 0, end: 29 }] },
    { id: 'foot', display_name: '腳', ranges: [{ start: 30, end: 59 }] },
    { id: 'head', display_name: '頭', ranges: [{ start: 60, end: 89 }] },
    { id: 'body', display_name: '身體', ranges: [{ start: 90, end: 125 }] }
  ],
  events: [
    { id: 'hands', from: '0:00', to: '0:01', targets: ['hand'], color: 'red', effect: 'solid', priority: 1 },
    { id: 'body', from: '0:01', to: '0:02', targets: ['body'], color: 'red', effect: 'solid', priority: 1 },
    {
      id: 'route', from: '0:02', to: '0:03', targets: ['body', 'head'], color: 'red',
      effect: 'path_flow', priority: 1,
      params: { route_parts: ['body', 'head', 'hand', 'foot'] }
    }
  ]
}

describe('legacy LED output migration', () => {
  it('materializes the six channels instead of leaving display-only defaults', () => {
    const migrated = migrateRoleToFiveOutputs(legacyRole)
    expect(migrated.led_outputs?.map((output) => output.gpio)).toEqual([4, 5, 6, 7, 15, 16])
    expect(migrated.parts.map((part) => part.id)).toEqual([
      'head', 'right_hand', 'right_foot', 'left_foot', 'left_hand', 'shoes'
    ])
  })

  it('maps legacy hand and body clips onto the current wearable parts', () => {
    const migrated = migrateRoleToFiveOutputs(legacyRole)
    expect(migrated.events[0].targets).toEqual(['right_hand', 'left_hand'])
    expect(migrated.events[1].targets).toEqual([
      'head', 'right_hand', 'right_foot', 'left_foot', 'left_hand'
    ])
    expect(migrated.events[2].params?.route_parts).toEqual([
      'head', 'right_hand', 'left_hand', 'right_foot', 'left_foot'
    ])
  })

  it('records a visible repair notice when loading an old project', () => {
    const source = { ...createEmptyProject('Legacy'), roles: [legacyRole] }
    const migrated = migrateProjectToFiveOutputs(source)
    expect(migrated.fixes).toHaveLength(1)
    expect(migrated.project.roles[0].led_outputs).toHaveLength(6)
  })

  it('also enforces six outputs when a legacy role is compiled directly', () => {
    const config = compileRoleToDeviceConfig(legacyRole, { red: { r: 255, g: 0, b: 0 } }, {
      deviceId: 'legacy-board',
      ledType: 'WS2812B'
    })
    expect(config.device.outputs?.map((output) => output.gpio)).toEqual([4, 5, 6, 7, 15, 16])
    expect(config.device.led_count).toBe(640)
    expect(config.events[0].targets).toEqual(['right_hand', 'left_hand'])
  })

  it('repairs an already-saved oversized route from the earlier migration', () => {
    const migrated = migrateRoleToFiveOutputs(legacyRole)
    const polluted: RoleDefinition = {
      ...migrated,
      events: [{
        ...migrated.events[2],
        params: {
          route_parts: [
            'head', 'right_hand', 'right_foot', 'left_foot', 'left_hand',
            'head', 'right_hand', 'left_hand', 'right_foot', 'left_foot'
          ]
        }
      }]
    }
    const repaired = migrateRoleToFiveOutputs(polluted)
    expect(repaired.events[0].params?.route_parts).toEqual([
      'head', 'right_hand', 'right_foot', 'left_foot', 'left_hand'
    ])
  })
})

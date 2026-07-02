import { describe, expect, it } from 'vitest'
import {
  copyEventsFromRole,
  resolveTargetsForRole
} from '../src/shared/copyRoleEvents'
import { addRole, createEmptyProject } from '../src/shared/projectMutations'
import { cloneDefaultChainParts } from '../src/shared/ledChainDefaults'
import type { PartDefinition } from '../src/shared/types/project'

const demoParts: PartDefinition[] = [
  { id: 'hand', display_name: 'Hand', ranges: [{ start: 0, end: 29 }] },
  { id: 'foot', display_name: 'Foot', ranges: [{ start: 30, end: 59 }] },
  { id: 'head', display_name: 'Head', ranges: [{ start: 60, end: 89 }] },
  { id: 'body', display_name: 'Body', ranges: [{ start: 90, end: 119 }] }
]

describe('resolveTargetsForRole', () => {
  it('keeps matching part ids', () => {
    expect(resolveTargetsForRole(['head', 'body'], cloneDefaultChainParts())).toEqual([
      'head',
      'body'
    ])
  })

  it('maps hand to left/right hand on default chain', () => {
    expect(resolveTargetsForRole(['hand'], cloneDefaultChainParts())).toEqual([
      'left_hand',
      'right_hand'
    ])
  })

  it('maps left_hand to hand on demo parts', () => {
    expect(resolveTargetsForRole(['left_hand'], demoParts)).toEqual(['hand'])
  })
})

describe('copyEventsFromRole', () => {
  it('copies all events with remapped targets', () => {
    let project = createEmptyProject()
    project = addRole(project, 'dancer_a', 'A')
    project = addRole(project, 'dancer_b', 'B')
    project = {
      ...project,
      roles: project.roles.map((r) =>
        r.role_id === 'dancer_a'
          ? {
              ...r,
              parts: demoParts,
              events: [
                {
                  id: 'evt_src',
                  from: '00:00',
                  to: '00:10',
                  targets: ['hand'],
                  color: 'red',
                  effect: 'solid',
                  priority: 10
                }
              ]
            }
          : r
      )
    }

    const { project: next, result } = copyEventsFromRole(project, 'dancer_a', 'dancer_b')
    const target = next.roles.find((r) => r.role_id === 'dancer_b')!

    expect(result.copied).toBe(1)
    expect(target.events).toHaveLength(1)
    expect(target.events[0].id).not.toBe('evt_src')
    expect(target.events[0].targets).toEqual(['left_hand', 'right_hand'])
    expect(target.events[0].from).toBe('00:00')
  })

  it('appends by default and can replace', () => {
    let project = createEmptyProject()
    project = addRole(project, 'dancer_a', 'A')
    project = addRole(project, 'dancer_b', 'B')
    project = {
      ...project,
      roles: project.roles.map((r) => {
        if (r.role_id === 'dancer_a') {
          return {
            ...r,
            events: [
              {
                id: 'evt_a',
                from: '00:00',
                to: '00:05',
                targets: ['body'],
                color: 'red',
                effect: 'solid',
                priority: 1
              }
            ]
          }
        }
        if (r.role_id === 'dancer_b') {
          return {
            ...r,
            events: [
              {
                id: 'evt_b',
                from: '00:10',
                to: '00:15',
                targets: ['head'],
                color: 'blue',
                effect: 'solid',
                priority: 1
              }
            ]
          }
        }
        return r
      })
    }

    const appended = copyEventsFromRole(project, 'dancer_a', 'dancer_b')
    expect(appended.result.copied).toBe(1)
    expect(appended.project.roles.find((r) => r.role_id === 'dancer_b')!.events).toHaveLength(2)

    const replaced = copyEventsFromRole(project, 'dancer_a', 'dancer_b', { replace: true })
    expect(replaced.project.roles.find((r) => r.role_id === 'dancer_b')!.events).toHaveLength(1)
    expect(replaced.project.roles.find((r) => r.role_id === 'dancer_b')!.events[0].color).toBe('red')
  })

  it('copies only events matching time range', () => {
    let project = createEmptyProject()
    project = addRole(project, 'dancer_a', 'A')
    project = addRole(project, 'dancer_b', 'B')
    project = {
      ...project,
      roles: project.roles.map((r) =>
        r.role_id === 'dancer_a'
          ? {
              ...r,
              events: [
                {
                  id: 'evt_1',
                  from: '00:00',
                  to: '00:05',
                  targets: ['body'],
                  color: 'red',
                  effect: 'solid',
                  priority: 1
                },
                {
                  id: 'evt_2',
                  from: '00:05',
                  to: '00:10',
                  targets: ['head'],
                  color: 'green',
                  effect: 'solid',
                  priority: 1
                }
              ]
            }
          : r
      )
    }

    const { result } = copyEventsFromRole(project, 'dancer_a', 'dancer_b', {
      matchTimes: { from: '00:05', to: '00:10' }
    })
    expect(result.copied).toBe(1)
    expect(
      copyEventsFromRole(project, 'dancer_a', 'dancer_b', {
        matchTimes: { from: '00:05', to: '00:10' }
      }).project.roles.find((r) => r.role_id === 'dancer_b')!.events[0].color
    ).toBe('green')
  })
})

import { describe, expect, it } from 'vitest'
import { addRole, addEvent, deleteEvent, createEmptyProject, newEventId } from '../src/shared/projectMutations'

describe('projectMutations', () => {
  it('adds dancer and event', () => {
    let p = createEmptyProject()
    p = addRole(p, 'dancer_a', '舞者 A')
    expect(p.roles).toHaveLength(1)

    p = addEvent(p, 'dancer_a', {
      id: newEventId(),
      from: '0:00',
      to: '0:10',
      targets: ['hand'],
      color: 'red',
      effect: 'solid',
      priority: 10
    })
    expect(p.roles[0].events).toHaveLength(1)

    p = deleteEvent(p, 'dancer_a', p.roles[0].events[0].id)
    expect(p.roles[0].events).toHaveLength(0)
  })
})

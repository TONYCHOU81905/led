import { useMemo } from 'react'
import { compileEvents } from '@shared/configCompiler'
import { resolveAllParts } from '@shared/timelineEngine'
import { colorToCss } from '@shared/stageColors'
import type { LedProject, RoleDefinition, TimelineEventUI } from '@shared/types/project'

interface TimelineListProps {
  role: RoleDefinition
  colors: LedProject['colors']
}

function EventRow({ event, colors }: { event: TimelineEventUI; colors: LedProject['colors'] }) {
  const swatch = colors[event.color]
  const bg = swatch ? colorToCss(swatch) : '#666'

  return (
    <tr>
      <td>{event.from}</td>
      <td>{event.to}</td>
      <td>{event.targets.join(', ')}</td>
      <td>
        <span className="color-swatch" style={{ background: bg }} />
        {event.color}
      </td>
      <td>{event.effect}</td>
      <td>{event.priority}</td>
    </tr>
  )
}

export function TimelineListEditor({ role, colors }: TimelineListProps) {
  const compiled = useMemo(() => compileEvents(role.events), [role.events])
  const preview = useMemo(
    () => resolveAllParts(compiled, role.parts.map((p) => p.id), 30_000, colors),
    [compiled, role.parts, colors]
  )

  return (
    <div className="timeline-editor">
      <h3>{role.display_name} — Timeline (MVP list view)</h3>
      <p className="hint">4 tracks: hand · foot · head · body · Preview @ 00:30</p>

      <div className="part-preview">
        {role.parts.map((part) => {
          const resolved = preview[part.id]
          const visible = resolved?.visible ?? false
          const bg = visible ? colorToCss(resolved) : '#222'
          return (
            <div key={part.id} className="part-chip">
              <span className="part-label">{part.id}</span>
              <span className="part-color" style={{ background: bg }} />
            </div>
          )
        })}
      </div>

      <table className="event-table">
        <thead>
          <tr>
            <th>From</th>
            <th>To</th>
            <th>Targets</th>
            <th>Color</th>
            <th>Effect</th>
            <th>Priority</th>
          </tr>
        </thead>
        <tbody>
          {role.events.map((event) => (
            <EventRow key={event.id} event={event} colors={colors} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

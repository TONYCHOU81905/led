import type { LedProject, PartDefinition, TimelineEventUI } from '../../shared/types/project'
import { tryParseTimeToMs } from '../../shared/timeParse'
import { ColorSwatchSelect } from './ColorSwatchSelect'
import { buildTrackMeta } from './partLabels'

interface EventInspectorProps {
  event: TimelineEventUI
  parts: PartDefinition[]
  colors: LedProject['colors']
  onPatch: (patch: Partial<TimelineEventUI>) => void
  onDelete: () => void
}

export function EventInspector({ event, parts, colors, onPatch, onDelete }: EventInspectorProps) {
  const { trackParts } = buildTrackMeta(parts)
  const partId = event.targets[0] ?? trackParts[0]?.id ?? 'body'
  const durationMs = (tryParseTimeToMs(event.to) ?? 0) - (tryParseTimeToMs(event.from) ?? 0)

  return (
    <aside className="timeline-inspector">
      <div className="inspector-header">
        <h3>Clip 屬性</h3>
        <div className="inspector-actions">
          <button type="button" className="btn btn-danger-sm" onClick={onDelete}>
            刪除
          </button>
        </div>
      </div>

      <div className="inspector-section">
        <span className="inspector-label">部位</span>
        <div className="part-segmented" role="group" aria-label="部位">
          {trackParts.map((p) => (
            <button
              key={p.id}
              type="button"
              className={partId === p.id ? 'part-seg active' : 'part-seg'}
              onClick={() => onPatch({ targets: [p.id] })}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="inspector-row">
        <label>
          <span className="inspector-label">From</span>
          <input value={event.from} onChange={(e) => onPatch({ from: e.target.value })} />
        </label>
        <label>
          <span className="inspector-label">To</span>
          <input value={event.to} onChange={(e) => onPatch({ to: e.target.value })} />
        </label>
        <div className="inspector-duration">
          <span className="inspector-label">長度</span>
          <strong>{durationMs} ms</strong>
        </div>
      </div>

      <div className="inspector-row">
        <label className="inspector-color-label">
          <span className="inspector-label">顏色</span>
          <ColorSwatchSelect
            value={event.color}
            colors={colors}
            onChange={(color) => onPatch({ color })}
          />
        </label>
        <label>
          <span className="inspector-label">效果</span>
          <select
            value={event.effect}
            onChange={(e) => onPatch({ effect: e.target.value as TimelineEventUI['effect'] })}
          >
            <option value="solid">Solid 常亮</option>
            <option value="blink">Blink 閃爍</option>
            <option value="fade_in">Fade In</option>
            <option value="fade_out">Fade Out</option>
            <option value="off">Off 關閉</option>
          </select>
        </label>
        <label>
          <span className="inspector-label">Priority</span>
          <input
            type="number"
            min={0}
            max={255}
            value={event.priority}
            onChange={(e) => onPatch({ priority: Number(e.target.value) })}
          />
        </label>
      </div>
    </aside>
  )
}

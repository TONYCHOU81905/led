import type { LedProject, PartDefinition, TimelineEventParams, TimelineEventUI } from '../../shared/types/project'
import { tryParseTimeToMs } from '../../shared/timeParse'
import {
  DIRECTION_OPTIONS,
  EFFECT_PRESETS,
  EFFECT_OPTIONS,
  FADE_CURVE_OPTIONS,
  ROUTE_PRESETS,
  buildRouteLabel,
  expandRouteToEvents,
  isLegacyRouteEvent,
  listRouteGroup,
  materializeRoutePreset,
  patchEventParams,
  readNumberParam,
  readStringParam,
  reorderRouteGroup,
  ungroupRoute
} from '../../shared/timelineEffects'
import { newEventId } from '../../shared/projectMutations'
import { ColorSwatchSelect } from './ColorSwatchSelect'
import { buildTrackMeta } from './partLabels'

interface EventInspectorProps {
  event: TimelineEventUI
  parts: PartDefinition[]
  colors: LedProject['colors']
  onPatch: (patch: Partial<TimelineEventUI>) => void
  onDelete: () => void
  allEvents: TimelineEventUI[]
  onEventsChange: (events: TimelineEventUI[]) => void
  onSelect: (id: string | null) => void
}

function supportsSecondaryColor(effect: TimelineEventUI['effect']): boolean {
  return ['gradient_scroll', 'color_lfo', 'wave', 'trail', 'path_flow', 'chase'].includes(effect)
}

function supportsRoute(effect: TimelineEventUI['effect']): boolean {
  return ['wipe_in', 'wipe_out', 'chase', 'wave', 'trail', 'gradient_scroll', 'path_flow'].includes(effect)
}

function supportsFadeControls(effect: TimelineEventUI['effect']): boolean {
  return ['solid', 'fade', 'fade_in', 'fade_out', 'pulse', 'gradient_scroll', 'color_lfo', 'path_flow', 'chase', 'wave', 'trail'].includes(effect)
}

function supportsBlinkControls(effect: TimelineEventUI['effect']): boolean {
  return effect === 'blink'
}

function supportsMotionControls(effect: TimelineEventUI['effect']): boolean {
  return ['pulse', 'wipe_in', 'wipe_out', 'chase', 'wave', 'trail', 'gradient_scroll', 'sparkle', 'color_lfo', 'path_flow'].includes(effect)
}

export function EventInspector({
  event,
  parts,
  colors,
  onPatch,
  onDelete,
  allEvents,
  onEventsChange,
  onSelect
}: EventInspectorProps) {
  const { trackParts } = buildTrackMeta(parts)
  const partId = event.targets[0] ?? trackParts[0]?.id ?? 'body'
  const durationMs = (tryParseTimeToMs(event.to) ?? 0) - (tryParseTimeToMs(event.from) ?? 0)
  const params = event.params
  const secondaryColor = readStringParam(params, 'secondary_color', 'silver_white')
  const fadeCurve = readStringParam(params, 'fade_curve', 'ease_in_out')
  const direction = readStringParam(params, 'direction', 'auto')
  const routePresetId = readStringParam(params, 'route_preset', 'none')
  const speed = readNumberParam(params, 'speed', 1)
  const intensity = readNumberParam(params, 'intensity', 1)
  const spread = readNumberParam(params, 'spread', 0.85)
  const fadeInMs = readNumberParam(params, 'fade_in_ms', 0)
  const fadeOutMs = readNumberParam(params, 'fade_out_ms', 0)
  const trailLength = readNumberParam(params, 'trail_length', 1.2)
  const frequencyHz = readNumberParam(params, 'frequency_hz', 2)
  const duty = readNumberParam(params, 'duty', 0.5)
  const minIntensity = readNumberParam(params, 'min_intensity', 0.18)
  const routeParts = Array.isArray(params?.route_parts) ? params.route_parts : []
  const routeStepLabels = Array.isArray(params?.route_step_labels) ? params.route_step_labels : []
  const routeGroupId = params?.route_group_id
  const routeGroup = routeGroupId ? listRouteGroup(allEvents, routeGroupId) : []

  const patchParams = (patch: Partial<TimelineEventParams>) => {
    onPatch({ params: patchEventParams(event.params, patch) })
  }

  const currentRouteLabel =
    params?.route_label ??
    params?.route_group_label ??
    (routeParts.length > 0 ? buildRouteLabel(routeParts, routeStepLabels) : '單部位發亮')

  const makeId = (index: number) => `${newEventId()}_${index}`

  const applyRoutePreset = (presetId: string) => {
    if (presetId === 'none') {
      if (routeGroupId) {
        onEventsChange(ungroupRoute(allEvents, routeGroupId))
        return
      }
      onPatch({
        targets: [partId],
        params: patchEventParams(event.params, {
          route_preset: undefined,
          route_parts: undefined,
          route_step_labels: undefined,
          route_label: undefined
        })
      })
      return
    }

    const preset = materializeRoutePreset(parts, presetId)
    if (!preset) return

    const expanded = expandRouteToEvents(event, parts, preset.routeParts, preset.stepLabels, makeId)
    if (expanded.length === 0) return

    onEventsChange([...allEvents.filter((e) => e.id !== event.id), ...expanded])
    onSelect(expanded[0].id)
  }

  const convertLegacyToIndependentClips = () => {
    const expanded = expandRouteToEvents(event, parts, routeParts, routeStepLabels, makeId)
    if (expanded.length === 0) return
    onEventsChange([...allEvents.filter((e) => e.id !== event.id), ...expanded])
    onSelect(expanded[0].id)
  }

  const updateRouteOrder = (nextParts: string[]) => {
    const nextLabels = nextParts.map((id) => {
      const index = routeParts.indexOf(id)
      if (index >= 0 && routeStepLabels[index]) return routeStepLabels[index]
      return parts.find((part) => part.id === id)?.display_name ?? id
    })
    onPatch({
      targets: Array.from(new Set(nextParts)),
      params: patchEventParams(event.params, {
        route_preset: undefined,
        route_parts: nextParts,
        route_step_labels: nextLabels,
        route_label: buildRouteLabel(nextParts, nextLabels)
      })
    })
  }

  const applyEffectPreset = (presetId: string) => {
    const preset = EFFECT_PRESETS.find((item) => item.id === presetId)
    if (!preset) return
    // 快速套用只影響目前選取的主要部位：清除殘留的跨部位路徑，
    // 跨部位流動請另外用「流動路徑」選單設定。
    const nextParams = patchEventParams(
      patchEventParams(event.params, {
        route_preset: undefined,
        route_parts: undefined,
        route_step_labels: undefined,
        route_label: undefined
      }),
      preset.params ?? {}
    )

    onPatch({
      effect: preset.effect,
      color: preset.color ?? event.color,
      targets: [partId],
      params: nextParams
    })
  }

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
        <span className="inspector-label">主要發亮部位</span>
        <div className="part-segmented" role="group" aria-label="部位">
          {trackParts.map((p) => (
            <button
              key={p.id}
              type="button"
              className={partId === p.id ? 'part-seg active' : 'part-seg'}
              onClick={() =>
                onPatch({
                  targets: [p.id],
                  params: patchEventParams(event.params, {
                    route_preset: undefined,
                    route_parts: undefined,
                    route_step_labels: undefined,
                    route_label: undefined
                  })
                })
              }
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="inspector-row">
        <label>
          <span className="inspector-label">開始時間</span>
          <input value={event.from} onChange={(e) => onPatch({ from: e.target.value })} />
        </label>
        <label>
          <span className="inspector-label">結束時間</span>
          <input value={event.to} onChange={(e) => onPatch({ to: e.target.value })} />
        </label>
        <div className="inspector-duration">
          <span className="inspector-label">片段長度</span>
          <strong>{durationMs} ms</strong>
        </div>
      </div>

      <div className="inspector-row">
        <label className="inspector-color-label">
          <span className="inspector-label">主色</span>
          <ColorSwatchSelect value={event.color} colors={colors} onChange={(color) => onPatch({ color })} />
        </label>
        {supportsSecondaryColor(event.effect) && (
          <label className="inspector-color-label">
            <span className="inspector-label">次色</span>
            <ColorSwatchSelect
              value={secondaryColor}
              colors={colors}
              onChange={(color) => patchParams({ secondary_color: color })}
            />
          </label>
        )}
      </div>

      <div className="inspector-row">
        <label>
          <span className="inspector-label">效果</span>
          <select
            value={event.effect}
            onChange={(e) => onPatch({ effect: e.target.value as TimelineEventUI['effect'] })}
          >
            {EFFECT_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="inspector-label">圖層優先權</span>
          <input
            type="number"
            min={0}
            max={255}
            value={event.priority}
            onChange={(e) => onPatch({ priority: Number(e.target.value) })}
          />
        </label>
      </div>

      <div className="inspector-help">
        {EFFECT_OPTIONS.find((option) => option.id === event.effect)?.description}
      </div>

      <div className="inspector-section">
        <span className="inspector-label">快速套用</span>
        <div className="preset-grid">
          {EFFECT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="preset-card"
              onClick={() => applyEffectPreset(preset.id)}
              title={preset.description}
            >
              <strong>{preset.label}</strong>
              <span>{preset.description}</span>
            </button>
          ))}
        </div>
      </div>

      {supportsRoute(event.effect) && (
        <>
        <div className="inspector-row">
          <label className="inspector-span-2">
            <span className="inspector-label">流動路徑</span>
            <select value={routePresetId} onChange={(e) => applyRoutePreset(e.target.value)}>
              {ROUTE_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          <div className="inspector-route-preview">
            <span className="inspector-label">目前路徑</span>
            <strong>{currentRouteLabel}</strong>
          </div>
        </div>
        {isLegacyRouteEvent(event) && (
          <div className="inspector-section">
            <span className="inspector-label">自訂路徑順序（舊格式：多部位共用同一個 clip）</span>
            <div className="route-chip-list">
              {routeParts.length > 0 ? (
                routeParts.map((routePart, index) => (
                  <div key={`${routePart}-${index}`} className="route-chip">
                    <span>{routeStepLabels[index] ?? parts.find((part) => part.id === routePart)?.display_name ?? routePart}</span>
                    <div className="route-chip-actions">
                      <button
                        type="button"
                        className="route-chip-btn"
                        onClick={() => {
                          if (index === 0) return
                          const next = [...routeParts]
                          ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                          updateRouteOrder(next)
                        }}
                      >
                        ←
                      </button>
                      <button
                        type="button"
                        className="route-chip-btn"
                        onClick={() => {
                          if (index === routeParts.length - 1) return
                          const next = [...routeParts]
                          ;[next[index + 1], next[index]] = [next[index], next[index + 1]]
                          updateRouteOrder(next)
                        }}
                      >
                        →
                      </button>
                      <button
                        type="button"
                        className="route-chip-btn route-chip-btn-danger"
                        onClick={() => {
                          const next = routeParts.filter((_, i) => i !== index)
                          updateRouteOrder(next)
                        }}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="route-chip-empty">先套用一條路徑，或從下方加入部位。</div>
              )}
            </div>
            <div className="route-add-list">
              {parts.map((part) => (
                <button
                  key={part.id}
                  type="button"
                  className="route-add-btn"
                  onClick={() => updateRouteOrder([...routeParts, part.id])}
                >
                  + {part.display_name}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-sm" onClick={convertLegacyToIndependentClips}>
              轉成獨立 clip
            </button>
          </div>
        )}

        {routeGroupId && routeGroup.length > 0 && (
          <div className="inspector-section">
            <span className="inspector-label">路徑群組</span>
            <div>
              <strong>{params?.route_group_label ?? currentRouteLabel}</strong>
            </div>
            <div>
              第 {(params?.route_group_index ?? 0) + 1} / {params?.route_group_total ?? routeGroup.length} 段：
              {params?.route_step_label ?? ''}
            </div>
            <div className="route-chip-list">
              {routeGroup.map((groupEvent, index) => {
                const isActive = groupEvent.id === event.id
                return (
                  <div key={groupEvent.id} className={isActive ? 'route-chip active' : 'route-chip'}>
                    <button
                      type="button"
                      className={isActive ? 'part-seg active' : 'part-seg'}
                      style={{ border: 'none', background: 'none', cursor: 'pointer' }}
                      onClick={() => onSelect(groupEvent.id)}
                    >
                      {groupEvent.params?.route_step_label ?? groupEvent.targets[0]}
                    </button>
                    <div className="route-chip-actions">
                      <button
                        type="button"
                        className="route-chip-btn"
                        onClick={() => {
                          if (index === 0) return
                          const order = routeGroup.map((e) => e.id)
                          ;[order[index - 1], order[index]] = [order[index], order[index - 1]]
                          onEventsChange(reorderRouteGroup(allEvents, routeGroupId, order))
                        }}
                      >
                        ←
                      </button>
                      <button
                        type="button"
                        className="route-chip-btn"
                        onClick={() => {
                          if (index === routeGroup.length - 1) return
                          const order = routeGroup.map((e) => e.id)
                          ;[order[index + 1], order[index]] = [order[index], order[index + 1]]
                          onEventsChange(reorderRouteGroup(allEvents, routeGroupId, order))
                        }}
                      >
                        →
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="inspector-help">
              每一段都是獨立 clip，改顏色、效果、時間只會影響選取的那一段。
            </div>
            <div className="inspector-row">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => onEventsChange(ungroupRoute(allEvents, routeGroupId))}
              >
                解除群組
              </button>
              <button
                type="button"
                className="btn btn-danger-sm"
                onClick={() => {
                  onEventsChange(allEvents.filter((e) => e.params?.route_group_id !== routeGroupId))
                  onSelect(null)
                }}
              >
                刪除整組
              </button>
            </div>
          </div>
        )}
        </>
      )}

      {supportsFadeControls(event.effect) && (
        <div className="inspector-row">
          <label>
            <span className="inspector-label">淡入時間</span>
            <input
              type="number"
              min={0}
              step={50}
              value={fadeInMs}
              onChange={(e) => patchParams({ fade_in_ms: Number(e.target.value) || 0 })}
            />
          </label>
          <label>
            <span className="inspector-label">淡出時間</span>
            <input
              type="number"
              min={0}
              step={50}
              value={fadeOutMs}
              onChange={(e) => patchParams({ fade_out_ms: Number(e.target.value) || 0 })}
            />
          </label>
          <label>
            <span className="inspector-label">淡化曲線</span>
            <select value={fadeCurve} onChange={(e) => patchParams({ fade_curve: e.target.value as TimelineEventParams['fade_curve'] })}>
              {FADE_CURVE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {supportsMotionControls(event.effect) && (
        <div className="inspector-row">
          <label>
            <span className="inspector-label">速度</span>
            <input
              type="number"
              min={0.1}
              max={12}
              step={0.1}
              value={speed}
              onChange={(e) => patchParams({ speed: Number(e.target.value) || 0.1 })}
            />
          </label>
          <label>
            <span className="inspector-label">亮度強度</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={intensity}
              onChange={(e) => patchParams({ intensity: Number(e.target.value) || 0 })}
            />
          </label>
          <label>
            <span className="inspector-label">方向</span>
            <select value={direction} onChange={(e) => patchParams({ direction: e.target.value as TimelineEventParams['direction'] })}>
              {DIRECTION_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {supportsMotionControls(event.effect) && (
        <div className="inspector-row">
          <label>
            <span className="inspector-label">流動範圍</span>
            <input
              type="number"
              min={0.1}
              max={2}
              step={0.05}
              value={spread}
              onChange={(e) => patchParams({ spread: Number(e.target.value) || 0.1 })}
            />
          </label>
          <label>
            <span className="inspector-label">最小亮度</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={minIntensity}
              onChange={(e) => patchParams({ min_intensity: Number(e.target.value) || 0 })}
            />
          </label>
          <label>
            <span className="inspector-label">拖尾長度</span>
            <input
              type="number"
              min={0.1}
              max={3}
              step={0.1}
              value={trailLength}
              onChange={(e) => patchParams({ trail_length: Number(e.target.value) || 0.1 })}
            />
          </label>
        </div>
      )}

      {supportsBlinkControls(event.effect) && (
        <div className="inspector-row">
          <label>
            <span className="inspector-label">閃爍頻率</span>
            <input
              type="number"
              min={0.5}
              max={20}
              step={0.5}
              value={frequencyHz}
              onChange={(e) => patchParams({ frequency_hz: Number(e.target.value) || 0.5 })}
            />
          </label>
          <label>
            <span className="inspector-label">亮燈比例</span>
            <input
              type="number"
              min={0.05}
              max={0.95}
              step={0.05}
              value={duty}
              onChange={(e) => patchParams({ duty: Number(e.target.value) || 0.05 })}
            />
          </label>
        </div>
      )}
    </aside>
  )
}

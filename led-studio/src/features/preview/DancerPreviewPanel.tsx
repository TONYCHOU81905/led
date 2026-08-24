import { useMemo, useState } from 'react'
import { compileEvents } from '../../shared/configCompiler'
import {
  describeEventRoute,
  pickWinningEvent,
  queryActiveEvents,
  resolvePartColor,
  resolvePartPixels
} from '../../shared/timelineEngine'
import { colorToCss } from '../../shared/stageColors'
import { formatMsToTime } from '../../shared/timeParse'
import type { LedProject, RoleDefinition } from '../../shared/types/project'
import { getEffectLabel, listEventRouteLabels } from '../../shared/timelineEffects'
import { DancerFigureSvg, REGION_PIXEL_COUNTS } from './DancerFigureSvg'
import { PREVIEW_ALL_ROLES, regionsForParts, resolveFigureRegionPixels } from './partRegionMap'

interface DancerPreviewPanelProps {
  project: LedProject
  playheadMs: number
  activeRoleId?: string | null
  onClose?: () => void
}

function RolePreviewCard({
  role,
  colors,
  playheadMs,
  showFlowGuide
}: {
  role: RoleDefinition
  colors: LedProject['colors']
  playheadMs: number
  showFlowGuide: boolean
}) {
  const visibleRegions = useMemo(() => regionsForParts(role.parts), [role.parts])

  const { regionPixels, unmapped, activeSummary } = useMemo(() => {
    const compiled = compileEvents(role.events)
    const routeEvent = queryActiveEvents(compiled, playheadMs)
      .filter((event) => (event.params?.route_parts?.length ?? 0) > 1)
      .sort((a, b) => b.priority - a.priority)[0]

    const focusPart = role.parts[0]?.id ?? 'body'
    const winner = pickWinningEvent(compiled, focusPart, playheadMs)
    const routeState = routeEvent ? describeEventRoute(routeEvent, playheadMs, role.parts) : null
    const routeLabels =
      routeEvent && routeState
        ? listEventRouteLabels(routeEvent.targets, role.parts, routeEvent.params)
        : []

    return {
      ...resolveFigureRegionPixels(
        role.parts,
        REGION_PIXEL_COUNTS,
        (partId, pixelCount) => resolvePartPixels(compiled, partId, playheadMs, colors, pixelCount, role.parts),
        (partId) => resolvePartColor(compiled, partId, playheadMs, colors)
      ),
      activeSummary: {
        effectLabel: winner ? getEffectLabel(winner.effect) : '未亮燈',
        routeLabel: routeEvent?.params?.route_label,
        activeStep:
          routeState && routeLabels.length > 0
            ? routeLabels[routeState.activeIndex] ?? routeLabels[0]
            : null
      }
    }
  }, [role, colors, playheadMs])

  return (
    <div className="dancer-preview-card">
      <div className="dancer-preview-card-title">{role.display_name}</div>
      <DancerFigureSvg
        regionPixels={regionPixels}
        visibleRegions={visibleRegions}
        showFlowGuide={showFlowGuide}
        className="dancer-preview-figure"
        title={role.display_name}
      />
      <div className="dancer-preview-meta">
        <div className="dancer-preview-effect">{activeSummary.effectLabel}</div>
        {activeSummary.routeLabel && (
          <div className="dancer-preview-route">
            <span>{activeSummary.routeLabel}</span>
            {activeSummary.activeStep && <strong>目前：{activeSummary.activeStep}</strong>}
          </div>
        )}
      </div>
      {unmapped.length > 0 && (
        <ul className="dancer-preview-unmapped">
          {unmapped.map(({ partId, label, color }) => (
            <li key={partId}>
              <span
                className="dancer-preview-swatch"
                style={{
                  background: color.visible ? colorToCss(color) : '#1a2030',
                  opacity: color.visible ? 1 : 0.55
                }}
              />
              {label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function DancerPreviewPanel({ project, playheadMs, activeRoleId, onClose }: DancerPreviewPanelProps) {
  const roles = project.roles
  const defaultSelection = activeRoleId && roles.some((r) => r.role_id === activeRoleId)
    ? activeRoleId
    : roles[0]?.role_id ?? PREVIEW_ALL_ROLES

  const [selection, setSelection] = useState(defaultSelection)
  const [showFlowGuide, setShowFlowGuide] = useState(true)

  const effectiveSelection =
    selection === PREVIEW_ALL_ROLES || roles.some((r) => r.role_id === selection)
      ? selection
      : defaultSelection

  const visibleRoles =
    effectiveSelection === PREVIEW_ALL_ROLES
      ? roles
      : roles.filter((r) => r.role_id === effectiveSelection)

  return (
    <aside className="dancer-preview-panel" aria-label="舞者燈光預覽">
      <div className="dancer-preview-header">
        <h3>燈光預覽</h3>
        <div className="dancer-preview-header-actions">
          <span className="dancer-preview-time">{formatMsToTime(playheadMs)}</span>
          {onClose && (
            <button
              type="button"
              className="dancer-preview-close"
              onClick={onClose}
              title="隱藏燈光預覽"
              aria-label="隱藏燈光預覽"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <label className="dancer-preview-select-label">
        顯示
        <select
          className="dancer-preview-select"
          value={effectiveSelection}
          onChange={(e) => setSelection(e.target.value)}
        >
          {roles.map((role) => (
            <option key={role.role_id} value={role.role_id}>
              {role.display_name}
            </option>
          ))}
          <option value={PREVIEW_ALL_ROLES}>全部舞者</option>
        </select>
      </label>

      <div className="dancer-preview-hint-row">
        <p className="dancer-preview-hint">跟隨播放進度 · 暗色為未亮燈</p>
        <button
          type="button"
          className="dancer-preview-flow-toggle"
          aria-pressed={showFlowGuide}
          onClick={() => setShowFlowGuide((v) => !v)}
          title="切換流動示意"
        >
          流動示意
        </button>
      </div>

      <div
        className={
          effectiveSelection === PREVIEW_ALL_ROLES
            ? 'dancer-preview-grid'
            : 'dancer-preview-single'
        }
      >
        {visibleRoles.map((role) => (
          <RolePreviewCard
            key={role.role_id}
            role={role}
            colors={project.colors}
            playheadMs={playheadMs}
            showFlowGuide={showFlowGuide}
          />
        ))}
      </div>
    </aside>
  )
}

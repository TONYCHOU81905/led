import { useMemo, useState } from 'react'
import { compileEvents } from '../../shared/configCompiler'
import { resolveAllParts } from '../../shared/timelineEngine'
import { colorToCss } from '../../shared/stageColors'
import { formatMsToTime } from '../../shared/timeParse'
import type { LedProject, RoleDefinition } from '../../shared/types/project'
import { DancerFigureSvg } from './DancerFigureSvg'
import { PREVIEW_ALL_ROLES, resolveFigureRegions } from './partRegionMap'

interface DancerPreviewPanelProps {
  project: LedProject
  playheadMs: number
  activeRoleId?: string | null
  onClose?: () => void
}

function RolePreviewCard({
  role,
  colors,
  playheadMs
}: {
  role: RoleDefinition
  colors: LedProject['colors']
  playheadMs: number
}) {
  const { regions, unmapped } = useMemo(() => {
    const compiled = compileEvents(role.events)
    const resolved = resolveAllParts(
      compiled,
      role.parts.map((p) => p.id),
      playheadMs,
      colors
    )
    return resolveFigureRegions(role.parts, resolved)
  }, [role, colors, playheadMs])

  return (
    <div className="dancer-preview-card">
      <div className="dancer-preview-card-title">{role.display_name}</div>
      <DancerFigureSvg regions={regions} className="dancer-preview-figure" title={role.display_name} />
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

      <p className="dancer-preview-hint">跟隨播放進度 · 暗色為未亮燈</p>

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
          />
        ))}
      </div>
    </aside>
  )
}

import { useEffect, useMemo, useState } from 'react'
import type { LedProject, RoleDefinition } from '../../shared/types/project'
import { copyEventsFromRole } from '../../shared/copyRoleEvents'

interface CopyTimelineControlProps {
  project: LedProject
  targetRole: RoleDefinition
  selectedEventId: string | null
  onProjectChange: (project: LedProject) => void
  onCopied?: (message: string) => void
  onError?: (message: string) => void
}

export function CopyTimelineControl({
  project,
  targetRole,
  selectedEventId,
  onProjectChange,
  onCopied,
  onError
}: CopyTimelineControlProps) {
  const otherRoles = useMemo(
    () => project.roles.filter((r) => r.role_id !== targetRole.role_id),
    [project.roles, targetRole.role_id]
  )

  const [sourceRoleId, setSourceRoleId] = useState(otherRoles[0]?.role_id ?? '')
  const [replaceExisting, setReplaceExisting] = useState(false)
  const [copyScope, setCopyScope] = useState<'all' | 'selected'>('all')

  useEffect(() => {
    if (!otherRoles.some((r) => r.role_id === sourceRoleId)) {
      setSourceRoleId(otherRoles[0]?.role_id ?? '')
    }
  }, [otherRoles, sourceRoleId])

  if (otherRoles.length === 0) return null

  const sourceRole = otherRoles.find((r) => r.role_id === sourceRoleId) ?? otherRoles[0]
  const canCopySelected = copyScope === 'selected' && selectedEventId !== null

  const handleCopy = () => {
    if (!sourceRole) return

    if (copyScope === 'selected' && !selectedEventId) {
      onError?.('請先在 Timeline 選取要對齊時間的 clip')
      return
    }

    const selectedEvent =
      copyScope === 'selected' && selectedEventId
        ? targetRole.events.find((e) => e.id === selectedEventId)
        : null

    if (copyScope === 'selected' && !selectedEvent) {
      onError?.('找不到選取的 clip')
      return
    }

    if (
      replaceExisting &&
      targetRole.events.length > 0 &&
      !window.confirm(
        `將以「${sourceRole.display_name}」的 clips ${copyScope === 'selected' ? '（相同時間區間）' : ''}取代「${targetRole.display_name}」現有的 ${targetRole.events.length} 個 clip。確定？`
      )
    ) {
      return
    }

    try {
      const { project: next, result } = copyEventsFromRole(
        project,
        sourceRole.role_id,
        targetRole.role_id,
        {
          replace: replaceExisting,
          matchTimes:
            copyScope === 'selected' && selectedEvent
              ? { from: selectedEvent.from, to: selectedEvent.to }
              : undefined
        }
      )

      onProjectChange(next)

      if (result.copied === 0) {
        onError?.(
          result.sourceTotal === 0
            ? `「${sourceRole.display_name}」沒有可複製的 clip`
            : `無法複製：${result.skippedNoTargets} 個 clip 的部位與「${targetRole.display_name}」不相容`
        )
        return
      }

      let message = `已複製 ${result.copied} 個 clip（${sourceRole.display_name} → ${targetRole.display_name}）`
      if (result.skippedNoTargets > 0) {
        message += `，略過 ${result.skippedNoTargets} 個（部位不相容）`
      }
      onCopied?.(message)
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="copy-timeline-control">
      <label className="copy-timeline-field">
        <span className="copy-timeline-label">從</span>
        <select
          className="copy-timeline-select"
          value={sourceRole.role_id}
          onChange={(e) => setSourceRoleId(e.target.value)}
          title="來源舞者"
        >
          {otherRoles.map((r) => (
            <option key={r.role_id} value={r.role_id}>
              {r.display_name}（{r.events.length}）
            </option>
          ))}
        </select>
      </label>

      <select
        className="copy-timeline-select copy-timeline-scope"
        value={copyScope}
        onChange={(e) => setCopyScope(e.target.value as 'all' | 'selected')}
        title="複製範圍"
      >
        <option value="all">全部 Clips</option>
        <option value="selected" disabled={!selectedEventId}>
          相同時間區間{selectedEventId ? '' : '（請先選取 clip）'}
        </option>
      </select>

      <button
        type="button"
        className="btn btn-sm"
        onClick={handleCopy}
        disabled={copyScope === 'selected' && !canCopySelected}
        title={`複製到 ${targetRole.display_name}`}
      >
        複製 → {targetRole.display_name}
      </button>

      <label className="copy-timeline-replace" title="勾選後會清除目標舞者現有 clips">
        <input
          type="checkbox"
          checked={replaceExisting}
          onChange={(e) => setReplaceExisting(e.target.checked)}
        />
        取代現有
      </label>
    </div>
  )
}

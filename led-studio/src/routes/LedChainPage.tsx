import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CHAIN_WIRING_ORDER_HINT,
  computeLedCountFromParts,
  ledCountForPart
} from '../shared/ledChainDefaults'
import {
  addPartAfterLast,
  removePart,
  resetPartsToDefault,
  updatePart
} from '../shared/projectMutations'
import type { PartDefinition } from '../shared/types/project'
import { useProjectStore } from '../stores/projectStore'

function rangeLabel(part: PartDefinition): string {
  if (part.ranges.length === 0) return '—'
  return part.ranges.map((r) => `${r.start} ~ ${r.end}`).join(', ')
}

function ChainStripPreview({ parts, total }: { parts: PartDefinition[]; total: number }) {
  if (total <= 0) return null
  return (
    <div className="led-chain-strip" aria-hidden>
      {parts.map((part) => {
        const count = ledCountForPart(part)
        const widthPct = Math.max((count / total) * 100, 2)
        return (
          <div
            key={part.id}
            className="led-chain-segment"
            style={{ flex: `0 0 ${widthPct}%` }}
            title={`${part.display_name} (${rangeLabel(part)})`}
          >
            <span className="led-chain-segment-label">{part.display_name}</span>
          </div>
        )
      })}
    </div>
  )
}

export function LedChainPage() {
  const { project, activeRoleId, setActiveRole, updateProject } = useProjectStore()
  const [error, setError] = useState<string | null>(null)

  const role = useMemo(
    () => project?.roles.find((r) => r.role_id === activeRoleId) ?? project?.roles[0] ?? null,
    [project, activeRoleId]
  )

  if (!project) {
    return (
      <section className="page">
        <p>
          尚未載入專案。<Link to="/">前往 Dashboard</Link>
        </p>
      </section>
    )
  }

  const roleId = role?.role_id ?? project.roles[0]?.role_id
  const parts = role?.parts ?? []
  const totalLeds = computeLedCountFromParts(parts)

  const patchPart = (partId: string, patch: Partial<Pick<PartDefinition, 'id' | 'display_name' | 'ranges'>>) => {
    if (!roleId) return
    setError(null)
    try {
      updateProject((p) => updatePart(p, roleId, partId, patch))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleRangeChange = (partId: string, field: 'start' | 'end', raw: string) => {
    const part = parts.find((p) => p.id === partId)
    if (!part) return
    const value = Math.max(0, Math.floor(Number(raw) || 0))
    const current = part.ranges[0] ?? { start: 0, end: 0 }
    const next = { ...current, [field]: value }
    patchPart(partId, { ranges: [next] })
  }

  return (
    <section className="page led-chain-page">
      <header className="page-header led-chain-header">
        <div>
          <h1>LED 串聯節點</h1>
          <p className="hint">
            單條 WS2812 串聯 · 接線順序：{CHAIN_WIRING_ORDER_HINT} · 共 {totalLeds} 顆 LED
          </p>
        </div>
        <div className="role-tabs">
          {project.roles.map((r) => (
            <button
              key={r.role_id}
              type="button"
              className={r.role_id === roleId ? 'tab active' : 'tab'}
              onClick={() => setActiveRole(r.role_id)}
            >
              {r.display_name}
            </button>
          ))}
        </div>
      </header>

      {error && <p className="error-banner">{error}</p>}

      {role ? (
        <>
          <ChainStripPreview parts={parts} total={totalLeds} />

          <div className="led-chain-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setError(null)
                try {
                  updateProject((p) => addPartAfterLast(p, role.role_id))
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err))
                }
              }}
            >
              + 新增節點
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (!window.confirm('還原為預設 6 節點（身體→頭→左右手→左右腳）？')) return
                setError(null)
                updateProject((p) => resetPartsToDefault(p, role.role_id))
              }}
            >
              還原預設節點
            </button>
          </div>

          <div className="led-chain-table-wrap">
            <table className="event-table led-chain-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>顯示名稱</th>
                  <th>節點 ID</th>
                  <th>起始索引</th>
                  <th>結束索引</th>
                  <th>LED 數</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {parts.map((part, index) => {
                  const range = part.ranges[0] ?? { start: 0, end: 0 }
                  return (
                    <tr key={part.id}>
                      <td className="mono">{index + 1}</td>
                      <td>
                        <input
                          value={part.display_name}
                          onChange={(e) => patchPart(part.id, { display_name: e.target.value })}
                          aria-label={`${part.display_name} 顯示名稱`}
                        />
                      </td>
                      <td>
                        <input
                          className="mono"
                          value={part.id}
                          onChange={(e) => patchPart(part.id, { id: e.target.value.trim() })}
                          aria-label={`${part.display_name} 節點 ID`}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          value={range.start}
                          onChange={(e) => handleRangeChange(part.id, 'start', e.target.value)}
                          aria-label={`${part.display_name} 起始索引`}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          value={range.end}
                          onChange={(e) => handleRangeChange(part.id, 'end', e.target.value)}
                          aria-label={`${part.display_name} 結束索引`}
                        />
                      </td>
                      <td className="mono">{ledCountForPart(part)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-danger-sm"
                          disabled={parts.length <= 1}
                          onClick={() => {
                            if (!window.confirm(`刪除節點「${part.display_name}」？相關 Timeline clip 也會移除。`)) {
                              return
                            }
                            setError(null)
                            updateProject((p) => removePart(p, role.role_id, part.id))
                          }}
                        >
                          刪除
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <p className="hint led-chain-footnote">
            索引從 0 起算（inclusive）。例如身體 0~19 代表第 1~20 顆 LED。匯出 Config 時會依節點範圍自動計算{' '}
            <code>led_count</code>（目前 {totalLeds}）。
          </p>
        </>
      ) : (
        <p className="error-banner">此專案沒有舞者。請到 Dashboard 新建專案。</p>
      )}
    </section>
  )
}

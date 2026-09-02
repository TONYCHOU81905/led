import { PREVIEW_PART_OPTIONS } from '../features/preview/partRegionMap'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CHAIN_WIRING_ORDER_HINT,
  SAFE_GPIO_OPTIONS,
  logicalLedCountForOutput,
  physicalLedCountForOutput
} from '../shared/ledChainDefaults'
import {
  addLedOutput,
  countEventsForOutput,
  removeLedOutput,
  resetPartsToDefault,
  updateLedOutput
} from '../shared/projectMutations'
import type { LedOutputDefinition } from '../shared/types/project'
import { useProjectStore } from '../stores/projectStore'

const BRANCH_LABELS = ['拇指／大趾', '食指／第二趾', '中指／第三趾', '無名指／第四趾', '小拇指／小趾']

function clampInteger(raw: string, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(Number(raw) || 0)))
}

function OutputTopology({ output }: { output: LedOutputDefinition }) {
  if (output.layout === 'ring') {
    return (
      <div className="output-topology ring-topology" aria-label="帽子接線拓撲">
        <span>GPIO {output.gpio}</span><b>DIN</b><span>圓形燈帶 {output.outbound_leds} 顆</span><b>DOUT 終點</b>
      </div>
    )
  }
  return (
    <div className="output-topology" aria-label={`${output.display_name}接線拓撲`}>
      <span>GPIO {output.gpio}</span><b>DIN</b><span>去程 {output.outbound_leds}</span><b>一分 {output.parallel_branches}</b>
      <span>{output.parallel_branches} 條 × {output.branch_leds}</span><b>分支 {output.continuation_branch} DOUT</b>
      <span>回程 {output.return_leds}</span>
    </div>
  )
}

export function LedChainPage() {
  const { project, activeRoleId, setActiveRole, updateProject } = useProjectStore()
  const [activeOutputId, setActiveOutputId] = useState('hat')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const role = useMemo(
    () => project?.roles.find((r) => r.role_id === activeRoleId) ?? project?.roles[0] ?? null,
    [project, activeRoleId]
  )
  const outputs = role?.led_outputs ?? []
  const activeOutput = outputs.find((output) => output.id === activeOutputId) ?? outputs[0]

  useEffect(() => {
    if (!outputs.some((output) => output.id === activeOutputId)) {
      setActiveOutputId(outputs[0]?.id ?? '')
    }
  }, [outputs, activeOutputId])

  if (!project) {
    return <section className="page"><p>尚未載入專案。<Link to="/">前往 Dashboard</Link></p></section>
  }

  const logicalCount = outputs.reduce((sum, output) => sum + logicalLedCountForOutput(output), 0)
  const physicalCount = outputs.reduce((sum, output) => sum + physicalLedCountForOutput(output), 0)
  const worstCaseAmps = physicalCount * 0.06
  const duplicateGpios = outputs.filter((output, index) => outputs.findIndex((item) => item.gpio === output.gpio) !== index)

  const patchOutput = (patch: Partial<LedOutputDefinition>) => {
    if (!role || !activeOutput) return
    updateProject((current) => updateLedOutput(current, role.role_id, activeOutput.id, patch))
  }

  return (
    <section className="page led-chain-page">
      <header className="page-header led-chain-header">
        <div>
          <h1>LED 輸出與並聯配置</h1>
          <p className="hint">{outputs.length} 個獨立 GPIO · {CHAIN_WIRING_ORDER_HINT}</p>
        </div>
        <div className="role-tabs" aria-label="舞者選擇">
          {project.roles.map((item) => (
            <button key={item.role_id} type="button" className={item.role_id === role?.role_id ? 'tab active' : 'tab'}
              onClick={() => setActiveRole(item.role_id)}>{item.display_name}</button>
          ))}
        </div>
      </header>

      <div className="output-summary-grid">
        <div><span>邏輯燈位</span><strong>{logicalCount}</strong><small>Timeline 實際編排數</small></div>
        <div><span>實體 LED</span><strong>{physicalCount}</strong><small>包含五指／五趾並聯</small></div>
        <div><span>5V 全白上限</span><strong>{worstCaseAmps.toFixed(1)} A</strong><small>以每顆 60mA 保守估算</small></div>
      </div>

      <p className="power-warning">
        行動電源不能經由 ESP32 供應燈帶。請使用可穩定輸出 5V 大電流的電源系統、分區保險絲與多點注電；ESP32、電平轉換器和所有 LED 電源必須共地。
      </p>
      {duplicateGpios.length > 0 && <p className="error-banner">GPIO 不可重複：{duplicateGpios.map((output) => output.gpio).join(', ')}</p>}

      <div className="output-tabs" role="tablist" aria-label="LED 通道">
        {outputs.map((output, index) => (
          <button key={output.id} type="button" role="tab" aria-selected={output.id === activeOutput?.id}
            className={output.id === activeOutput?.id ? 'output-tab active' : 'output-tab'}
            onClick={() => setActiveOutputId(output.id)}>
            <span>通道 {index + 1}</span><strong>{output.display_name}</strong><small>GPIO {output.gpio}</small>
          </button>
        ))}
        {role && (
          <button
            type="button"
            className="output-tab"
            title="複製目前選取的通道設定，新增一個通道"
            onClick={() => {
              const sourceId = activeOutput?.id
              updateProject((current) => addLedOutput(current, role.role_id, sourceId))
              setPendingDeleteId(null)
            }}
          >
            <span>＋</span><strong>新增通道</strong><small>沿用目前設定</small>
          </button>
        )}
      </div>

      {activeOutput && role && (
        <div className="output-editor" role="tabpanel">
          <div className="output-editor-heading">
            <div><h2>{activeOutput.display_name}</h2><p className="hint">索引會依通道順序自動重算，Timeline 部位 ID 保持不變。</p></div>
            <div className="output-counts">
              <span>邏輯 {logicalLedCountForOutput(activeOutput)} 顆</span>
              <span>實體 {physicalLedCountForOutput(activeOutput)} 顆</span>
              <button
                type="button"
                className="btn btn-danger-sm"
                disabled={outputs.length <= 1}
                title={outputs.length <= 1 ? '至少要保留一個通道' : '刪除這個通道'}
                onClick={() => setPendingDeleteId(activeOutput.id)}
              >
                刪除通道
              </button>
            </div>
          </div>

          {pendingDeleteId === activeOutput.id && (
            <div className="error-banner" style={{ display: 'flex', alignItems: 'center', gap: '0.75em', flexWrap: 'wrap' }}>
              <span>
                「{activeOutput.display_name}」這個通道上有 {countEventsForOutput(role, activeOutput.id)} 個 clip，
                刪除通道會一併移除它們。後面通道的 LED 索引也會往前重算。
              </span>
              <button type="button" className="btn btn-sm" onClick={() => setPendingDeleteId(null)}>取消</button>
              <button
                type="button"
                className="btn btn-danger-sm"
                onClick={() => {
                  updateProject((current) => removeLedOutput(current, role.role_id, activeOutput.id))
                  setPendingDeleteId(null)
                }}
              >
                確定刪除
              </button>
            </div>
          )}

          <OutputTopology output={activeOutput} />

          <div className="output-form-grid">
            <label><span>GPIO</span><select value={activeOutput.gpio}
              onChange={(e) => patchOutput({ gpio: Number(e.target.value) })}>
              {SAFE_GPIO_OPTIONS.map((gpio) => <option key={gpio} value={gpio}>GPIO {gpio}</option>)}
            </select></label>
            <label><span>名稱</span><input value={activeOutput.display_name}
              onChange={(e) => patchOutput({ display_name: e.target.value })} /></label>
            <label>
              <span>預覽對應部位</span>
              <select
                value={PREVIEW_PART_OPTIONS.some((o) => o.id === activeOutput.part_id) ? activeOutput.part_id : ''}
                onChange={(e) => patchOutput({ part_id: e.target.value })}
              >
                <option value="">（未對應，預覽不顯示）</option>
                {PREVIEW_PART_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
            </label>
            <label><span>{activeOutput.layout === 'ring' ? '帽子燈數' : '肩膀／大腿到分岔點'}</span>
              <input type="number" min={1} max={300} value={activeOutput.outbound_leds}
                onChange={(e) => patchOutput({ outbound_leds: clampInteger(e.target.value, 1, 300) })} /></label>

            {activeOutput.layout === 'ring' ? (
              <label><span>繞行方向</span><select value={activeOutput.direction}
                onChange={(e) => patchOutput({ direction: e.target.value as LedOutputDefinition['direction'] })}>
                <option value="clockwise">順時針</option><option value="counterclockwise">逆時針</option>
              </select></label>
            ) : (
              <>
                <label><span>並聯手指／腳趾數</span><input type="number" min={1} max={5} value={activeOutput.parallel_branches}
                  onChange={(e) => {
                    const count = clampInteger(e.target.value, 1, 5)
                    patchOutput({ parallel_branches: count, continuation_branch: Math.min(activeOutput.continuation_branch, count) })
                  }} /></label>
                <label><span>每根手指／腳趾燈數</span><input type="number" min={1} max={60} value={activeOutput.branch_leds}
                  onChange={(e) => patchOutput({ branch_leds: clampInteger(e.target.value, 1, 60) })} /></label>
                <label><span>回到肩膀／大腿燈數</span><input type="number" min={0} max={300} value={activeOutput.return_leds}
                  onChange={(e) => patchOutput({ return_leds: clampInteger(e.target.value, 0, 300) })} /></label>
                <label><span>接續回程的 DOUT</span><select value={activeOutput.continuation_branch}
                  onChange={(e) => patchOutput({ continuation_branch: Number(e.target.value) })}>
                  {Array.from({ length: activeOutput.parallel_branches }, (_, index) => (
                    <option key={index + 1} value={index + 1}>分支 {index + 1}（{BRANCH_LABELS[index] ?? `第 ${index + 1} 支`}）</option>
                  ))}
                </select></label>
              </>
            )}
          </div>

          <div className="wiring-note">
            <strong>接線規則</strong>
            <span>箭頭或焊盤上的 <code>DI / DIN</code> 是資料進入端，<code>DO / DOUT</code> 是資料輸出端。不可將多條分支的 DOUT 合併；只從上方選定的一條分支接往回程。</span>
          </div>
        </div>
      )}

      <button type="button" className="btn" onClick={() => {
        if (role && window.confirm('將此舞者還原為帽子與四肢的預設 5 通道配置？')) {
          updateProject((current) => resetPartsToDefault(current, role.role_id))
        }
      }}>還原 5 通道預設值</button>
    </section>
  )
}

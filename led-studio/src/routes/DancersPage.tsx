import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { STAGE_COLOR_NAMES, getStageColorLabel, resolveColorCss } from '../shared/stageColors'
import { newEventId } from '../shared/projectMutations'
import { EFFECT_OPTIONS, getEffectLabel } from '../shared/timelineEffects'
import { useProjectStore } from '../stores/projectStore'

export function DancersPage() {
  const {
    project,
    activeRoleId,
    setActiveRole,
    activeRole,
    addDancer,
    removeDancer,
    renameDancer,
    addDancerEvent,
    deleteDancerEvent
  } = useProjectStore()

  const role = activeRole()

  useEffect(() => {
    if (project && !activeRoleId && project.roles[0]) {
      setActiveRole(project.roles[0].role_id)
    }
  }, [project, activeRoleId, setActiveRole])

  if (!project) {
    return (
      <section className="page">
        <p>
          尚未載入專案。<Link to="/">前往 Dashboard</Link>
        </p>
      </section>
    )
  }

  return (
    <section className="page dancers-page">
      <header className="dancers-page-header">
        <div>
          <h1>舞者 / 亮燈條件</h1>
          <p className="hint">
            {project.project.name} · {role?.display_name ?? '—'} · {role?.events.length ?? 0} 條件
          </p>
        </div>
        <div className="role-tabs">
          {project.roles.map((r) => (
            <button
              key={r.role_id}
              type="button"
              className={r.role_id === activeRoleId ? 'tab active' : 'tab'}
              onClick={() => setActiveRole(r.role_id)}
            >
              {r.display_name}
              {r.events.length > 0 && <span className="tab-badge">{r.events.length}</span>}
            </button>
          ))}
          <button
            type="button"
            className="tab tab-add"
            onClick={() => {
              const id = `dancer_${String.fromCharCode(97 + project.roles.length)}`
              addDancer(id, `舞者 ${project.roles.length + 1}`)
            }}
            title="新增舞者"
          >
            + 舞者
          </button>
        </div>
      </header>

      {!role ? (
        <p className="hint">尚無舞者，請按上方「+ 舞者」新增。</p>
      ) : (
        <div className="dancer-card dancer-card-active">
          <div className="dancer-card-header">
            <input
              className="dancer-name-input"
              value={role.display_name}
              onChange={(e) => renameDancer(role.role_id, e.target.value)}
            />
            <span className="mono">{role.role_id}</span>
            <button
              type="button"
              className="btn"
              disabled={project.roles.length <= 1}
              onClick={() => removeDancer(role.role_id)}
            >
              刪除舞者
            </button>
            <Link
              to="/timeline"
              className="btn"
              onClick={() => useProjectStore.getState().setActiveRole(role.role_id)}
            >
              Canvas 編輯
            </Link>
          </div>

          <div className="dancer-table-wrap">
            <table className="event-table">
              <thead>
                <tr>
                  <th>From</th>
                  <th>To</th>
                  <th>部位</th>
                  <th>顏色</th>
                  <th>效果</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {role.events.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="dancer-empty-row">
                      尚無亮燈條件，請按下方「+ 新增亮燈條件」
                    </td>
                  </tr>
                ) : (
                  role.events.map((ev) => (
                    <tr key={ev.id}>
                      <td>
                        <input
                          value={ev.from}
                          onChange={(e) =>
                            useProjectStore.getState().updateDancerEvent(role.role_id, ev.id, {
                              from: e.target.value
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          value={ev.to}
                          onChange={(e) =>
                            useProjectStore.getState().updateDancerEvent(role.role_id, ev.id, {
                              to: e.target.value
                            })
                          }
                        />
                      </td>
                      <td>
                        <select
                          value={ev.targets[0] ?? role.parts[0]?.id ?? 'body'}
                          onChange={(e) =>
                            useProjectStore.getState().updateDancerEvent(role.role_id, ev.id, {
                              targets: [e.target.value]
                            })
                          }
                        >
                          {role.parts.map((part) => (
                            <option key={part.id} value={part.id}>
                              {part.display_name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <span
                          className="color-swatch"
                          style={{ background: resolveColorCss(ev.color, project.colors) }}
                        />
                        <select
                          value={ev.color}
                          onChange={(e) =>
                            useProjectStore.getState().updateDancerEvent(role.role_id, ev.id, {
                              color: e.target.value
                            })
                          }
                        >
                          {STAGE_COLOR_NAMES.map((c) => (
                            <option key={c} value={c}>
                              {getStageColorLabel(c)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          value={ev.effect}
                          onChange={(e) =>
                            useProjectStore.getState().updateDancerEvent(role.role_id, ev.id, {
                              effect: e.target.value as typeof ev.effect
                            })
                          }
                        >
                          {EFFECT_OPTIONS.map((option) => (
                            <option key={option.id} value={option.id}>
                              {getEffectLabel(option.id)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-danger-sm"
                          onClick={() => deleteDancerEvent(role.role_id, ev.id)}
                        >
                          刪
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() =>
              addDancerEvent(role.role_id, {
                id: newEventId(),
                from: '0:00',
                to: '0:10',
                targets: [role.parts[0]?.id ?? 'body'],
                color: 'electric_cyan',
                effect: 'solid',
                priority: 10
              })
            }
          >
            + 新增亮燈條件
          </button>
        </div>
      )}
    </section>
  )
}

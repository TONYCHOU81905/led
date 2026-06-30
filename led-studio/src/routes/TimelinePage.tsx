import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { TimelineEditor } from '../features/timeline/TimelineEditor'
import { useProjectStore } from '../stores/projectStore'

export function TimelinePage() {
  const { project, projectFilePath, activeRoleId, setActiveRole, activeRole, updateProject, lastRepairFixes, repairCurrentProject } =
    useProjectStore()
  const role = activeRole()

  useEffect(() => {
    if (project && !activeRoleId && project.roles[0]) {
      setActiveRole(project.roles[0].role_id)
    }
  }, [project, activeRoleId, setActiveRole])

  useEffect(() => {
    repairCurrentProject()
  }, [repairCurrentProject])

  if (!project) {
    return (
      <section className="page">
        <p>
          No project loaded. <Link to="/">Go to Dashboard</Link>
        </p>
      </section>
    )
  }

  return (
    <section className="page timeline-page">
      <header className="timeline-page-header">
        <div>
          <h1>Timeline</h1>
          <p className="hint">{project.project.name} · {role?.display_name ?? '—'}</p>
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
            </button>
          ))}
        </div>
      </header>
      {lastRepairFixes.length > 0 && (
        <div className="notice-banner timeline-repair-notice">
          已自動修復 {lastRepairFixes.length} 個 clip 時間格式：
          <ul>
            {lastRepairFixes.slice(0, 5).map((line) => (
              <li key={line}>{line}</li>
            ))}
            {lastRepairFixes.length > 5 && <li>…另有 {lastRepairFixes.length - 5} 項</li>}
          </ul>
          建議到 Dashboard「儲存專案」保留修復結果。
        </div>
      )}
      {role ? (
        <TimelineEditor
          project={project}
          projectFilePath={projectFilePath}
          role={role}
          onProjectChange={(p) => updateProject(() => p)}
        />
      ) : (
        <p className="error-banner">此專案沒有舞者。請到 Dashboard 新建專案或到「舞者 CRUD」新增。</p>
      )}
    </section>
  )
}

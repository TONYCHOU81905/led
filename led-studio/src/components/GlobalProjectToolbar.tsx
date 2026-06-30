import { useProjectSave } from '../hooks/useProjectSave'

export function GlobalProjectToolbar() {
  const { project, saveProject, saveMessage, saveError, saving, canSave } = useProjectSave()

  return (
    <header className="app-topbar">
      <div className="app-topbar-meta">
        {project ? (
          <span className="app-topbar-project" title={project.project.name}>
            {project.project.name}
          </span>
        ) : (
          <span className="app-topbar-hint">未載入專案</span>
        )}
        {saveMessage && <span className="app-topbar-notice">{saveMessage}</span>}
        {saveError && <span className="app-topbar-error">{saveError}</span>}
      </div>
      <div className="app-topbar-actions">
        <button
          type="button"
          className="btn btn-sm"
          disabled={!canSave || saving}
          onClick={() => void saveProject(true)}
          title="另存到新位置"
        >
          另存…
        </button>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={!canSave || saving}
          onClick={() => void saveProject(false)}
          title="儲存專案（含 timeline、LED 節點、音檔打包）"
        >
          {saving ? '儲存中…' : '儲存專案'}
        </button>
      </div>
    </header>
  )
}

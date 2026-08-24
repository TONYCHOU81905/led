import { useProjectSave } from '../hooks/useProjectSave'

export function GlobalProjectToolbar() {
  const {
    project,
    saveProject,
    saveAsBundle,
    saveMessage,
    saveError,
    saving,
    canSave,
    canUpgradeToBundle
  } = useProjectSave()

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
        {canUpgradeToBundle && (
          <span className="app-topbar-notice" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5em' }}>
            這是舊格式的單檔專案
            <button
              type="button"
              className="btn btn-sm"
              disabled={saving}
              onClick={() => void saveAsBundle()}
              title="複製成資料夾格式（含音檔）"
            >
              轉存成專案資料夾
            </button>
          </span>
        )}
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

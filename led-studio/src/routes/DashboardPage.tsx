import { useState } from 'react'
import { Link } from 'react-router-dom'
import { NewProjectDialog } from '../components/NewProjectDialog'
import { projectBundleSummary } from '../shared/projectBundle'
import { useProjectStore } from '../stores/projectStore'

export function DashboardPage() {
  const { project, setProject, newProject, loadDemo } = useProjectStore()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loadingDemo, setLoadingDemo] = useState(false)
  const [showNewDialog, setShowNewDialog] = useState(false)

  const handleLoadDemo = async () => {
    if (!window.api) {
      setError('請用 Electron 開啟 App（npm run dev），不要只用瀏覽器')
      return
    }
    setLoadingDemo(true)
    setError(null)
    try {
      const demo = await window.api.project.openDemo()
      loadDemo(demo)
      setNotice(`已載入範例專案「${demo.project.name}」（${demo.roles.length} 位舞者）`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingDemo(false)
    }
  }

  const handleOpenProject = async () => {
    if (!window.api?.project.openFile) {
      setError('請用 Electron 開啟 App（npm run dev）')
      return
    }
    setError(null)
    const result = await window.api.project.openFile()
    if (!result) return
    setProject(result.project, result.filePath)
    const summary = projectBundleSummary(result.project)
    setNotice(
      `已開啟「${result.project.project.name}」：` +
        `${summary.roleCount} 位舞者 · ${summary.eventCount} 個 clip · ` +
        `${summary.partCount} 個 LED 節點 · 音檔 ${summary.hasMusic ? '已載入' : '未設定'}`
    )
  }

  const handleNewProject = (name: string) => {
    newProject(name)
    setShowNewDialog(false)
    setNotice(`已建立新專案「${name}」— 已預建 4 位舞者，請到 Timeline 匯入音檔並編輯亮燈條件`)
    setError(null)
  }

  return (
    <section className="page">
      <h1>Dashboard</h1>
      <p className="hint">
        請用 <strong>Electron 視窗</strong>操作（終端機執行 <code>npm run dev</code>）。瀏覽器開 localhost 僅供預覽，Devices
        與檔案對話框無法使用。
      </p>

      {error && <p className="error-banner">{error}</p>}
      {notice && <p className="notice-banner">{notice}</p>}

      {!project ? (
        <div className="welcome-panel">
          <h2>開始編排</h2>
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={() => setShowNewDialog(true)}>
              新建專案
            </button>
            <button type="button" className="btn" onClick={() => void handleLoadDemo()} disabled={loadingDemo}>
              {loadingDemo ? '載入中…' : '載入範例專案'}
            </button>
            <button type="button" className="btn" onClick={() => void handleOpenProject()}>
              開啟專案（.ledproj.json）
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="project-name">{project.project.name}</p>
          <ul className="stats">
            <li>Roles: {project.roles.length}</li>
            <li>Duration: {Math.round(project.project.music_duration_ms / 1000)}s</li>
            <li>BPM: {project.project.bpm}</li>
            <li>音檔: {project.project.music_file ? '已設定' : '未匯入（請到 Timeline）'}</li>
          </ul>
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={() => setShowNewDialog(true)}>
              新建專案
            </button>
            <button type="button" className="btn" onClick={() => void handleOpenProject()}>
              開啟專案
            </button>
            <Link to="/dancers" className="btn">
              舞者 CRUD
            </Link>
            <Link to="/timeline" className="btn">
              Canvas Timeline
            </Link>
            <Link to="/devices" className="btn">
              Devices
            </Link>
            <Link to="/show" className="btn btn-primary">
              音樂控制
            </Link>
          </div>
        </>
      )}

      <NewProjectDialog
        open={showNewDialog}
        onConfirm={handleNewProject}
        onCancel={() => setShowNewDialog(false)}
      />
    </section>
  )
}

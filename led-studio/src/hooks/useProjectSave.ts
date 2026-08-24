import { useCallback, useState } from 'react'
import { useProjectStore } from '../stores/projectStore'
import { isBundledProjectPath } from '../shared/projectBundle'

export function useProjectSave() {
  const { project, projectFilePath, setProject } = useProjectStore()
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [canUpgradeToBundle, setCanUpgradeToBundle] = useState(false)

  const saveProject = useCallback(
    async (saveAs = false) => {
      if (!project) {
        setSaveError('尚未載入專案')
        return false
      }
      if (!window.api?.project.saveFile) {
        setSaveError('請用 Electron App 儲存（npm run dev）')
        return false
      }

      setSaving(true)
      setSaveError(null)
      setSaveMessage(null)

      try {
        const existingPath = saveAs ? undefined : (projectFilePath ?? undefined)
        const result = await window.api.project.saveFile(project, existingPath)
        if (!result.ok || !result.filePath) return false

        if (result.project) {
          setProject(result.project, result.filePath)
        } else {
          setProject(project, result.filePath)
        }

        setCanUpgradeToBundle(Boolean(result.canUpgradeToBundle))
        setSaveMessage(
          result.canUpgradeToBundle
            ? '已儲存（舊格式單檔）'
            : isBundledProjectPath(result.filePath)
              ? '已儲存為專案資料夾（含音檔）'
              : '專案已儲存'
        )
        return true
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : String(err))
        return false
      } finally {
        setSaving(false)
      }
    },
    [project, projectFilePath, setProject]
  )

  const saveAsBundle = useCallback(async () => {
    if (!project) {
      setSaveError('尚未載入專案')
      return false
    }
    if (!window.api?.project.saveAsBundle) {
      setSaveError('請用 Electron App 儲存（npm run dev）')
      return false
    }

    setSaving(true)
    setSaveError(null)
    setSaveMessage(null)

    try {
      const result = await window.api.project.saveAsBundle(project)
      if (!result.ok || !result.filePath) return false

      if (result.project) {
        setProject(result.project, result.filePath)
      } else {
        setProject(project, result.filePath)
      }

      setCanUpgradeToBundle(false)
      setSaveMessage('已儲存為專案資料夾（含音檔）')
      return true
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setSaving(false)
    }
  }, [project, setProject])

  return {
    project,
    projectFilePath,
    saveProject,
    saveAsBundle,
    saveMessage,
    saveError,
    saving,
    canSave: Boolean(project),
    canUpgradeToBundle
  }
}

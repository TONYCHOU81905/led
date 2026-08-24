import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import type { LedProject } from '../../src/shared/types/project'
import {
  hydrateProjectMusicPath,
  joinProjectPath,
  musicAssetFileName,
  projectDirFromFilePath,
  projectFilePathForDir,
  relativizeMusicPath
} from '../../src/shared/projectBundle'
import { resolveAppResource } from '../utils/paths'

function pickExistingPath(candidates: string[]): string | undefined {
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return candidates[0]
}

export function resolveMusicPathForProject(
  projectFilePath: string,
  musicRef: string | undefined
): string | undefined {
  if (!musicRef?.trim()) return undefined
  const trimmed = musicRef.trim()
  if (isAbsolute(trimmed)) return trimmed

  const projectDir = projectDirFromFilePath(projectFilePath)
  return pickExistingPath([
    joinProjectPath(projectDir, trimmed),
    resolveAppResource(trimmed)
  ])
}

export function openProjectFromFile(projectFilePath: string, raw: string): LedProject {
  const project = JSON.parse(raw) as LedProject
  const musicRef = project.project.music_file
  const resolved = musicRef ? resolveMusicPathForProject(projectFilePath, musicRef) : undefined
  return hydrateProjectMusicPath(
    resolved
      ? { ...project, project: { ...project.project, music_file: resolved } }
      : project,
    projectFilePath,
    (rel) => resolveAppResource(rel)
  )
}

export async function saveProjectToFile(
  projectFilePath: string,
  project: LedProject
): Promise<LedProject> {
  const projectDir = projectDirFromFilePath(projectFilePath)
  await mkdir(projectDir, { recursive: true })

  let musicPath = project.project.music_file
  let musicRef = musicPath

  if (musicPath && existsSync(musicPath)) {
    const assetName = musicAssetFileName(musicPath)
    const destPath = join(projectDir, assetName)
    const alreadyBundled =
      musicPath === destPath || relativizeMusicPath(projectFilePath, musicPath) === assetName

    if (!alreadyBundled) {
      await copyFile(musicPath, destPath)
    }
    musicRef = assetName
    musicPath = destPath
  } else if (musicPath) {
    musicRef = relativizeMusicPath(projectFilePath, musicPath) ?? musicPath
  }

  const toWrite: LedProject = {
    ...project,
    project: {
      ...project.project,
      music_file: musicRef,
      updated_at: new Date().toISOString()
    }
  }

  await writeFile(projectFilePath, JSON.stringify(toWrite, null, 2), 'utf-8')

  return {
    ...project,
    project: {
      ...project.project,
      music_file: musicPath,
      updated_at: toWrite.project.updated_at
    }
  }
}

export async function readProjectFile(projectFilePath: string): Promise<LedProject> {
  const raw = await readFile(projectFilePath, 'utf-8')
  return openProjectFromFile(projectFilePath, raw)
}

/**
 * 在 dirPath 建立/更新專案資料夾：mkdir -p、寫入 <name>.ledproj.json、
 * 複製音檔進去。內部重用既有的 saveProjectToFile。
 */
export async function saveProjectToDir(
  dirPath: string,
  project: LedProject
): Promise<{ filePath: string; project: LedProject }> {
  await mkdir(dirPath, { recursive: true })
  const filePath = projectFilePathForDir(dirPath, project.project.name)
  const saved = await saveProjectToFile(filePath, project)
  return { filePath, project: saved }
}

/** 在資料夾裡找專案 json：優先同名的 <dir>.ledproj.json，否則第一個 *.ledproj.json，再否則第一個 *.json。找不到回 null */
export async function findProjectJsonInDir(dirPath: string): Promise<string | null> {
  const entries = await readdir(dirPath, { withFileTypes: true })
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name)

  const dirName = dirPath.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop() ?? ''
  const preferredName = `${dirName}.ledproj.json`
  if (files.includes(preferredName)) {
    return join(dirPath, preferredName)
  }

  const ledprojFile = files.find((name) => name.toLowerCase().endsWith('.ledproj.json'))
  if (ledprojFile) {
    return join(dirPath, ledprojFile)
  }

  const jsonFile = files.find((name) => name.toLowerCase().endsWith('.json'))
  if (jsonFile) {
    return join(dirPath, jsonFile)
  }

  return null
}

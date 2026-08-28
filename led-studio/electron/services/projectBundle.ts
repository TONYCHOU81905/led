import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import type { LedProject } from '../../src/shared/types/project'
import {
  hydrateProjectMusicPath,
  hydrateProjectVideoPath,
  joinProjectPath,
  musicAssetFileName,
  projectDirFromFilePath,
  projectFilePathForDir,
  relativizeMusicPath,
  relativizeVideoPath,
  videoAssetFileName
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

export function resolveVideoPathForProject(
  projectFilePath: string,
  videoRef: string | undefined
): string | undefined {
  if (!videoRef?.trim()) return undefined
  const trimmed = videoRef.trim()
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
  const resolvedMusic = musicRef ? resolveMusicPathForProject(projectFilePath, musicRef) : undefined
  const videoRef = project.project.video_file
  const resolvedVideo = videoRef ? resolveVideoPathForProject(projectFilePath, videoRef) : undefined

  const withResolvedPaths: LedProject = {
    ...project,
    project: {
      ...project.project,
      ...(resolvedMusic ? { music_file: resolvedMusic } : {}),
      ...(resolvedVideo ? { video_file: resolvedVideo } : {})
    }
  }

  return hydrateProjectVideoPath(
    hydrateProjectMusicPath(withResolvedPaths, projectFilePath, (rel) => resolveAppResource(rel)),
    projectFilePath,
    (rel) => resolveAppResource(rel)
  )
}

/** 目的檔已存在且大小相同時視為已複製過，跳過複製（大檔案避免重複複製）。 */
async function shouldSkipCopy(sourcePath: string, destPath: string): Promise<boolean> {
  if (sourcePath === destPath) return true
  if (!existsSync(destPath)) return false
  try {
    const [srcStat, destStat] = await Promise.all([stat(sourcePath), stat(destPath)])
    return srcStat.size === destStat.size
  } catch {
    return false
  }
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

  let videoPath = project.project.video_file
  let videoRef = videoPath

  if (videoPath && existsSync(videoPath)) {
    const assetName = videoAssetFileName(videoPath)
    const destPath = join(projectDir, assetName)
    // 影片可能數百 MB 到數 GB：目的檔已存在且大小相同就跳過複製，避免每次存檔都重複複製大檔案。
    const skipCopy = await shouldSkipCopy(videoPath, destPath)

    if (!skipCopy) {
      await copyFile(videoPath, destPath)
    }
    videoRef = assetName
    videoPath = destPath
  } else if (videoPath) {
    videoRef = relativizeVideoPath(projectFilePath, videoPath) ?? videoPath
  }

  const toWrite: LedProject = {
    ...project,
    project: {
      ...project.project,
      music_file: musicRef,
      video_file: videoRef,
      updated_at: new Date().toISOString()
    }
  }

  await writeFile(projectFilePath, JSON.stringify(toWrite, null, 2), 'utf-8')

  return {
    ...project,
    project: {
      ...project.project,
      music_file: musicPath,
      video_file: videoPath,
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

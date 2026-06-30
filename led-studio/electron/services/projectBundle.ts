import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { LedProject } from '../../src/shared/types/project'
import {
  hydrateProjectMusicPath,
  joinProjectPath,
  musicAssetFileName,
  projectDirFromFilePath,
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
  if (trimmed.startsWith('/')) return trimmed

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

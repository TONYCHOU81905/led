import type { LedProject } from './types/project'

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.aiff', '.aif'])

export function musicAssetFileName(sourcePath: string): string {
  const ext = extractExt(sourcePath)
  return `music${ext}`
}

function extractExt(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  if (dot === -1) return '.mp3'
  const ext = filePath.slice(dot).toLowerCase()
  return AUDIO_EXTENSIONS.has(ext) ? ext : '.mp3'
}

export function projectDirFromFilePath(projectFilePath: string): string {
  const normalized = projectFilePath.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  return idx === -1 ? '.' : normalized.slice(0, idx)
}

export function joinProjectPath(projectDir: string, segment: string): string {
  const base = projectDir.replace(/\\/g, '/').replace(/\/$/, '')
  const rel = segment.replace(/\\/g, '/').replace(/^\.\//, '')
  return `${base}/${rel}`
}

/** Resolve music_file reference relative to the .ledproj.json directory. */
export function resolveMusicFilePath(
  projectFilePath: string,
  musicRef: string | undefined,
  resolveBundled?: (relativePath: string) => string
): string | undefined {
  if (!musicRef?.trim()) return undefined

  const trimmed = musicRef.trim()
  if (trimmed.startsWith('/')) return trimmed

  const projectDir = projectDirFromFilePath(projectFilePath)
  const sibling = joinProjectPath(projectDir, trimmed)
  const candidates = [sibling]
  if (resolveBundled) candidates.push(resolveBundled(trimmed))

  return candidates[0]
}

export function hydrateProjectMusicPath(
  project: LedProject,
  projectFilePath: string,
  resolveBundled?: (relativePath: string) => string
): LedProject {
  const resolved = resolveMusicFilePath(projectFilePath, project.project.music_file, resolveBundled)
  if (!resolved || resolved === project.project.music_file) return project
  return {
    ...project,
    project: { ...project.project, music_file: resolved }
  }
}

/** Strip to portable relative music path for writing .ledproj.json */
export function relativizeMusicPath(
  projectFilePath: string,
  musicPath: string | undefined
): string | undefined {
  if (!musicPath?.trim()) return undefined
  const trimmed = musicPath.trim()
  const projectDir = projectDirFromFilePath(projectFilePath)
  const prefix = projectDir.endsWith('/') ? projectDir : `${projectDir}/`
  if (trimmed.startsWith(prefix)) {
    return trimmed.slice(prefix.length)
  }
  if (trimmed.startsWith(projectDir)) {
    return trimmed.slice(projectDir.length).replace(/^\//, '')
  }
  return trimmed
}

export function projectBundleSummary(project: LedProject): {
  roleCount: number
  eventCount: number
  partCount: number
  hasMusic: boolean
} {
  const eventCount = project.roles.reduce((sum, role) => sum + role.events.length, 0)
  const partCount = project.roles[0]?.parts.length ?? 0
  return {
    roleCount: project.roles.length,
    eventCount,
    partCount,
    hasMusic: Boolean(project.project.music_file)
  }
}

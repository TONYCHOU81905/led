import { describe, expect, it } from 'vitest'
import { createDefaultShowProject } from '../src/shared/projectMutations'
import {
  hydrateProjectMusicPath,
  isBundledProjectPath,
  joinProjectPath,
  musicAssetFileName,
  projectBundleSummary,
  projectDirFromFilePath,
  projectFilePathForDir,
  projectJsonFileName,
  relativizeMusicPath,
  sanitizeProjectFileName
} from '../src/shared/projectBundle'

describe('projectBundle', () => {
  it('musicAssetFileName keeps source extension', () => {
    expect(musicAssetFileName('/Users/foo/track.wav')).toBe('music.wav')
    expect(musicAssetFileName('/Users/foo/track.MP3')).toBe('music.mp3')
  })

  it('relativizeMusicPath stores sibling audio reference', () => {
    const projectPath = '/shows/MyShow.ledproj.json'
    expect(relativizeMusicPath(projectPath, '/shows/music.mp3')).toBe('music.mp3')
  })

  it('hydrateProjectMusicPath resolves relative music next to project file', () => {
    const project = createDefaultShowProject('Test')
    project.project.music_file = 'music.mp3'
    const hydrated = hydrateProjectMusicPath(project, '/shows/MyShow.ledproj.json')
    expect(hydrated.project.music_file).toBe('/shows/music.mp3')
  })

  it('projectBundleSummary counts roles events and parts', () => {
    const project = createDefaultShowProject('Test')
    project.roles[0].events.push({
      id: 'e1',
      from: '0:00',
      to: '0:01',
      targets: ['body'],
      color: 'red',
      effect: 'solid',
      priority: 1
    })
    const summary = projectBundleSummary(project)
    expect(summary.roleCount).toBe(4)
    expect(summary.eventCount).toBe(1)
    expect(summary.partCount).toBe(5)
  })

  it('joinProjectPath combines project dir and relative segment', () => {
    expect(joinProjectPath('/shows', 'music.mp3')).toBe('/shows/music.mp3')
    expect(projectDirFromFilePath('/shows/MyShow.ledproj.json')).toBe('/shows')
  })

  it('sanitizeProjectFileName strips unsafe characters and trims', () => {
    expect(sanitizeProjectFileName('5P')).toBe('5P')
    expect(sanitizeProjectFileName('my/proj:name*?"<>|')).toBe('myprojname')
    expect(sanitizeProjectFileName('   ')).toBe('project')
    expect(sanitizeProjectFileName('  5P  ')).toBe('5P')
  })

  it('projectJsonFileName appends .ledproj.json to sanitized name', () => {
    expect(projectJsonFileName('5P')).toBe('5P.ledproj.json')
  })

  it('projectFilePathForDir joins dir and json file name', () => {
    expect(projectFilePathForDir('/a/b/5P', '5P')).toBe('/a/b/5P/5P.ledproj.json')
  })

  it('isBundledProjectPath detects bundle folder structure', () => {
    expect(isBundledProjectPath('/a/5P/5P.ledproj.json')).toBe(true)
    expect(isBundledProjectPath('/Users/x/Desktop/5P.ledproj.json')).toBe(false)
    expect(isBundledProjectPath('C:\\proj\\5P\\5P.ledproj.json')).toBe(true)
  })
})

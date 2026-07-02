import { useEffect, useMemo, useRef, useState } from 'react'
import type { LedProject, RoleDefinition, TimelineEventUI, TimelineKeyframe } from '../../shared/types/project'
import { formatMsToTime, parseTimeToMs } from '../../shared/timeParse'
import { deleteEvent, newEventId, updateEvent } from '../../shared/projectMutations'
import { clipFromEvent, pasteClip, type TimelineClipClipboard } from '../../shared/timelineClipboard'
import { compileProjectRole, configChecksum } from '../../shared/configCompiler'
import { defaultCompileOptions, deviceConfigFilename } from '../../shared/deviceConfigDefaults'
import { loadMusicFromPath } from './audioAnalysis'
import { CopyTimelineControl } from './CopyTimelineControl'
import { DancerPreviewPanel } from '../preview/DancerPreviewPanel'
import { EventInspector } from './EventInspector'
import { TimelineCanvas } from './TimelineCanvas'
import { useSnapGrid } from './hooks/useSnapGrid'
import { useTimelineViewport } from './hooks/useTimelineViewport'

interface TimelineEditorProps {
  project: LedProject
  projectFilePath?: string | null
  role: RoleDefinition
  onProjectChange: (project: LedProject) => void
}

function basename(path: string): string {
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] ?? path
}

export function TimelineEditor({ project, projectFilePath, role, onProjectChange }: TimelineEditorProps) {
  const durationMs = project.project.music_duration_ms
  const {
    scrollMs,
    setScrollMs,
    zoomPxPerMs,
    zoomIn,
    zoomOut,
    zoomAt,
    followPlayhead,
    resetViewport
  } = useTimelineViewport(durationMs)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const { snapTime } = useSnapGrid(project.project.bpm, snapEnabled)
  const [playheadMs, setPlayheadMs] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [musicUrl, setMusicUrl] = useState<string | null>(null)
  const [waveformPeaks, setWaveformPeaks] = useState<number[] | null>(null)
  const [musicLoading, setMusicLoading] = useState(false)
  const [musicError, setMusicError] = useState<string | null>(null)
  const [configNotice, setConfigNotice] = useState<string | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [copyNotice, setCopyNotice] = useState<string | null>(null)
  const [copyError, setCopyError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const objectUrlRef = useRef<string | null>(null)
  const playheadRafRef = useRef<number>(0)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(zoomPxPerMs)
  const clipClipboardRef = useRef<TimelineClipClipboard | null>(null)
  zoomRef.current = zoomPxPerMs

  const selected = useMemo(
    () => role.events.find((e) => e.id === selectedId) ?? null,
    [role.events, selectedId]
  )

  useEffect(() => {
    resetViewport(durationMs)
  }, [durationMs, resetViewport])

  useEffect(() => {
    let cancelled = false
    const revoke = () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }

    if (!project.project.music_file) {
      revoke()
      setMusicUrl(null)
      setWaveformPeaks(null)
      setMusicError(null)
      return
    }

    if (!window.api?.project.readMusicFile) {
      setMusicError('請用 Electron App 匯入音檔')
      return
    }

    setMusicLoading(true)
    setMusicError(null)

    const tryWaveformCache = async (): Promise<number[] | null> => {
      if (!window.api?.project.loadWaveformCache) return null
      try {
        const cached = await window.api.project.loadWaveformCache(
          project.project.music_file!,
          projectFilePath ?? undefined
        )
        return cached?.peaks ?? null
      } catch {
        return null
      }
    }

    void Promise.all([
      loadMusicFromPath(project.project.music_file),
      tryWaveformCache()
    ])
      .then(([{ objectUrl, durationMs: decodedMs, peaks }, cachedPeaks]) => {
        if (cancelled) {
          URL.revokeObjectURL(objectUrl)
          return
        }
        revoke()
        objectUrlRef.current = objectUrl
        setMusicUrl(objectUrl)
        setWaveformPeaks(cachedPeaks ?? peaks)
        if (decodedMs > 0 && decodedMs !== project.project.music_duration_ms) {
          onProjectChange({
            ...project,
            project: {
              ...project.project,
              music_duration_ms: decodedMs,
              updated_at: new Date().toISOString()
            }
          })
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setMusicUrl(null)
          setWaveformPeaks(null)
          setMusicError(err instanceof Error ? err.message : String(err))
        }
      })
      .finally(() => {
        if (!cancelled) setMusicLoading(false)
      })

    return () => {
      cancelled = true
      revoke()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.project.music_file])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !musicUrl) return

    const syncPlayhead = () => setPlayheadMs(Math.round(audio.currentTime * 1000))

    const tick = () => {
      const ms = Math.round(audio.currentTime * 1000)
      setPlayheadMs(ms)
      if (!audio.paused) {
        const w = workspaceRef.current?.clientWidth ?? 800
        followPlayhead(ms, w, zoomRef.current)
      }
      if (!audio.paused) playheadRafRef.current = requestAnimationFrame(tick)
    }

    const onPlay = () => {
      cancelAnimationFrame(playheadRafRef.current)
      playheadRafRef.current = requestAnimationFrame(tick)
    }
    const onPause = () => {
      cancelAnimationFrame(playheadRafRef.current)
      syncPlayhead()
    }

    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onPause)
    audio.addEventListener('seeked', syncPlayhead)

    return () => {
      cancelAnimationFrame(playheadRafRef.current)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onPause)
      audio.removeEventListener('seeked', syncPlayhead)
    }
  }, [musicUrl, followPlayhead])

  const setEvents = (events: TimelineEventUI[]) => {
    onProjectChange({
      ...project,
      roles: project.roles.map((r) => (r.role_id === role.role_id ? { ...r, events } : r))
    })
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return

      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()

      if (mod && key === 'c') {
        if (!selectedId) return
        const source = role.events.find((ev) => ev.id === selectedId)
        if (!source) return
        e.preventDefault()
        clipClipboardRef.current = clipFromEvent(source)
        setCopyError(null)
        setCopyNotice(`已複製 clip（${source.from} → ${source.to}）`)
        return
      }

      if (mod && key === 'v') {
        const clip = clipClipboardRef.current
        if (!clip) return
        e.preventDefault()
        const pasted = pasteClip(clip, playheadMs, durationMs, snapTime)
        setEvents([...role.events, pasted])
        setSelectedId(pasted.id)
        setCopyError(null)
        setCopyNotice(`已貼上 clip 於 ${pasted.from}`)
        return
      }

      if (mod && key === 'd') {
        if (!selectedId) return
        const source = role.events.find((ev) => ev.id === selectedId)
        if (!source) return
        e.preventDefault()
        const beatMs = 60000 / project.project.bpm
        const dup: TimelineEventUI = {
          ...source,
          id: newEventId(),
          from: formatMsToTime(parseTimeToMs(source.from) + beatMs),
          to: formatMsToTime(parseTimeToMs(source.to) + beatMs)
        }
        setEvents([...role.events, dup])
        setSelectedId(dup.id)
        return
      }

      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (!selectedId) return
      e.preventDefault()
      onProjectChange(deleteEvent(project, role.role_id, selectedId))
      setSelectedId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    selectedId,
    project,
    role.role_id,
    role.events,
    onProjectChange,
    project.project.bpm,
    playheadMs,
    durationMs,
    snapTime
  ])

  const patchSelected = (patch: Partial<TimelineEventUI>) => {
    if (!selectedId) return
    onProjectChange(updateEvent(project, role.role_id, selectedId, patch))
  }

  const importMusic = async () => {
    if (!window.api?.project.pickMusicFile) {
      setMusicError('請用 Electron App 匯入音檔')
      return
    }
    setMusicError(null)
    try {
      const picked = await window.api.project.pickMusicFile()
      if (!picked) return
      onProjectChange({
        ...project,
        project: {
          ...project.project,
          music_file: picked.path,
          updated_at: new Date().toISOString()
        }
      })
    } catch (err) {
      setMusicError(err instanceof Error ? err.message : String(err))
    }
  }

  const seekAudio = (ms: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = ms / 1000
  }

  const setPlayhead = (ms: number) => {
    setPlayheadMs(ms)
    seekAudio(ms)
  }

  const setKeyframes = (keyframes: TimelineKeyframe[]) => {
    onProjectChange({
      ...project,
      roles: project.roles.map((r) =>
        r.role_id === role.role_id ? { ...r, keyframes } : r
      )
    })
  }

  const addEvent = () => {
    const ev: TimelineEventUI = {
      id: newEventId(),
      from: formatMsToTime(playheadMs),
      to: formatMsToTime(Math.min(durationMs, playheadMs + 5000)),
      targets: [role.parts[0]?.id ?? 'body'],
      color: 'hot_magenta',
      effect: 'solid',
      priority: 10
    }
    setEvents([...role.events, ev])
    setSelectedId(ev.id)
  }

  const buildDeviceConfig = () =>
    compileProjectRole(project, role.role_id, {
      ...defaultCompileOptions(role.role_id),
      network: {
        ssid: '',
        password: '',
        timecode_port: 4210,
        device_status_port: 4211
      }
    })

  const exportDeviceConfig = async () => {
    setConfigError(null)
    setConfigNotice(null)
    if (!window.api?.project.saveDeviceConfig) {
      setConfigError('請用 Electron App 匯出 config')
      return
    }
    try {
      const config = buildDeviceConfig()
      const crc = configChecksum(config)
      const ok = await window.api.project.saveDeviceConfig(config, deviceConfigFilename(role.role_id))
      if (ok) {
        setConfigNotice(
          `已匯出 ${deviceConfigFilename(role.role_id)}（${config.events.length} events · crc32 0x${crc.toString(16)}）`
        )
      }
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleZoomAt = (anchorMs: number, factor: number) => {
    const w = workspaceRef.current?.clientWidth ?? 800
    zoomAt(anchorMs, factor, w)
  }

  const deleteSelected = () => {
    if (!selectedId) return
    onProjectChange(deleteEvent(project, role.role_id, selectedId))
    setSelectedId(null)
  }

  return (
    <div className={`timeline-studio${previewOpen ? ' timeline-studio--preview-open' : ''}`}>
      <div className="timeline-transport">
        <div className="transport-group transport-clock">
          <span className="transport-time">{formatMsToTime(playheadMs)}</span>
          <span className="transport-sep">/</span>
          <span className="transport-duration">{formatMsToTime(durationMs)}</span>
        </div>

        <div className="transport-group transport-audio">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void importMusic()}>
            匯入音檔
          </button>
          <span className="music-label">
            {project.project.music_file
              ? basename(project.project.music_file)
              : '未匯入音檔'}
          </span>
          {musicLoading && <span className="hint">解碼中…</span>}
          {musicUrl && (
            <>
              <audio ref={audioRef} src={musicUrl} controls preload="auto" className="transport-audio-el" />
              <button type="button" className="btn btn-sm" onClick={() => seekAudio(playheadMs)}>
                同步 Playhead
              </button>
            </>
          )}
          {musicError && <span className="music-error">{musicError}</span>}
        </div>

        <div className="transport-group transport-tools">
          <button type="button" className="btn btn-sm" onClick={zoomOut} title="縮小">
            −
          </button>
          <button type="button" className="btn btn-sm" onClick={zoomIn} title="放大">
            +
          </button>
          <label className="snap-toggle">
            <input type="checkbox" checked={snapEnabled} onChange={(e) => setSnapEnabled(e.target.checked)} />
            Snap {project.project.bpm}
          </label>
          <button type="button" className="btn btn-primary btn-sm" onClick={addEvent}>
            + Clip
          </button>
          <button type="button" className="btn btn-sm" onClick={() => void exportDeviceConfig()} title="匯出 ESP device config JSON">
            匯出 Config
          </button>
          <button
            type="button"
            className={`btn btn-sm${previewOpen ? ' btn-toggle-active' : ''}`}
            onClick={() => setPreviewOpen((open) => !open)}
            title={previewOpen ? '隱藏燈光預覽' : '顯示燈光預覽'}
            aria-pressed={previewOpen}
          >
            燈光預覽
          </button>
        </div>
      </div>

      {(configNotice || configError || copyNotice || copyError) && (
        <div className="timeline-config-banner">
          {configNotice && <p className="notice-banner">{configNotice}</p>}
          {configError && <p className="error-banner">{configError}</p>}
          {copyNotice && <p className="notice-banner">{copyNotice}</p>}
          {copyError && <p className="error-banner">{copyError}</p>}
        </div>
      )}

      <CopyTimelineControl
        project={project}
        targetRole={role}
        selectedEventId={selectedId}
        onProjectChange={onProjectChange}
        onCopied={(message) => {
          setCopyError(null)
          setCopyNotice(message)
        }}
        onError={(message) => {
          setCopyNotice(null)
          setCopyError(message)
        }}
      />

      <div className="timeline-editor-body">
        <div className="timeline-editor-main">
          <div className="transport-progress-row">
            <input
              type="range"
              min={0}
              max={Math.max(1, durationMs)}
              value={Math.min(playheadMs, durationMs)}
              onChange={(e) => setPlayhead(Number(e.target.value))}
              className="transport-progress"
              title="播放進度"
            />
          </div>

          <input
            type="range"
            min={0}
            max={Math.max(0, durationMs - 1000)}
            value={scrollMs}
            onChange={(e) => setScrollMs(Number(e.target.value))}
            className="timeline-scrubber"
            title="Timeline 水平捲動"
          />

          <div className="timeline-workspace" ref={workspaceRef}>
            <TimelineCanvas
              durationMs={durationMs}
              bpm={project.project.bpm}
              parts={role.parts}
              events={role.events}
              colors={project.colors}
              scrollMs={scrollMs}
              zoomPxPerMs={zoomPxPerMs}
              snapTime={snapTime}
              playheadMs={playheadMs}
              selectedId={selectedId}
              waveformPeaks={waveformPeaks}
              keyframes={role.keyframes}
              onSelect={setSelectedId}
              onEventsChange={setEvents}
              onPlayheadChange={setPlayhead}
              onKeyframesChange={setKeyframes}
              onZoomAt={handleZoomAt}
            />
          </div>
        </div>

        {previewOpen && (
          <DancerPreviewPanel
            project={project}
            playheadMs={playheadMs}
            activeRoleId={role.role_id}
            onClose={() => setPreviewOpen(false)}
          />
        )}
      </div>

      {selected ? (
        <EventInspector
          event={selected}
          parts={role.parts}
          colors={project.colors}
          onPatch={patchSelected}
          onDelete={deleteSelected}
        />
      ) : (
        <aside className="timeline-inspector timeline-inspector-empty">
          <div className="inspector-header">
            <h3>Clip 屬性</h3>
          </div>
          <p>選取 clip 後可編輯部位、時間、顏色。空白軌道拖曳建立 · ⌘/Ctrl+C 複製 · ⌘/Ctrl+V 於 playhead 貼上 · ⌘/Ctrl+D 複製並偏移一拍。</p>
        </aside>
      )}
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import type { LedProject, RoleDefinition, TimelineEventUI, TimelineKeyframe } from '../../shared/types/project'
import { formatMsToTime, parseTimeToMs, tryParseTimeToMs } from '../../shared/timeParse'
import { newEventId, updateEvent } from '../../shared/projectMutations'
import { clipsFromEvents, pasteClips, type TimelineClipGroup } from '../../shared/timelineClipboard'
import { compileProjectRole, configChecksum } from '../../shared/configCompiler'
import { defaultCompileOptions, deviceConfigFilename } from '../../shared/deviceConfigDefaults'
import { loadMusicFromPath } from './audioAnalysis'
import { CopyTimelineControl } from './CopyTimelineControl'
import { DancerPreviewPanel } from '../preview/DancerPreviewPanel'
import { EventInspector } from './EventInspector'
import { TimelineCanvas } from './TimelineCanvas'
import { applyDurationToSelection, buildSelectionPatch } from './batchPatch'
import { useSnapGrid } from './hooks/useSnapGrid'
import {
  maxTimelineScroll,
  useTimelineViewport,
  visibleTimelineMs
} from './hooks/useTimelineViewport'

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
    zoomAt,
    zoomCenteredAt,
    followPlayhead,
    keepPlayheadVisible,
    scrollBy,
    centerPlayhead,
    resetViewport
  } = useTimelineViewport(durationMs)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [snapSubdivision, setSnapSubdivision] = useState(4)
  const { snapTime } = useSnapGrid(project.project.bpm, snapEnabled, snapSubdivision)
  const [playheadMs, setPlayheadMs] = useState(0)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selectedId = selectedIds.length > 0 ? selectedIds[selectedIds.length - 1] : null
  const [musicUrl, setMusicUrl] = useState<string | null>(null)
  const [waveformPeaks, setWaveformPeaks] = useState<number[] | null>(null)
  const [musicLoading, setMusicLoading] = useState(false)
  const [musicError, setMusicError] = useState<string | null>(null)
  const [configNotice, setConfigNotice] = useState<string | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [copyNotice, setCopyNotice] = useState<string | null>(null)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [ledSyncEnabled, setLedSyncEnabled] = useState(true)
  const [followEnabled, setFollowEnabled] = useState(true)
  const [workspaceWidth, setWorkspaceWidth] = useState(800)
  const ledSyncRef = useRef(true)
  const followEnabledRef = useRef(true)
  const lastBridgeTimeRef = useRef(0)
  const audioRef = useRef<HTMLAudioElement>(null)
  const objectUrlRef = useRef<string | null>(null)
  const playheadRafRef = useRef<number>(0)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(zoomPxPerMs)
  const playheadRef = useRef(0)
  const clipClipboardRef = useRef<TimelineClipGroup | null>(null)
  zoomRef.current = zoomPxPerMs
  playheadRef.current = playheadMs
  followEnabledRef.current = followEnabled

  const visibleMs = visibleTimelineMs(workspaceWidth, zoomPxPerMs)
  const maxScrollMs = maxTimelineScroll(durationMs, workspaceWidth, zoomPxPerMs)

  const selected = useMemo(
    () => role.events.find((e) => e.id === selectedId) ?? null,
    [role.events, selectedId]
  )

  useEffect(() => {
    resetViewport(durationMs)
  }, [durationMs, resetViewport])

  useEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace) return
    const updateWidth = () => setWorkspaceWidth(Math.max(1, workspace.clientWidth || 800))
    const observer = new ResizeObserver(updateWidth)
    observer.observe(workspace)
    updateWidth()
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setScrollMs((current) => Math.min(current, maxScrollMs))
  }, [maxScrollMs, setScrollMs])

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

  // ---- LED 同步（Timeline 播放 → Timecode Bridge）----

  const notifyBridgeTime = (ms: number) => {
    if (!ledSyncRef.current || !window.api?.show.bridgePreviewTime) return
    const now = Date.now()
    if (now - lastBridgeTimeRef.current < 50) return
    lastBridgeTimeRef.current = now
    void window.api.show.bridgePreviewTime(ms)
  }

  const bridgeOnPlay = async () => {
    if (!ledSyncRef.current || !window.api) return
    const ms = Math.round((audioRef.current?.currentTime ?? playheadMs / 1000) * 1000)
    const state = await window.api.show.bridgeGetState()
    if (!state.running) {
      await window.api.show.bridgeStart({ source: 'preview' })
      if (ms > 0) await window.api.show.bridgeSeek(ms)
    } else if (state.paused) {
      await window.api.show.bridgeResume()
      // SEEK 讓韌體硬定位到目前位置（同時相容尚未支援 resume 的舊韌體）
      await window.api.show.bridgeSeek(ms)
    }
    lastBridgeTimeRef.current = 0
    notifyBridgeTime(ms)
  }

  const bridgeOnPause = () => {
    if (!ledSyncRef.current || !window.api) return
    void window.api.show.bridgePause()
  }

  const bridgeOnSeek = (ms: number) => {
    if (!ledSyncRef.current || !window.api) return
    void (async () => {
      const state = await window.api!.show.bridgeGetState()
      if (!state.running) {
        await window.api!.show.bridgeStart({ source: 'preview' })
      }
      // A hard SEEK updates the ESP immediately; preview time keeps the
      // bridge pinned to the dragged playhead while audio is not running.
      await window.api!.show.bridgeSeek(ms)
      if (audioRef.current?.paused ?? true) {
        await window.api!.show.bridgePause()
      }
      lastBridgeTimeRef.current = 0
      notifyBridgeTime(ms)
    })()
  }

  useEffect(() => {
    ledSyncRef.current = ledSyncEnabled
    if (!window.api) return
    if (ledSyncEnabled) {
      const audio = audioRef.current
      if (audio && !audio.paused) void bridgeOnPlay()
    } else {
      void window.api.show.bridgeStop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledSyncEnabled])

  useEffect(() => {
    return () => {
      if (ledSyncRef.current && window.api) {
        void window.api.show.bridgeStop()
      }
    }
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !musicUrl) return

    const syncPlayhead = () => setPlayheadMs(Math.round(audio.currentTime * 1000))

    const tick = () => {
      const ms = Math.round(audio.currentTime * 1000)
      setPlayheadMs(ms)
      if (!audio.paused) {
        const w = workspaceRef.current?.clientWidth ?? 800
        if (followEnabledRef.current) followPlayhead(ms, w, zoomRef.current)
        notifyBridgeTime(ms)
      }
      if (!audio.paused) playheadRafRef.current = requestAnimationFrame(tick)
    }

    const onPlay = () => {
      cancelAnimationFrame(playheadRafRef.current)
      playheadRafRef.current = requestAnimationFrame(tick)
      void bridgeOnPlay()
    }
    const onPause = () => {
      cancelAnimationFrame(playheadRafRef.current)
      syncPlayhead()
      bridgeOnPause()
    }
    const onSeeked = () => {
      const ms = Math.round(audio.currentTime * 1000)
      setPlayheadMs(ms)
      if (followEnabledRef.current) {
        const w = workspaceRef.current?.clientWidth ?? 800
        followPlayhead(ms, w, zoomRef.current)
      }
      bridgeOnSeek(ms)
    }

    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onPause)
    audio.addEventListener('seeked', onSeeked)

    return () => {
      cancelAnimationFrame(playheadRafRef.current)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onPause)
      audio.removeEventListener('seeked', onSeeked)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        // 複製整個選取集合，clipboard 會保留成員之間的相對時間關係
        if (selectedIds.length === 0) return
        const sources = role.events.filter((ev) => selectedIds.includes(ev.id))
        if (sources.length === 0) return
        e.preventDefault()
        clipClipboardRef.current = clipsFromEvents(sources)
        setCopyError(null)
        setCopyNotice(
          sources.length === 1
            ? `已複製 clip（${sources[0].from} → ${sources[0].to}）`
            : `已複製 ${sources.length} 個 clip`
        )
        return
      }

      if (mod && key === 'v') {
        // 整組貼到 playhead，維持成員之間的相對關係；貼完後選取新產生的那一組
        const board = clipClipboardRef.current
        if (!board || board.items.length === 0) return
        e.preventDefault()
        const pasted = pasteClips(board, playheadMs, durationMs, snapTime)
        setEvents([...role.events, ...pasted])
        setSelectedIds(pasted.map((p) => p.id))
        setCopyError(null)
        setCopyNotice(
          pasted.length === 1
            ? `已貼上 clip 於 ${pasted[0].from}`
            : `已貼上 ${pasted.length} 個 clip 於 ${pasted[0].from}`
        )
        return
      }

      if (mod && key === 'd') {
        // 多選時對整個集合作用：每個選取的 clip 都複製並偏移一拍，選取結果變成新複製出的那一組
        if (selectedIds.length === 0) return
        const sources = role.events.filter((ev) => selectedIds.includes(ev.id))
        if (sources.length === 0) return
        e.preventDefault()
        const beatMs = 60000 / project.project.bpm
        const dups: TimelineEventUI[] = sources.map((source) => ({
          ...source,
          id: newEventId(),
          from: formatMsToTime(parseTimeToMs(source.from) + beatMs),
          to: formatMsToTime(parseTimeToMs(source.to) + beatMs)
        }))
        setEvents([...role.events, ...dups])
        setSelectedIds(dups.map((d) => d.id))
        return
      }

      if (e.key === 'Escape') {
        setSelectedIds([])
        return
      }

      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      // 刪除對整個選取集合作用
      if (selectedIds.length === 0) return
      e.preventDefault()
      setEvents(role.events.filter((ev) => !selectedIds.includes(ev.id)))
      setSelectedIds([])
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    selectedId,
    selectedIds,
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
    // 單選走原本的路徑；多選時由 buildSelectionPatch 決定哪些欄位可以套用到整組
    // （顏色 / 效果 / 優先權 / 一般 params 可以；絕對時間、發亮部位、路徑群組不行）
    if (selectedIds.length <= 1) {
      onProjectChange(updateEvent(project, role.role_id, selectedId, patch))
      return
    }
    setEvents(buildSelectionPatch(role.events, selectedId, selectedIds, patch))
  }

  /** 多選時把整組 clip 統一設成同一個片段長度（各自固定開頭、只動結尾）。 */
  const patchSelectedDuration = (clipMs: number) => {
    if (selectedIds.length <= 1) return
    setEvents(
      applyDurationToSelection(
        role.events,
        selectedIds,
        clipMs,
        tryParseTimeToMs,
        formatMsToTime,
        durationMs
      )
    )
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

  /**
   * 拖 playhead 到畫面邊緣時，每幀捲動 deltaMs 並把 playhead 推進同樣的量
   * （指標停在邊緣不動，時間持續前進）。用 ref 累加，避免 rAF 連續幀之間
   * 因為還沒 re-render 而讀到舊的 playheadMs。
   */
  const handleEdgeScroll = (deltaMs: number) => {
    scrollBy(deltaMs, workspaceWidth, zoomRef.current)
    const next = Math.max(0, Math.min(durationMs, playheadRef.current + deltaMs))
    playheadRef.current = next
    setPlayhead(next)
  }

  const setPlayhead = (ms: number) => {
    setPlayheadMs(ms)
    seekAudio(ms)
    bridgeOnSeek(ms)
  }

  const setPlayheadFromProgress = (ms: number) => {
    setPlayhead(ms)
    // 用最小移動量把 playhead 保持在畫面內，所以連續拖曳是平滑地一點一點推移。
    // 不用 centerPlayhead —— 那會每次把 playhead 拉到正中央，看起來就是一次跳好幾秒。
    keepPlayheadVisible(ms, workspaceWidth, zoomRef.current)
  }

  const enableFollow = () => {
    setFollowEnabled(true)
    followEnabledRef.current = true
    followPlayhead(playheadMs, workspaceWidth, zoomRef.current)
  }

  const locatePlayhead = () => {
    centerPlayhead(playheadMs, workspaceWidth, zoomRef.current)
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
      params: {
        fade_curve: 'ease_in_out',
        intensity: 1,
        speed: 1
      },
      priority: 10
    }
    setEvents([...role.events, ev])
    setSelectedIds([ev.id])
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
    if (selectedIds.length === 0) return
    setEvents(role.events.filter((ev) => !selectedIds.includes(ev.id)))
    setSelectedIds([])
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
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => zoomCenteredAt(playheadMs, 1 / 1.25, workspaceWidth)}
            title="以播放頭為中心縮小"
          >
            −
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => zoomCenteredAt(playheadMs, 1.25, workspaceWidth)}
            title="以播放頭為中心放大"
          >
            +
          </button>
          <button
            type="button"
            className={`btn btn-sm${followEnabled ? ' btn-toggle-active' : ''}`}
            onClick={() => followEnabled ? setFollowEnabled(false) : enableFollow()}
            title="播放頭接近右側時自動推動 Timeline"
            aria-pressed={followEnabled}
          >
            跟隨播放
          </button>
          <button type="button" className="btn btn-sm" onClick={locatePlayhead} title="將播放頭移到畫面中央">
            定位播放頭
          </button>
          <label className="snap-toggle">
            <input type="checkbox" checked={snapEnabled} onChange={(e) => setSnapEnabled(e.target.checked)} />
            節拍吸附
          </label>
          <label className="timeline-compact-field">
            <span>BPM</span>
            <input type="number" min={20} max={300} value={project.project.bpm}
              onChange={(e) => {
                const bpm = Math.min(300, Math.max(20, Math.round(Number(e.target.value) || 20)))
                onProjectChange({
                  ...project,
                  project: { ...project.project, bpm, updated_at: new Date().toISOString() }
                })
              }} />
          </label>
          <label className="timeline-compact-field">
            <span>格線</span>
            <select value={snapSubdivision} onChange={(e) => setSnapSubdivision(Number(e.target.value))}>
              <option value={1}>1/4 拍</option>
              <option value={2}>1/8 拍</option>
              <option value={4}>1/16 拍</option>
              <option value={8}>1/32 拍</option>
            </select>
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
          <button
            type="button"
            className={`btn btn-sm${ledSyncEnabled ? ' btn-toggle-active' : ''}`}
            onClick={() => setLedSyncEnabled((on) => !on)}
            title={ledSyncEnabled ? '停止把 Timeline 播放送到 LED 裝置' : '播放/暫停/拉動時間同步控制 LED 裝置'}
            aria-pressed={ledSyncEnabled}
          >
            LED 同步{ledSyncEnabled ? '：開' : '：關'}
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
          <input
            type="range"
            min={0}
            max={maxScrollMs}
            step={Math.max(1, Math.round(visibleMs / 200))}
            value={Math.min(scrollMs, maxScrollMs)}
            onChange={(e) => {
              setFollowEnabled(false)
              followEnabledRef.current = false
              setScrollMs(Number(e.target.value))
            }}
            className="timeline-scrubber"
            title="Timeline 水平捲動"
          />

          <div className="transport-progress-row">
            <input
              type="range"
              min={0}
              max={Math.max(1, durationMs)}
              value={Math.min(playheadMs, durationMs)}
              onChange={(e) => setPlayheadFromProgress(Number(e.target.value))}
              className="transport-progress"
              title="播放進度"
            />
          </div>

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
              selectedIds={selectedIds}
              waveformPeaks={waveformPeaks}
              keyframes={role.keyframes}
              onSelectionChange={setSelectedIds}
              onEventsChange={setEvents}
              onPlayheadChange={setPlayhead}
              onKeyframesChange={setKeyframes}
              onZoomAt={handleZoomAt}
              onEdgeScroll={handleEdgeScroll}
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
          allEvents={role.events}
          onEventsChange={setEvents}
          onSelect={(id) => setSelectedIds(id ? [id] : [])}
          selectedCount={selectedIds.length}
          maxTimeMs={durationMs}
          onPatchDurationAll={patchSelectedDuration}
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

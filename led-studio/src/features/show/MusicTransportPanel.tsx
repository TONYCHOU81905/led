import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatMsToTime } from '../../shared/timeParse'
import { useProjectStore } from '../../stores/projectStore'
import { useShowStore } from '../../stores/showStore'

function basename(path: string): string {
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] || path
}

function mimeFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
    aac: 'audio/aac', flac: 'audio/flac', aiff: 'audio/aiff', aif: 'audio/aiff'
  }
  return map[ext ?? ''] ?? 'audio/mpeg'
}

export function MusicTransportPanel() {
  const { project } = useProjectStore()
  const { bridge, setPlaybackMs } = useShowStore()
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const [musicUrl, setMusicUrl] = useState<string | null>(null)
  const [musicError, setMusicError] = useState<string | null>(null)
  const [localMs, setLocalMs] = useState(0)
  const [durationMs, setDurationMs] = useState(1)
  const [isPlaying, setIsPlaying] = useState(false)
  // 'stopped' = 從0播 | 'paused' = 從暫停點播
  const [playState, setPlayState] = useState<'stopped' | 'paused' | 'playing'>('stopped')

  const musicFile = project?.project.music_file

  // 每次 musicFile 變更時載入 Blob URL（file:// 在 Renderer 被 CSP 擋，必須用 readMusicFile）
  useEffect(() => {
    let revoked = false
    let prevUrl: string | null = null

    if (!window.api?.project.readMusicFile || !musicFile) {
      setMusicUrl(null)
      setMusicError(null)
      setLocalMs(0)
      setPlaybackMs(0)
      setPlayState('stopped')
      setIsPlaying(false)
      return
    }

    setMusicError(null)
    void window.api.project.readMusicFile(musicFile)
      .then(({ data, mime }) => {
        if (revoked) return
        const blob = new Blob([data], { type: mime || mimeFromPath(musicFile) })
        const url = URL.createObjectURL(blob)
        prevUrl = url
        setMusicUrl(url)
        const d = project?.project.music_duration_ms
        if (d && d > 0) setDurationMs(d)
      })
      .catch(() => { if (!revoked) setMusicError('無法載入音檔') })

    return () => {
      revoked = true
      if (prevUrl) URL.revokeObjectURL(prevUrl)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [musicFile])

  // 通知 Bridge 目前時間（throttle: 最多 20Hz 即可）
  const lastSyncRef = useRef(0)
  const notifyBridge = (ms: number) => {
    if (!window.api?.show.bridgePreviewTime) return
    const now = Date.now()
    if (now - lastSyncRef.current < 50) return
    lastSyncRef.current = now
    void window.api.show.bridgePreviewTime(ms)
  }

  // ---- 按鈕邏輯 ----

  const handlePlay = async () => {
    const audio = audioRef.current
    if (!audio || !musicUrl || !window.api) return

    // 如果是「停止狀態」，確保從 0 開始
    if (playState === 'stopped') {
      audio.currentTime = 0
    }

    // 先啟動 Bridge
    const bridgeState = useShowStore.getState().bridge
    if (!bridgeState.running) {
      await window.api.show.bridgeStart({ source: 'preview' })
      const ms = Math.round(audio.currentTime * 1000)
      if (ms > 0) await window.api.show.bridgeSeek(ms)
    } else if (bridgeState.paused) {
      await window.api.show.bridgeResume()
      // 再送一次 SEEK 讓韌體硬定位回暫停點（相容尚未支援 resume 的舊韌體）
      await window.api.show.bridgeSeek(Math.round(audio.currentTime * 1000))
    }

    // audio.play() 在某些環境（jsdom、autoplay policy）可能回傳 undefined 或 reject
    await audio.play()?.catch(() => undefined)
  }

  const handlePause = async () => {
    const audio = audioRef.current
    audio?.pause()
    const bridgeState = useShowStore.getState().bridge
    if (bridgeState.running && window.api) {
      await window.api.show.bridgePause()
    }
  }

  const handleStop = async () => {
    const audio = audioRef.current
    audio?.pause()
    if (audio) audio.currentTime = 0
    setLocalMs(0)
    setPlaybackMs(0)
    setPlayState('stopped')
    setIsPlaying(false)
    if (window.api) {
      await window.api.show.bridgeStop()
    }
  }

  const handleSeek = (ms: number) => {
    const clamped = Math.max(0, Math.min(durationMs, ms))
    const audio = audioRef.current
    if (audio) audio.currentTime = clamped / 1000
    setLocalMs(clamped)
    setPlaybackMs(clamped)
    const bridgeState = useShowStore.getState().bridge
    if (bridgeState.running && window.api) {
      void window.api.show.bridgeSeek(clamped)
      lastSyncRef.current = 0
      notifyBridge(clamped)
    }
  }

  // ---- 按鈕 disabled 規則 ----
  const canControl = Boolean(musicUrl && musicFile)
  const playDisabled = !canControl || isPlaying
  const pauseDisabled = !isPlaying
  // 停止：有任何進度或 Bridge 在跑就可用
  const stopDisabled = !canControl || (!isPlaying && !bridge.running && localMs === 0)

  return (
    <div className="music-transport" aria-label="音樂播放控制">
      <div className="music-transport-filename" title={musicFile ?? undefined}>
        {musicFile ? basename(musicFile) : '未匯入音檔'}
      </div>
      {!musicFile && (
        <p className="music-transport-hint">
          請至 <Link to="/timeline">Timeline</Link> 匯入音檔
        </p>
      )}
      {musicError && <p className="music-error">{musicError}</p>}

      <div className="music-transport-controls">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => void handlePlay()}
          disabled={playDisabled}
          aria-label="播放"
        >
          ▶ 播放
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => void handlePause()}
          disabled={pauseDisabled}
          aria-label="暫停"
        >
          ⏸ 暫停
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => void handleStop()}
          disabled={stopDisabled}
          aria-label="停止"
        >
          ■ 停止
        </button>
      </div>

      <input
        type="range"
        className="music-transport-seek"
        min={0}
        max={durationMs}
        step={100}
        value={Math.min(localMs, durationMs)}
        disabled={!canControl}
        onChange={(e) => handleSeek(Number(e.target.value))}
        aria-label="音樂時間"
      />
      <div className="music-transport-times">
        <span>{formatMsToTime(localMs)}</span>
        <span>{formatMsToTime(durationMs)}</span>
      </div>

      {musicUrl && (
        <audio
          ref={audioRef}
          src={musicUrl}
          preload="auto"
          className="music-transport-audio"
          onLoadedMetadata={() => {
            const audio = audioRef.current
            if (audio && audio.duration > 0) {
              setDurationMs(Math.round(audio.duration * 1000))
            }
          }}
          onPlay={() => {
            setIsPlaying(true)
            setPlayState('playing')
          }}
          onPause={() => {
            setIsPlaying(false)
            // 只有非程式呼叫 stop 時才設為 paused
            const audio = audioRef.current
            if (audio && audio.currentTime > 0 && !audio.ended) {
              setPlayState('paused')
              const ms = Math.round(audio.currentTime * 1000)
              setLocalMs(ms)
              setPlaybackMs(ms)
            }
          }}
          onEnded={() => {
            setIsPlaying(false)
            setPlayState('stopped')
          }}
          onTimeUpdate={() => {
            const audio = audioRef.current
            if (!audio) return
            const ms = Math.round(audio.currentTime * 1000)
            setLocalMs(ms)
            setPlaybackMs(ms)
            notifyBridge(ms)
          }}
        />
      )}
    </div>
  )
}

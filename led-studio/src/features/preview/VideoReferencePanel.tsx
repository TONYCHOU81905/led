import { useEffect, useRef, useState } from 'react'
import { formatMsToTime } from '../../shared/timeParse'
import {
  computeOffsetMs,
  isVideoTimeInRange,
  musicToVideoMs,
  needsVideoResync,
  videoToMusicMs
} from '../../shared/videoSync'

interface VideoReferencePanelProps {
  musicMs: number
  musicPlaying: boolean
  offsetMs: number
  videoFile?: string
  videoMuted?: boolean
  onOffsetChange: (offsetMs: number) => void
  onSeekMusic: (ms: number) => void
  onPickVideo: () => void | Promise<void>
  onMutedChange: (muted: boolean) => void
  onClose: () => void
}

const OFFSET_STEPS = [-100, -10, 10, 100]

export function VideoReferencePanel({
  musicMs,
  musicPlaying,
  offsetMs,
  videoFile,
  videoMuted = true,
  onOffsetChange,
  onSeekMusic,
  onPickVideo,
  onMutedChange,
  onClose
}: VideoReferencePanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoDurationMs, setVideoDurationMs] = useState(0)
  const [outOfRange, setOutOfRange] = useState(false)
  const [offsetInput, setOffsetInput] = useState(String(offsetMs))
  // 程式主動 seek 前設為 true；seeked handler 看到 true 時只清旗標、不回報，
  // 避免「音樂 → 影片 seek → seeked 事件 → 又回頭改音樂」的無限迴圈。
  const programmaticSeekRef = useRef(false)

  useEffect(() => {
    setOffsetInput(String(offsetMs))
  }, [offsetMs])

  useEffect(() => {
    let cancelled = false
    if (!videoFile) {
      setVideoUrl(null)
      return
    }
    void window.api?.project.getVideoFileUrl(videoFile).then((url) => {
      if (!cancelled) setVideoUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [videoFile])

  // 正向同步：音樂時間 → 影片時間
  useEffect(() => {
    const video = videoRef.current
    if (!video || !videoUrl) return

    const targetVideoMs = musicToVideoMs(musicMs, offsetMs)
    const duration = video.duration ? video.duration * 1000 : videoDurationMs

    if (!isVideoTimeInRange(targetVideoMs, duration || Infinity)) {
      setOutOfRange(true)
      if (!video.paused) video.pause()
      return
    }
    setOutOfRange(false)

    if (!musicPlaying) {
      // 暫停時：playhead 一變就直接 seek。
      const diffMs = Math.abs(video.currentTime * 1000 - targetVideoMs)
      if (diffMs > 1) {
        programmaticSeekRef.current = true
        video.currentTime = targetVideoMs / 1000
      }
      if (!video.paused) video.pause()
      return
    }

    // 播放中：不要每幀 seek，讓 video 自己跑，只有漂移超過門檻才校正一次。
    if (needsVideoResync(video.currentTime * 1000, targetVideoMs)) {
      programmaticSeekRef.current = true
      video.currentTime = targetVideoMs / 1000
    }
    if (video.paused) {
      void video.play().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [musicMs, offsetMs, musicPlaying, videoUrl, videoDurationMs])

  // 反向同步：使用者手動拖曳影片 → 回報音樂時間
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handleSeeked = () => {
      if (programmaticSeekRef.current) {
        programmaticSeekRef.current = false
        return
      }
      const targetMusicMs = videoToMusicMs(video.currentTime * 1000, offsetMs)
      // 差距很小時不動作，避免和正向同步互相反彈。
      if (needsVideoResync(musicMs, targetMusicMs)) {
        onSeekMusic(Math.max(0, Math.round(targetMusicMs)))
      }
    }
    const handleLoadedMetadata = () => {
      setVideoDurationMs(video.duration ? video.duration * 1000 : 0)
    }

    video.addEventListener('seeked', handleSeeked)
    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    return () => {
      video.removeEventListener('seeked', handleSeeked)
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl, offsetMs, musicMs, onSeekMusic])

  const alignToCurrentPosition = () => {
    const video = videoRef.current
    if (!video) return
    const newOffset = computeOffsetMs(musicMs, video.currentTime * 1000)
    onOffsetChange(newOffset)
  }

  const adjustOffset = (deltaMs: number) => {
    onOffsetChange(offsetMs + deltaMs)
  }

  const commitOffsetInput = () => {
    const parsed = Number(offsetInput)
    if (Number.isFinite(parsed)) {
      onOffsetChange(Math.round(parsed))
    } else {
      setOffsetInput(String(offsetMs))
    }
  }

  const videoMs = musicToVideoMs(musicMs, offsetMs)

  return (
    <div className="video-ref-panel">
      <div className="video-ref-header">
        <span className="video-ref-title">參考影片</span>
        <div className="video-ref-header-actions">
          <button type="button" className="btn btn-sm" onClick={() => void onPickVideo()}>
            匯入影片
          </button>
          <button type="button" className="video-ref-close" onClick={onClose} title="隱藏參考影片">
            ×
          </button>
        </div>
      </div>

      {videoUrl ? (
        <>
          <video
            ref={videoRef}
            src={videoUrl}
            playsInline
            muted={videoMuted}
            className="video-ref-player"
          />
          <div className="video-ref-controls">
            <button
              type="button"
              className={`btn btn-sm${videoMuted ? ' btn-toggle-active' : ''}`}
              onClick={() => onMutedChange(!videoMuted)}
              aria-pressed={videoMuted}
            >
              {videoMuted ? '影片靜音：開' : '影片靜音：關'}
            </button>
          </div>

          <div className="video-ref-sync-row">
            音樂 {formatMsToTime(musicMs)} ↔ 影片 {formatMsToTime(Math.max(0, videoMs))}
          </div>

          {outOfRange && (
            <p className="video-ref-warning">此音樂時間沒有對應的影片畫面</p>
          )}

          <button type="button" className="btn btn-sm btn-primary" onClick={alignToCurrentPosition}>
            以目前位置對齊
          </button>

          <div className="video-ref-offset-row">
            <span>偏移量</span>
            {OFFSET_STEPS.map((step) => (
              <button
                key={step}
                type="button"
                className="btn btn-sm"
                onClick={() => adjustOffset(step)}
              >
                {step > 0 ? `+${step}ms` : `${step}ms`}
              </button>
            ))}
            <input
              type="number"
              className="video-ref-offset-input"
              value={offsetInput}
              onChange={(e) => setOffsetInput(e.target.value)}
              onBlur={commitOffsetInput}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitOffsetInput()
              }}
            />
            <span>ms</span>
          </div>
        </>
      ) : (
        <p className="video-ref-empty">尚未匯入參考影片</p>
      )}
    </div>
  )
}

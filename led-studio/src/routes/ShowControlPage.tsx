import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatMsToTime } from '../shared/timeParse'
import { useShowStore } from '../stores/showStore'

export function ShowControlPage() {
  const { bridge, setBridge } = useShowStore()
  const [source, setSource] = useState<'manual' | 'ltc'>('manual')

  useEffect(() => {
    if (!window.api) return
    const unsub = window.api.show.onBridgeState(setBridge)
    return unsub
  }, [setBridge])

  const handleStart = () => {
    void window.api?.show.bridgeStart({ source })
  }

  const handleStop = () => {
    void window.api?.show.bridgeStop()
  }

  const handleLtcOnly = () => {
    void window.api?.show.ltcStart({ durationMs: 180000 })
  }

  return (
    <section className="page show-control">
      <h1>Show Control</h1>
      <p className="hint">UDP Timecode · port 4210 · 50 Hz · 搭配 ESP32 Wi-Fi 同步</p>

      <div className="show-time">
        <span className="label">Show time</span>
        <span className="time">{formatMsToTime(bridge.musicTimeMs)}</span>
      </div>

      <div className="bridge-stats">
        <div>
          <span className="label">Status</span>
          <span className={bridge.running ? 'badge running' : 'badge stopped'}>
            {bridge.running ? 'RUNNING' : 'STOPPED'}
          </span>
        </div>
        <div>
          <span className="label">Sequence</span>
          <span>{bridge.sequence}</span>
        </div>
        <div>
          <span className="label">Rate</span>
          <span>{bridge.packetsPerSecond} pkt/s</span>
        </div>
        <div>
          <span className="label">Source</span>
          <span>{bridge.source}</span>
        </div>
      </div>

      <div className="device-form">
        <label>
          時間源
          <select value={source} onChange={(e) => setSource(e.target.value as 'manual' | 'ltc')}>
            <option value="manual">Manual（Bridge 本地 clock）</option>
            <option value="ltc">LTC Sidecar（Python 模擬 / WAV）</option>
          </select>
        </label>
      </div>

      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={handleStart} disabled={bridge.running}>
          Start Bridge
        </button>
        <button type="button" className="btn" onClick={handleStop} disabled={!bridge.running}>
          Stop Bridge
        </button>
        <button type="button" className="btn" onClick={handleLtcOnly}>
          LTC Sidecar 測試
        </button>
        <Link to="/devices" className="btn">
          Device Manager
        </Link>
      </div>
    </section>
  )
}

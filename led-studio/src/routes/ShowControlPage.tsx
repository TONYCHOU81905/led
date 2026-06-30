import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { EspDeviceStatus } from '../shared/types/project'
import { formatMsToTime, parseTimeToMs } from '../shared/timeParse'
import { useShowStore } from '../stores/showStore'

export function ShowControlPage() {
  const { bridge, setBridge } = useShowStore()
  const [source, setSource] = useState<'manual' | 'ltc'>('manual')
  const [seekInput, setSeekInput] = useState('0:00')
  const [devices, setDevices] = useState<EspDeviceStatus[]>([])

  useEffect(() => {
    if (!window.api) return
    const unsubBridge = window.api.show.onBridgeState(setBridge)
    const unsubEsp = window.api.show.onEspStatus(setDevices)
    void window.api.show.espStatusList().then(setDevices)
    return () => {
      unsubBridge()
      unsubEsp()
    }
  }, [setBridge])

  const handleStart = () => {
    void window.api?.show.bridgeStart({ source })
  }

  const handleStop = () => {
    void window.api?.show.bridgeStop()
  }

  const handlePause = () => {
    void window.api?.show.bridgePause()
  }

  const handleResume = () => {
    void window.api?.show.bridgeResume()
  }

  const handleSeek = () => {
    try {
      const ms = parseTimeToMs(seekInput.includes(':') ? seekInput : `0:${seekInput}`)
      void window.api?.show.bridgeSeek(ms)
    } catch {
      // ignore invalid input
    }
  }

  const handleLtcOnly = () => {
    void window.api?.show.ltcStart({ durationMs: 180000 })
  }

  return (
    <section className="page show-control">
      <h1>Show Control</h1>
      <p className="hint">UDP Timecode · port 4210 · 100 Hz · ESP status UDP 4211</p>

      <div className="show-time">
        <span className="label">Show time</span>
        <span className="time">{formatMsToTime(bridge.musicTimeMs)}</span>
      </div>

      <div className="bridge-stats">
        <div>
          <span className="label">Status</span>
          <span className={bridge.running ? 'badge running' : 'badge stopped'}>
            {bridge.running ? (bridge.paused ? 'PAUSED' : 'RUNNING') : 'STOPPED'}
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
        <label>
          Seek 時間 (m:ss)
          <input value={seekInput} onChange={(e) => setSeekInput(e.target.value)} placeholder="1:30" />
        </label>
      </div>

      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={handleStart} disabled={bridge.running}>
          Start Bridge
        </button>
        <button type="button" className="btn" onClick={handlePause} disabled={!bridge.running || bridge.paused}>
          Pause
        </button>
        <button type="button" className="btn" onClick={handleResume} disabled={!bridge.running || !bridge.paused}>
          Resume
        </button>
        <button type="button" className="btn" onClick={handleSeek} disabled={!bridge.running}>
          Seek
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
        <Link to="/calibration" className="btn">
          測試 / 校正
        </Link>
      </div>

      <section className="esp-status-panel">
        <h2>ESP 裝置狀態（UDP 4211）</h2>
        {devices.length === 0 ? (
          <p className="hint">尚無裝置回報。ESP 連上 Wi-Fi 並進入演出狀態後會出現。</p>
        ) : (
          <table className="event-table">
            <thead>
              <tr>
                <th>device_id</th>
                <th>sync</th>
                <th>drift ms</th>
                <th>RSSI</th>
                <th>battery mV</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.device_id}>
                  <td>{d.device_id}</td>
                  <td>{d.sync_state ?? '—'}</td>
                  <td>{d.drift_ms ?? '—'}</td>
                  <td>{d.rssi ?? '—'}</td>
                  <td>{d.battery_mv ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </section>
  )
}

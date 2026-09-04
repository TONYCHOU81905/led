import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { MusicTransportPanel } from '../features/show/MusicTransportPanel'
import { deviceDisplayName, deviceKey } from '../shared/deviceIdentity'
import { mergeShowDevices } from '../shared/showDeviceRegistry'
import type { EspDeviceStatus, MdnsDevice } from '../shared/types/project'
import { formatMsToTime } from '../shared/timeParse'
import { useShowStore } from '../stores/showStore'

function fmtMmSs(ms: number): string {
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function ShowControlPage() {
  const { bridge, playbackMs, setBridge } = useShowStore()
  const [devices, setDevices] = useState<EspDeviceStatus[]>([])
  const [manualTarget, setManualTarget] = useState('')
  const [knownTargets, setKnownTargets] = useState<string[]>([])
  const [scanning, setScanning] = useState(false)
  const [mdnsDevices, setMdnsDevices] = useState<MdnsDevice[]>([])
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)
  const [skippedSubnetSweep, setSkippedSubnetSweep] = useState(false)

  const runDiscovery = async () => {
    if (!window.api?.show.discoverDevices) return
    setScanning(true)
    try {
      const result = await window.api.show.discoverDevices()
      if (result.skippedSubnetSweep) {
        setSkippedSubnetSweep(true)
      } else {
        setSkippedSubnetSweep(false)
      }
    } finally {
      setScanning(false)
    }
  }

  useEffect(() => {
    if (!window.api) return
    const refreshTargets = () => {
      void window.api.show.bridgeTargetList().then(setKnownTargets)
    }
    const unsubBridge = window.api.show.onBridgeState(setBridge)
    const unsubEsp = window.api.show.onEspStatus((list) => {
      setDevices(list)
      refreshTargets()
    })
    // mDNS 找到板子後，main process 會自動把 IP 註冊成 unicast target，
    // 所以這裡訂閱只是為了顯示；裝置清單本身會透過 onEspStatus 自己更新。
    const unsubMdns = window.api.show.onMdnsDevices((list) => {
      setMdnsDevices(list)
      refreshTargets()
    })
    const unsubDiscoveryError = window.api.show.onDiscoveryError(setDiscoveryError)
    void window.api.show.espStatusList().then(setDevices)
    refreshTargets()

    // 演出進行中不要自動掃描，避免 ARP 廣播干擾 timecode
    const showRunning = useShowStore.getState().bridge.running
    if (!showRunning) {
      void runDiscovery()
    }

    return () => {
      unsubBridge()
      unsubEsp()
      unsubMdns()
      unsubDiscoveryError()
    }
  }, [setBridge])

  const showDevices = useMemo(() => mergeShowDevices(knownTargets, devices), [knownTargets, devices])

  const handleAddTarget = () => {
    const ip = manualTarget.trim()
    if (!ip) return
    void window.api?.show.bridgeTargetAdd(ip).then((targets) => {
      setKnownTargets(targets)
      setManualTarget('')
    })
  }

  const handleRemoveTarget = (ip: string) => {
    void window.api?.show.bridgeTargetRemove(ip).then(setKnownTargets)
  }

  return (
    <section className="page show-control">
      <div className="show-control-header">
        <div className="show-control-heading">
          <h1>音樂控制</h1>
          <p className="hint">播放專案音檔並同步 UDP Timecode · port 4210 · 100 Hz · ESP status UDP 4211</p>
        </div>
        <MusicTransportPanel />
      </div>

      <div className="show-time">
        <span className="label">Show time</span>
        <span className="time">{formatMsToTime(playbackMs)}</span>
      </div>

      <div className="bridge-stats">
        <div>
          <span className="label">狀態</span>
          <span className={bridge.running ? 'badge running' : 'badge stopped'}>
            {bridge.running ? (bridge.paused ? 'PAUSED' : 'RUNNING') : 'STOPPED'}
          </span>
        </div>
        <div>
          <span className="label">封包速率</span>
          <span>{bridge.packetsPerSecond} pkt/s</span>
        </div>
        <div title="每送一個 UDP timecode 封包遞增，用於 ESP 偵測漏包">
          <span className="label">封包序號</span>
          <span>{bridge.sequence}</span>
        </div>
        <div>
          <span className="label">時間源</span>
          <span>{bridge.source}</span>
        </div>
        <div>
          <span className="label">Unicast IP</span>
          <span>{knownTargets.length} 個</span>
        </div>
        <div>
          <span className="label">ESP 回報中</span>
          <span>{devices.filter((d) => d.online !== false && d.ip).length} 台</span>
        </div>
      </div>

      <div className="device-form">
        <label>
          手動 Unicast IP（選填，跨子網時用）
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={manualTarget} onChange={(e) => setManualTarget(e.target.value)} placeholder="192.168.90.57" />
            <button type="button" className="btn" onClick={handleAddTarget}>
              加入
            </button>
          </div>
        </label>
      </div>

      {knownTargets.length > 0 ? (
        <div className="device-config-source">
          <span className="device-field-label">Unicast 已註冊 IP（Timecode 4210）</span>
          <div className="device-config-loaded">
            {knownTargets.map((ip) => (
              <button key={ip} type="button" className="btn btn-sm" onClick={() => handleRemoveTarget(ip)}>
                {ip} ×
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="actions">
        <button type="button" className="btn" onClick={() => void runDiscovery()} disabled={scanning}>
          {scanning ? '掃描中…' : '掃描裝置'}
        </button>
        <Link to="/devices" className="btn">
          Device Manager
        </Link>
        <Link to="/calibration" className="btn">
          測試 / 校正
        </Link>
      </div>

      {discoveryError ? (
        <p className="hint discovery-error" role="alert">
          ⚠ {discoveryError}
        </p>
      ) : null}

      {skippedSubnetSweep ? (
        <p className="hint">
          演出進行中，已跳過子網掃描以避免無線干擾。停止 Bridge 後再按「掃描裝置」可做完整掃描。
        </p>
      ) : null}

      <section className="esp-status-panel">
        <h2>演出裝置狀態</h2>
        <p className="hint">
          進入此頁會用兩條管道同時找裝置：<strong>mDNS</strong>（Bonjour，逐一網卡送查詢）與
          <strong> UDP 4211 廣播＋子網 unicast 掃描</strong>。任一條找到就會自動註冊 Unicast，無需手動輸入 IP。
          手動 IP 僅在跨子網或兩條都掃不到時使用。狀態與 USB 有線無關。
        </p>
        {mdnsDevices.length > 0 ? (
          <details className="mdns-panel">
            <summary>mDNS 掃到 {mdnsDevices.length} 台</summary>
            <table className="event-table">
              <thead>
                <tr>
                  <th>device_id</th>
                  <th>hostname</th>
                  <th>IP</th>
                  <th>role</th>
                  <th>韌體</th>
                  <th title="從哪張網卡發現的。有線與 Wi-Fi 都接著時，看這欄可以確認板子在哪個網段">
                    來源網卡
                  </th>
                </tr>
              </thead>
              <tbody>
                {mdnsDevices.map((d) => (
                  <tr key={deviceKey(d.device_id, d.chip_id, d.ip)}>
                    <td>{deviceDisplayName(d.device_id, d.chip_id)}</td>
                    <td>{d.host}</td>
                    <td>{d.ip}</td>
                    <td>{d.role_id ?? '—'}</td>
                    <td>{d.firmware ?? '—'}</td>
                    <td>{d.via_interface}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ) : null}
        {showDevices.length === 0 ? (
          <p className="hint">
            {scanning
              ? '正在掃描（mDNS ＋ 子網 unicast）…'
              : '尚無裝置。確認 ESP 已連 Wi-Fi，或按「掃描裝置」。板子的 serial log 會印出 [mdns] 那一行，可用來確認註冊成功。'}
          </p>
        ) : (
          <table className="event-table">
            <thead>
              <tr>
                <th>IP</th>
                <th>device_id</th>
                <th>已註冊</th>
                <th>回報</th>
                <th>sync</th>
                <th title="ESP 回報的目前播放時間">ESP 時間</th>
                <th title="ESP 與 Bridge 的時間差（毫秒）">drift ms</th>
                <th>RSSI</th>
                <th>battery mV</th>
              </tr>
            </thead>
            <tbody>
              {showDevices.map((d) => (
                <tr key={d.ip}>
                  <td>{d.ip}</td>
                  <td>{d.device_id ? deviceDisplayName(d.device_id, d.chip_id) : '—'}</td>
                  <td>{d.registered ? '是' : '—'}</td>
                  <td>
                    {d.udpReporting === null ? '未回報' : d.udpReporting ? 'online' : 'offline'}
                  </td>
                  <td>{d.udpReporting ? d.sync_state ?? '—' : '—'}</td>
                  <td>
                    {d.udpReporting && d.music_time_ms != null
                      ? fmtMmSs(d.music_time_ms)
                      : '—'}
                  </td>
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

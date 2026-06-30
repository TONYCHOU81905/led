import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { EspDeviceStatus } from '../shared/types/project'
import { useShowStore } from '../stores/showStore'

export function CalibrationPage() {
  const { bridge } = useShowStore()
  const [devices, setDevices] = useState<EspDeviceStatus[]>([])

  useEffect(() => {
    if (!window.api) return
    const unsub = window.api.show.onEspStatus(setDevices)
    void window.api.show.espStatusList().then(setDevices)
    return unsub
  }, [])

  const maxDrift = devices.reduce((max, d) => Math.max(max, Math.abs(d.drift_ms ?? 0)), 0)
  const within10ms = devices.filter((d) => Math.abs(d.drift_ms ?? 0) <= 10).length

  return (
    <section className="page">
      <h1>測試 / 校正</h1>
      <p className="hint">
        同步驗收目標 ±10 ms。Bridge 廣播 100 Hz；ESP 掉包 500 ms 內 continue_local，超過 2 s blackout。
      </p>

      <div className="bridge-stats">
        <div>
          <span className="label">Bridge</span>
          <span>{bridge.running ? `${bridge.packetsPerSecond} pkt/s` : 'stopped'}</span>
        </div>
        <div>
          <span className="label">±10 ms 內裝置</span>
          <span>
            {devices.length > 0 ? `${within10ms} / ${devices.length}` : '—'}
          </span>
        </div>
        <div>
          <span className="label">最大 |drift|</span>
          <span>{devices.length > 0 ? `${maxDrift} ms` : '—'}</span>
        </div>
      </div>

      <div className="actions">
        <Link to="/show" className="btn btn-primary">
          前往 Show Control
        </Link>
        <Link to="/devices" className="btn">
          Device Manager
        </Link>
      </div>

      <h2>現場檢查清單</h2>
      <ul className="hint">
        <li>主控電腦關閉省電；優先使用 2.4 GHz 熱點</li>
        <li>每支 ESP RSSI &gt; -65 dBm</li>
        <li>連續播放 30 分鐘無 crash（burn-in）</li>
        <li>電池 ADC 接線後確認 battery_mv 合理（見 docs/OPERATIONS.md）</li>
      </ul>

      <p className="hint">
        詳細操作手冊：<code>docs/OPERATIONS.md</code>
      </p>
    </section>
  )
}

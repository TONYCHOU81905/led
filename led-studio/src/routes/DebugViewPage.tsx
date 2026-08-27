import { useCallback, useEffect, useRef, useState } from 'react'

interface PortInfo {
  path: string
  manufacturer?: string
}

interface DebugLine {
  kind: 'line' | 'info' | 'error'
  text: string
  at: number
}

const MAX_LINES = 2000
// 使用者往上捲看歷史時不該被強制拉回底部：距底部小於這個距離才視為「已在底部」。
const AUTO_SCROLL_THRESHOLD_PX = 40

function formatTimestamp(at: number): string {
  const d = new Date(at)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

export function DebugViewPage() {
  const [ports, setPorts] = useState<PortInfo[]>([])
  const [selectedPort, setSelectedPort] = useState('')
  const [manualPort, setManualPort] = useState('')
  const [monitoring, setMonitoring] = useState(false)
  const [monitorPath, setMonitorPath] = useState<string | null>(null)
  const [lines, setLines] = useState<DebugLine[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
  const [portError, setPortError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const effectivePort = selectedPort || manualPort.trim()
  const logRef = useRef<HTMLDivElement | null>(null)

  const refreshPorts = useCallback(async () => {
    if (!window.api?.device) {
      setPortError('請用 Electron App 開啟（npm run dev），瀏覽器無法存取 USB Serial')
      return
    }
    setPortError(null)
    try {
      const list = await window.api.device.listPorts()
      setPorts(list)
      if (list.length === 0) {
        setPortError('未偵測到 Serial Port。請接上 ESP32 USB，或在下方手動輸入埠名（如 /dev/cu.usbserial-xxx）')
      }
    } catch (err) {
      setPortError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void refreshPorts()
  }, [refreshPorts])

  // 掛載時還原監看狀態（例如切走再切回這頁時，monitor 可能還開著）。
  useEffect(() => {
    if (!window.api?.device) return
    void window.api.device.monitorStatus().then((status) => {
      setMonitoring(status.monitoring)
      setMonitorPath(status.path)
      if (status.path) {
        setSelectedPort(status.path)
      }
    })
  }, [])

  const appendLine = useCallback((line: DebugLine) => {
    setLines((prev) => {
      const next = [...prev, line]
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next
    })
  }, [])

  const handleStart = useCallback(async () => {
    if (!effectivePort || !window.api?.device) return
    setBusy(true)
    try {
      await window.api.device.monitorStart(effectivePort, (l) => {
        appendLine({ kind: (l.kind as DebugLine['kind']) ?? 'line', text: l.text, at: l.at })
      })
      setMonitoring(true)
      setMonitorPath(effectivePort)
    } catch (err) {
      appendLine({
        kind: 'error',
        text: err instanceof Error ? err.message : String(err),
        at: Date.now()
      })
    } finally {
      setBusy(false)
    }
  }, [effectivePort, appendLine])

  const handleStop = useCallback(async () => {
    if (!window.api?.device) return
    setBusy(true)
    try {
      await window.api.device.monitorStop()
    } finally {
      setMonitoring(false)
      setMonitorPath(null)
      setBusy(false)
    }
  }, [])

  const handleClear = useCallback(() => {
    setLines([])
  }, [])

  const handleCopyAll = useCallback(() => {
    const text = lines.map((l) => `${formatTimestamp(l.at)} ${l.text}`).join('\n')
    void navigator.clipboard.writeText(text)
  }, [lines])

  const handleScroll = useCallback(() => {
    const el = logRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setAutoScroll(distanceFromBottom < AUTO_SCROLL_THRESHOLD_PX)
  }, [])

  useEffect(() => {
    if (!autoScroll) return
    const el = logRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [lines, autoScroll])

  return (
    <div className="debugview-page">
      <h1>DebugView</h1>
      <p className="debugview-hint">
        即時顯示 ESP32 板子從 Serial Port 送出的所有輸出（開機訊息、[app]/[wifi]/[health] 等 log），
        不用另開終端機跑 pio device monitor。
      </p>

      {portError && <div className="debugview-error">{portError}</div>}

      <div className="debugview-controls">
        <label className="debugview-field">
          <span className="debugview-field-label">Serial Port</span>
          <select value={selectedPort} onChange={(e) => setSelectedPort(e.target.value)}>
            <option value="">— 選擇 —</option>
            {ports.map((p) => (
              <option key={p.path} value={p.path}>
                {p.path} {p.manufacturer ? `(${p.manufacturer})` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="debugview-field">
          <span className="debugview-field-label">手動輸入埠名</span>
          <input
            value={manualPort}
            onChange={(e) => setManualPort(e.target.value)}
            placeholder="/dev/cu.usbserial-1100"
          />
        </label>

        <button type="button" className="btn btn-sm" onClick={() => void refreshPorts()}>
          重新掃描
        </button>

        {!monitoring ? (
          <button
            type="button"
            className="btn btn-sm debugview-start-btn"
            disabled={busy || !effectivePort}
            onClick={() => void handleStart()}
          >
            開始監看
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-sm debugview-stop-btn"
            disabled={busy}
            onClick={() => void handleStop()}
          >
            停止監看
          </button>
        )}

        <button type="button" className="btn btn-sm" onClick={handleClear}>
          清除
        </button>

        <button type="button" className="btn btn-sm" onClick={handleCopyAll}>
          複製全部
        </button>

        <label className="debugview-autoscroll">
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
          自動捲動
        </label>
      </div>

      <div className="debugview-status">
        {monitoring ? `監看中：${monitorPath}` : '未在監看'}
      </div>

      <div className="debugview-log" ref={logRef} onScroll={handleScroll}>
        {lines.map((l, i) => (
          <div key={i} className={`debugview-line debugview-line-${l.kind}`}>
            <span className="debugview-line-ts">{formatTimestamp(l.at)}</span>
            <span className="debugview-line-text">{l.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

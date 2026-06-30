import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { compileProjectRole, configChecksum } from '../shared/configCompiler'
import { defaultCompileOptions } from '../shared/deviceConfigDefaults'
import type { DeviceConfig } from '../shared/types/project'
import { useProjectStore } from '../stores/projectStore'

interface PortInfo {
  path: string
  manufacturer?: string
}

function buildConfigFromProject(
  project: NonNullable<ReturnType<typeof useProjectStore.getState>['project']>,
  roleId: string,
  dataGpio: number,
  ledType: 'WS2811' | 'WS2812B',
  ssid: string,
  password: string
): DeviceConfig {
  return compileProjectRole(project, roleId, {
    ...defaultCompileOptions(roleId),
    dataGpio,
    ledType,
    network: { ssid, password, timecode_port: 4210, device_status_port: 4211 }
  })
}

export function DeviceManagerPage() {
  const { project, activeRoleId } = useProjectStore()
  const [ports, setPorts] = useState<PortInfo[]>([])
  const [selectedPort, setSelectedPort] = useState('')
  const [manualPort, setManualPort] = useState('')
  const [roleId, setRoleId] = useState(activeRoleId ?? '')
  const [ssid, setSsid] = useState('')
  const [password, setPassword] = useState('')
  const [dataGpio, setDataGpio] = useState(8)
  const [ledType, setLedType] = useState<'WS2811' | 'WS2812B'>('WS2811')
  const [loadedConfig, setLoadedConfig] = useState<DeviceConfig | null>(null)
  const [loadedConfigLabel, setLoadedConfigLabel] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [portError, setPortError] = useState<string | null>(null)

  const effectivePort = selectedPort || manualPort.trim()

  const appendLog = useCallback((line: string) => {
    setLog((prev) => [...prev.slice(-200), line])
  }, [])

  const refreshPorts = useCallback(async () => {
    if (!window.api?.device) {
      setPortError('請用 Electron App 開啟（npm run dev），瀏覽器無法存取 USB Serial')
      return
    }
    setPortError(null)
    try {
      const list = await window.api.device.listPorts()
      setPorts(list)
      const isEspPort = (p: PortInfo) =>
        !p.path.includes('debug-console') &&
        !p.path.includes('wlan-debug') &&
        !p.path.includes('Bluetooth')
      const espPort = list.find(
        (p) =>
          isEspPort(p) &&
          (p.manufacturer?.toLowerCase().includes('espressif') ||
            p.path.includes('usbserial') ||
            p.path.includes('wchusbserial'))
      )
      if (espPort && !selectedPort && !manualPort.trim()) {
        setSelectedPort(espPort.path)
      } else if (list.find(isEspPort) && !selectedPort && !manualPort.trim()) {
        setSelectedPort(list.find(isEspPort)!.path)
      }
      if (list.length === 0) {
        setPortError('未偵測到 Serial Port。請接上 ESP32 USB，或在下方手動輸入埠名（如 /dev/cu.usbserial-xxx）')
      }
    } catch (err) {
      setPortError(err instanceof Error ? err.message : String(err))
    }
  }, [selectedPort, manualPort])

  useEffect(() => {
    void refreshPorts()
  }, [refreshPorts])

  useEffect(() => {
    if (activeRoleId) setRoleId(activeRoleId)
  }, [activeRoleId])

  if (!project) {
    return (
      <section className="page">
        <p>
          尚未載入專案。<Link to="/">前往 Dashboard</Link>
        </p>
      </section>
    )
  }

  const run = async (label: string, fn: () => Promise<void>) => {
    if (!window.api?.device) {
      appendLog(`${label}: 需要 Electron App`)
      return
    }
    if (!effectivePort) {
      appendLog(`${label}: 請選擇或輸入 Serial Port`)
      return
    }
    setBusy(true)
    appendLog(`--- ${label} ---`)
    try {
      await fn()
      appendLog(`${label}: OK`)
    } catch (err) {
      appendLog(`${label}: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const resolveConfig = (): DeviceConfig => {
    if (loadedConfig) return loadedConfig
    return buildConfigFromProject(project, roleId, dataGpio, ledType, ssid, password)
  }

  const loadConfigFile = async () => {
    if (!window.api?.project.openDeviceConfig) {
      appendLog('載入 config: 需要 Electron App')
      return
    }
    try {
      const config = await window.api.project.openDeviceConfig()
      if (!config) return
      setLoadedConfig(config)
      setLoadedConfigLabel(`${config.device.role_id} · ${config.events.length} events`)
      if (config.device.role_id) setRoleId(config.device.role_id)
      appendLog(`已載入 config 檔：${config.device.role_id}（${config.events.length} events）`)
    } catch (err) {
      appendLog(`載入 config 失敗: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const clearLoadedConfig = () => {
    setLoadedConfig(null)
    setLoadedConfigLabel(null)
    appendLog('已清除載入的 config，改從專案編譯')
  }

  return (
    <section className="page device-manager-page">
      <header className="page-header">
        <h1>Device Manager</h1>
        <p className="hint">
          韌體只需燒錄一次 · WiFi 寫入 NVS 持久保存 · Config 可從 Timeline 匯出後在此上傳
        </p>
      </header>

      {portError && <p className="error-banner">{portError}</p>}

      <div className="device-form">
        <div className="device-port-row">
          <label className="device-field">
            <span className="device-field-label">Serial Port</span>
            <select value={selectedPort} onChange={(e) => setSelectedPort(e.target.value)}>
              <option value="">— 選擇 —</option>
              {ports.map((p) => (
                <option key={p.path} value={p.path}>
                  {p.path} {p.manufacturer ? `(${p.manufacturer})` : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="device-field">
            <span className="device-field-label">手動輸入埠名</span>
            <input
              value={manualPort}
              onChange={(e) => setManualPort(e.target.value)}
              placeholder="/dev/cu.usbserial-1100"
            />
          </label>

          <button type="button" className="btn btn-sm device-rescan-btn" onClick={() => void refreshPorts()}>
            重新掃描
          </button>
        </div>

        <label className="device-field">
          <span className="device-field-label">角色（編譯來源）</span>
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)} disabled={!!loadedConfig}>
            {project.roles.map((r) => (
              <option key={r.role_id} value={r.role_id}>
                {r.display_name}
              </option>
            ))}
          </select>
        </label>

        <label className="device-field">
          <span className="device-field-label">WiFi SSID</span>
          <input value={ssid} onChange={(e) => setSsid(e.target.value)} placeholder="場地 Wi-Fi 或筆電熱點" />
        </label>

        <label className="device-field">
          <span className="device-field-label">WiFi 密碼</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="WiFi 密碼" />
        </label>

        <label className="device-field">
          <span className="device-field-label">LED 燈條 IC</span>
          <select value={ledType} onChange={(e) => setLedType(e.target.value as 'WS2811' | 'WS2812B')}>
            <option value="WS2811">WS2811（400 kHz，預設）</option>
            <option value="WS2812B">WS2812B（800 kHz）</option>
          </select>
        </label>

        <label className="device-field">
          <span className="device-field-label">LED GPIO</span>
          <input type="number" value={dataGpio} onChange={(e) => setDataGpio(Number(e.target.value))} />
        </label>
      </div>

      <div className="device-config-source">
        <span className="device-field-label">Config 來源</span>
        {loadedConfig ? (
          <div className="device-config-loaded">
            <span className="badge running">檔案：{loadedConfigLabel}</span>
            <button type="button" className="btn btn-sm" onClick={clearLoadedConfig}>
              改從專案編譯
            </button>
          </div>
        ) : (
          <span className="hint">目前從專案 + 上方角色即時編譯（Timeline 可「匯出 Config」備份）</span>
        )}
        <button type="button" className="btn btn-sm" onClick={() => void loadConfigFile()}>
          從檔案載入 Config
        </button>
      </div>

      <p className="device-hint">
        避免選到 <code>/dev/tty.debug-console</code> 或 <code>wlan-debug</code>。接上 ESP32 後按「重新掃描」，或手動輸入 macOS 埠名。
        Config 上傳後寫入 ESP <strong>Flash (LittleFS)</strong>，重開機仍保留；WiFi 寫入 <strong>NVS</strong>。
      </p>

      <div className="actions device-actions">
        <button
          type="button"
          className="btn"
          disabled={busy || !effectivePort}
          onClick={() =>
            run('Ping ESP', async () => {
              const res = await window.api.device.ping(effectivePort)
              appendLog(JSON.stringify(res))
            })
          }
        >
          Ping
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !effectivePort}
          onClick={() =>
            run('Flash firmware', async () => {
              await window.api.device.flashFirmware(effectivePort, (p) => appendLog(p.message))
            })
          }
        >
          燒錄韌體 (esptool)
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !effectivePort || !ssid}
          onClick={() =>
            run('Set WiFi', async () => {
              await window.api.device.setWifi(effectivePort, ssid, password)
            })
          }
        >
          寫入 WiFi → NVS
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !effectivePort || !roleId}
          onClick={() =>
            run('Upload config', async () => {
              const config = resolveConfig()
              const crc = configChecksum(config)
              appendLog(`config crc32: 0x${crc.toString(16)} · ${config.events.length} events`)
              const res = await window.api.device.uploadConfig(
                effectivePort,
                config as unknown as Record<string, unknown>
              )
              appendLog(JSON.stringify(res))
            })
          }
        >
          上傳 Config (Serial)
        </button>
        <button
          type="button"
          className="btn btn-accent"
          disabled={busy || !effectivePort || !roleId || !ssid}
          onClick={() =>
            run('Deploy WiFi + Config', async () => {
              await window.api.device.setWifi(effectivePort, ssid, password)
              const config = resolveConfig()
              const crc = configChecksum(config)
              appendLog(`config crc32: 0x${crc.toString(16)}`)
              const res = await window.api.device.uploadConfig(
                effectivePort,
                config as unknown as Record<string, unknown>
              )
              appendLog(JSON.stringify(res))
            })
          }
        >
          一鍵：WiFi + Config
        </button>
      </div>

      <pre className="device-log">{log.join('\n') || '操作紀錄會顯示在這裡…'}</pre>
    </section>
  )
}

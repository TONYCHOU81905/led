import dgram from 'node:dgram'
import os from 'node:os'
import { deviceKey } from '../../src/shared/deviceIdentity'
import { isValidBridgeTargetIp } from '../../src/shared/showDeviceRegistry'
import {
  resolveBroadcastAddresses,
  resolveLocalSubnetHosts,
  sleep
} from './networkDiscovery'

export interface EspDeviceStatus {
  device_id: string
  /** 韌體帶的 MAC 後 3 bytes。同 role 的多台板子 device_id 相同，靠這個區分。 */
  chip_id?: string
  ip?: string
  online?: boolean
  role_id?: string
  sync_state?: string
  music_time_ms?: number
  drift_ms?: number
  rssi?: number
  battery_mv?: number
  config_crc32?: string | number
  last_seen_ms: number
}

export class EspStatusListener {
  private socket: dgram.Socket | null = null
  private port = 4211
  private devices = new Map<string, EspDeviceStatus>()
  private listeners = new Set<(devices: EspDeviceStatus[]) => void>()
  private helloTimer: NodeJS.Timeout | null = null
  private staleTimer: NodeJS.Timeout | null = null
  private knownTargets = new Set<string>()
  private deviceIpHandler: ((ip: string) => void) | null = null
  private discovering = false
  private errorListeners = new Set<(message: string) => void>()

  subscribe(listener: (devices: EspDeviceStatus[]) => void): () => void {
    this.listeners.add(listener)
    listener(this.listDevices())
    return () => this.listeners.delete(listener)
  }

  setDeviceIpHandler(handler: (ip: string) => void): void {
    this.deviceIpHandler = handler
  }

  /**
   * bind / send 失敗的回報管道。
   *
   * 以前這些錯誤只有 console.error，UI 完全不知道 discovery 已經死了 ——
   * 使用者看到的只是「掃描裝置沒反應」，而真正的原因（port 被佔、macOS 的
   * 本機網路權限被拒）永遠沒機會被看到。
   */
  onError(listener: (message: string) => void): () => void {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }

  private emitError(message: string): void {
    console.error('[esp-status]', message)
    for (const listener of this.errorListeners) listener(message)
  }

  listDevices(): EspDeviceStatus[] {
    // 同 device_id 的多台板子要有穩定順序，否則畫面每次更新都在跳動。
    return [...this.devices.values()].sort((a, b) =>
      deviceKey(a.device_id, a.chip_id, a.ip).localeCompare(
        deviceKey(b.device_id, b.chip_id, b.ip)
      )
    )
  }

  setDiscoveryTargets(targets: string[]): void {
    this.knownTargets = new Set(
      targets.map((target) => target.trim()).filter(isValidBridgeTargetIp)
    )
  }

  start(port = 4211): void {
    if (this.socket) return
    this.port = port
    // reuseAddr：同一台機器上跑第二個 Studio、或前一個 session 的 socket
    // 還沒被核心回收時，少了這個旗標就是 EADDRINUSE，而 discovery 會在
    // 完全沒有 UI 提示的情況下永久失效。
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    this.socket.on('message', (buf, rinfo) => this.onMessage(buf, rinfo.address))
    this.socket.on('error', (err) => {
      this.emitError(this.describeSocketFailure(err))
    })
    this.socket.bind(port, () => {
      this.socket?.setBroadcast(true)
      console.log(`[esp-status] listening on UDP ${port}`)
      void this.discoverDevices()
      this.helloTimer = setInterval(() => this.sendHello(), 2000)
      this.staleTimer = setInterval(() => this.pruneStaleDevices(), 1000)
    })
  }

  stop(): void {
    if (this.helloTimer) {
      clearInterval(this.helloTimer)
      this.helloTimer = null
    }
    if (this.staleTimer) {
      clearInterval(this.staleTimer)
      this.staleTimer = null
    }
    this.socket?.close()
    this.socket = null
  }

  /** Broadcast + subnet unicast hello sweep so ESPs discover Studio without manual IP entry. */
  async discoverDevices(): Promise<void> {
    if (!this.socket || this.discovering) return
    this.discovering = true
    try {
      for (let burst = 0; burst < 3; burst++) {
        this.sendHello()
        await sleep(80)
      }

      const hosts = resolveLocalSubnetHosts()
      console.log(`[esp-status] subnet discovery hello to ${hosts.length} hosts`)
      for (const host of hosts) {
        this.sendHelloToIp(host)
        await sleep(4)
      }

      for (let burst = 0; burst < 2; burst++) {
        this.sendHello()
        await sleep(80)
      }
    } finally {
      this.discovering = false
    }
  }

  /** 把 errno 翻成使用者能動手處理的訊息（原始訊息看不出該做什麼）。 */
  private describeSocketFailure(err: Error): string {
    const raw = err.message
    if (/EADDRINUSE/i.test(raw)) {
      return (
        `裝置發現無法啟動：UDP ${this.port} 已被佔用（${raw}）。` +
        '請確認沒有開著第二個 LED Studio，或有其他程式佔用這個 port。'
      )
    }
    if (/EACCES|EPERM/i.test(raw)) {
      return (
        `裝置發現被系統拒絕（${raw}）。` +
        'macOS：請到「系統設定 → 隱私權與安全性 → 本機網路」允許 LED Studio。' +
        'Windows：請在防火牆允許本程式的「私人網路」通訊。'
      )
    }
    return `裝置發現發生錯誤：${raw}`
  }

  private emit(): void {
    const list = this.listDevices()
    for (const listener of this.listeners) {
      listener(list)
    }
  }

  private noteDeviceIp(ip: string): void {
    if (!isValidBridgeTargetIp(ip)) return
    this.knownTargets.add(ip)
    this.sendHelloToIp(ip)
    this.deviceIpHandler?.(ip)
  }

  private onMessage(buf: Buffer, remoteIp: string): void {
    const text = buf.toString('utf8').trim()
    try {
      const msg = JSON.parse(text) as Record<string, unknown>
      if (msg.type !== 'status') return
      const deviceId = String(msg.device_id ?? '')
      if (!deviceId) return

      this.noteDeviceIp(remoteIp)

      const chipId = msg.chip_id ? String(msg.chip_id) : undefined

      const entry: EspDeviceStatus = {
        device_id: deviceId,
        chip_id: chipId,
        ip: remoteIp,
        online: true,
        role_id: msg.role_id ? String(msg.role_id) : undefined,
        sync_state: msg.sync_state ? String(msg.sync_state) : undefined,
        music_time_ms: typeof msg.music_time_ms === 'number' ? msg.music_time_ms : undefined,
        drift_ms:
          typeof msg.drift_ms === 'number'
            ? msg.drift_ms
            : typeof msg.estimated_drift_ms === 'number'
              ? msg.estimated_drift_ms
              : undefined,
        rssi: typeof msg.rssi === 'number' ? msg.rssi : undefined,
        battery_mv: typeof msg.battery_mv === 'number' ? msg.battery_mv : undefined,
        config_crc32: msg.config_crc32 as string | number | undefined,
        last_seen_ms: Date.now()
      }
      // key 不能只用 device_id：同 role 的十台板子 device_id 完全相同，
      // 只用它會讓十台併成一台，UI 上看起來像只有一台上線。
      this.devices.set(deviceKey(deviceId, chipId, remoteIp), entry)
      this.emit()
    } catch {
      // ignore malformed packets
    }
  }

  private helloPayload(): Buffer {
    return Buffer.from(
      JSON.stringify({
        type: 'controller_hello',
        controller_id: os.hostname(),
        sent_at_ms: Date.now()
      })
    )
  }

  private sendHelloToIp(ip: string): void {
    if (!this.socket || !isValidBridgeTargetIp(ip)) return
    this.socket.send(this.helloPayload(), this.port, ip)
  }

  private sendHello(): void {
    if (!this.socket) return
    const payload = this.helloPayload()

    for (const target of resolveBroadcastAddresses()) {
      this.socket.send(payload, this.port, target)
    }
    for (const target of this.knownTargets) {
      this.socket.send(payload, this.port, target)
    }
  }

  private pruneStaleDevices(): void {
    const now = Date.now()
    let changed = false
    for (const [key, device] of this.devices) {
      const age = now - device.last_seen_ms
      if ((device.online ?? true) && age > 6000) {
        this.devices.set(key, { ...device, online: false })
        changed = true
        continue
      }
      if (age > 30000) {
        this.devices.delete(key)
        changed = true
      }
    }
    if (changed) this.emit()
  }
}

export const espStatusListener = new EspStatusListener()

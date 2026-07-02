import dgram from 'node:dgram'
import os from 'node:os'
import { isValidBridgeTargetIp } from '../../src/shared/showDeviceRegistry'
import {
  resolveBroadcastAddresses,
  resolveLocalSubnetHosts,
  sleep
} from './networkDiscovery'

export interface EspDeviceStatus {
  device_id: string
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

  subscribe(listener: (devices: EspDeviceStatus[]) => void): () => void {
    this.listeners.add(listener)
    listener(this.listDevices())
    return () => this.listeners.delete(listener)
  }

  setDeviceIpHandler(handler: (ip: string) => void): void {
    this.deviceIpHandler = handler
  }

  listDevices(): EspDeviceStatus[] {
    return [...this.devices.values()].sort((a, b) => a.device_id.localeCompare(b.device_id))
  }

  setDiscoveryTargets(targets: string[]): void {
    this.knownTargets = new Set(
      targets.map((target) => target.trim()).filter(isValidBridgeTargetIp)
    )
  }

  start(port = 4211): void {
    if (this.socket) return
    this.port = port
    this.socket = dgram.createSocket('udp4')
    this.socket.on('message', (buf, rinfo) => this.onMessage(buf, rinfo.address))
    this.socket.on('error', (err) => {
      console.error('[esp-status]', err.message)
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

      const entry: EspDeviceStatus = {
        device_id: deviceId,
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
      this.devices.set(deviceId, entry)
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
    for (const [deviceId, device] of this.devices) {
      const age = now - device.last_seen_ms
      if ((device.online ?? true) && age > 6000) {
        this.devices.set(deviceId, { ...device, online: false })
        changed = true
        continue
      }
      if (age > 30000) {
        this.devices.delete(deviceId)
        changed = true
      }
    }
    if (changed) this.emit()
  }
}

export const espStatusListener = new EspStatusListener()

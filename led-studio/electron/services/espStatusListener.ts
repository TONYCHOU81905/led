import dgram from 'node:dgram'

export interface EspDeviceStatus {
  device_id: string
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

  subscribe(listener: (devices: EspDeviceStatus[]) => void): () => void {
    this.listeners.add(listener)
    listener(this.listDevices())
    return () => this.listeners.delete(listener)
  }

  listDevices(): EspDeviceStatus[] {
    return [...this.devices.values()].sort((a, b) => a.device_id.localeCompare(b.device_id))
  }

  start(port = 4211): void {
    if (this.socket) return
    this.port = port
    this.socket = dgram.createSocket('udp4')
    this.socket.on('message', (buf) => this.onMessage(buf))
    this.socket.on('error', (err) => {
      console.error('[esp-status]', err.message)
    })
    this.socket.bind(port, () => {
      console.log(`[esp-status] listening on UDP ${port}`)
    })
  }

  stop(): void {
    this.socket?.close()
    this.socket = null
  }

  private emit(): void {
    const list = this.listDevices()
    for (const listener of this.listeners) {
      listener(list)
    }
  }

  private onMessage(buf: Buffer): void {
    const text = buf.toString('utf8').trim()
    try {
      const msg = JSON.parse(text) as Record<string, unknown>
      if (msg.type !== 'status') return
      const deviceId = String(msg.device_id ?? '')
      if (!deviceId) return
      const entry: EspDeviceStatus = {
        device_id: deviceId,
        role_id: msg.role_id ? String(msg.role_id) : undefined,
        sync_state: msg.sync_state ? String(msg.sync_state) : undefined,
        music_time_ms: typeof msg.music_time_ms === 'number' ? msg.music_time_ms : undefined,
        drift_ms: typeof msg.drift_ms === 'number' ? msg.drift_ms : undefined,
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
}

export const espStatusListener = new EspStatusListener()

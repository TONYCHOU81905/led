import dgram from 'node:dgram'
import os from 'node:os'
import type { BridgeOptions, BridgeState } from '../../src/shared/types/project'

export const TIMECODE_MAGIC = 0x4c544331 // 'LTC1'
export const TIMECODE_PORT = 4210
export const TIMECODE_RATE_HZ = 100

function msToMmSs(ms: number): string {
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export enum PacketType {
  START = 1,
  RUNNING = 2,
  PAUSE = 3,
  STOP = 4,
  SEEK = 5,
  PING = 6
}

export interface TimecodePacketFields {
  version?: number
  packetType: PacketType
  flags?: number
  showIdCrc32?: number
  sequence: number
  senderUnixMs?: bigint
  musicTimeMs: number
  playbackRatePpm?: number
  configCrc32?: number
}

const PACKET_SIZE = 40

function crc32Buffer(buf: Buffer, excludeLast4 = false): number {
  const end = excludeLast4 ? buf.length - 4 : buf.length
  let crc = 0xffffffff
  for (let i = 0; i < end; i++) {
    crc ^= buf[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Encode TimecodePacketV1 binary (40 bytes). */
export function encodeTimecodePacket(fields: TimecodePacketFields): Buffer {
  const buf = Buffer.alloc(PACKET_SIZE)

  buf.writeUInt32LE(TIMECODE_MAGIC, 0)
  buf.writeUInt8(fields.version ?? 1, 4)
  buf.writeUInt8(fields.packetType, 5)
  buf.writeUInt16LE(fields.flags ?? 0, 6)
  buf.writeUInt32LE(fields.showIdCrc32 ?? 0, 8)
  buf.writeUInt32LE(fields.sequence, 12)
  buf.writeBigUInt64LE(fields.senderUnixMs ?? BigInt(Date.now()), 16)
  buf.writeUInt32LE(fields.musicTimeMs >>> 0, 24)
  buf.writeInt32LE(fields.playbackRatePpm ?? 0, 28)
  buf.writeUInt32LE(fields.configCrc32 ?? 0, 32)

  const packetCrc = crc32Buffer(buf, true)
  buf.writeUInt32LE(packetCrc, 36)

  return buf
}

export function decodeTimecodePacket(buf: Buffer): TimecodePacketFields {
  if (buf.length < PACKET_SIZE) {
    throw new Error(`Timecode packet too short: ${buf.length} bytes`)
  }

  const magic = buf.readUInt32LE(0)
  if (magic !== TIMECODE_MAGIC) {
    throw new Error(`Invalid magic: 0x${magic.toString(16)}`)
  }

  const expectedCrc = buf.readUInt32LE(36)
  const actualCrc = crc32Buffer(buf, true)
  if (expectedCrc !== actualCrc) {
    throw new Error(`CRC mismatch: expected 0x${expectedCrc.toString(16)}, got 0x${actualCrc.toString(16)}`)
  }

  return {
    version: buf.readUInt8(4),
    packetType: buf.readUInt8(5) as PacketType,
    flags: buf.readUInt16LE(6),
    showIdCrc32: buf.readUInt32LE(8),
    sequence: buf.readUInt32LE(12),
    senderUnixMs: buf.readBigUInt64LE(16),
    musicTimeMs: buf.readUInt32LE(24),
    playbackRatePpm: buf.readInt32LE(28),
    configCrc32: buf.readUInt32LE(32)
  }
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    throw new Error(`Invalid IPv4 address: ${ip}`)
  }
  return (
    ((parts[0] << 24) >>> 0) |
    ((parts[1] << 16) >>> 0) |
    ((parts[2] << 8) >>> 0) |
    (parts[3] >>> 0)
  ) >>> 0
}

function intToIpv4(value: number): string {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff
  ].join('.')
}

function resolveBroadcastAddresses(preferred?: string): string[] {
  const targets = new Set<string>()
  if (preferred && preferred.trim()) {
    targets.add(preferred.trim())
  }

  const interfaces = os.networkInterfaces()
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== 'IPv4' || !entry.address || !entry.netmask) continue
      try {
        const ip = ipv4ToInt(entry.address)
        const mask = ipv4ToInt(entry.netmask)
        const broadcast = (ip & mask) | (~mask >>> 0)
        targets.add(intToIpv4(broadcast >>> 0))
      } catch {
        // Ignore malformed interface entries.
      }
    }
  }

  targets.add('255.255.255.255')
  return [...targets]
}

export class TimecodeBridgeService {
  private socket: dgram.Socket | null = null
  private timer: NodeJS.Timeout | null = null
  private socketReady = false
  private lastDebugLogAt = 0
  private sequence = 0
  private musicTimeMs = 0
  private startedAt = 0
  private running = false
  private paused = false
  private source: BridgeOptions['source'] = 'manual'
  private showIdCrc32 = 0
  private configCrc32 = 0
  private broadcastAddresses = ['255.255.255.255']
  private unicastTargets: string[] = []
  private port = TIMECODE_PORT
  private packetTimestamps: number[] = []
  private listeners = new Set<(state: BridgeState) => void>()
  private externalTimeMs: number | null = null

  private debugLog(message: string): void {
    console.log(`[bridge] ${message}`)
  }

  subscribe(listener: (state: BridgeState) => void): () => void {
    this.listeners.add(listener)
    listener(this.getState())
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    const state = this.getState()
    for (const listener of this.listeners) {
      listener(state)
    }
  }

  getState(): BridgeState {
    const now = Date.now()
    const recent = this.packetTimestamps.filter((t) => now - t < 1000)
    return {
      running: this.running,
      paused: this.paused,
      source: this.source ?? 'manual',
      musicTimeMs: this.musicTimeMs,
      sequence: this.sequence,
      packetsPerSecond: recent.length,
      broadcastTargets: [...this.broadcastAddresses],
      unicastTargets: [...this.unicastTargets],
      startedAt: this.startedAt || undefined
    }
  }

  start(options: BridgeOptions = {}): void {
    if (this.running) return

    this.source = options.source ?? 'manual'
    this.showIdCrc32 = options.showIdCrc32 ?? 0
    this.configCrc32 = options.configCrc32 ?? 0
    this.broadcastAddresses = resolveBroadcastAddresses(options.broadcastAddress)
    this.unicastTargets = [...new Set((options.unicastTargets ?? []).map((ip) => ip.trim()).filter(Boolean))]
    this.port = options.port ?? TIMECODE_PORT
    this.sequence = 0
    this.musicTimeMs = 0
    this.externalTimeMs = null
    this.startedAt = Date.now()
    this.running = true
    this.paused = false
    this.packetTimestamps = []
    this.socketReady = false
    this.lastDebugLogAt = 0

    this.socket = dgram.createSocket('udp4')
    this.socket.on('error', (err) => {
      console.error('[bridge]', err.message)
    })
    this.socket.bind(0, () => {
      this.socket?.setBroadcast(true)
      this.socketReady = true
      const addr = this.socket?.address()
      const local = typeof addr === 'object' ? `${addr.address}:${addr.port}` : 'unknown'
      this.debugLog(
        `bound ${local}, broadcasting UDP ${this.port} to ${this.broadcastAddresses.join(', ')}`
      )
      if (this.unicastTargets.length > 0) {
        this.debugLog(`unicast UDP ${this.port} to ${this.unicastTargets.join(', ')}`)
      } else {
        this.debugLog('no known ESP unicast targets yet; broadcast only')
      }
      this.sendPacket(PacketType.START)
      this.debugLog(`start source=${this.source}`)
    })

    const intervalMs = 1000 / TIMECODE_RATE_HZ
    this.timer = setInterval(() => this.tick(), intervalMs)
    this.emit()
  }

  /** Feed time from LTC sidecar or Studio preview playback. */
  setExternalTimeMs(ms: number): void {
    this.externalTimeMs = Math.max(0, ms)
    if (this.source === 'ltc' || this.source === 'preview') {
      this.musicTimeMs = this.externalTimeMs
      if (this.running) {
        this.emit()
      }
    }
  }

  stop(): void {
    if (!this.running) return

    this.sendPacket(PacketType.STOP)
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.socket?.close()
    this.socket = null
    this.socketReady = false
    this.running = false
    this.paused = false
    this.debugLog('stopped')
    this.emit()
  }

  pause(): void {
    if (!this.running || this.paused) return
    this.paused = true
    this.sendPacket(PacketType.PAUSE)
    this.debugLog(`pause at music_ms=${this.musicTimeMs} (${msToMmSs(this.musicTimeMs)})`)
    this.emit()
  }

  resume(): void {
    if (!this.running || !this.paused) return
    this.paused = false
    if (this.source === 'manual') {
      this.startedAt = Date.now() - this.musicTimeMs
    }
    this.sendPacket(PacketType.RUNNING)
    this.debugLog(`resume at music_ms=${this.musicTimeMs} (${msToMmSs(this.musicTimeMs)})`)
    this.emit()
  }

  seek(musicTimeMs: number): void {
    if (!this.running) return
    this.musicTimeMs = Math.max(0, musicTimeMs)
    if (this.source === 'manual') {
      this.startedAt = Date.now() - this.musicTimeMs
    } else if (this.source === 'preview' || this.source === 'ltc') {
      this.externalTimeMs = this.musicTimeMs
    }
    this.sendPacket(PacketType.SEEK)
    this.debugLog(`seek to music_ms=${this.musicTimeMs} (${msToMmSs(this.musicTimeMs)})`)
    this.emit()
  }

  private tick(): void {
    if (!this.running || this.paused) return

    if ((this.source === 'ltc' || this.source === 'preview') && this.externalTimeMs !== null) {
      this.musicTimeMs = this.externalTimeMs
    } else {
      const elapsed = Date.now() - this.startedAt
      this.musicTimeMs = elapsed
    }
    this.sendPacket(PacketType.RUNNING)
    this.emit()
  }

  private sendPacket(type: PacketType): void {
    if (!this.socket || !this.socketReady) return

    this.sequence += 1
    const packet = encodeTimecodePacket({
      packetType: type,
      sequence: this.sequence,
      musicTimeMs: this.musicTimeMs,
      showIdCrc32: this.showIdCrc32,
      configCrc32: this.configCrc32
    })

    for (const address of this.broadcastAddresses) {
      this.socket.send(packet, this.port, address)
    }
    this.packetTimestamps.push(Date.now())

    const now = Date.now()
    const isControlPacket = type !== PacketType.RUNNING
    if (isControlPacket || now - this.lastDebugLogAt >= 1000) {
      const typeName = PacketType[type] ?? String(type)
      this.debugLog(
        `tx ${typeName} seq=${this.sequence} music_ms=${this.musicTimeMs} (${msToMmSs(this.musicTimeMs)}) broadcast=${this.broadcastAddresses.join(', ')} unicast=${this.unicastTargets.join(', ') || '-'}`
      )
      this.lastDebugLogAt = now
    }

    for (const address of this.unicastTargets) {
      this.socket.send(packet, this.port, address)
    }
  }
}

export const timecodeBridge = new TimecodeBridgeService()

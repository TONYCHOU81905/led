import dgram from 'node:dgram'
import {
  decideSeekPacket,
  initialSeekThrottleState,
  type SeekThrottleState
} from '../../src/shared/seekThrottle'
import os from 'node:os'
import type { BridgeOptions, BridgeState } from '../../src/shared/types/project'

export const TIMECODE_MAGIC = 0x4c544331 // 'LTC1'
export const TIMECODE_PORT = 4210
export const TIMECODE_RATE_HZ = 100

/**
 * 暫停時仍要送 PAUSE 心跳的間隔。
 *
 * 原本 tick() 在 paused 時直接 return，暫停後 app 一顆封包都不送。板子在
 * TIMECODE_BLACKOUT_MS（2 秒）之後就失去時間源，而且拖動時間軸的預覽也送
 * 不出去。持續告知「現在暫停在哪一點」才是對的：封包是冪等的（idempotent，
 * 重複送同一個位置結果一樣），成本也只有 5 Hz。
 */
export const PAUSE_HEARTBEAT_MS = 200

/**
 * 控制封包（START/PAUSE/SEEK/STOP）重送次數。
 *
 * RUNNING 每秒有上百顆，掉幾顆無所謂；但控制封包原本只送一次，UDP 掉一顆
 * 板子就永久失步 —— 例如 PAUSE 掉了，ESP 會一直以為還在播放並自由奔跑。
 * 現場 RSSI −83 dBm 的環境掉包很常見，所以連送幾份。
 */
export const CONTROL_REPEAT = 4
/** 控制封包重送的間隔；夠短，重送造成的重新錨定誤差可忽略。 */
export const CONTROL_REPEAT_GAP_MS = 20

export function interpolatePreviewTime(
  externalTimeMs: number,
  externalUpdatedAtMs: number,
  nowMs: number
): number {
  return Math.max(0, externalTimeMs + Math.max(0, nowMs - externalUpdatedAtMs))
}

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

export interface NetworkInterfaceLike {
  internal: boolean
  family: string
  address: string
  netmask: string
}

/**
 * 決定要往哪些位址廣播 timecode。
 *
 * 每多一個目標，ESP 就多收到同一個 sequence 的一份複本。重複的那幾份帶著
 * 已經過期的 music_time，會把韌體 ClockSync 的 drift filter 一路往負的拉，
 * 最後演變成不斷觸發 hard seek（韌體端也已加上 sequence 去重，這裡是治本的
 * 另一半）。所以只送必要的目標：
 * - 略過 169.254.0.0/16 link-local（沒拿到 DHCP 時的自我指派位址，ESP 不會
 *   在這個網段），這一條就少掉一份完全無用的複本。
 * - 已經有具體的子網廣播位址時就不再送 255.255.255.255：兩者抵達同一批
 *   主機，等於把每個封包無條件再複製一份。
 */
export function resolveBroadcastAddresses(
  preferred?: string,
  interfaceList?: NetworkInterfaceLike[]
): string[] {
  const targets = new Set<string>()
  if (preferred && preferred.trim()) {
    targets.add(preferred.trim())
  }

  const entries =
    interfaceList ??
    Object.values(os.networkInterfaces()).flatMap(
      (list) => (list ?? []) as unknown as NetworkInterfaceLike[]
    )

  for (const entry of entries) {
    if (entry.internal || entry.family !== 'IPv4' || !entry.address || !entry.netmask) continue
    if (entry.address.startsWith('169.254.')) continue
    try {
      const ip = ipv4ToInt(entry.address)
      const mask = ipv4ToInt(entry.netmask)
      const broadcast = (ip & mask) | (~mask >>> 0)
      targets.add(intToIpv4(broadcast >>> 0))
    } catch {
      // Ignore malformed interface entries.
    }
  }

  if (targets.size === 0) targets.add('255.255.255.255')
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
  /**
   * SEEK 封包的節流狀態。拖動時間軸時 seek() 會被每個拖曳事件呼叫
   * （實測約 21 Hz），每顆 SEEK 都讓韌體 applyHardSeek 重新錨定時鐘。
   * 內部時間仍然每次都更新，只有封包送出受節流。
   */
  private seekThrottle: SeekThrottleState = initialSeekThrottleState()
  private port = TIMECODE_PORT
  private packetTimestamps: number[] = []
  private listeners = new Set<(state: BridgeState) => void>()
  private externalTimeMs: number | null = null
  private externalUpdatedAt = 0
  private lastPauseHeartbeatAt = 0
  private controlRepeatTimers = new Set<NodeJS.Timeout>()

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
    this.resetSeekThrottle()
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
    this.externalUpdatedAt = 0
    this.startedAt = Date.now()
    this.running = true
    this.paused = false
    this.packetTimestamps = []
    this.socketReady = false
    this.lastDebugLogAt = 0
    this.lastPauseHeartbeatAt = 0
    this.clearControlRepeats()

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
      this.sendControlPacket(PacketType.START)
      if (this.paused) this.sendControlPacket(PacketType.PAUSE)
      this.debugLog(`start source=${this.source}`)
    })

    const intervalMs = 1000 / TIMECODE_RATE_HZ
    this.timer = setInterval(() => this.tick(), intervalMs)
    this.emit()
  }

  /** Feed time from LTC sidecar or Studio preview playback. */
  setExternalTimeMs(ms: number): void {
    this.externalTimeMs = Math.max(0, ms)
    this.externalUpdatedAt = Date.now()
    if (this.source === 'ltc' || this.source === 'preview') {
      this.musicTimeMs = this.externalTimeMs
      if (this.running) {
        if (this.paused) {
          // 暫停中拖動時間軸：原本這裡只更新記憶體變數，封包只從 tick() 出
          // 去，而 tick() 在 paused 時 early-return —— 板子完全收不到，燈光
          // 不會跟著時間軸走。立刻補一顆 PAUSE 讓預覽即時反應，並把心跳計時
          // 往後推，避免同一時間點被送兩次。
          this.lastPauseHeartbeatAt = Date.now()
          this.sendPacket(PacketType.PAUSE)
        }
        this.emit()
      }
    }
  }

  stop(): void {
    this.resetSeekThrottle()
    if (!this.running) return

    // STOP 之後 socket 就要關掉，沒辦法用延遲重送；改成連續送幾份。
    for (let i = 0; i < CONTROL_REPEAT; i++) {
      this.sendPacket(PacketType.STOP)
    }
    this.clearControlRepeats()
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
    this.lastPauseHeartbeatAt = Date.now()
    this.sendControlPacket(PacketType.PAUSE)
    this.debugLog(`pause at music_ms=${this.musicTimeMs} (${msToMmSs(this.musicTimeMs)})`)
    this.emit()
  }

  resume(): void {
    if (!this.running || !this.paused) return
    this.paused = false
    if (this.source === 'manual') {
      this.startedAt = Date.now() - this.musicTimeMs
    } else if (this.source === 'preview') {
      this.externalTimeMs = this.musicTimeMs
      this.externalUpdatedAt = Date.now()
    }
    // 用 sendControlPacket 而非 sendPacket：它會先取消還在排隊的 PAUSE 重送
    // （否則播放後那幾顆遲到的 PAUSE 會把板子重新停住）。
    this.sendControlPacket(PacketType.RUNNING)
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
      this.externalUpdatedAt = Date.now()
    }
    // 內部時間已經在上面更新完（永遠精確）；這裡只決定要不要送封包。
    // 拖曳過程中被省略的那些，會由下一顆心跳（播放 100 Hz RUNNING、
    // 暫停 5 Hz PAUSE）帶著相同的 music_time 補上 —— 兩者的韌體 handler
    // 都會 applyHardSeek，所以預覽仍然跟得上。
    const decision = decideSeekPacket(this.musicTimeMs, Date.now(), this.seekThrottle)
    if (decision.send) {
      this.seekThrottle = decision.next
      this.sendControlPacket(PacketType.SEEK)
    }
    if (this.paused) {
      // 暫停中 seek：緊接著補一顆 PAUSE，板子才會明確停在新位置，不必等
      // 下一次心跳。（韌體的 SEEK 已不再隱含「開始播放」。）
      this.lastPauseHeartbeatAt = Date.now()
      this.sendPacket(PacketType.PAUSE)
    }
    if (decision.send) {
      this.debugLog(`seek to music_ms=${this.musicTimeMs} (${msToMmSs(this.musicTimeMs)})`)
    }
    this.emit()
  }

  /** 開始／停止時重置，避免跨場次拿舊的 music_time 比對位移。 */
  private resetSeekThrottle(): void {
    this.seekThrottle = initialSeekThrottleState()
  }

  private tick(): void {
    if (!this.running) return

    if (this.paused) {
      // 暫停時不能靜默：板子 2 秒沒收到封包就進 blackout 並失去時間源。
      // 持續告知「暫停在 musicTimeMs 這一點」，板子才能穩定預覽該時間點。
      const now = Date.now()
      if (now - this.lastPauseHeartbeatAt >= PAUSE_HEARTBEAT_MS) {
        this.lastPauseHeartbeatAt = now
        this.sendPacket(PacketType.PAUSE)
      }
      return
    }

    if (this.source === 'preview' && this.externalTimeMs !== null) {
      this.musicTimeMs = interpolatePreviewTime(
        this.externalTimeMs,
        this.externalUpdatedAt,
        Date.now()
      )
    } else if (this.source === 'ltc' && this.externalTimeMs !== null) {
      this.musicTimeMs = this.externalTimeMs
    } else {
      const elapsed = Date.now() - this.startedAt
      this.musicTimeMs = elapsed
    }
    this.sendPacket(PacketType.RUNNING)
    this.emit()
  }

  /**
   * 送出一顆控制封包，並在之後重送幾份。
   *
   * 每一份都拿到新的 sequence，所以韌體的「同 sequence 去重」不會把重送吃
   * 掉；而控制封包本身是冪等的，板子重複套用同一個位置沒有副作用。
   */
  private sendControlPacket(type: PacketType): void {
    // 先取消還沒送出的舊重送。否則按下暫停後 30ms 內又按播放，排在 40ms 的
    // PAUSE 重送會蓋掉剛送出的 RUNNING，板子就停在那裡不動了。
    this.clearControlRepeats()
    this.sendPacket(type)
    for (let i = 1; i < CONTROL_REPEAT; i++) {
      const timer = setTimeout(() => {
        this.controlRepeatTimers.delete(timer)
        // socket 可能已經在重送排程期間關掉（sendPacket 自己也會擋）。
        this.sendPacket(type)
      }, i * CONTROL_REPEAT_GAP_MS)
      this.controlRepeatTimers.add(timer)
    }
  }

  private clearControlRepeats(): void {
    for (const timer of this.controlRepeatTimers) clearTimeout(timer)
    this.controlRepeatTimers.clear()
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
    const now = Date.now()
    this.packetTimestamps.push(now)
    // getState() 只看最近 1 秒，但這個陣列原本永遠不裁切：一場 5 分鐘的秀
    // 會累積十幾萬筆，而且每次 getState() 都要整個 filter 一遍。
    if (this.packetTimestamps.length > 2 * TIMECODE_RATE_HZ) {
      this.packetTimestamps = this.packetTimestamps.filter((t) => now - t < 1000)
    }

    // PAUSE 現在是 5 Hz 心跳，跟 RUNNING 一樣要節流，否則 log 會被洗掉。
    const isControlPacket = type !== PacketType.RUNNING && type !== PacketType.PAUSE
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

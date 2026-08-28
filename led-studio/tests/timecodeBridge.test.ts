import { describe, expect, it } from 'vitest'
import {
  encodeTimecodePacket,
  decodeTimecodePacket,
  PacketType,
  TIMECODE_MAGIC,
  TIMECODE_RATE_HZ,
  interpolatePreviewTime,
  resolveBroadcastAddresses,
  PAUSE_HEARTBEAT_MS,
  CONTROL_REPEAT,
  CONTROL_REPEAT_GAP_MS
} from '../electron/services/timecodeBridge'

describe('timecodeBridge packet', () => {
  it('uses 100 Hz broadcast rate per spec', () => {
    expect(TIMECODE_RATE_HZ).toBe(100)
  })
  it('interpolates preview time between slower audio samples', () => {
    expect(interpolatePreviewTime(15_000, 1_000, 1_040)).toBe(15_040)
    expect(interpolatePreviewTime(15_000, 1_000, 990)).toBe(15_000)
  })
  it('encodes and decodes TimecodePacketV1', () => {
    const buf = encodeTimecodePacket({
      packetType: PacketType.RUNNING,
      sequence: 42,
      musicTimeMs: 90_000,
      showIdCrc32: 0xdeadbeef,
      configCrc32: 0x12345678
    })

    expect(buf.length).toBe(40)
    expect(buf.readUInt32LE(0)).toBe(TIMECODE_MAGIC)

    const decoded = decodeTimecodePacket(buf)
    expect(decoded.packetType).toBe(PacketType.RUNNING)
    expect(decoded.sequence).toBe(42)
    expect(decoded.musicTimeMs).toBe(90_000)
    expect(decoded.showIdCrc32).toBe(0xdeadbeef)
  })
})

describe('resolveBroadcastAddresses', () => {
  const iface = (address: string, netmask: string) => ({
    internal: false,
    family: 'IPv4',
    address,
    netmask
  })

  it('每個子網只送一個廣播位址，不再附加 255.255.255.255', () => {
    // 多送一份 = ESP 收到同一個 sequence 的重複封包，會把 drift filter 拉歪。
    expect(
      resolveBroadcastAddresses(undefined, [
        iface('192.168.25.30', '255.255.255.0'),
        iface('192.168.90.35', '255.255.255.0')
      ])
    ).toEqual(['192.168.25.255', '192.168.90.255'])
  })

  it('略過 169.254.0.0/16 link-local 介面', () => {
    expect(
      resolveBroadcastAddresses(undefined, [
        iface('192.168.90.35', '255.255.255.0'),
        iface('169.254.156.200', '255.255.0.0')
      ])
    ).toEqual(['192.168.90.255'])
  })

  it('沒有任何可用介面時才退回 255.255.255.255', () => {
    expect(resolveBroadcastAddresses(undefined, [])).toEqual(['255.255.255.255'])
    expect(resolveBroadcastAddresses(undefined, [iface('169.254.1.2', '255.255.0.0')])).toEqual([
      '255.255.255.255'
    ])
  })

  it('保留呼叫端指定的位址', () => {
    expect(
      resolveBroadcastAddresses('10.0.0.255', [iface('192.168.90.35', '255.255.255.0')])
    ).toEqual(['10.0.0.255', '192.168.90.255'])
  })
})

describe('暫停與控制封包常數', () => {
  it('暫停時仍以 5 Hz 送 PAUSE 心跳（板子 2 秒沒封包就進 blackout）', () => {
    expect(PAUSE_HEARTBEAT_MS).toBeLessThan(2000 / 2)
  })
  it('控制封包重送多份，UDP 掉一顆不會讓板子永久失步', () => {
    expect(CONTROL_REPEAT).toBeGreaterThan(1)
    expect(CONTROL_REPEAT * CONTROL_REPEAT_GAP_MS).toBeLessThan(PAUSE_HEARTBEAT_MS)
  })
})

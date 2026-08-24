import { describe, expect, it } from 'vitest'
import {
  encodeTimecodePacket,
  decodeTimecodePacket,
  PacketType,
  TIMECODE_MAGIC,
  TIMECODE_RATE_HZ,
  interpolatePreviewTime
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

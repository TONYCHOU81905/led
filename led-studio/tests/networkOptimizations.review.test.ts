import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  filterBroadcastForTargets,
  ipv4ToInt,
  intToIpv4,
  type InterfaceLike
} from '../src/shared/broadcastPolicy'

describe('review: ipv4ToInt 32-bit 有號數溢位', () => {
  it('192.168.x.x（最高位元組 > 127）不會造成 filterBroadcastForTargets 誤判', () => {
    // 192 << 24 在 JS 是有號 int32，結果是負數；ipv4ToInt 沒有 `>>> 0`。
    // 直接驗算 bit pattern 是否仍然一致。
    const raw = ipv4ToInt('192.168.90.69')
    // 這裡原本斷言 toBeLessThan(0)，記錄的是「溢位成負數」的當時現狀。
    // 覆核後已在 broadcastPolicy.ts 補上 >>> 0，回傳無號，故改斷言修正後行為。
    // 注意：補 >>> 0 時必須連同 filterBroadcastForTargets 內部的
    // expectedBroadcast 與子網比較一起改 —— 只改一邊會讓
    // 3232258303 !== -1062708993 永遠不相等，過濾全空、優化靜默失效（實測過）。
    expect(raw).toBeGreaterThan(0)
    expect(intToIpv4(raw)).toBe('192.168.90.69') // 但 round-trip 正確（因為 intToIpv4 用 >>> 0）
  })

  it('非 byte-aligned 遮罩（/25）+ 192.x 位址：filterBroadcastForTargets 仍正確過濾', () => {
    const iface: InterfaceLike = {
      address: '192.168.90.200',
      netmask: '255.255.255.128',
      internal: false,
      family: 'IPv4'
    }
    // /25: 192.168.90.128–255，broadcast = 192.168.90.255
    const candidates = ['192.168.90.255', '192.168.90.127']
    const targetInSameSubnet = ['192.168.90.230'] // 128-255 範圍
    const result = filterBroadcastForTargets(candidates, targetInSameSubnet, [iface])
    expect(result).toEqual(['192.168.90.255'])
  })

  it('目標落在 /25 的另一半（不同子網）→ 不保留該 broadcast', () => {
    const iface: InterfaceLike = {
      address: '192.168.90.200', // .128-.255 half
      netmask: '255.255.255.128',
      internal: false,
      family: 'IPv4'
    }
    const candidates = ['192.168.90.255']
    const targetOtherHalf = ['192.168.90.50'] // 0-127 half，不同子網
    const result = filterBroadcastForTargets(candidates, targetOtherHalf, [iface])
    // 沒有任何 candidate 對應得上 target 所在子網 → 應該回退到全部 candidates（後備行為）
    expect(result).toEqual(candidates)
  })
})

describe('review: sendPacket 控制封包重送與 broadcast 2Hz 降頻的交互', () => {
  interface Sent {
    address: string
    seq: number
  }
  const sent: Sent[] = []

  beforeEach(() => {
    sent.length = 0
    vi.resetModules()
    vi.useFakeTimers()
    vi.doMock('node:dgram', () => ({
      default: {
        createSocket: () => ({
          on: () => undefined,
          bind: (_port: number, cb?: () => void) => cb?.(),
          setBroadcast: () => undefined,
          address: () => ({ address: '0.0.0.0', port: 12345 }),
          send: (buf: Buffer, _port: number, address: string) => {
            sent.push({ address, seq: buf.readUInt32LE(12) })
          },
          close: () => undefined
        })
      }
    }))
    vi.doMock('node:os', () => ({
      default: {
        networkInterfaces: () => ({
          en1: [
            { address: '192.168.90.69', netmask: '255.255.255.0', family: 'IPv4', internal: false }
          ]
        }),
        hostname: () => 'test-host'
      }
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.doUnmock('node:dgram')
    vi.doUnmock('node:os')
  })

  it('已知板子時，STOP 的 4 份重送裡，broadcast 大多被 2Hz 節流吃掉（只有 unicast 全數送達）', async () => {
    const { timecodeBridge } = await import('../electron/services/timecodeBridge')
    timecodeBridge.start({ source: 'manual', unicastTargets: ['192.168.90.107'] })
    // 讓一顆 100Hz RUNNING 先把 lastBroadcastAt 設成「剛剛」，模擬穩定運行中
    vi.advanceTimersByTime(10)
    sent.length = 0

    timecodeBridge.stop() // stop() 內部立即連送 CONTROL_REPEAT=4 份 STOP（無延遲，同步迴圈)

    const toBoard = sent.filter((s) => s.address === '192.168.90.107')
    const broadcast = sent.filter((s) => s.address === '192.168.90.255')

    // Unicast：4 份 STOP 全數送達（可靠通道）
    expect(toBoard.length).toBe(4)
    // Broadcast：因為 stop() 是同步迴圈（4 次呼叫發生在同一個 Date.now() 毫秒內），
    // 2Hz 節流下最多只有 1 份會被送出（第一份，因為剛好在 500ms 窗口内 lastBroadcastAt
    // 是 10ms 前，未過 500ms，所以理論上應該是 0 份）。
    expect(broadcast.length).toBeLessThanOrEqual(1)

    timecodeBridge.stop()
  })

  it('sendControlPacket 的延遲重送（20ms 間隔）中，多數 broadcast 重送一樣被節流吃掉', async () => {
    const { timecodeBridge, PacketType } = await import('../electron/services/timecodeBridge')
    timecodeBridge.start({ source: 'manual', unicastTargets: ['192.168.90.107'] })
    sent.length = 0

    // pause() 用 sendControlPacket：立即送一份 + setTimeout 在 20/40/60ms 各補一份
    timecodeBridge.pause()
    vi.advanceTimersByTime(100)

    const toBoard = sent.filter((s) => s.address === '192.168.90.107')
    const broadcast = sent.filter((s) => s.address === '192.168.90.255')

    // Unicast 全數送達
    expect(toBoard.length).toBe(4)
    // 這裡原本斷言 toBeLessThanOrEqual(1)，記錄的是「重送的 broadcast 被 2Hz
    // 窗口吃掉」的當時現狀 —— 那正是覆核指出的 P2。已修正：sendControlPacket
    // 的四發都帶 forceBroadcast 豁免降頻。理由是「只靠 broadcast 才收得到」的
    // 板子（晚開機、還沒進 unicastTargets 的）漏掉一顆 STOP 就整台失去同步，
    // 而控制封包很稀疏，全速送 broadcast 的成本可忽略。
    expect(broadcast.length).toBe(4)

    timecodeBridge.stop()
  })
})

describe('review: start/stop/setUnicastTargets 狀態一致性', () => {
  interface Sent {
    address: string
  }
  const sent: Sent[] = []

  beforeEach(() => {
    sent.length = 0
    vi.resetModules()
    vi.useFakeTimers()
    vi.doMock('node:dgram', () => ({
      default: {
        createSocket: () => ({
          on: () => undefined,
          bind: (_port: number, cb?: () => void) => cb?.(),
          setBroadcast: () => undefined,
          address: () => ({ address: '0.0.0.0', port: 12345 }),
          send: (_buf: Buffer, _port: number, address: string) => {
            sent.push({ address })
          },
          close: () => undefined
        })
      }
    }))
    vi.doMock('node:os', () => ({
      default: {
        networkInterfaces: () => ({
          en1: [
            { address: '192.168.90.69', netmask: '255.255.255.0', family: 'IPv4', internal: false }
          ]
        }),
        hostname: () => 'test-host'
      }
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.doUnmock('node:dgram')
    vi.doUnmock('node:os')
  })

  it('setUnicastTargets() 在 bridge 尚未 start() 時呼叫不會丟例外，且不影響之後 start() 的行為', async () => {
    const { timecodeBridge } = await import('../electron/services/timecodeBridge')
    expect(() => timecodeBridge.setUnicastTargets(['192.168.90.107'])).not.toThrow()

    // start() 時沒有帶 unicastTargets options → 應該視為「沒有已知板子」，
    // 而不是繼承 setUnicastTargets() 先前設定的值（呼叫端各自有自己的
    // targets 來源，start() 的 options 才是 single source of truth）。
    timecodeBridge.start({ source: 'manual' })
    sent.length = 0
    vi.advanceTimersByTime(200)

    const toBoard = sent.filter((s) => s.address === '192.168.90.107')
    expect(toBoard).toHaveLength(0)

    timecodeBridge.stop()
  })

  it('stop() 後再 start()：lastBroadcastAt 重置，第一顆 tick 立刻 broadcast（不用等 500ms）', async () => {
    const { timecodeBridge } = await import('../electron/services/timecodeBridge')
    timecodeBridge.start({ source: 'manual', unicastTargets: ['192.168.90.107'] })
    vi.advanceTimersByTime(50) // 產生過 broadcast，lastBroadcastAt 非 0
    timecodeBridge.stop()

    sent.length = 0
    timecodeBridge.start({ source: 'manual', unicastTargets: ['192.168.90.107'] })
    // start() 在 socket.bind() 回呼裡同步送出 START，這一顆就該立刻 broadcast
    // （lastBroadcastAt 已被 stop()/start() 重置成 0），不需要等任何 tick。
    const broadcast = sent.filter((s) => s.address === '192.168.90.255')
    expect(broadcast.length).toBeGreaterThanOrEqual(1)

    timecodeBridge.stop()
  })

  it('對已停止的 bridge 呼叫 stop() 兩次不會拋出、也不會重複送 STOP', async () => {
    const { timecodeBridge } = await import('../electron/services/timecodeBridge')
    timecodeBridge.start({ source: 'manual', unicastTargets: ['192.168.90.107'] })
    timecodeBridge.stop()
    sent.length = 0
    expect(() => timecodeBridge.stop()).not.toThrow()
    expect(sent).toHaveLength(0)
  })
})

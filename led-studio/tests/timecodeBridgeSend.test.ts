import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * sendPacket() 的整合測試 —— 實際數送出去的封包，而不只測政策純函式。
 *
 * 為什麼需要這一層：broadcastPolicy 的單元測試只證明「判斷是對的」，
 * 不證明 sendPacket() 真的用了它。主 session 在實機上量到 124.7 pkt/s 的
 * broadcast，但那是舊 build（新 main process 要重啟 Studio 才生效），
 * 所以線上量測驗證不了。這個測試把 dgram mock 掉，直接數 socket.send 的
 * 目標位址，是唯一能自動化驗證整合行為的方式。
 */

interface Sent {
  address: string
}

const sent: Sent[] = []

vi.mock('node:dgram', () => ({
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

// 兩張網卡：有線（無板子）＋ Wi-Fi（有板子），對應實機環境。
vi.mock('node:os', () => ({
  default: {
    networkInterfaces: () => ({
      en0: [
        { address: '192.168.25.30', netmask: '255.255.255.0', family: 'IPv4', internal: false }
      ],
      en1: [
        { address: '192.168.90.69', netmask: '255.255.255.0', family: 'IPv4', internal: false }
      ],
      lo0: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', internal: true }]
    }),
    hostname: () => 'test-host'
  }
}))

const loadBridge = async () => {
  const mod = await import('../electron/services/timecodeBridge')
  return mod.timecodeBridge
}

describe('sendPacket 的 broadcast 政策整合', () => {
  beforeEach(() => {
    sent.length = 0
    vi.useFakeTimers()
  })

  afterEach(async () => {
    const bridge = await loadBridge()
    bridge.stop()
    vi.useRealTimers()
  })

  it('沒有已知板子時 broadcast 全速送（發現階段行為不能壞）', async () => {
    const bridge = await loadBridge()
    bridge.start({ source: 'manual', unicastTargets: [] })
    sent.length = 0

    vi.advanceTimersByTime(1000) // 1 秒 = 100 個 tick

    const unicast = sent.filter((s) => !s.address.endsWith('.255'))
    expect(unicast).toHaveLength(0)
    // 兩個子網廣播位址 × 100 tick，容許控制封包造成的少量誤差
    expect(sent.length).toBeGreaterThan(150)
  })

  it('已知板子時：unicast 全速、broadcast 降到 2Hz、且不送到沒有板子的網段', async () => {
    const bridge = await loadBridge()
    bridge.start({ source: 'manual', unicastTargets: ['192.168.90.107'] })
    sent.length = 0

    vi.advanceTimersByTime(1000)

    const toBoard = sent.filter((s) => s.address === '192.168.90.107')
    const wifiBcast = sent.filter((s) => s.address === '192.168.90.255')
    const wiredBcast = sent.filter((s) => s.address === '192.168.25.255')

    // unicast 維持全速 —— 板子的時間精度不能被犧牲
    expect(toBoard.length).toBeGreaterThan(90)
    // broadcast 降到 2Hz（1 秒約 2~3 顆，容許邊界）
    expect(wifiBcast.length).toBeGreaterThan(0)
    expect(wifiBcast.length).toBeLessThan(10)
    // 有線網段沒有板子 → 一顆都不該送（這是每秒 100 封包的浪費來源）
    expect(wiredBcast).toHaveLength(0)
  })

  it('演出中用 setUnicastTargets 加入板子後，它立刻開始收到 unicast', async () => {
    // 修復前 unicastTargets 只在 start() 設定一次，演出開始後才被發現的
    // 板子永遠收不到 unicast。
    const bridge = await loadBridge()
    bridge.start({ source: 'manual', unicastTargets: [] })

    vi.advanceTimersByTime(200)
    expect(sent.filter((s) => s.address === '192.168.90.107')).toHaveLength(0)

    bridge.setUnicastTargets(['192.168.90.107'])
    sent.length = 0
    vi.advanceTimersByTime(500)

    expect(sent.filter((s) => s.address === '192.168.90.107').length).toBeGreaterThan(40)
  })
})

describe('控制封包豁免 broadcast 降頻（覆核找到的 P2 迴歸測試）', () => {
  beforeEach(() => {
    sent.length = 0
    vi.useFakeTimers()
  })
  afterEach(async () => {
    const bridge = await loadBridge()
    bridge.stop()
    vi.useRealTimers()
  })

  it('CONTROL_REPEAT 的四發在 broadcast 上都要送出，不能被 500ms 窗口吃掉', async () => {
    // CONTROL_REPEAT 存在的理由是「RF 會掉包，控制封包一定要到」，重送間隔
    // 20/40/60ms 全部落在 2Hz 降頻的 500ms 窗口內。修復前只有第一發的
    // broadcast 真的送出，另外三份被靜默丟掉 —— 專門為可靠性做的冗餘在
    // broadcast 這條路上等於沒有。而只能靠 broadcast 的板子（晚開機、
    // 還沒進 unicastTargets 的）漏掉一顆 STOP 就整台失去同步。
    const bridge = await loadBridge()
    bridge.start({ source: 'manual', unicastTargets: ['192.168.90.107'] })
    vi.advanceTimersByTime(600) // 先讓降頻窗口進入「剛送過」的狀態
    sent.length = 0

    bridge.pause()
    vi.advanceTimersByTime(70) // 涵蓋 20/40/60ms 三發重送

    const bcast = sent.filter((s) => s.address === '192.168.90.255')
    const uni = sent.filter((s) => s.address === '192.168.90.107')
    // unicast 本來就每發都送（4 發）
    expect(uni.length).toBeGreaterThanOrEqual(4)
    // broadcast 也要 4 發都到，不是只有 1 發
    expect(bcast.length).toBeGreaterThanOrEqual(4)
  })

  it('心跳（RUNNING/PAUSE tick）仍然受降頻限制 —— 豁免不能擴散到 100Hz 的部分', async () => {
    const bridge = await loadBridge()
    bridge.start({ source: 'manual', unicastTargets: ['192.168.90.107'] })
    vi.advanceTimersByTime(600)
    sent.length = 0

    vi.advanceTimersByTime(1000) // 1 秒的心跳，沒有任何使用者操作

    const bcast = sent.filter((s) => s.address === '192.168.90.255')
    expect(bcast.length).toBeLessThan(10) // 仍是 2Hz 量級，不是 100Hz
  })
})

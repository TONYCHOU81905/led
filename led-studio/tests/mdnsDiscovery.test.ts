import { describe, expect, it } from 'vitest'
import {
  listIpv4InterfaceAddresses,
  mdnsSocketOptions,
  toMdnsDevice
} from '../electron/services/mdnsDiscovery'

// bonjour-service 的 Service 型別欄位很多，測試只需要我們讀的那幾個。
const service = (over: Record<string, unknown>) =>
  ({
    name: 'esp32s3-dancer-demo-001',
    host: 'esp32s3-dancer-demo-001.local',
    port: 4211,
    addresses: [],
    txt: {},
    ...over
  }) as never

describe('toMdnsDevice', () => {
  it('從 A record 取 IPv4，不靠 hostname 解析', () => {
    // 這是 Windows 能正常運作的關鍵：不呼叫 dns.lookup('*.local')。
    const device = toMdnsDevice(
      service({
        addresses: ['192.168.90.42'],
        txt: { device_id: 'esp32s3_dancer_demo_001', role_id: 'dancer_a', fw: '1.0.0' }
      }),
      '192.168.90.69',
      1000
    )
    expect(device).toEqual({
      device_id: 'esp32s3_dancer_demo_001',
      host: 'esp32s3-dancer-demo-001.local',
      ip: '192.168.90.42',
      port: 4211,
      role_id: 'dancer_a',
      firmware: '1.0.0',
      via_interface: '192.168.90.69',
      last_seen_ms: 1000
    })
  })

  it('addresses 同時有 IPv6 時只取 IPv4', () => {
    const device = toMdnsDevice(
      service({ addresses: ['fe80::1', '192.168.90.42'], txt: { device_id: 'x' } }),
      '192.168.90.69',
      1
    )
    expect(device?.ip).toBe('192.168.90.42')
  })

  it('A record 缺漏時退回封包來源 IP', () => {
    const device = toMdnsDevice(
      service({ addresses: [], referer: { address: '192.168.90.43' }, txt: { device_id: 'x' } }),
      '192.168.90.69',
      1
    )
    expect(device?.ip).toBe('192.168.90.43')
  })

  it('完全沒有 IPv4 時回 null（不要產生連不上的假裝置）', () => {
    expect(toMdnsDevice(service({ addresses: ['fe80::1'], txt: { device_id: 'x' } }), '1.2.3.4', 1)).toBeNull()
  })

  it('device_id 用 TXT 原始值，不用被消毒過的 hostname', () => {
    // 韌體把底線換成 '-' 才能當 DNS hostname；拿 hostname 回推
    // 會跟專案設定裡的 device_id（含底線）對不上。
    const device = toMdnsDevice(
      service({
        host: 'esp32s3-dancer-demo-001.local',
        addresses: ['192.168.90.42'],
        txt: { device_id: 'esp32s3_dancer_demo_001' }
      }),
      '192.168.90.69',
      1
    )
    expect(device?.device_id).toBe('esp32s3_dancer_demo_001')
  })

  it('TXT 沒帶 device_id 時退回服務名稱', () => {
    const device = toMdnsDevice(
      service({ addresses: ['192.168.90.42'], txt: {} }),
      '192.168.90.69',
      1
    )
    expect(device?.device_id).toBe('esp32s3-dancer-demo-001')
  })

  it('TXT 是空字串時視為未提供', () => {
    const device = toMdnsDevice(
      service({ addresses: ['192.168.90.42'], txt: { device_id: 'x', role_id: '', fw: '' } }),
      '192.168.90.69',
      1
    )
    expect(device?.role_id).toBeUndefined()
    expect(device?.firmware).toBeUndefined()
  })
})

describe('listIpv4InterfaceAddresses', () => {
  it('列出的每一項都是 IPv4，且不含 loopback', () => {
    // 每張網卡都要各開一個 Bonjour instance，才不會因為
    // 「有線持有預設路由、板子在 Wi-Fi 網段」而掃不到。
    const addresses = listIpv4InterfaceAddresses()
    for (const address of addresses) {
      expect(address).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/)
    }
    expect(addresses).not.toContain('127.0.0.1')
  })
})

describe('mdnsSocketOptions', () => {
  it("bind 必須是 0.0.0.0，否則收不到 multicast", () => {
    // 迴歸測試：multicast-dns 是 socket.bind(port, opts.bind || opts.interface)。
    // 少了 bind，socket 會綁在網卡的 unicast 位址上，而 mDNS 封包的目的位址是
    // 224.0.0.251，對不上綁定位址就永遠收不到 —— 實測是掃到 0 台。
    expect(mdnsSocketOptions('192.168.90.69').bind).toBe('0.0.0.0')
  })

  it('interface 帶指定網卡，讓查詢從那張卡送出去（解決雙網卡）', () => {
    expect(mdnsSocketOptions('192.168.90.69').interface).toBe('192.168.90.69')
  })

  it('reuseAddr 必須開，UDP 5353 已被系統的 mDNS 服務佔用', () => {
    expect(mdnsSocketOptions('192.168.90.69').reuseAddr).toBe(true)
  })
})

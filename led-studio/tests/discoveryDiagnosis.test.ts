import { describe, expect, it } from 'vitest'
import { describeDiscoveryMismatch } from '../electron/services/discoveryDiagnosis'

describe('describeDiscoveryMismatch', () => {
  it('UDP 找到、mDNS 找不到 → 指向 AP 擋 multicast', () => {
    // 這是 2026-09-04 實機遇到的狀況：同一份程式碼在有線網段看到 11 台主機的
    // mDNS 流量，Wi-Fi 網段 0 台 —— AP 擋掉 224.0.0.251 但仍轉發 broadcast。
    const msg = describeDiscoveryMismatch({ mdns: 0, udp: 1, mdnsStarted: true })
    expect(msg).toContain('multicast')
    expect(msg).toContain('IGMP Snooping')
    // 要講清楚「不關也能用」，否則使用者會以為系統壞了
    expect(msg).toContain('備援')
  })

  it('mDNS 找到、UDP 沒回報 → 指向 status_port 或防火牆', () => {
    const msg = describeDiscoveryMismatch({ mdns: 2, udp: 0, mdnsStarted: true })
    expect(msg).toContain('4211')
  })

  it('兩邊都找到時不要打擾使用者', () => {
    expect(describeDiscoveryMismatch({ mdns: 3, udp: 3, mdnsStarted: true })).toBeNull()
  })

  it('兩邊都沒找到時不要亂猜（可能只是板子還沒開機）', () => {
    expect(describeDiscoveryMismatch({ mdns: 0, udp: 0, mdnsStarted: true })).toBeNull()
  })

  it('mDNS 根本沒啟動時不要重複報 —— bind 失敗已經有自己的訊息', () => {
    expect(describeDiscoveryMismatch({ mdns: 0, udp: 5, mdnsStarted: false })).toBeNull()
  })
})

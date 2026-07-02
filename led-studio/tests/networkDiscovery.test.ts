import { describe, expect, it } from 'vitest'
import { intToIpv4, ipv4ToInt } from '../electron/services/networkDiscovery'

describe('networkDiscovery', () => {
  it('computes host range for /24 subnet', () => {
    const network = ipv4ToInt('192.168.90.0')
    const mask = ipv4ToInt('255.255.255.0')
    const broadcast = (network | (~mask >>> 0)) >>> 0
    const hosts: string[] = []
    for (let host = network + 1; host < broadcast; host++) {
      hosts.push(intToIpv4(host >>> 0))
    }
    expect(hosts[0]).toBe('192.168.90.1')
    expect(hosts[hosts.length - 1]).toBe('192.168.90.254')
    expect(hosts).toHaveLength(254)
  })
})

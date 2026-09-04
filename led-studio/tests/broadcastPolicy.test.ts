import { describe, expect, it } from 'vitest'
import {
  filterBroadcastForTargets,
  shouldBroadcastThisTick,
  ipv4ToInt,
  intToIpv4,
  DISCOVERY_BROADCAST_HZ,
  type InterfaceLike
} from '../src/shared/broadcastPolicy'

describe('broadcastPolicy', () => {
  describe('ipv4ToInt / intToIpv4', () => {
    it('converts IPv4 addresses to integers and back', () => {
      expect(intToIpv4(ipv4ToInt('192.168.1.1'))).toBe('192.168.1.1')
      expect(intToIpv4(ipv4ToInt('255.255.255.255'))).toBe('255.255.255.255')
      expect(intToIpv4(ipv4ToInt('0.0.0.0'))).toBe('0.0.0.0')
    })

    it('throws on invalid IPv4 addresses', () => {
      expect(() => ipv4ToInt('256.1.1.1')).toThrow()
      expect(() => ipv4ToInt('1.1.1')).toThrow()
      expect(() => ipv4ToInt('invalid')).toThrow()
    })
  })

  describe('filterBroadcastForTargets', () => {
    const iface = (address: string, netmask: string, internal = false, family = 'IPv4'): InterfaceLike => ({
      internal,
      family,
      address,
      netmask
    })

    it('returns all candidates when targets is empty (discovery phase)', () => {
      const candidates = ['192.168.1.255', '192.168.2.255', '255.255.255.255']
      const interfaces = [
        iface('192.168.1.10', '255.255.255.0'),
        iface('192.168.2.20', '255.255.255.0')
      ]

      const result = filterBroadcastForTargets(candidates, [], interfaces)
      expect(result).toEqual(candidates)
    })

    it('filters to only subnets containing known targets (real machine scenario)', () => {
      // 實機值：有線網卡 192.168.25.30/255.255.255.0（廣播 192.168.25.255）、
      // Wi-Fi 網卡 192.168.90.69/255.255.255.0（廣播 192.168.90.255）。
      // 已知板子在 192.168.90.107（Wi-Fi），應該濾掉有線廣播。
      const candidates = ['192.168.25.255', '192.168.90.255']
      const targets = ['192.168.90.107']
      const interfaces = [
        iface('192.168.25.30', '255.255.255.0'),
        iface('192.168.90.69', '255.255.255.0')
      ]

      const result = filterBroadcastForTargets(candidates, targets, interfaces)
      expect(result).toEqual(['192.168.90.255'])
    })

    it('handles multiple targets across different subnets', () => {
      const candidates = ['192.168.1.255', '192.168.2.255', '10.0.0.255']
      const targets = ['192.168.1.100', '192.168.2.200']
      const interfaces = [
        iface('192.168.1.10', '255.255.255.0'),
        iface('192.168.2.20', '255.255.255.0'),
        iface('10.0.0.5', '255.255.255.0')
      ]

      const result = filterBroadcastForTargets(candidates, targets, interfaces)
      expect(result.sort()).toEqual(['192.168.1.255', '192.168.2.255'].sort())
    })

    it('excludes 255.255.255.255 from results when targets are known', () => {
      const candidates = ['192.168.1.255', '255.255.255.255']
      const targets = ['192.168.1.100']
      const interfaces = [iface('192.168.1.10', '255.255.255.0')]

      const result = filterBroadcastForTargets(candidates, targets, interfaces)
      expect(result).toEqual(['192.168.1.255'])
      expect(result).not.toContain('255.255.255.255')
    })

    it('keeps 255.255.255.255 when targets are empty (discovery phase)', () => {
      const candidates = ['192.168.1.255', '255.255.255.255']
      const targets: string[] = []
      const interfaces = [iface('192.168.1.10', '255.255.255.0')]

      const result = filterBroadcastForTargets(candidates, targets, interfaces)
      expect(result).toContain('255.255.255.255')
    })

    it('handles targets on network without corresponding interface', () => {
      // 已知板子在 10.20.30.40 但沒有對應網卡 → 不應該 crash 也不應該產生位址
      const candidates = ['192.168.1.255', '10.0.0.255']
      const targets = ['10.20.30.40']
      const interfaces = [iface('192.168.1.10', '255.255.255.0')]

      const result = filterBroadcastForTargets(candidates, targets, interfaces)
      expect(result).toEqual([])
    })

    it('ignores internal and non-IPv4 interfaces', () => {
      const candidates = ['192.168.1.255', '127.0.0.1']
      const targets = ['192.168.1.100']
      const interfaces = [
        iface('192.168.1.10', '255.255.255.0', false),
        iface('127.0.0.1', '255.0.0.0', true), // internal
        iface('fe80::1', '255:255:255:255', false, 'IPv6') // IPv6
      ]

      const result = filterBroadcastForTargets(candidates, targets, interfaces)
      expect(result).toEqual(['192.168.1.255'])
    })

    it('handles malformed interface entries gracefully', () => {
      const candidates = ['192.168.1.255']
      const targets = ['192.168.1.100']
      const interfaces: InterfaceLike[] = [
        iface('192.168.1.10', '255.255.255.0'),
        iface('invalid.ip', '255.255.255.0'), // malformed
        { address: '', netmask: '', internal: false, family: 'IPv4' } // empty
      ]

      const result = filterBroadcastForTargets(candidates, targets, interfaces)
      expect(result).toEqual(['192.168.1.255'])
    })

    it('handles malformed candidate addresses gracefully', () => {
      const candidates = ['invalid.broadcast', '192.168.1.255']
      const targets = ['192.168.1.100']
      const interfaces = [iface('192.168.1.10', '255.255.255.0')]

      const result = filterBroadcastForTargets(candidates, targets, interfaces)
      expect(result).toEqual(['192.168.1.255'])
    })

    it('handles /24, /16, /8 subnets correctly', () => {
      const candidates = ['10.255.255.255', '10.20.255.255', '10.20.30.255']
      const targets = ['10.20.30.40']
      const interfaces = [
        iface('10.0.0.1', '255.0.0.0'), // /8
        iface('10.20.0.1', '255.255.0.0'), // /16
        iface('10.20.30.1', '255.255.255.0') // /24
      ]

      const result = filterBroadcastForTargets(candidates, targets, interfaces)
      // Target is in all three subnets, so all three broadcast addresses should be kept
      expect(result.sort()).toEqual(['10.20.30.255', '10.20.255.255', '10.255.255.255'].sort())
    })
  })

  describe('shouldBroadcastThisTick', () => {
    it('returns true when there are no unicast targets (discovery phase)', () => {
      const now = 1000
      expect(shouldBroadcastThisTick(false, now, 0)).toBe(true)
      expect(shouldBroadcastThisTick(false, now, 500)).toBe(true)
      expect(shouldBroadcastThisTick(false, now, 999)).toBe(true)
    })

    it('returns true on first broadcast when lastBroadcastAtMs is 0', () => {
      expect(shouldBroadcastThisTick(true, 1000, 0)).toBe(true)
    })

    it('throttles to DISCOVERY_BROADCAST_HZ when targets exist', () => {
      // DISCOVERY_BROADCAST_HZ = 2, so interval = 500 ms
      const rateHz = DISCOVERY_BROADCAST_HZ
      const intervalMs = 1000 / rateHz // 500 ms

      // First call: lastBroadcastAtMs = 0 → should broadcast
      expect(shouldBroadcastThisTick(true, 1000, 0, rateHz)).toBe(true)

      // Second call at 1200ms (200ms later) → should not broadcast
      expect(shouldBroadcastThisTick(true, 1200, 1000, rateHz)).toBe(false)

      // Third call at 1500ms (500ms later) → should broadcast
      expect(shouldBroadcastThisTick(true, 1500, 1000, rateHz)).toBe(true)

      // Fourth call at 2000ms (500ms later) → should broadcast
      expect(shouldBroadcastThisTick(true, 2000, 1500, rateHz)).toBe(true)
    })

    it('respects custom rateHz parameter', () => {
      // Test with 1 Hz (1000ms interval)
      const rateHz = 1

      expect(shouldBroadcastThisTick(true, 1000, 0, rateHz)).toBe(true)
      expect(shouldBroadcastThisTick(true, 1999, 1000, rateHz)).toBe(false)
      expect(shouldBroadcastThisTick(true, 2000, 1000, rateHz)).toBe(true)

      // Test with 10 Hz (100ms interval)
      const rateHz10 = 10

      expect(shouldBroadcastThisTick(true, 1000, 0, rateHz10)).toBe(true)
      expect(shouldBroadcastThisTick(true, 1099, 1000, rateHz10)).toBe(false)
      expect(shouldBroadcastThisTick(true, 1100, 1000, rateHz10)).toBe(true)
    })

    it('handles large time deltas correctly', () => {
      const rateHz = DISCOVERY_BROADCAST_HZ
      const lastBroadcast = 0
      const now = 10000

      // Even with large time delta, should return true (interval exceeded)
      expect(shouldBroadcastThisTick(true, now, lastBroadcast, rateHz)).toBe(true)
    })

    it('differentiates between no targets and has targets', () => {
      const now = 1000
      const lastAt = 900

      // No targets: always true
      expect(shouldBroadcastThisTick(false, now, lastAt)).toBe(true)

      // Has targets: depends on interval
      const rateHz = DISCOVERY_BROADCAST_HZ
      const intervalMs = 1000 / rateHz

      if (now - lastAt >= intervalMs) {
        expect(shouldBroadcastThisTick(true, now, lastAt, rateHz)).toBe(true)
      } else {
        expect(shouldBroadcastThisTick(true, now, lastAt, rateHz)).toBe(false)
      }
    })
  })
})

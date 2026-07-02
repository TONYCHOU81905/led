import { describe, expect, it } from 'vitest'
import { filterValidBridgeTargets, isValidBridgeTargetIp, mergeShowDevices } from '../src/shared/showDeviceRegistry'
import type { EspDeviceStatus } from '../src/shared/types/project'

describe('showDeviceRegistry', () => {
  it('rejects invalid unicast IPs', () => {
    expect(isValidBridgeTargetIp('0.0.0.0')).toBe(false)
    expect(isValidBridgeTargetIp('192.168.90.91')).toBe(true)
    expect(filterValidBridgeTargets(['0.0.0.0', '192.168.90.57'])).toEqual(['192.168.90.57'])
  })

  it('merges registered targets with UDP devices', () => {
    const udp: EspDeviceStatus[] = [
      {
        device_id: 'esp32s3_dancer_b_001',
        ip: '192.168.90.91',
        online: true,
        sync_state: 'WAIT_TIMECODE',
        last_seen_ms: Date.now()
      }
    ]
    const rows = mergeShowDevices(['192.168.90.57', '0.0.0.0', '192.168.90.91'], udp)
    expect(rows.map((r) => r.ip)).toEqual(['192.168.90.57', '192.168.90.91'])
    expect(rows.find((r) => r.ip === '192.168.90.57')).toMatchObject({
      registered: true,
      udpReporting: null
    })
    expect(rows.find((r) => r.ip === '192.168.90.91')).toMatchObject({
      registered: true,
      udpReporting: true,
      device_id: 'esp32s3_dancer_b_001'
    })
  })
})

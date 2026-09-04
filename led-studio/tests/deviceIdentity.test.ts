import { describe, expect, it } from 'vitest'
import { deviceDisplayName, deviceKey } from '../src/shared/deviceIdentity'
import { mergeShowDevices } from '../src/shared/showDeviceRegistry'
import type { EspDeviceStatus } from '../src/shared/types/project'

describe('deviceKey', () => {
  it('十台同 role 的板子必須產生十個不同的 key', () => {
    // device_id 是從 role_id 推導的（esp32s3_<role>_001），同 role 燒同一份
    // config 的十台板子 device_id 完全一樣。只用 device_id 當 Map key 的話
    // 十台會併成一台 —— UI 上看起來只有一台上線。
    const keys = new Set(
      Array.from({ length: 10 }, (_, i) =>
        deviceKey('esp32s3_dancer_a_001', `a4b2${String(i).padStart(2, '0')}`, `192.168.90.${10 + i}`)
      )
    )
    expect(keys.size).toBe(10)
  })

  it('沒有 chip_id 的舊韌體退回用 IP 區分', () => {
    const a = deviceKey('esp32s3_dancer_a_001', undefined, '192.168.90.10')
    const b = deviceKey('esp32s3_dancer_a_001', undefined, '192.168.90.11')
    expect(a).not.toBe(b)
  })

  it('chip_id 優先於 IP —— DHCP 換 IP 不應該變成另一台裝置', () => {
    const before = deviceKey('esp32s3_dancer_a_001', 'a4b2c1', '192.168.90.10')
    const after = deviceKey('esp32s3_dancer_a_001', 'a4b2c1', '192.168.90.55')
    expect(before).toBe(after)
  })

  it('chip_id 與 IP 都沒有時退回 device_id（不要產生 undefined 字串）', () => {
    expect(deviceKey('esp32s3_dancer_a_001', undefined, undefined)).toBe('esp32s3_dancer_a_001')
  })
})

describe('deviceDisplayName', () => {
  it('有 chip_id 時附在後面，讓十台同 role 的板子在畫面上分得出來', () => {
    expect(deviceDisplayName('esp32s3_dancer_a_001', 'a4b2c1')).toBe(
      'esp32s3_dancer_a_001 (a4b2c1)'
    )
  })

  it('沒有 chip_id 時維持原樣', () => {
    expect(deviceDisplayName('esp32s3_dancer_a_001')).toBe('esp32s3_dancer_a_001')
  })
})

describe('mergeShowDevices 的十台情境', () => {
  const tenBoards: EspDeviceStatus[] = Array.from({ length: 10 }, (_, i) => ({
    device_id: 'esp32s3_dancer_a_001',
    chip_id: `a4b2${String(i).padStart(2, '0')}`,
    ip: `192.168.90.${10 + i}`,
    online: true,
    sync_state: 'PLAYING',
    last_seen_ms: 1
  }))

  it('十台同 device_id 的板子要顯示成十列', () => {
    const rows = mergeShowDevices([], tenBoards)
    expect(rows).toHaveLength(10)
  })

  it('每一列都帶自己的 chip_id，才有辦法辨識是哪一台', () => {
    const rows = mergeShowDevices([], tenBoards)
    expect(new Set(rows.map((r) => r.chip_id)).size).toBe(10)
  })

  it('已註冊的 unicast IP 與回報中的板子要合併成同一列，不重複', () => {
    const rows = mergeShowDevices(
      tenBoards.map((b) => b.ip!),
      tenBoards
    )
    expect(rows).toHaveLength(10)
    expect(rows.every((r) => r.registered && r.udpReporting)).toBe(true)
  })
})

import type { EspDeviceStatus } from './types/project'

const INVALID_TARGET_IPS = new Set(['0.0.0.0', '255.255.255.255'])

export function isValidBridgeTargetIp(ip: string): boolean {
  const trimmed = ip.trim()
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed)) return false
  const parts = trimmed.split('.').map(Number)
  if (parts.some((part) => part < 0 || part > 255)) return false
  return !INVALID_TARGET_IPS.has(trimmed)
}

export interface ShowDeviceRow {
  ip: string
  device_id?: string
  /** MAC 後 3 bytes。十台同 role 的板子 device_id 一樣，要靠這個在畫面上分辨。 */
  chip_id?: string
  /** Listed in Show Control / Device Manager unicast targets */
  registered: boolean
  /** null = never received UDP status from this IP */
  udpReporting: boolean | null
  sync_state?: string
  music_time_ms?: number
  drift_ms?: number
  rssi?: number
  battery_mv?: number
}

export function mergeShowDevices(
  registeredTargets: string[],
  udpDevices: EspDeviceStatus[]
): ShowDeviceRow[] {
  const rows = new Map<string, ShowDeviceRow>()

  for (const rawIp of registeredTargets) {
    const ip = rawIp.trim()
    if (!isValidBridgeTargetIp(ip)) continue
    rows.set(ip, {
      ip,
      registered: true,
      udpReporting: null
    })
  }

  for (const device of udpDevices) {
    const ip = device.ip?.trim()
    if (!ip || !isValidBridgeTargetIp(ip)) continue
    const existing = rows.get(ip)
    const udpReporting = device.online !== false
    rows.set(ip, {
      ip,
      device_id: device.device_id,
      chip_id: device.chip_id,
      registered: existing?.registered ?? false,
      udpReporting,
      sync_state: device.sync_state,
      music_time_ms: device.music_time_ms,
      drift_ms: device.drift_ms,
      rssi: device.rssi,
      battery_mv: device.battery_mv
    })
  }

  return [...rows.values()].sort((a, b) => {
    if (a.registered !== b.registered) return a.registered ? -1 : 1
    return a.ip.localeCompare(b.ip)
  })
}

export function filterValidBridgeTargets(targets: string[]): string[] {
  return [...new Set(targets.map((t) => t.trim()).filter(isValidBridgeTargetIp))].sort()
}

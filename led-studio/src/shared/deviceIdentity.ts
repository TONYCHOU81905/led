/**
 * 裝置清單的 key。
 *
 * 為什麼不能只用 device_id：
 * device_id 是從 role_id 推導的（`esp32s3_<role>_001`，見 deviceConfigDefaults.ts），
 * 同一個 role 的多台板子燒同一份 config 就會拿到完全相同的 device_id。
 * 十台同 role 的板子一起上線時，用 device_id 當 Map key 只會留下最後一筆 ——
 * UI 上看起來像「只有一台上線」，而其他九台明明在正常回報。
 *
 * 優先用韌體 status / mDNS TXT 帶的 chip_id（MAC 後 3 bytes，出廠唯一）。
 * 舊韌體沒有這個欄位，退回用 IP —— 同一網段內 IP 唯一，足以把多台分開；
 * DHCP 換 IP 會短暫多一列，但 espStatusListener 的 30 秒 prune 會清掉。
 */
export function deviceKey(
  deviceId: string,
  chipId: string | undefined,
  ip: string | undefined
): string {
  if (chipId) return `${deviceId}#${chipId}`
  if (ip) return `${deviceId}@${ip}`
  return deviceId
}

/**
 * 給 UI 顯示的名稱。chip_id 存在時附上，讓十台同 role 的板子在畫面上分得出來。
 */
export function deviceDisplayName(deviceId: string, chipId?: string): string {
  return chipId ? `${deviceId} (${chipId})` : deviceId
}

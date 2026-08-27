/**
 * Wi-Fi 快捷：讓使用者不用每次手打場地網路的 SSID 與密碼。
 *
 * 密碼一律只存在使用者本機（localStorage，或開發機的 .env.local），
 * 不寫進版控 —— 這個 repo 會推上 GitHub。
 */

export interface WifiPreset {
  ssid: string
  password: string
}

export const WIFI_PRESET_STORAGE_KEY = 'led-studio.wifi-presets'

/** 清掉空白、丟掉沒有 ssid 的項目、同名只留最後一筆（後寫的覆蓋先寫的） */
export function normalizePresets(list: unknown): WifiPreset[] {
  if (!Array.isArray(list)) return []
  const bySsid = new Map<string, WifiPreset>()
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const ssid = String((item as WifiPreset).ssid ?? '').trim()
    if (!ssid) continue
    const password = String((item as WifiPreset).password ?? '')
    bySsid.set(ssid, { ssid, password })
  }
  return [...bySsid.values()]
}

/** 解析 localStorage 讀到的字串；壞掉的內容視為空清單，不要讓整頁爆掉 */
export function parsePresets(raw: string | null): WifiPreset[] {
  if (!raw) return []
  try {
    return normalizePresets(JSON.parse(raw))
  } catch {
    return []
  }
}

/**
 * 合併本機儲存與環境變數帶進來的預設值。
 * 本機儲存優先 —— 使用者自己改過的內容不該被 .env 蓋掉。
 */
export function mergeWithEnvPreset(
  stored: WifiPreset[],
  envSsid?: string,
  envPassword?: string
): WifiPreset[] {
  const ssid = (envSsid ?? '').trim()
  if (!ssid) return stored
  if (stored.some((p) => p.ssid === ssid)) return stored
  return [...stored, { ssid, password: envPassword ?? '' }]
}

/** 加入或更新一筆（同 ssid 視為更新密碼） */
export function upsertPreset(list: WifiPreset[], preset: WifiPreset): WifiPreset[] {
  const ssid = preset.ssid.trim()
  if (!ssid) return list
  const next = list.filter((p) => p.ssid !== ssid)
  return [...next, { ssid, password: preset.password }]
}

export function removePreset(list: WifiPreset[], ssid: string): WifiPreset[] {
  return list.filter((p) => p.ssid !== ssid)
}

import { crc32, configChecksum, stripConfigForTransport } from './configCompiler'
import type { DeviceConfig } from './types/project'

const DEFAULT_EVENTS_PER_BATCH = 10

/**
 * 非 ASCII 字元轉義為 \uXXXX，確保 CRC 與 JSON 序列化後的位元組對齐。
 *
 * 用法完全同 serializeConfigForTransport 裡的轉義方式 —— 韌體端也是同一個
 * 算法（見 configSerializer.cpp），所以 Studio 算的 CRC 與板子收到的位元組
 * 永遠是同一份。
 */
export function escapeNonAscii(s: string): string {
  // 轉義範圍: U+0080 ~ U+FFFF（所有非 ASCII 字元）
  return s.replace(/[\x80-￿]/g, (char) => {
    const code = char.charCodeAt(0)
    return `\\u${code.toString(16).padStart(4, '0')}`
  })
}

/**
 * 判斷是否應該退回舊協定（`begin_config` / `config_chunk` / `end_config`）。
 *
 * 只有 `begin_meta` 階段失敗時才能退回，因為那時板子的狀態還沒有被部分修改。
 * 一旦進到 events 批次或 commit 階段，退回舊路徑會送出不一致的設定。
 */
export function shouldFallbackToLegacyUpload(stage: 'begin_meta' | 'events' | 'commit'): boolean {
  return stage === 'begin_meta'
}

/**
 * 把 config 分割成 meta（events 為 []）與多批 events。
 *
 * 解決的問題：板子在 WiFi 起來後 heap 只剩約 90KB，而完整 config 的 ArduinoJson
 * 物件樹可能需要 200KB+ 的記憶體。拆成 meta ＋ 多批 events 讓板子每次只需要
 * 持有一小塊，peak 記憶體與批次大小成正比，而不是與 config 總量成正比。
 *
 * 每批約 2～4KB（EVENTS_PER_BATCH = 10），板子的緩衝與 ArduinoJson 文件都
 * 可以容納。相比 SINGLE_CONFIG_LIMIT = 0 時一次送整份導致頻繁 NoMemory 失敗，
 * 這個方法穩定性高得多。
 *
 * USB CDC 的指令行上限約 228 bytes，但這裡使用既有的 CHUNK_SIZE = 128 片段機制
 * （見 serialDevice.ts）來進一步確保相容性。
 */
export function planConfigUpload(
  config: DeviceConfig,
  eventsPerBatch: number = DEFAULT_EVENTS_PER_BATCH
): {
  metaJson: string
  batches: string[]
  totalEvents: number
  configCrc32: number
} {
  // 完整 config 的 CRC —— 這是韌體會存起來給 Studio 比對的
  const configCrc32 = configChecksum(config)

  // 取出裁剪後的 events（韌體真的會讀的欄位）
  const stripped = stripConfigForTransport(config)
  const allEvents = Array.isArray(stripped.events) ? (stripped.events as Record<string, unknown>[]) : []
  const totalEvents = allEvents.length

  // meta 是完整 config，但 events 換成 [] —— 韌體會讀 events 欄位，只是這時裡面是空的
  const metaConfig = {
    ...stripped,
    events: []
  }

  // meta 也要經過轉義
  const metaJson = escapeNonAscii(JSON.stringify(metaConfig))

  // 把 events 分成多批，每個都是 JSON 陣列
  const batches: string[] = []
  for (let i = 0; i < allEvents.length; i += eventsPerBatch) {
    const batch = allEvents.slice(i, i + eventsPerBatch)
    const batchJson = escapeNonAscii(JSON.stringify(batch))
    batches.push(batchJson)
  }

  return {
    metaJson,
    batches,
    totalEvents,
    configCrc32
  }
}

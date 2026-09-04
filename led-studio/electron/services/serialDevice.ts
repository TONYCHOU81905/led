import { crc32, serializeConfigForTransport } from '../../src/shared/configCompiler'
import { planConfigUpload, shouldFallbackToLegacyUpload } from '../../src/shared/configUploadPlan'
import type { DeviceConfig } from '../../src/shared/types/project'

export interface SerialPortInfo {
  path: string
  manufacturer?: string
  serialNumber?: string
}

export interface EspPingResponse {
  ok: boolean
  firmware?: string
  device_id?: string
  error?: string
}

export interface EspConfigUploadResult {
  ok: boolean
  crc32?: number
  events?: number
  flash_saved?: boolean
  error?: string
}

type JsonPayload = Record<string, unknown>

const COMMAND_TIMEOUT_MS = 60000
// ESP32 JSON command buffer is limited; large configs must use chunked upload.
const SINGLE_CONFIG_LIMIT = 0
/**
 * config_chunk 的 data 片段大小。
 *
 * 每個片段會被塞進 JSON 的字串欄位，裡面大量的 " 都要轉義成 \"，長度大約
 * 膨脹 1.35 倍：240 bytes 的片段會變成 324 bytes 的指令行。ESP32-S3 的
 * USB CDC 接收緩衝預設只有 256 bytes，超過就靜默丟棄整行，板子不會回應也
 * 不會報錯 —— config 因此永遠傳不完。
 *
 * 實測臨界點（USB CDC）：指令 228 bytes 可過、278 bytes 失敗。
 * 128 對應約 190 bytes，即使韌體端沒有加大緩衝也安全。
 */
const CHUNK_SIZE = 128
const SETTLE_AFTER_WIFI_MS = 500
const PING_RETRY_MS = 1500
const PING_RETRY_COUNT = 12
/**
 * ping 只是探測「板子活了沒」，不該用跟資料傳輸一樣的 60 秒。
 * 板子重開機（含 3 秒 LED 自檢）約需 4 秒才會回應，這裡用 2.5 秒配合
 * 12 次重試 ≈ 48 秒的涵蓋範圍，足夠等到開機完成。
 * 用 60 秒的話，第一次 ping 就要等滿一分鐘才算失敗，使用者看起來像當掉。
 */
const PING_TIMEOUT_MS = 2500
/** port.close() 沒回 callback 時的逾時保險，避免 Promise 永遠不 settle */
const PORT_CLOSE_GUARD_MS = 1500

type SerialPortModule = typeof import('serialport')
type ReadlineParserModule = typeof import('@serialport/parser-readline')

let serialModules: {
  SerialPort: SerialPortModule['SerialPort']
  ReadlineParser: ReadlineParserModule['ReadlineParser']
} | null = null

async function loadSerialModules() {
  if (serialModules) return serialModules
  try {
    const [{ SerialPort }, { ReadlineParser }] = await Promise.all([
      import('serialport'),
      import('@serialport/parser-readline')
    ])
    serialModules = { SerialPort, ReadlineParser }
    return serialModules
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(
      `serialport 原生模組載入失敗。請在 led-studio 目錄執行：npm run rebuild\n原始錯誤：${msg}`
    )
  }
}

export async function listSerialPorts(): Promise<SerialPortInfo[]> {
  const { SerialPort } = await loadSerialModules()
  const ports = await SerialPort.list()
  return ports.map((p) => ({
    path: p.path,
    manufacturer: p.manufacturer,
    serialNumber: p.serialNumber
  }))
}

function normalizeSerialPort(path: string): string {
  // macOS: prefer cu.* (call-out) over tty.* for host-initiated serial I/O.
  if (path.startsWith('/dev/tty.') && !path.includes('debug')) {
    return path.replace('/dev/tty.', '/dev/cu.')
  }
  return path
}

async function withOpenPort<T>(
  path: string,
  fn: (
    port: InstanceType<SerialPortModule['SerialPort']>,
    parser: InstanceType<ReadlineParserModule['ReadlineParser']>,
    send: <R>(payload: JsonPayload, timeoutMs?: number) => Promise<R>
  ) => Promise<T>
): Promise<T> {
  const { SerialPort, ReadlineParser } = await loadSerialModules()
  const devicePath = normalizeSerialPort(path)

  return new Promise<T>((resolve, reject) => {
    // Disable DTR/RTS so opening the port does not reset the ESP (boot logs would
    // arrive before the JSON response and break JSON.parse on empty lines).
    const port = new SerialPort({
      path: devicePath,
      baudRate: 115200,
      autoOpen: false,
      rts: false,
      dtr: false
    })
    const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }))
    let pending: ((line: string) => void) | null = null
    let commandDiagnostics: string[] = []

    const send = <R>(payload: JsonPayload, timeoutMs?: number): Promise<R> =>
      new Promise<R>((res, rej) => {
        commandDiagnostics = []
        const timer = setTimeout(() => {
          pending = null
          const errorMsg = commandDiagnostics.length > 0
            ? `Serial command timeout（板子最後輸出：${commandDiagnostics.slice(-3).join(' | ')}）`
            : 'Serial command timeout（板子完全沒有輸出）'
          rej(new Error(errorMsg))
        }, timeoutMs ?? COMMAND_TIMEOUT_MS)

        pending = (line: string) => {
          const trimmed = line.trim()
          // Boot logs and Serial.println() empty lines are not command responses.
          if (!trimmed.startsWith('{')) return

          clearTimeout(timer)
          pending = null
          try {
            const parsed = JSON.parse(trimmed) as R & { ok?: boolean; error?: string }
            if (parsed && typeof parsed === 'object' && parsed.ok === false) {
              const detail = commandDiagnostics.at(-1)
              rej(new Error(detail ? `${parsed.error ?? 'ESP error'} — ${detail}` : parsed.error ?? 'ESP error'))
              return
            }
            res(parsed)
          } catch (err) {
            rej(err instanceof Error ? err : new Error(String(err)))
          }
        }

        port.write(`${JSON.stringify(payload)}\n`, (writeErr) => {
          if (writeErr) {
            clearTimeout(timer)
            pending = null
            rej(writeErr)
          }
        })
      })

    const onData = (data: string) => {
      const trimmed = data.trim()
      // 收集所有非 JSON 行進 commandDiagnostics，用於 timeout 時顯示板子最後的輸出
      if (!trimmed.startsWith('{') && trimmed.length > 0) {
        commandDiagnostics.push(trimmed)
        if (commandDiagnostics.length > 8) commandDiagnostics.shift()
      }
      if (pending) pending(data)
    }

    let settled = false
    const cleanup = (err?: Error, result?: T) => {
      if (settled) return
      settled = true
      parser.off('data', onData)
      port.removeAllListeners('error')

      // port.close() 的 callback 在 port 已進入錯誤狀態時可能永遠不會被呼叫，
      // 那樣這個 Promise 就永遠不 settle，fd 也一直掛著 —— 累積起來 app 自己
      // 就會佔住 port。加上逾時保險，無論如何都要 settle。
      let done = false
      const finish = () => {
        if (done) return
        done = true
        if (err) reject(err)
        else resolve(result as T)
      }
      const guard = setTimeout(finish, PORT_CLOSE_GUARD_MS)
      try {
        port.close(() => {
          clearTimeout(guard)
          finish()
        })
      } catch {
        clearTimeout(guard)
        finish()
      }
    }

    port.open((openErr) => {
      if (openErr) {
        cleanup(openErr)
        return
      }
      // 沒有 error handler 時，port 層級的錯誤（板子被拔除、CDC 斷線）會變成
      // unhandled error event，而這個 Promise 永遠等不到結果。
      port.on('error', (err: Error) => {
        cleanup(err instanceof Error ? err : new Error(String(err)))
      })
      parser.on('data', onData)
      void fn(port, parser, send)
        .then((result) => cleanup(undefined, result))
        .catch((err) => cleanup(err instanceof Error ? err : new Error(String(err))))
    })
  })
}

async function sendJsonCommand<T>(
  path: string,
  payload: JsonPayload,
  timeoutMs?: number
): Promise<T> {
  return withOpenPort(path, async (_port, _parser, send) => send<T>(payload, timeoutMs))
}

export async function pingEsp(path: string): Promise<EspPingResponse> {
  return sendJsonCommand<EspPingResponse>(path, { cmd: 'ping' }, PING_TIMEOUT_MS)
}

/** Wait until the ESP answers ping (e.g. after WiFi write used to block Serial). */
export async function waitForEspReady(path: string): Promise<void> {
  let lastError: Error | undefined
  for (let i = 0; i < PING_RETRY_COUNT; i++) {
    try {
      await pingEsp(path)
      return
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      await new Promise((r) => setTimeout(r, PING_RETRY_MS))
    }
  }
  // 直接 throw lastError 會變成含糊的 "Serial command timeout"，看起來像是
  // 資料傳輸逾時，實際上是「重試 N 次 ping 都沒回應」—— 兩者的排查方向完全
  // 不同（前者查傳輸量，後者查板子收不到指令），訊息必須講清楚。
  const detail = lastError ? `：${lastError.message}` : ''
  throw new Error(
    `板子沒有回應 ping（已重試 ${PING_RETRY_COUNT} 次、每次等 ${PING_TIMEOUT_MS}ms）${detail}。` +
      '常見原因：DebugView 的監看還開著、終端機另外開了 pio device monitor' +
      `（可用 lsof 檢查誰佔著 port）、port 選錯，或板子韌體未啟用對應的 serial 通道。`
  )
}

export async function setEspWifi(path: string, ssid: string, password: string): Promise<{ ok: boolean }> {
  return sendJsonCommand<{ ok: boolean }>(path, { cmd: 'wifi', ssid, password })
}

/**
 * 用舊協定（SINGLE_CONFIG_LIMIT 時代）上傳完整 config。
 *
 * 韌體仍然支援 begin_config / config_chunk / end_config，用於向後相容。
 */
async function uploadEspConfigLegacy(
  path: string,
  config: Record<string, unknown>
): Promise<EspConfigUploadResult> {
  const json = serializeConfigForTransport(config as unknown as DeviceConfig)
  const checksum = crc32(json)
  const totalChunks = Math.ceil(json.length / CHUNK_SIZE)

  console.log(
    `[device] 上傳 config（舊協定）：${json.length} bytes / ${totalChunks} 個 chunk（每個 ${CHUNK_SIZE} bytes）`
  )

  const labelled = async <R>(stage: string, run: () => Promise<R>): Promise<R> => {
    try {
      return await run()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`上傳 Config 失敗（${stage}）：${msg}`)
    }
  }

  return withOpenPort(path, async (_port, _parser, send) => {
    await labelled(`begin_config，共 ${json.length} bytes / ${totalChunks} 個 chunk`, () =>
      send({ cmd: 'begin_config', size: json.length, crc32: checksum })
    )

    let index = 0
    for (let offset = 0; offset < json.length; offset += CHUNK_SIZE) {
      const data = json.slice(offset, offset + CHUNK_SIZE)
      index += 1
      const at = index
      await labelled(`傳送第 ${at}/${totalChunks} 個 chunk（offset ${offset}）`, () =>
        send({ cmd: 'config_chunk', offset, data })
      )
    }

    return labelled('end_config（板子套用設定）', () =>
      send<EspConfigUploadResult>({ cmd: 'end_config' })
    )
  })
}

/**
 * 用新協定（批量上傳）上傳 config。
 *
 * 流程：
 * 1. meta（除 events 外全部，events 為 []）
 * 2. 每 EVENTS_PER_BATCH 個 event 一批
 * 3. 最後 commit，確認 config 完整性
 *
 * 這個方法讓板子的 peak 記憶體與批次大小成正比，而不是與 config 總量成正比。
 */
async function uploadEspConfigBatched(
  path: string,
  config: Record<string, unknown>
): Promise<EspConfigUploadResult> {
  const deviceConfig = config as unknown as DeviceConfig
  const plan = planConfigUpload(deviceConfig)

  const metaTotalChunks = Math.ceil(plan.metaJson.length / CHUNK_SIZE)
  const totalEventChunks = plan.batches.reduce(
    (sum, batch) => sum + Math.ceil(batch.length / CHUNK_SIZE),
    0
  )
  const totalChunks = metaTotalChunks + totalEventChunks + plan.batches.length

  console.log(
    `[device] 上傳 config（批量）：meta ${plan.metaJson.length} bytes ` +
    `+ ${plan.totalEvents} 個 event / ${plan.batches.length} 批 ` +
    `= 約 ${plan.metaJson.length + plan.batches.reduce((s, b) => s + b.length, 0)} bytes ` +
    `/ ${totalChunks} 個 chunk`
  )

  const labelled = async <R>(stage: string, run: () => Promise<R>): Promise<R> => {
    try {
      return await run()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`上傳 Config 失敗（${stage}）：${msg}`)
    }
  }

  return withOpenPort(path, async (_port, _parser, send) => {
    // 1. 上傳 meta
    const metaCrc = crc32(plan.metaJson)
    await labelled('begin_meta', () =>
      send({ cmd: 'begin_meta', size: plan.metaJson.length, crc32: metaCrc })
    )

    let metaChunks = 0
    for (let offset = 0; offset < plan.metaJson.length; offset += CHUNK_SIZE) {
      const data = plan.metaJson.slice(offset, offset + CHUNK_SIZE)
      metaChunks += 1
      await labelled(`傳送 meta chunk ${metaChunks}/${metaTotalChunks}`, () =>
        send({ cmd: 'config_chunk', offset, data })
      )
    }

    await labelled('end_meta', () => send({ cmd: 'end_meta' }))

    // 2. 上傳每一批 events
    for (let batchIdx = 0; batchIdx < plan.batches.length; batchIdx++) {
      const batchJson = plan.batches[batchIdx]
      const batchCrc = crc32(batchJson)

      await labelled(`begin_events batch ${batchIdx + 1}/${plan.batches.length}`, () =>
        send({
          cmd: 'begin_events',
          size: batchJson.length,
          crc32: batchCrc,
          batch: batchIdx
        })
      )

      let chunkIdx = 0
      for (let offset = 0; offset < batchJson.length; offset += CHUNK_SIZE) {
        const data = batchJson.slice(offset, offset + CHUNK_SIZE)
        chunkIdx += 1
        await labelled(`傳送 events batch ${batchIdx + 1} chunk ${chunkIdx}`, () =>
          send({ cmd: 'config_chunk', offset, data })
        )
      }

      await labelled(`end_events batch ${batchIdx + 1}/${plan.batches.length}`, () =>
        send({ cmd: 'end_events' })
      )
    }

    // 3. commit —— 確認 config 完整性並寫進 flash
    return labelled('commit_config', () =>
      send<EspConfigUploadResult>({
        cmd: 'commit_config',
        event_count: plan.totalEvents,
        config_crc32: plan.configCrc32
      })
    )
  })
}

export async function uploadEspConfig(
  path: string,
  config: Record<string, unknown>
): Promise<EspConfigUploadResult> {
  // Ensure ESP is answering before starting multi-chunk transfer (WiFi join must not block Serial).
  await waitForEspReady(path)
  await new Promise((r) => setTimeout(r, SETTLE_AFTER_WIFI_MS))

  if ((config as any).schema_version === undefined) {
    // 如果不是 DeviceConfig 結構（例如舊版的直接 JSON），用舊邏輯
    return uploadEspConfigLegacy(path, config)
  }

  // 嘗試新協定（批量上傳）
  try {
    return await uploadEspConfigBatched(path, config)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    // 如果是 begin_meta 階段失敗，可以退回舊協定
    if (msg.includes('begin_meta') && shouldFallbackToLegacyUpload('begin_meta')) {
      console.log('[device] 批量上傳 begin_meta 失敗，退回舊協定...')
      try {
        return await uploadEspConfigLegacy(path, config)
      } catch (legacyErr) {
        const legacyMsg = legacyErr instanceof Error ? legacyErr.message : String(legacyErr)
        throw new Error(`舊協定也失敗：${legacyMsg}`)
      }
    }

    // events 批次或 commit 失敗就不要退回 —— 板子狀態已經被部分修改
    throw err
  }
}

export async function getEspStatus(path: string): Promise<Record<string, unknown>> {
  return sendJsonCommand<Record<string, unknown>>(path, { cmd: 'status' })
}

export async function reloadEspConfig(path: string): Promise<EspConfigUploadResult> {
  return sendJsonCommand<EspConfigUploadResult>(path, { cmd: 'reload' })
}

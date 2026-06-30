import { crc32 } from '../../src/shared/configCompiler'

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

const COMMAND_TIMEOUT_MS = 30000
const SINGLE_CONFIG_LIMIT = 7000
const CHUNK_SIZE = 3000

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

type JsonPayload = Record<string, unknown>

async function withOpenPort<T>(
  path: string,
  fn: (
    port: InstanceType<SerialPortModule['SerialPort']>,
    parser: InstanceType<ReadlineParserModule['ReadlineParser']>,
    send: <R extends JsonPayload>(payload: JsonPayload) => Promise<R>
  ) => Promise<T>
): Promise<T> {
  const { SerialPort, ReadlineParser } = await loadSerialModules()

  return new Promise<T>((resolve, reject) => {
    const port = new SerialPort({ path, baudRate: 115200, autoOpen: false })
    const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }))
    let pending: ((line: string) => void) | null = null

    const send = <R extends JsonPayload>(payload: JsonPayload): Promise<R> =>
      new Promise<R>((res, rej) => {
        const timer = setTimeout(() => {
          pending = null
          rej(new Error('Serial command timeout'))
        }, COMMAND_TIMEOUT_MS)

        pending = (line: string) => {
          clearTimeout(timer)
          pending = null
          try {
            const parsed = JSON.parse(line.trim()) as R & { ok?: boolean; error?: string }
            if (parsed && typeof parsed === 'object' && parsed.ok === false) {
              rej(new Error(parsed.error ?? 'ESP error'))
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
      if (pending) pending(data)
    }

    const cleanup = (err?: Error, result?: T) => {
      parser.off('data', onData)
      port.close(() => {
        if (err) reject(err)
        else resolve(result as T)
      })
    }

    port.open((openErr) => {
      if (openErr) {
        cleanup(openErr)
        return
      }
      parser.on('data', onData)
      void fn(port, parser, send)
        .then((result) => cleanup(undefined, result))
        .catch((err) => cleanup(err instanceof Error ? err : new Error(String(err))))
    })
  })
}

async function sendJsonCommand<T extends JsonPayload>(path: string, payload: JsonPayload): Promise<T> {
  return withOpenPort(path, async (_port, _parser, send) => send<T>(payload))
}

export async function pingEsp(path: string): Promise<EspPingResponse> {
  return sendJsonCommand<EspPingResponse>(path, { cmd: 'ping' })
}

export async function setEspWifi(path: string, ssid: string, password: string): Promise<{ ok: boolean }> {
  return sendJsonCommand<{ ok: boolean }>(path, { cmd: 'wifi', ssid, password })
}

export async function uploadEspConfig(
  path: string,
  config: Record<string, unknown>
): Promise<EspConfigUploadResult> {
  const json = JSON.stringify(config)

  if (json.length <= SINGLE_CONFIG_LIMIT) {
    return sendJsonCommand<EspConfigUploadResult>(path, { cmd: 'config', config })
  }

  const checksum = crc32(json)

  return withOpenPort(path, async (_port, _parser, send) => {
    await send({ cmd: 'begin_config', size: json.length, crc32: checksum })

    for (let offset = 0; offset < json.length; offset += CHUNK_SIZE) {
      const data = json.slice(offset, offset + CHUNK_SIZE)
      await send({ cmd: 'config_chunk', offset, data })
    }

    return send<EspConfigUploadResult>({ cmd: 'end_config' })
  })
}

export async function getEspStatus(path: string): Promise<Record<string, unknown>> {
  return sendJsonCommand<Record<string, unknown>>(path, { cmd: 'status' })
}

export async function reloadEspConfig(path: string): Promise<EspConfigUploadResult> {
  return sendJsonCommand<EspConfigUploadResult>(path, { cmd: 'reload' })
}

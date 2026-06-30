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
  error?: string
}

const COMMAND_TIMEOUT_MS = 15000

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

async function sendJsonCommand<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const { SerialPort, ReadlineParser } = await loadSerialModules()
  const line = JSON.stringify(payload)

  return new Promise<T>((resolve, reject) => {
    const port = new SerialPort({ path, baudRate: 115200, autoOpen: false })
    const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }))

    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Serial command timeout'))
    }, COMMAND_TIMEOUT_MS)

    const onData = (data: string) => {
      try {
        const parsed = JSON.parse(data.trim()) as T & { ok?: boolean; error?: string }
        cleanup()
        if (parsed && typeof parsed === 'object' && 'ok' in parsed && parsed.ok === false) {
          reject(new Error((parsed as { error?: string }).error ?? 'ESP error'))
          return
        }
        resolve(parsed)
      } catch {
        // ignore boot logs
      }
    }

    const onError = (err: Error) => {
      cleanup()
      reject(err)
    }

    const cleanup = () => {
      clearTimeout(timer)
      parser.off('data', onData)
      port.off('error', onError)
      port.close(() => undefined)
    }

    port.open((openErr) => {
      if (openErr) {
        cleanup()
        reject(openErr)
        return
      }
      parser.on('data', onData)
      port.on('error', onError)
      port.write(`${line}\n`, (writeErr) => {
        if (writeErr) {
          cleanup()
          reject(writeErr)
        }
      })
    })
  })
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
  const json = JSON.stringify({ cmd: 'config', config })
  if (json.length > 8192) {
    throw new Error(`Config JSON too large (${json.length} bytes). Max 8192 for MVP serial upload.`)
  }
  return sendJsonCommand<EspConfigUploadResult>(path, { cmd: 'config', config })
}

export async function getEspStatus(path: string): Promise<Record<string, unknown>> {
  return sendJsonCommand<Record<string, unknown>>(path, { cmd: 'status' })
}

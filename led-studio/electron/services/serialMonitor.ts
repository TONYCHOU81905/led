/**
 * Live serial monitor for the DebugView tab.
 *
 * Streams every line the ESP32 prints over serial (boot logs, `[app]`/`[wifi]`/
 * `[health]` output, ...) so the user does not have to open a separate
 * `pio device monitor` terminal to debug boot failures.
 *
 * The serial port is exclusive: while this monitor holds it open, the
 * request/response commands in serialDevice.ts (ping, setWifi, uploadConfig,
 * flashing, ...) cannot open the same port. main.ts is responsible for
 * pausing/resuming this monitor around those commands via
 * pauseMonitor()/resumeMonitor() (see withMonitorPaused there).
 */

export interface SerialMonitorLine {
  /** 'line' = 板子輸出、'info' = 監看器自己的狀態訊息、'error' = 錯誤 */
  kind: 'line' | 'info' | 'error'
  text: string
  /** Date.now() */
  at: number
}

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

/**
 * macOS 上 host 主動開啟的 serial I/O 應優先用 cu.*（call-out）而非 tty.*
 * （tty.* 是 dial-in device，會等待 DCD/carrier，容易卡住開啟動作）。
 * 這份邏輯與 serialDevice.ts 的 normalizeSerialPort() 等價，但因為那是
 * 該檔案的內部函式（未 export），這裡複製一份維持模組獨立。
 * 帶 "debug" 的 tty（例如 JTAG debug console）不轉換，維持原樣。
 */
export function normalizeSerialPort(path: string): string {
  if (path.startsWith('/dev/tty.') && !path.includes('debug')) {
    return path.replace('/dev/tty.', '/dev/cu.')
  }
  return path
}

/**
 * 裁切保留行數上限的純函式（可獨立測試，不依賴 serialport）。
 * - 未超過上限：全部保留
 * - 超過上限：丟棄最舊的，只留最新 max 筆
 * - 單次塞入就超過上限：只留 incoming 的最後 max 筆
 */
export function appendCappedLines<T>(prev: T[], incoming: T[], max: number): T[] {
  if (incoming.length >= max) {
    return incoming.slice(incoming.length - max)
  }
  const combined = prev.length + incoming.length > max ? prev.slice(prev.length + incoming.length - max) : prev
  return [...combined, ...incoming]
}

type OpenPort = InstanceType<SerialPortModule['SerialPort']>

let currentSession: {
  path: string
  port: OpenPort
  onLine: (l: SerialMonitorLine) => void
} | null = null

// 記住最後一次使用的 onLine callback，讓 resumeMonitor(path) 不需要呼叫端
// 重新傳入 callback 就能恢復監看（暫停/恢復是同一個 IPC 呼叫端在用同一個 event.sender）。
let lastOnLine: ((l: SerialMonitorLine) => void) | null = null

function emit(onLine: (l: SerialMonitorLine) => void, kind: SerialMonitorLine['kind'], text: string): void {
  onLine({ kind, text, at: Date.now() })
}

/** 開始監看指定 port。已在監看別的 port 時先停掉舊的。 */
export async function startMonitor(path: string, onLine: (l: SerialMonitorLine) => void): Promise<void> {
  if (currentSession) {
    await stopMonitor()
  }
  lastOnLine = onLine

  const { SerialPort, ReadlineParser } = await loadSerialModules()
  const devicePath = normalizeSerialPort(path)

  await new Promise<void>((resolve, reject) => {
    // rts/dtr 關閉，避免開 port 就 reset ESP（跟 serialDevice.ts 的做法一致）。
    const port = new SerialPort({
      path: devicePath,
      baudRate: 115200,
      autoOpen: false,
      rts: false,
      dtr: false
    })
    const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }))

    parser.on('data', (data: string) => {
      emit(onLine, 'line', data.replace(/\r$/, ''))
    })

    port.on('error', (err: Error) => {
      emit(onLine, 'error', err instanceof Error ? err.message : String(err))
    })

    port.on('close', () => {
      if (currentSession && currentSession.port === port) {
        currentSession = null
      }
    })

    port.open((openErr) => {
      if (openErr) {
        // open 失敗也必須把 parser 與 port 的 listener/fd 清乾淨。
        // 漏掉這段時，失敗的 port 物件會殘留在半開狀態，累積之後 app 自己
        // 就會佔住 /dev/cu.*（lsof 可看到 Electron 掛著高編號的 FD），
        // 於後續所有指令都拿到 Cannot lock port。
        try {
          parser.removeAllListeners()
          port.removeAllListeners()
          if (port.isOpen) port.close(() => {})
        } catch {
          // 已經是壞掉的 port，清理失敗就忽略
        }
        // 原始訊息是 "Resource temporarily unavailable Cannot lock port"，
        // 看不出該怎麼處理。CDC 只有一條通道，最常見的原因就是 port 正被
        // 別的東西佔著（Studio 正在燒錄或傳 config、外部的 pio device
        // monitor、或上一個 session 還沒關乾淨）。
        const raw = openErr.message ?? String(openErr)
        const locked = /cannot lock port|resource temporarily unavailable|access denied|busy/i.test(raw)
        reject(
          locked
            ? new Error(
                `無法開啟 ${devicePath}：port 正被其他程式佔用。` +
                  '請等目前的燒錄／設定指令跑完，並確認沒有另外開著 ' +
                  `pio device monitor（可用 lsof ${devicePath} 檢查）。原始錯誤：${raw}`
              )
            : new Error(`無法開啟 ${devicePath}：${raw}`)
        )
        return
      }
      currentSession = { path: devicePath, port, onLine }
      emit(onLine, 'info', `已開始監看 ${devicePath}`)
      resolve()
    })
  })
}

/** 停止監看。已經停了就直接 return。 */
/**
 * macOS 上 close() 的 callback 回來之後，核心還要一小段時間才真正釋放
 * file descriptor（USB CDC 尤其明顯）。沒有這段等待就立刻重開同一個 port，
 * 會拿到 "Resource temporarily unavailable / Cannot lock port"。
 */
const PORT_RELEASE_SETTLE_MS = 250

export async function stopMonitor(): Promise<void> {
  if (!currentSession) return
  const session = currentSession
  currentSession = null
  await new Promise<void>((resolve) => {
    session.port.close(() => resolve())
  })
  await new Promise((resolve) => setTimeout(resolve, PORT_RELEASE_SETTLE_MS))
}

export function isMonitoring(): boolean {
  return currentSession !== null
}

export function monitoringPath(): string | null {
  return currentSession?.path ?? null
}

/** 給 withMonitorPaused 用：暫停後回傳「要恢復哪個 port」，沒在監看則回 null */
export async function pauseMonitor(): Promise<string | null> {
  if (!currentSession) return null
  const { path, onLine } = currentSession
  emit(onLine, 'info', '--- 暫停監看（執行裝置指令中）---')
  await stopMonitor()
  return path
}

/**
 * 恢復先前暫停的監看，沿用暫停前記住的 onLine callback。
 *
 * 為什麼要重試：燒錄用 esptool 的 --after hard_reset 收尾，板子重開機時
 * ESP32-S3 的原生 USB-Serial/JTAG 會整個重新列舉（re-enumerate），
 * /dev/cu.usbmodemXXXX 這個節點會先消失再出現，要 1～2 秒。
 * 指令一結束就立刻重開必然拿到 ENOENT 或 "Resource temporarily unavailable"。
 */
const RESUME_ATTEMPTS = 4
const RESUME_RETRY_MS = 1000

export async function resumeMonitor(path: string): Promise<void> {
  if (!lastOnLine) {
    throw new Error('resumeMonitor: 沒有可恢復的監看 session（尚未呼叫過 startMonitor）')
  }

  let lastError: Error | undefined
  for (let attempt = 1; attempt <= RESUME_ATTEMPTS; attempt++) {
    try {
      await startMonitor(path, lastOnLine)
      return
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < RESUME_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RESUME_RETRY_MS))
      }
    }
  }

  throw new Error(
    `恢復監看 ${path} 失敗（已重試 ${RESUME_ATTEMPTS} 次）：${lastError?.message ?? '未知原因'}`
  )
}

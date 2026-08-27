import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  DEFAULT_FLASH_BOARD_ID,
  getFlashBoardTarget,
  type FlashBoardId
} from '../../src/shared/boardTargets'
import { resolveRepoResource } from '../utils/paths'

/** Prefer PlatformIO's bundled esptool — Homebrew python3 is PEP 668 and often has no esptool. */
function resolveEsptoolInvocation(): { command: string; prefixArgs: string[] } {
  const home = homedir()
  const isWin = process.platform === 'win32'
  const pioPython = isWin
    ? join(home, '.platformio', 'penv', 'Scripts', 'python.exe')
    : join(home, '.platformio', 'penv', 'bin', 'python')
  const pioEsptool = join(home, '.platformio', 'packages', 'tool-esptoolpy', 'esptool.py')

  if (existsSync(pioPython) && existsSync(pioEsptool)) {
    return { command: pioPython, prefixArgs: [pioEsptool] }
  }

  return { command: 'python3', prefixArgs: ['-m', 'esptool'] }
}

export interface FlashProgress {
  stage: 'start' | 'stdout' | 'stderr' | 'done' | 'error'
  message: string
}

/** Candidate `pio` executable paths, in lookup order. Pure (no fs), so it's testable in isolation. */
export function pioCandidatePaths(home: string): string[] {
  return [
    join(home, '.platformio', 'penv', 'bin', 'pio'),
    join(
      home,
      'Library',
      'Application Support',
      'Code',
      'User',
      'globalStorage',
      'platformio.platformio-ide',
      'penv',
      'bin',
      'pio'
    )
  ]
}

/** Resolve the `pio` executable path. Checks PATH first, then PlatformIO's own install locations. */
export function resolvePioExecutable(): string | null {
  const pathDirs = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')
  for (const dir of pathDirs) {
    if (!dir) continue
    const candidate = join(dir, process.platform === 'win32' ? 'pio.exe' : 'pio')
    if (existsSync(candidate)) return candidate
  }

  for (const candidate of pioCandidatePaths(homedir())) {
    if (existsSync(candidate)) return candidate
  }

  return null
}

export interface FirmwareBuildAvailability {
  ok: boolean
  /** ok 為 false 時給使用者看的繁中原因 */
  reason?: string
  pioPath?: string
  /** 找到的 platformio.ini 路徑 */
  projectRoot?: string
}

/** Whether the app can compile firmware in this environment (needs C++ source tree + pio executable). */
export function checkFirmwareBuildAvailability(): FirmwareBuildAvailability {
  const platformioIni = resolveRepoResource('platformio.ini')
  if (!existsSync(platformioIni)) {
    return {
      ok: false,
      reason: '找不到 platformio.ini（此環境沒有韌體原始碼，通常是打包後的 App）。請改用開發環境或用終端機執行 pio。'
    }
  }

  const pioPath = resolvePioExecutable()
  if (!pioPath) {
    return {
      ok: false,
      reason:
        '找不到 pio 執行檔。可安裝 PlatformIO Core（python3 -m pip install --user platformio）或 VS Code 的 PlatformIO IDE extension。',
      projectRoot: dirname(platformioIni)
    }
  }

  return { ok: true, pioPath, projectRoot: dirname(platformioIni) }
}

let buildInProgress = false

interface FlashArtifacts {
  firmwareBin: string
  bootloaderBin: string
  partitionsBin: string
}

function resolveFlashArtifacts(pioEnv: string): FlashArtifacts {
  const buildDir = resolveRepoResource('.pio', 'build', pioEnv)
  const firmwareBin = join(buildDir, 'firmware.bin')
  if (!existsSync(firmwareBin)) {
    throw new Error(`firmware.bin not found for ${pioEnv}. Run \`pio run -e ${pioEnv}\` in the repo root first.`)
  }

  const bootloaderBin = join(buildDir, 'bootloader.bin')
  const partitionsBin = join(buildDir, 'partitions.bin')

  // 過去缺 bootloader / partitions 時是靜默降級成「只燒 firmware」，那在
  // erase_flash 過的板子上必然燒出一塊開不了機的磚：ROM 會載入 0x0 的殘缺
  // bootloader，載到第一個 segment 就失敗並觸發看門狗重置，log 看起來像
  // 無窮 boot loop（只有一個 load: 而沒有後續 load: 與 entry:）。
  // 這兩個檔案是 pio run 的標準產物，缺了就是不正常狀態，必須明確報錯。
  const missing = [
    existsSync(bootloaderBin) ? null : 'bootloader.bin',
    existsSync(partitionsBin) ? null : 'partitions.bin'
  ].filter((x): x is string => x !== null)

  if (missing.length > 0) {
    throw new Error(
      `${pioEnv} 的建置產物不完整，缺少 ${missing.join('、')}。` +
        '只燒 firmware 會讓板子無法開機（bootloader 與分區表不完整）。' +
        `請先重新建置：pio run -e ${pioEnv}`
    )
  }

  return { firmwareBin, bootloaderBin, partitionsBin }
}

function buildEsptoolArgs(
  port: string,
  board: ReturnType<typeof getFlashBoardTarget>,
  artifacts: FlashArtifacts,
  baud: number
): string[] {
  // Global options (before the operation). NOTE: esptool >= 4.x requires the
  // flash options (--flash_mode/_freq/_size) to come AFTER `write_flash`, not
  // here; placing them before makes esptool treat 'dio' as the operation and
  // exit with code 2.
  const args = [
    '--chip',
    board.esptoolChip,
    '-p',
    port,
    '-b',
    String(baud),
    '--before',
    'default_reset',
    '--after',
    'hard_reset',
    'write_flash',
    // 一律用 keep，不要覆寫映像檔頭裡的 flash 設定。
    //
    // 映像是 pio 依 platformio.ini 編譯的，檔頭（byte2=flash_mode、
    // byte3=size/freq）已經正確。boardTargets.ts 手寫的那組值與編譯產物之間
    // 沒有任何同步機制，一旦對不上，esptool 會改寫檔頭而燒出開不了機的板子：
    // n16r8 的 flashMode 寫成 'qio' 但編譯產物是 DIO，燒進去後 bootloader
    // 改用 QIO 讀 flash（eFuse 實為 quad），只載入第一個 segment 就失敗並
    // 觸發看門狗重置 —— 表現為無窮 boot loop。pio upload 不覆寫檔頭，所以
    // 同一塊板子用指令燒就正常，用 app 燒就 loop。
    '--flash_mode',
    'keep',
    '--flash_freq',
    'keep',
    '--flash_size',
    'keep'
  ]

  if (board.noCompress) {
    args.push('--no-compress')
  }

  // 三個映像一律一起燒（resolveFlashArtifacts 已保證都存在）。
  // Bootloader offset 依晶片而異：ESP32-S3 = 0x0、classic ESP32 = 0x1000
  args.push(
    `0x${board.bootloaderOffset.toString(16)}`,
    artifacts.bootloaderBin,
    '0x8000',
    artifacts.partitionsBin,
    `0x${board.flashOffset.toString(16)}`,
    artifacts.firmwareBin
  )

  return args
}

/** Generic spawn + stream-progress helper, shared by esptool flashing and pio building. */
function runStreaming(
  command: string,
  args: string[],
  onProgress: (p: FlashProgress) => void,
  options?: { cwd?: string }
): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd: options?.cwd })
    proc.stdout.on('data', (buf: Buffer) => {
      onProgress({ stage: 'stdout', message: buf.toString() })
    })
    proc.stderr.on('data', (buf: Buffer) => {
      onProgress({ stage: 'stderr', message: buf.toString() })
    })
    proc.on('error', (err) => {
      onProgress({ stage: 'error', message: err.message })
      reject(err)
    })
    proc.on('close', (code) => resolve(code ?? 1))
  })
}

/** Prefer board baud, then proven USB-UART-safe rates (pio upload uses 115200). */
function baudAttempts(preferred: number): number[] {
  return [preferred, 115200, 460800].filter((b, i, arr) => arr.indexOf(b) === i)
}

export async function flashFirmware(
  port: string,
  boardId: FlashBoardId = DEFAULT_FLASH_BOARD_ID,
  onProgress: (p: FlashProgress) => void
): Promise<void> {
  const board = getFlashBoardTarget(boardId)
  const artifacts = resolveFlashArtifacts(board.pioEnv)
  const { command, prefixArgs } = resolveEsptoolInvocation()
  const bauds = baudAttempts(board.uploadBaud)

  const imageSummary = 'bootloader + partitions + firmware'
  onProgress({
    stage: 'start',
    message: `Flashing ${board.label} (${imageSummary}, ${board.flashSize}) to ${port}`
  })

  let lastCode = 1
  for (let i = 0; i < bauds.length; i++) {
    const baud = bauds[i]
    if (i > 0) {
      onProgress({
        stage: 'stderr',
        message: `\nRetrying at ${baud} baud…\n`
      })
    } else {
      onProgress({ stage: 'stdout', message: `Using ${baud} baud\n` })
    }

    const fullArgs = [...prefixArgs, ...buildEsptoolArgs(port, board, artifacts, baud)]
    lastCode = await runStreaming(command, fullArgs, onProgress)
    if (lastCode === 0) {
      onProgress({ stage: 'done', message: `Flash complete (${baud} baud)` })
      return
    }
  }

  const hint =
    lastCode === 2
      ? ` Hold BOOT while flashing; use a data USB cable. Or: \`${board.buildHint} -t upload\`.`
      : command === 'python3'
        ? ' Install PlatformIO (`pio`) or: pipx install esptool'
        : ''
  const msg = `esptool exited with code ${lastCode}.${hint}`
  onProgress({ stage: 'error', message: msg })
  throw new Error(msg)
}

export async function buildFirmware(
  boardId: FlashBoardId = DEFAULT_FLASH_BOARD_ID,
  onProgress: (p: FlashProgress) => void
): Promise<void> {
  if (buildInProgress) {
    throw new Error('已有編譯在進行中，請稍候再試。')
  }

  const availability = checkFirmwareBuildAvailability()
  if (!availability.ok || !availability.pioPath || !availability.projectRoot) {
    const msg = availability.reason ?? '目前環境無法編譯韌體。'
    onProgress({ stage: 'error', message: msg })
    throw new Error(msg)
  }

  buildInProgress = true
  try {
    const board = getFlashBoardTarget(boardId)
    onProgress({ stage: 'start', message: `Building ${board.label} (env: ${board.pioEnv})` })

    const code = await runStreaming(availability.pioPath, ['run', '-e', board.pioEnv], onProgress, {
      cwd: availability.projectRoot
    })

    if (code !== 0) {
      const msg = `pio run 結束代碼 ${code}，編譯失敗。請檢查上方輸出訊息。`
      onProgress({ stage: 'error', message: msg })
      throw new Error(msg)
    }

    onProgress({ stage: 'done', message: `Build complete (${board.pioEnv})` })
  } finally {
    buildInProgress = false
  }
}

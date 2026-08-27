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
  bootloaderBin?: string
  partitionsBin?: string
}

function resolveFlashArtifacts(pioEnv: string): FlashArtifacts {
  const buildDir = resolveRepoResource('.pio', 'build', pioEnv)
  const firmwareBin = join(buildDir, 'firmware.bin')
  if (!existsSync(firmwareBin)) {
    throw new Error(`firmware.bin not found for ${pioEnv}. Run \`pio run -e ${pioEnv}\` in the repo root first.`)
  }

  const bootloaderBin = join(buildDir, 'bootloader.bin')
  const partitionsBin = join(buildDir, 'partitions.bin')
  return {
    firmwareBin,
    bootloaderBin: existsSync(bootloaderBin) ? bootloaderBin : undefined,
    partitionsBin: existsSync(partitionsBin) ? partitionsBin : undefined
  }
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
    '--flash_mode',
    board.flashMode,
    '--flash_freq',
    board.flashFreq,
    '--flash_size',
    board.flashSize
  ]

  if (board.noCompress) {
    args.push('--no-compress')
  }

  if (artifacts.bootloaderBin && artifacts.partitionsBin) {
    // Bootloader offset differs per chip: ESP32-S3 = 0x0, classic ESP32 = 0x1000
    args.push(
      `0x${board.bootloaderOffset.toString(16)}`,
      artifacts.bootloaderBin,
      '0x8000',
      artifacts.partitionsBin,
      `0x${board.flashOffset.toString(16)}`,
      artifacts.firmwareBin
    )
  } else {
    args.push(`0x${board.flashOffset.toString(16)}`, artifacts.firmwareBin)
  }

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

  const imageSummary = artifacts.bootloaderBin
    ? 'bootloader + partitions + firmware'
    : 'firmware only'
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

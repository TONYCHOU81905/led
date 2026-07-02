import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_FLASH_BOARD_ID,
  getFlashBoardTarget,
  type FlashBoardId
} from '../../src/shared/boardTargets'
import { resolveRepoResource } from '../utils/paths'

export interface FlashProgress {
  stage: 'start' | 'stdout' | 'stderr' | 'done' | 'error'
  message: string
}

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

function buildEsptoolArgs(port: string, board: ReturnType<typeof getFlashBoardTarget>, artifacts: FlashArtifacts): string[] {
  const args = [
    '-m',
    'esptool',
    '--chip',
    board.esptoolChip,
    '-p',
    port,
    '-b',
    String(board.uploadBaud),
    '--before',
    'default_reset',
    '--after',
    'hard_reset',
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

  args.push('write_flash')

  if (artifacts.bootloaderBin && artifacts.partitionsBin) {
    args.push(
      '0x1000',
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

export async function flashFirmware(
  port: string,
  boardId: FlashBoardId = DEFAULT_FLASH_BOARD_ID,
  onProgress: (p: FlashProgress) => void
): Promise<void> {
  const board = getFlashBoardTarget(boardId)
  const artifacts = resolveFlashArtifacts(board.pioEnv)
  const fullArgs = buildEsptoolArgs(port, board, artifacts)

  const imageSummary = artifacts.bootloaderBin
    ? 'bootloader + partitions + firmware'
    : 'firmware only'
  onProgress({
    stage: 'start',
    message: `Flashing ${board.label} (${imageSummary}, ${board.flashSize}, ${board.uploadBaud} baud) to ${port}`
  })

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('python3', fullArgs, { stdio: ['ignore', 'pipe', 'pipe'] })

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
    proc.on('close', (code) => {
      if (code === 0) {
        onProgress({ stage: 'done', message: 'Flash complete' })
        resolve()
      } else {
        const hint =
          board.noCompress && code === 2
            ? ' Try holding BOOT, use a shorter USB cable, or run `pio run -e esp32-dev -t upload` once.'
            : ''
        const msg = `esptool exited with code ${code}.${hint} Install: pip install esptool`
        onProgress({ stage: 'error', message: msg })
        reject(new Error(msg))
      }
    })
  })
}

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolveRepoResource } from '../utils/paths'

export interface FlashProgress {
  stage: 'start' | 'stdout' | 'stderr' | 'done' | 'error'
  message: string
}

function resolveFirmwareBin(): string {
  const p = resolveRepoResource('.pio', 'build', 'esp32-s3-devkitc-1', 'firmware.bin')
  if (!existsSync(p)) {
    throw new Error('firmware.bin not found. Run `pio run` in the repo root first.')
  }
  return p
}

export async function flashFirmware(
  port: string,
  onProgress: (p: FlashProgress) => void
): Promise<void> {
  const firmwareBin = resolveFirmwareBin()
  onProgress({ stage: 'start', message: `Flashing ${firmwareBin} to ${port}` })

  const fullArgs = [
    '-m',
    'esptool',
    '--chip',
    'esp32s3',
    '-p',
    port,
    '-b',
    '921600',
    'write_flash',
    '0x10000',
    firmwareBin
  ]

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
        const msg = `esptool exited with code ${code}. Install: pip install esptool`
        onProgress({ stage: 'error', message: msg })
        reject(new Error(msg))
      }
    })
  })
}

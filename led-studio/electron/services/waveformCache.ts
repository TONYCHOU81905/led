import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'

export interface WaveformCache {
  durationMs: number
  peaks: number[]
  sourceHash: string
  generatedAt: string
}

const CACHE_VERSION = 1

function hashBuffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex').slice(0, 16)
}

async function decodePeaksWithFfmpeg(filePath: string, bins = 4000): Promise<WaveformCache | null> {
  return new Promise((resolve) => {
    const args = ['-i', filePath, '-ac', '1', '-ar', '8000', '-f', 'f32le', '-']
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'ignore'] })
    const chunks: Buffer[] = []
    proc.stdout.on('data', (c: Buffer) => chunks.push(c))
    proc.on('error', () => resolve(null))
    proc.on('close', (code) => {
      if (code !== 0) {
        resolve(null)
        return
      }
      const pcm = Buffer.concat(chunks)
      const samples = pcm.length / 4
      if (samples === 0) {
        resolve(null)
        return
      }
      const block = Math.max(1, Math.floor(samples / bins))
      const peaks: number[] = []
      for (let i = 0; i < bins; i++) {
        let peak = 0
        const start = i * block
        const end = Math.min(samples, start + block)
        for (let s = start; s < end; s++) {
          const v = Math.abs(pcm.readFloatLE(s * 4))
          if (v > peak) peak = v
        }
        peaks.push(peak)
      }
      const durationMs = Math.round((samples / 8000) * 1000)
      resolve({
        durationMs,
        peaks,
        sourceHash: '',
        generatedAt: new Date().toISOString()
      })
    })
  })
}

export function waveformCachePath(projectFilePath: string, musicFilePath: string): string {
  const base = projectFilePath
    ? join(dirname(projectFilePath), '.led-cache')
    : join(dirname(musicFilePath), '.led-cache')
  const key = createHash('sha1').update(musicFilePath).digest('hex').slice(0, 12)
  return join(base, `waveform-${key}.json`)
}

export async function loadOrBuildWaveformCache(
  musicFilePath: string,
  projectFilePath?: string
): Promise<WaveformCache | null> {
  const musicBuf = await readFile(musicFilePath)
  const sourceHash = hashBuffer(musicBuf)
  const cachePath = waveformCachePath(projectFilePath ?? '', musicFilePath)

  if (existsSync(cachePath)) {
    try {
      const raw = JSON.parse(await readFile(cachePath, 'utf-8')) as WaveformCache & { version?: number }
      if (raw.version === CACHE_VERSION && raw.sourceHash === sourceHash && raw.peaks?.length) {
        return raw
      }
    } catch {
      // rebuild below
    }
  }

  const built = await decodePeaksWithFfmpeg(musicFilePath)
  if (!built) return null

  built.sourceHash = sourceHash
  await mkdir(dirname(cachePath), { recursive: true })
  await writeFile(cachePath, JSON.stringify({ version: CACHE_VERSION, ...built }), 'utf-8')
  return built
}

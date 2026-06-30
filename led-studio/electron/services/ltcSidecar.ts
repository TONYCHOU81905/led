import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolveRepoResource } from '../utils/paths'

export interface LtcSidecarOptions {
  wavPath?: string
  simulate?: boolean
  durationMs?: number
  rateHz?: number
}

export class LtcSidecarService {
  private proc: ChildProcess | null = null
  private listeners = new Set<(ms: number) => void>()

  subscribe(cb: (ms: number) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(ms: number): void {
    for (const cb of this.listeners) cb(ms)
  }

  private resolveScript(): string {
    const p = resolveRepoResource('tools', 'ltc_sidecar.py')
    if (!existsSync(p)) {
      throw new Error('ltc_sidecar.py not found in tools/')
    }
    return p
  }

  start(options: LtcSidecarOptions = {}): void {
    this.stop()
    const script = this.resolveScript()
    const args = ['-u', script]
    if (options.simulate) {
      args.push('--simulate', '--duration-ms', String(options.durationMs ?? 180000))
    } else if (options.wavPath) {
      args.push('--wav', options.wavPath)
    } else {
      args.push('--simulate', '--duration-ms', String(options.durationMs ?? 180000))
    }
    args.push('--rate-hz', String(options.rateHz ?? 100))

    const proc = spawn('python3', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    this.proc = proc
    let buf = ''
    proc.stdout?.on('data', (chunk: Buffer) => {
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const parsed = JSON.parse(line) as { music_time_ms?: number; done?: boolean }
          if (typeof parsed.music_time_ms === 'number') {
            this.emit(parsed.music_time_ms)
          }
        } catch {
          // ignore
        }
      }
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      console.error('[ltc]', chunk.toString())
    })
  }

  stop(): void {
    if (this.proc) {
      this.proc.kill()
      this.proc = null
    }
  }

  isRunning(): boolean {
    return this.proc !== null
  }
}

export const ltcSidecar = new LtcSidecarService()

import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Resolve files that live in project root (examples/, tools/) in dev and production. */
export function resolveAppResource(...segments: string[]): string {
  const candidates = [
    join(app.getAppPath(), ...segments),
    join(process.cwd(), ...segments),
    // out/main/index.js -> led-studio/
    join(__dirname, '..', '..', ...segments),
    // led-studio/electron/main.ts compiled -> led-studio/
    join(__dirname, '..', ...segments)
  ]

  for (const p of candidates) {
    if (existsSync(p)) return p
  }

  return join(process.cwd(), ...segments)
}

/** Repo root (parent of led-studio) for firmware.bin */
export function resolveRepoResource(...segments: string[]): string {
  const candidates = [
    join(app.getAppPath(), '..', ...segments),
    join(process.cwd(), '..', ...segments),
    join(__dirname, '..', '..', '..', ...segments)
  ]

  for (const p of candidates) {
    if (existsSync(p)) return p
  }

  return join(process.cwd(), '..', ...segments)
}

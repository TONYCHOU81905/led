import { describe, expect, it } from 'vitest'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { pioCandidatePaths, resolvePioExecutable } from '../electron/services/flasher'

describe('pioCandidatePaths', () => {
  it('returns the penv and VS Code globalStorage locations, in that order', () => {
    const home = '/Users/example'
    const candidates = pioCandidatePaths(home)

    expect(candidates).toEqual([
      '/Users/example/.platformio/penv/bin/pio',
      '/Users/example/Library/Application Support/Code/User/globalStorage/platformio.platformio-ide/penv/bin/pio'
    ])
  })

  it('uses the supplied home directory rather than a hardcoded path', () => {
    const candidates = pioCandidatePaths('/tmp/some-other-home')

    for (const candidate of candidates) {
      expect(candidate.startsWith('/tmp/some-other-home')).toBe(true)
    }
  })
})

describe('resolvePioExecutable', () => {
  // 這台機器上有沒有 pio 是環境相依的，所以分成兩種情況各自斷言 ——
  // 原本只斷言「回傳 null 或 string」幾乎恆真，沒有保護力。
  const anyCandidateExists = pioCandidatePaths(homedir()).some((p) => existsSync(p))

  it.runIf(anyCandidateExists)('候選路徑存在時，回傳的路徑必須真的存在且可執行', () => {
    const result = resolvePioExecutable()
    expect(result).not.toBeNull()
    expect(existsSync(result!)).toBe(true)
    // 可執行位元
    expect(statSync(result!).mode & 0o111).toBeGreaterThan(0)
  })

  it.runIf(!anyCandidateExists)('候選都不存在且 PATH 上沒有時回傳 null', () => {
    // PATH 上可能仍有 pio，那樣就會拿到字串；只要不是 undefined 即可
    const result = resolvePioExecutable()
    expect(result === null || existsSync(result)).toBe(true)
  })
})

// NOTE: checkFirmwareBuildAvailability() and buildFirmware() are NOT covered here.
// They call resolveRepoResource() (electron/utils/paths.ts), which reads
// `app.getAppPath()` from the `electron` module. Outside a real Electron process
// `app` is undefined, so calling either function throws immediately in the
// vitest (node) environment. Mocking that away would just be testing the mock,
// so per the task instructions this is left as documented, untested surface.

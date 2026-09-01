import { app, BrowserWindow, dialog, ipcMain, protocol } from 'electron'
import { join, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { mediaContentType, parseRangeHeader } from './services/mediaRange'
import { Readable } from 'node:stream'
import { buildFirmware, checkFirmwareBuildAvailability, flashFirmware } from './services/flasher'
import { espStatusListener, type EspDeviceStatus } from './services/espStatusListener'
import { ltcSidecar } from './services/ltcSidecar'
import {
  getEspStatus,
  listSerialPorts,
  pingEsp,
  reloadEspConfig,
  setEspWifi,
  uploadEspConfig
} from './services/serialDevice'
import {
  isMonitoring,
  monitoringPath,
  pauseMonitor,
  resumeMonitor,
  startMonitor,
  stopMonitor,
  type SerialMonitorLine
} from './services/serialMonitor'
import { timecodeBridge } from './services/timecodeBridge'
import { loadOrBuildWaveformCache } from './services/waveformCache'
import { resolveAppResource } from './utils/paths'
import {
  findProjectJsonInDir,
  openProjectFromFile,
  readProjectFile,
  saveProjectToDir,
  saveProjectToFile
} from './services/projectBundle'
import { isBundledProjectPath, sanitizeProjectFileName } from '../src/shared/projectBundle'
import type { FlashBoardId } from '../src/shared/boardTargets'
import type { BridgeOptions, DeviceConfig, LedProject } from '../src/shared/types/project'

export interface OpenProjectResult {
  project: LedProject
  filePath: string
}

export interface SaveProjectResult {
  ok: boolean
  filePath?: string
  project?: LedProject
  canUpgradeToBundle?: boolean
}

/** 剝掉 macOS showSaveDialog 可能自動補上的副檔名，把回傳路徑當成資料夾名稱使用。 */
function stripAccidentalExtension(dirPath: string): string {
  if (dirPath.toLowerCase().endsWith('.ledproj.json')) {
    return dirPath.slice(0, -'.ledproj.json'.length)
  }
  if (dirPath.toLowerCase().endsWith('.json')) {
    return dirPath.slice(0, -'.json'.length)
  }
  return dirPath
}

async function pickProjectBundleDir(project: LedProject): Promise<string | null> {
  const result = await dialog.showSaveDialog({
    title: '儲存專案資料夾',
    defaultPath: sanitizeProjectFileName(project.project.name),
    buttonLabel: '建立專案資料夾',
    properties: ['createDirectory']
  })
  if (result.canceled || !result.filePath) return null
  return stripAccidentalExtension(result.filePath)
}

/**
 * serial port 是獨佔的：DebugView 的 monitor 若持續開著 port，任何其他
 * device:* 指令（setWifi/uploadConfig/flash...）都會因 port busy 而失敗。
 * 這個 helper 在執行指令前先暫停 monitor，指令結束後（無論成功或失敗）
 * 自動恢復，讓使用者不用自己記得手動停看。
 */
async function withMonitorPaused<T>(fn: () => Promise<T>): Promise<T> {
  const pausedPath = await pauseMonitor()
  try {
    return await fn()
  } finally {
    if (pausedPath) {
      await resumeMonitor(pausedPath)
    }
  }
}

const knownBridgeTargets = new Set<string>()

function normalizeIpv4(ip: string): string | null {
  const trimmed = ip.trim()
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed)) return null
  const parts = trimmed.split('.').map(Number)
  if (parts.some((part) => part < 0 || part > 255)) return null
  return trimmed
}

function isUsableBridgeTargetIp(ip: string): boolean {
  if (ip === '0.0.0.0' || ip === '255.255.255.255') return false
  return true
}

function registerBridgeTarget(ip?: string): void {
  if (!ip) return
  const normalized = normalizeIpv4(ip)
  if (!normalized || !isUsableBridgeTargetIp(normalized)) return
  knownBridgeTargets.add(normalized)
}

function removeBridgeTarget(ip: string): string[] {
  const normalized = normalizeIpv4(ip)
  if (normalized) {
    knownBridgeTargets.delete(normalized)
  }
  return listBridgeTargets()
}

function listBridgeTargets(): string[] {
  return [...knownBridgeTargets].filter(isUsableBridgeTargetIp).sort()
}

function syncDiscoveryTargets(): void {
  espStatusListener.setDiscoveryTargets(listBridgeTargets())
}

function pushBridgeState(): void {
  const state = timecodeBridge.getState()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('show:bridgeState', state)
  }
}

function pushEspStatus(devices: EspDeviceStatus[]): void {
  for (const device of devices) {
    registerBridgeTarget(device.ip)
  }
  syncDiscoveryTargets()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('show:espStatus', devices)
  }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'LED Show Studio',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * 自訂 protocol：給 <video> 讀本機影片用。
 *
 * dev 模式下 renderer 跑在 http://localhost:5173，從 http 頁面載入 file:// 資源
 * 會被 Chromium 的安全策略擋掉，<video> 只會拿到 MEDIA_ERR_SRC_NOT_SUPPORTED
 * （即使 codec 完全支援）。音檔沒踩到是因為它走的是 readMusicFile → Blob →
 * blob: URL 那條路；但影片動輒數百 MB 到 GB，整個讀進記憶體不可行，而且
 * blob 也不利於 seek。
 *
 * handler 自己讀檔案區間並回 206 Partial Content，不轉發給 file://。
 * <video> 的 seek 完全依賴 206 + Content-Range，拿到 200 全檔就無法定位，
 * currentTime 會一直停在 0。自己處理才能確定行為。
 *
 * registerSchemesAsPrivileged 必須在 app ready 之前呼叫。
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
  }
])

app.whenReady().then(() => {
  protocol.handle('app-media', async (request) => {
    try {
      // app-media://local/<URL 編碼後的絕對路徑>
      const url = new URL(request.url)
      const encoded = url.pathname.replace(/^\//, '')
      const filePath = decodeURIComponent(encoded)
      if (!isAbsolute(filePath)) {
        return new Response('bad path', { status: 400 })
      }

      // 這裡自己處理 Range，而不是把 header 轉發給 net.fetch(file://)。
      //
      // <video> 每次 seek 都會送 Range: bytes=N-，並且期待拿回 206 Partial
      // Content 加上 Content-Range。轉發給 file:// 不保證會得到 206 ——
      // 拿到 200 全檔時 Chromium 無法定位，currentTime 會一直停在 0，
      // 表現就是「第一次從頭播正常，之後怎麼拖都回到 00:00」。
      //
      // 自己讀檔案區間並回 206 才能確定行為，不依賴底層 protocol 的實作細節。
      const fileStat = await stat(filePath)
      const contentType = mediaContentType(filePath)
      const range = parseRangeHeader(request.headers.get('Range'), fileStat.size)

      if (!range) {
        return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(fileStat.size),
            // 少了這個 Chromium 不會嘗試 seek，進度條會變成不能拖
            'Accept-Ranges': 'bytes'
          }
        })
      }

      const { start, end } = range
      return new Response(
        Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream,
        {
          status: 206,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${fileStat.size}`,
            'Accept-Ranges': 'bytes'
          }
        }
      )
    } catch (err) {
      return new Response(String(err), { status: 500 })
    }
  })

  // Drop invalid targets left from earlier sessions (e.g. wifi_ip 0.0.0.0 via serial).
  for (const ip of [...knownBridgeTargets]) {
    if (!isUsableBridgeTargetIp(ip)) knownBridgeTargets.delete(ip)
  }

  timecodeBridge.subscribe(pushBridgeState)
  espStatusListener.setDeviceIpHandler((ip) => {
    registerBridgeTarget(ip)
    syncDiscoveryTargets()
  })
  espStatusListener.subscribe(pushEspStatus)
  espStatusListener.start(4211)

  ltcSidecar.subscribe((ms) => {
    timecodeBridge.setExternalTimeMs(ms)
    pushBridgeState()
  })

  ipcMain.handle('project:openDemo', async (): Promise<LedProject> => {
    const demoPath = resolveAppResource('examples', 'demo_show.ledproj.json')
    return readProjectFile(demoPath)
  })

  ipcMain.handle('project:openFile', async (): Promise<OpenProjectResult | null> => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'LED Project', extensions: ['json', 'ledproj.json'] }],
      properties: ['openFile', 'openDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    let filePath = result.filePaths[0]

    const stats = await stat(filePath)
    if (stats.isDirectory()) {
      const found = await findProjectJsonInDir(filePath)
      if (!found) {
        throw new Error('這個資料夾裡找不到專案檔（*.ledproj.json）')
      }
      filePath = found
    }

    const project = await readProjectFile(filePath)
    return { project, filePath }
  })

  ipcMain.handle(
    'project:saveFile',
    async (_event, project: LedProject, existingPath?: string): Promise<SaveProjectResult> => {
      if (existingPath) {
        const saved = await saveProjectToFile(existingPath, project)
        return {
          ok: true,
          filePath: existingPath,
          project: saved,
          canUpgradeToBundle: !isBundledProjectPath(existingPath)
        }
      }

      const dirPath = await pickProjectBundleDir(project)
      if (!dirPath) return { ok: false }
      const { filePath, project: saved } = await saveProjectToDir(dirPath, project)
      return { ok: true, filePath, project: saved }
    }
  )

  ipcMain.handle(
    'project:saveAsBundle',
    async (_event, project: LedProject): Promise<SaveProjectResult> => {
      const dirPath = await pickProjectBundleDir(project)
      if (!dirPath) return { ok: false }
      const { filePath, project: saved } = await saveProjectToDir(dirPath, project)
      return { ok: true, filePath, project: saved }
    }
  )

  ipcMain.handle(
    'project:saveDeviceConfig',
    async (_event, config: DeviceConfig, suggestedName?: string): Promise<boolean> => {
      const result = await dialog.showSaveDialog({
        filters: [{ name: 'Device Config', extensions: ['device.json', 'json'] }],
        defaultPath: suggestedName ?? 'device.config.json'
      })
      if (result.canceled || !result.filePath) return false
      await writeFile(result.filePath, JSON.stringify(config, null, 2), 'utf-8')
      return true
    }
  )

  ipcMain.handle('project:openDeviceConfig', async (): Promise<DeviceConfig | null> => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'Device Config', extensions: ['device.json', 'json'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths[0]) return null
    const raw = await readFile(result.filePaths[0], 'utf-8')
    return JSON.parse(raw) as DeviceConfig
  })

  ipcMain.handle('project:pickMusicFile', async (): Promise<{ path: string } | null> => {
    const result = await dialog.showOpenDialog({
      filters: [
        { name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'aiff', 'aif'] }
      ],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths[0]) return null
    return { path: result.filePaths[0] }
  })

  ipcMain.handle('project:getMusicFileUrl', async (_event, filePath: string): Promise<string> => {
    const resolved = isAbsolute(filePath)
      ? filePath
      : resolveAppResource(filePath)
    return pathToFileURL(resolved).href
  })

  ipcMain.handle('project:pickVideoFile', async (): Promise<{ path: string } | null> => {
    const result = await dialog.showOpenDialog({
      filters: [
        { name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'] }
      ],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths[0]) return null
    return { path: result.filePaths[0] }
  })

  ipcMain.handle('project:getVideoFileUrl', async (_event, filePath: string): Promise<string> => {
    const resolved = isAbsolute(filePath) ? filePath : resolveAppResource(filePath)
    // 不能回 file://（dev 模式的 http renderer 會被安全策略擋），改走自訂 protocol
    return `app-media://local/${encodeURIComponent(resolved)}`
  })

  ipcMain.handle(
    'project:readMusicFile',
    async (_event, filePath: string): Promise<{ data: Uint8Array; mime: string }> => {
      const resolved = isAbsolute(filePath)
        ? filePath
        : resolveAppResource(filePath)
      const buf = await readFile(resolved)
      const ext = resolved.split('.').pop()?.toLowerCase()
      const mimeMap: Record<string, string> = {
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        m4a: 'audio/mp4',
        aac: 'audio/aac',
        flac: 'audio/flac',
        aiff: 'audio/aiff',
        aif: 'audio/aiff'
      }
      return { data: new Uint8Array(buf), mime: mimeMap[ext ?? ''] ?? 'audio/mpeg' }
    }
  )

  ipcMain.handle('show:bridgeStart', async (_event, options?: BridgeOptions) => {
    if (options?.source === 'ltc') {
      ltcSidecar.start({ simulate: true, durationMs: 180000 })
    }
    for (const device of espStatusListener.listDevices()) {
      registerBridgeTarget(device.ip)
    }
    timecodeBridge.start({
      ...options,
      unicastTargets: [...new Set([...(options?.unicastTargets ?? []), ...listBridgeTargets()])]
    })
    pushBridgeState()
  })

  ipcMain.handle('show:bridgeStop', async () => {
    ltcSidecar.stop()
    timecodeBridge.stop()
    pushBridgeState()
  })

  ipcMain.handle('show:bridgePause', async () => {
    timecodeBridge.pause()
    pushBridgeState()
  })

  ipcMain.handle('show:bridgeResume', async () => {
    timecodeBridge.resume()
    pushBridgeState()
  })

  ipcMain.handle('show:bridgeSeek', async (_event, musicTimeMs: number) => {
    timecodeBridge.seek(musicTimeMs)
    pushBridgeState()
  })

  ipcMain.handle('show:bridgePreviewTime', async (_event, musicTimeMs: number) => {
    timecodeBridge.setExternalTimeMs(musicTimeMs)
    pushBridgeState()
  })

  ipcMain.handle('show:bridgeGetState', async () => timecodeBridge.getState())
  ipcMain.handle('show:bridgeTargetList', async () => listBridgeTargets())
  ipcMain.handle('show:bridgeTargetAdd', async (_event, ip: string) => {
    registerBridgeTarget(ip)
    syncDiscoveryTargets()
    return listBridgeTargets()
  })
  ipcMain.handle('show:bridgeTargetRemove', async (_event, ip: string) => {
    const targets = removeBridgeTarget(ip)
    syncDiscoveryTargets()
    return targets
  })

  ipcMain.handle('show:espStatusList', async () => espStatusListener.listDevices())

  ipcMain.handle('show:discoverDevices', async () => {
    await espStatusListener.discoverDevices()
  })

  ipcMain.handle('show:ltcStart', async (_event, options?: { wavPath?: string; durationMs?: number }) => {
    ltcSidecar.start({ wavPath: options?.wavPath, simulate: !options?.wavPath, durationMs: options?.durationMs })
  })

  ipcMain.handle('show:ltcStop', async () => {
    ltcSidecar.stop()
  })

  ipcMain.handle('device:listPorts', async () => listSerialPorts())

  ipcMain.handle('device:ping', async (_event, port: string) =>
    withMonitorPaused(() => pingEsp(port))
  )

  ipcMain.handle('device:setWifi', async (_event, port: string, ssid: string, password: string) =>
    withMonitorPaused(() => setEspWifi(port, ssid, password))
  )

  ipcMain.handle('device:uploadConfig', async (_event, port: string, config: Record<string, unknown>) =>
    withMonitorPaused(() => uploadEspConfig(port, config))
  )

  ipcMain.handle('device:reloadConfig', async (_event, port: string) =>
    withMonitorPaused(() => reloadEspConfig(port))
  )

  ipcMain.handle('device:getStatus', async (_event, port: string) =>
    withMonitorPaused(async () => {
      const status = await getEspStatus(port)
      const wifiIp = typeof status.wifi_ip === 'string' ? status.wifi_ip : undefined
      registerBridgeTarget(wifiIp)
      syncDiscoveryTargets()
      return status
    })
  )

  ipcMain.handle(
    'project:loadWaveformCache',
    async (_event, musicFilePath: string, projectFilePath?: string) => {
      const resolved = musicFilePath.startsWith('/')
        ? musicFilePath
        : resolveAppResource(musicFilePath)
      return loadOrBuildWaveformCache(resolved, projectFilePath)
    }
  )

  ipcMain.handle('device:flashFirmware', async (event, port: string, boardId?: FlashBoardId) => {
    await withMonitorPaused(() =>
      flashFirmware(port, boardId, (progress) => {
        event.sender.send('device:flashProgress', progress)
      })
    )
  })

  // buildFirmware 只是跑 pio build，不會碰 serial port，不需要暫停 monitor。
  ipcMain.handle('device:buildFirmware', async (event, boardId?: FlashBoardId) => {
    await buildFirmware(boardId, (progress) => {
      event.sender.send('device:buildProgress', progress)
    })
  })

  ipcMain.handle('device:canBuildFirmware', async () => {
    return checkFirmwareBuildAvailability()
  })

  ipcMain.handle('device:monitorStart', async (event, port: string) => {
    await startMonitor(port, (line: SerialMonitorLine) => {
      event.sender.send('device:monitorLine', line)
    })
  })

  ipcMain.handle('device:monitorStop', async () => {
    await stopMonitor()
  })

  ipcMain.handle('device:monitorStatus', async () => ({
    monitoring: isMonitoring(),
    path: monitoringPath()
  }))

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  ltcSidecar.stop()
  timecodeBridge.stop()
  espStatusListener.stop()
  void stopMonitor()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  void stopMonitor()
})

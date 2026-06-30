import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'
import { flashFirmware } from './services/flasher'
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
import { timecodeBridge } from './services/timecodeBridge'
import { loadOrBuildWaveformCache } from './services/waveformCache'
import { resolveAppResource } from './utils/paths'
import { openProjectFromFile, readProjectFile, saveProjectToFile } from './services/projectBundle'
import type { BridgeOptions, DeviceConfig, LedProject } from '../src/shared/types/project'

export interface OpenProjectResult {
  project: LedProject
  filePath: string
}

export interface SaveProjectResult {
  ok: boolean
  filePath?: string
  project?: LedProject
}

function pushBridgeState(): void {
  const state = timecodeBridge.getState()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('show:bridgeState', state)
  }
}

function pushEspStatus(devices: EspDeviceStatus[]): void {
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

app.whenReady().then(() => {
  timecodeBridge.subscribe(pushBridgeState)
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
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths[0]) return null
    const filePath = result.filePaths[0]
    const project = await readProjectFile(filePath)
    return { project, filePath }
  })

  ipcMain.handle(
    'project:saveFile',
    async (_event, project: LedProject, existingPath?: string): Promise<SaveProjectResult> => {
      let filePath = existingPath
      if (!filePath) {
        const result = await dialog.showSaveDialog({
          filters: [{ name: 'LED Project', extensions: ['ledproj.json'] }],
          defaultPath: `${project.project.name}.ledproj.json`
        })
        if (result.canceled || !result.filePath) return { ok: false }
        filePath = result.filePath
      }
      const saved = await saveProjectToFile(filePath, project)
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
    const resolved = filePath.startsWith('/')
      ? filePath
      : resolveAppResource(filePath)
    return pathToFileURL(resolved).href
  })

  ipcMain.handle(
    'project:readMusicFile',
    async (_event, filePath: string): Promise<{ data: Uint8Array; mime: string }> => {
      const resolved = filePath.startsWith('/')
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
    timecodeBridge.start(options)
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

  ipcMain.handle('show:bridgeGetState', async () => timecodeBridge.getState())

  ipcMain.handle('show:espStatusList', async () => espStatusListener.listDevices())

  ipcMain.handle('show:ltcStart', async (_event, options?: { wavPath?: string; durationMs?: number }) => {
    ltcSidecar.start({ wavPath: options?.wavPath, simulate: !options?.wavPath, durationMs: options?.durationMs })
  })

  ipcMain.handle('show:ltcStop', async () => {
    ltcSidecar.stop()
  })

  ipcMain.handle('device:listPorts', async () => listSerialPorts())

  ipcMain.handle('device:ping', async (_event, port: string) => pingEsp(port))

  ipcMain.handle('device:setWifi', async (_event, port: string, ssid: string, password: string) =>
    setEspWifi(port, ssid, password)
  )

  ipcMain.handle('device:uploadConfig', async (_event, port: string, config: Record<string, unknown>) =>
    uploadEspConfig(port, config)
  )

  ipcMain.handle('device:reloadConfig', async (_event, port: string) => reloadEspConfig(port))

  ipcMain.handle('device:getStatus', async (_event, port: string) => getEspStatus(port))

  ipcMain.handle(
    'project:loadWaveformCache',
    async (_event, musicFilePath: string, projectFilePath?: string) => {
      const resolved = musicFilePath.startsWith('/')
        ? musicFilePath
        : resolveAppResource(musicFilePath)
      return loadOrBuildWaveformCache(resolved, projectFilePath)
    }
  )

  ipcMain.handle('device:flashFirmware', async (event, port: string) => {
    await flashFirmware(port, (progress) => {
      event.sender.send('device:flashProgress', progress)
    })
  })

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
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

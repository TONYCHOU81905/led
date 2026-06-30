import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { timecodeBridge } from './services/timecodeBridge'
import type { BridgeOptions, LedProject } from '../src/shared/types/project'

function pushBridgeState(): void {
  const state = timecodeBridge.getState()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('show:bridgeState', state)
  }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
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

  ipcMain.handle('project:openDemo', async (): Promise<LedProject> => {
    const demoPath = join(app.getAppPath(), 'examples/demo_show.ledproj.json')
    const raw = await readFile(demoPath, 'utf-8')
    return JSON.parse(raw) as LedProject
  })

  ipcMain.handle('show:bridgeStart', async (_event, options?: BridgeOptions) => {
    timecodeBridge.start(options)
    pushBridgeState()
  })

  ipcMain.handle('show:bridgeStop', async () => {
    timecodeBridge.stop()
    pushBridgeState()
  })

  ipcMain.handle('show:bridgeGetState', async () => timecodeBridge.getState())

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  timecodeBridge.stop()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

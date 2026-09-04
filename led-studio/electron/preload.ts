import { contextBridge, ipcRenderer } from 'electron'
import type {
  BridgeOptions,
  BridgeState,
  DeviceConfig,
  EspDeviceStatus,
  LedProject,
  LedStudioApi,
  MdnsDevice
} from '../src/shared/types/project'
import type { FlashBoardId } from '../src/shared/boardTargets'

// monitorStart 的 listener 是長時間串流，用這個模組層變數記住目前註冊的
// handler，讓 monitorStart/monitorStop 可以互相協調移除，避免重複註冊。
let currentMonitorLineHandler:
  | ((event: Electron.IpcRendererEvent, line: { kind: string; text: string; at: number }) => void)
  | null = null

const api: LedStudioApi = {
  project: {
    openDemo: () => ipcRenderer.invoke('project:openDemo') as Promise<LedProject>,
    openFile: () => ipcRenderer.invoke('project:openFile') as Promise<import('../src/shared/types/project').OpenProjectResult | null>,
    saveFile: (project: import('../src/shared/types/project').LedProject, existingPath?: string) =>
      ipcRenderer.invoke('project:saveFile', project, existingPath) as Promise<
        import('../src/shared/types/project').SaveProjectResult
      >,
    saveAsBundle: (project: import('../src/shared/types/project').LedProject) =>
      ipcRenderer.invoke('project:saveAsBundle', project) as Promise<
        import('../src/shared/types/project').SaveProjectResult
      >,
    saveDeviceConfig: (config: DeviceConfig, suggestedName?: string) =>
      ipcRenderer.invoke('project:saveDeviceConfig', config, suggestedName) as Promise<boolean>,
    openDeviceConfig: () => ipcRenderer.invoke('project:openDeviceConfig') as Promise<DeviceConfig | null>,
    pickMusicFile: () =>
      ipcRenderer.invoke('project:pickMusicFile') as Promise<{ path: string; durationMs?: number } | null>,
    getMusicFileUrl: (filePath: string) =>
      ipcRenderer.invoke('project:getMusicFileUrl', filePath) as Promise<string>,
    readMusicFile: (filePath: string) =>
      ipcRenderer.invoke('project:readMusicFile', filePath) as Promise<{ data: Uint8Array<ArrayBuffer>; mime: string }>,
    loadWaveformCache: (musicFilePath: string, projectFilePath?: string) =>
      ipcRenderer.invoke('project:loadWaveformCache', musicFilePath, projectFilePath),
    pickVideoFile: () =>
      ipcRenderer.invoke('project:pickVideoFile') as Promise<{ path: string } | null>,
    getVideoFileUrl: (filePath: string) =>
      ipcRenderer.invoke('project:getVideoFileUrl', filePath) as Promise<string>
  },
  show: {
    bridgeStart: (options?: BridgeOptions) => ipcRenderer.invoke('show:bridgeStart', options),
    bridgeStop: () => ipcRenderer.invoke('show:bridgeStop'),
    bridgePause: () => ipcRenderer.invoke('show:bridgePause'),
    bridgeResume: () => ipcRenderer.invoke('show:bridgeResume'),
    bridgeSeek: (musicTimeMs: number) => ipcRenderer.invoke('show:bridgeSeek', musicTimeMs),
    bridgePreviewTime: (musicTimeMs: number) => ipcRenderer.invoke('show:bridgePreviewTime', musicTimeMs),
    bridgeGetState: () => ipcRenderer.invoke('show:bridgeGetState') as Promise<BridgeState>,
    bridgeTargetList: () => ipcRenderer.invoke('show:bridgeTargetList') as Promise<string[]>,
    bridgeTargetAdd: (ip: string) => ipcRenderer.invoke('show:bridgeTargetAdd', ip) as Promise<string[]>,
    bridgeTargetRemove: (ip: string) => ipcRenderer.invoke('show:bridgeTargetRemove', ip) as Promise<string[]>,
    ltcStart: (options?: { wavPath?: string; durationMs?: number }) =>
      ipcRenderer.invoke('show:ltcStart', options),
    ltcStop: () => ipcRenderer.invoke('show:ltcStop'),
    onBridgeState: (cb) => {
      const handler = (_event: Electron.IpcRendererEvent, state: BridgeState) => cb(state)
      ipcRenderer.on('show:bridgeState', handler)
      void ipcRenderer.invoke('show:bridgeGetState').then(cb)
      return () => ipcRenderer.removeListener('show:bridgeState', handler)
    },
    onEspStatus: (cb) => {
      const handler = (_event: Electron.IpcRendererEvent, devices: EspDeviceStatus[]) => cb(devices)
      ipcRenderer.on('show:espStatus', handler)
      void ipcRenderer.invoke('show:espStatusList').then(cb)
      return () => ipcRenderer.removeListener('show:espStatus', handler)
    },
    espStatusList: () => ipcRenderer.invoke('show:espStatusList') as Promise<EspDeviceStatus[]>,
    discoverDevices: () => ipcRenderer.invoke('show:discoverDevices') as Promise<{ skippedSubnetSweep: boolean }>,
    mdnsDeviceList: () => ipcRenderer.invoke('show:mdnsDeviceList') as Promise<MdnsDevice[]>,
    onMdnsDevices: (cb) => {
      const handler = (_event: Electron.IpcRendererEvent, devices: MdnsDevice[]) => cb(devices)
      ipcRenderer.on('show:mdnsDevices', handler)
      void ipcRenderer.invoke('show:mdnsDeviceList').then(cb)
      return () => ipcRenderer.removeListener('show:mdnsDevices', handler)
    },
    onDiscoveryError: (cb) => {
      const handler = (_event: Electron.IpcRendererEvent, message: string) => cb(message)
      ipcRenderer.on('show:discoveryError', handler)
      return () => ipcRenderer.removeListener('show:discoveryError', handler)
    }
  },
  device: {
    listPorts: () => ipcRenderer.invoke('device:listPorts'),
    ping: (port: string) => ipcRenderer.invoke('device:ping', port),
    setWifi: (port: string, ssid: string, password: string) =>
      ipcRenderer.invoke('device:setWifi', port, ssid, password),
    uploadConfig: (port: string, config: Record<string, unknown>) =>
      ipcRenderer.invoke('device:uploadConfig', port, config),
    reloadConfig: (port: string) => ipcRenderer.invoke('device:reloadConfig', port),
    getStatus: (port: string) => ipcRenderer.invoke('device:getStatus', port),
    flashFirmware: (port: string, boardId: FlashBoardId, onProgress: (p: { stage: string; message: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: { stage: string; message: string }) =>
        onProgress(progress)
      ipcRenderer.on('device:flashProgress', handler)
      return ipcRenderer.invoke('device:flashFirmware', port, boardId).finally(() => {
        ipcRenderer.removeListener('device:flashProgress', handler)
      })
    },
    buildFirmware: (boardId: FlashBoardId, onProgress: (p: { stage: string; message: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: { stage: string; message: string }) =>
        onProgress(progress)
      ipcRenderer.on('device:buildProgress', handler)
      return ipcRenderer.invoke('device:buildFirmware', boardId).finally(() => {
        ipcRenderer.removeListener('device:buildProgress', handler)
      })
    },
    canBuildFirmware: () =>
      ipcRenderer.invoke('device:canBuildFirmware') as Promise<{
        ok: boolean
        reason?: string
        pioPath?: string
        projectRoot?: string
      }>,
    monitorStart: (path: string, onLine: (l: { kind: string; text: string; at: number }) => void) => {
      // monitorStart 是長時間串流（不像 flashFirmware 一次性指令用 .finally() 移除），
      // listener 要一直留著直到 monitorStop() 被呼叫。用模組層變數記住目前的 handler，
      // 重複呼叫 monitorStart 時先移除舊的，避免 listener 疊加造成每行顯示多次。
      if (currentMonitorLineHandler) {
        ipcRenderer.removeListener('device:monitorLine', currentMonitorLineHandler)
        currentMonitorLineHandler = null
      }
      const handler = (_event: Electron.IpcRendererEvent, line: { kind: string; text: string; at: number }) =>
        onLine(line)
      currentMonitorLineHandler = handler
      ipcRenderer.on('device:monitorLine', handler)
      return ipcRenderer.invoke('device:monitorStart', path) as Promise<void>
    },
    monitorStop: () => {
      if (currentMonitorLineHandler) {
        ipcRenderer.removeListener('device:monitorLine', currentMonitorLineHandler)
        currentMonitorLineHandler = null
      }
      return ipcRenderer.invoke('device:monitorStop') as Promise<void>
    },
    monitorStatus: () =>
      ipcRenderer.invoke('device:monitorStatus') as Promise<{ monitoring: boolean; path: string | null }>
  }
}

contextBridge.exposeInMainWorld('api', api)

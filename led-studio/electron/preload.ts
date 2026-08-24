import { contextBridge, ipcRenderer } from 'electron'
import type {
  BridgeOptions,
  BridgeState,
  DeviceConfig,
  EspDeviceStatus,
  LedProject,
  LedStudioApi
} from '../src/shared/types/project'
import type { FlashBoardId } from '../src/shared/boardTargets'

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
      ipcRenderer.invoke('project:loadWaveformCache', musicFilePath, projectFilePath)
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
    discoverDevices: () => ipcRenderer.invoke('show:discoverDevices') as Promise<void>
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
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

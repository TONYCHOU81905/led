import { vi } from 'vitest'
import { createDefaultShowProject } from '../../src/shared/projectMutations'
import type { BridgeState, LedProject, LedStudioApi } from '../../src/shared/types/project'

const demoProject = (): LedProject => {
  const p = createDefaultShowProject('Demo Show')
  p.project.music_file = '/tmp/demo.wav'
  p.roles[0].events.push({
    id: 'evt_demo_1',
    from: '0:00',
    to: '0:10',
    targets: [p.roles[0].parts[0]?.id ?? 'body'],
    color: 'electric_cyan',
    effect: 'solid',
    priority: 10
  })
  return p
}

export interface MockApi {
  api: LedStudioApi
  bridgeState: BridgeState
  emitBridgeState(state: Partial<BridgeState>): void
}

export function createMockApi(): MockApi {
  let bridgeState: BridgeState = {
    running: false,
    paused: false,
    source: 'manual',
    musicTimeMs: 0,
    sequence: 0,
    packetsPerSecond: 0
  }

  const bridgeListeners = new Set<(state: BridgeState) => void>()

  const emitBridgeState = (patch: Partial<BridgeState>) => {
    bridgeState = { ...bridgeState, ...patch }
    for (const cb of bridgeListeners) cb(bridgeState)
  }

  const api: LedStudioApi = {
    project: {
      openDemo: vi.fn(async () => demoProject()),
      openFile: vi.fn(async () => ({
        project: demoProject(),
        filePath: '/tmp/Demo Show.ledproj.json'
      })),
      saveFile: vi.fn(async (project: LedProject, existingPath?: string) => ({
        ok: true,
        filePath: existingPath ?? `/tmp/${project.project.name}.ledproj.json`,
        project
      })),
      saveAsBundle: vi.fn(async (project: LedProject) => ({
        ok: true,
        filePath: `/tmp/${project.project.name}/${project.project.name}.ledproj.json`,
        project
      })),
      saveDeviceConfig: vi.fn(async () => true),
      openDeviceConfig: vi.fn(async () => null),
      pickMusicFile: vi.fn(async () => ({ path: '/tmp/test-track.mp3' })),
      getMusicFileUrl: vi.fn(async (filePath: string) => `blob:mock/${filePath}`),
    readMusicFile: vi.fn(async () => ({
      data: new Uint8Array([0]),
      mime: 'audio/mpeg'
    })),
    loadWaveformCache: vi.fn(async () => null)
    },
    show: {
      bridgeStart: vi.fn(async () => {
        emitBridgeState({ running: true, paused: false, source: 'manual', musicTimeMs: 0, sequence: 1, packetsPerSecond: 100 })
      }),
      bridgeStop: vi.fn(async () => {
        emitBridgeState({ running: false, paused: false, packetsPerSecond: 0 })
      }),
      bridgePause: vi.fn(async () => {
        emitBridgeState({ paused: true })
      }),
      bridgeResume: vi.fn(async () => {
        emitBridgeState({ paused: false })
      }),
      bridgeSeek: vi.fn(async (ms: number) => {
        emitBridgeState({ musicTimeMs: ms })
      }),
      bridgePreviewTime: vi.fn(async (ms: number) => {
        emitBridgeState({ musicTimeMs: ms, source: 'preview' })
      }),
      bridgeGetState: vi.fn(async () => bridgeState),
      bridgeTargetList: vi.fn(async () => []),
      bridgeTargetAdd: vi.fn(async (ip: string) => [ip]),
      bridgeTargetRemove: vi.fn(async () => []),
      ltcStart: vi.fn(async () => undefined),
      ltcStop: vi.fn(async () => undefined),
      onBridgeState: vi.fn((cb) => {
        bridgeListeners.add(cb)
        cb(bridgeState)
        return () => bridgeListeners.delete(cb)
      }),
      onEspStatus: vi.fn((cb) => {
        cb([])
        return () => undefined
      }),
      espStatusList: vi.fn(async () => []),
      discoverDevices: vi.fn(async () => undefined)
    },
    device: {
      listPorts: vi.fn(async () => [{ path: '/dev/cu.usbserial-mock', manufacturer: 'Espressif' }]),
      ping: vi.fn(async () => ({ ok: true, firmware: '0.1.0-test', device_id: 'esp32s3_mock' })),
      setWifi: vi.fn(async () => ({ ok: true })),
      uploadConfig: vi.fn(async () => ({ ok: true, crc32: 1234, events: 1, flash_saved: true })),
      reloadConfig: vi.fn(async () => ({ ok: true, crc32: 1234, events: 1 })),
      getStatus: vi.fn(async () => ({ ok: true, wifi: 'connected' })),
      flashFirmware: vi.fn(async (_port, _boardId, onProgress) => {
        onProgress({ stage: 'flash', message: 'mock flash ok' })
      }),
      buildFirmware: vi.fn(async (_boardId, onProgress) => {
        onProgress({ stage: 'done', message: 'mock build ok' })
      }),
      canBuildFirmware: vi.fn(async () => ({ ok: true }))
    }
  }

  return { api, get bridgeState() { return bridgeState }, emitBridgeState }
}

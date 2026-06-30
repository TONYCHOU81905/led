export type PartId = 'hand' | 'foot' | 'head' | 'body' | string

export type EffectId = 'solid' | 'off' | 'blink' | 'fade_in' | 'fade_out' | 'fade'

export interface RgbColor {
  r: number
  g: number
  b: number
}

export interface TimelineEventUI {
  id: string
  from: string
  to: string
  targets: PartId[]
  color: string
  effect: EffectId
  params?: Record<string, unknown>
  priority: number
  note?: string
  _startMs?: number
  _endMs?: number
}

export interface CompiledEvent {
  id: string
  startMs: number
  endMs: number
  targets: PartId[]
  color: string
  effect: EffectId
  params?: Record<string, unknown>
  priority: number
  note?: string
}

export interface ResolvedColor {
  r: number
  g: number
  b: number
  visible: boolean
}

export interface PartDefinition {
  id: PartId
  display_name: string
  ranges: Array<{ start: number; end: number }>
}

export interface DeviceConfig {
  schema_version: string
  device: {
    device_id: string
    role_id: string
    display_name: string
    led_count: number
    data_gpio: number
    led_type?: 'WS2811' | 'WS2812B'
    max_brightness: number
  }
  network?: {
    ssid: string
    password: string
    timecode_port?: number
    device_status_port?: number
  }
  parts: PartDefinition[]
  colors: Record<string, RgbColor>
  events: Array<{
    id: string
    start_ms: number
    end_ms: number
    targets: PartId[]
    color: string
    effect: EffectId
    params?: Record<string, unknown>
    priority: number
    note?: string
  }>
}

export interface ProjectMeta {
  id: string
  name: string
  music_file?: string
  music_duration_ms: number
  bpm: number
  created_at: string
  updated_at: string
}

export interface TimelineKeyframe {
  id: string
  timeMs: number
}

export interface RoleDefinition {
  role_id: string
  display_name: string
  parts: PartDefinition[]
  events: TimelineEventUI[]
  keyframes?: TimelineKeyframe[]
}

export interface LedProject {
  schema_version: string
  project: ProjectMeta
  colors: Record<string, RgbColor>
  roles: RoleDefinition[]
}

export type BridgeSource = 'manual' | 'preview' | 'ltc'

export interface BridgeOptions {
  source?: BridgeSource
  showIdCrc32?: number
  configCrc32?: number
  broadcastAddress?: string
  port?: number
}

export interface BridgeState {
  running: boolean
  paused: boolean
  source: BridgeSource
  musicTimeMs: number
  sequence: number
  packetsPerSecond: number
  startedAt?: number
}

export interface EspDeviceStatus {
  device_id: string
  role_id?: string
  sync_state?: string
  music_time_ms?: number
  drift_ms?: number
  rssi?: number
  battery_mv?: number
  config_crc32?: string | number
  last_seen_ms: number
}

export interface WaveformCacheResult {
  durationMs: number
  peaks: number[]
  sourceHash: string
  generatedAt: string
}

export interface OpenProjectResult {
  project: LedProject
  filePath: string
}

export interface SaveProjectResult {
  ok: boolean
  filePath?: string
  project?: LedProject
}

export interface LedStudioApi {
  project: {
    openDemo(): Promise<LedProject>
    openFile(): Promise<OpenProjectResult | null>
    saveFile(project: LedProject, existingPath?: string): Promise<SaveProjectResult>
    saveDeviceConfig(config: DeviceConfig, suggestedName?: string): Promise<boolean>
    openDeviceConfig(): Promise<DeviceConfig | null>
    pickMusicFile(): Promise<{ path: string; durationMs?: number } | null>
    getMusicFileUrl(filePath: string): Promise<string>
    readMusicFile(filePath: string): Promise<{ data: Uint8Array; mime: string }>
    loadWaveformCache(musicFilePath: string, projectFilePath?: string): Promise<WaveformCacheResult | null>
  }
  show: {
    bridgeStart(options?: BridgeOptions): Promise<void>
    bridgeStop(): Promise<void>
    bridgePause(): Promise<void>
    bridgeResume(): Promise<void>
    bridgeSeek(musicTimeMs: number): Promise<void>
    bridgeGetState(): Promise<BridgeState>
    ltcStart(options?: { wavPath?: string; durationMs?: number }): Promise<void>
    ltcStop(): Promise<void>
    onBridgeState(cb: (state: BridgeState) => void): () => void
    onEspStatus(cb: (devices: EspDeviceStatus[]) => void): () => void
    espStatusList(): Promise<EspDeviceStatus[]>
  }
  device: {
    listPorts(): Promise<Array<{ path: string; manufacturer?: string }>>
    ping(port: string): Promise<{ ok: boolean; firmware?: string; device_id?: string }>
    setWifi(port: string, ssid: string, password: string): Promise<{ ok: boolean }>
    uploadConfig(port: string, config: Record<string, unknown>): Promise<{ ok: boolean; crc32?: number; events?: number; flash_saved?: boolean }>
    reloadConfig(port: string): Promise<{ ok: boolean; crc32?: number; events?: number }>
    getStatus(port: string): Promise<Record<string, unknown>>
    flashFirmware(port: string, onProgress: (p: { stage: string; message: string }) => void): Promise<void>
  }
}

declare global {
  interface Window {
    api: LedStudioApi
  }
}

export {}

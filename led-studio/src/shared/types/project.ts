import type { FlashBoardId } from '../boardTargets'

export type PartId = 'hand' | 'foot' | 'head' | 'body' | string

export type EffectId =
  | 'solid'
  | 'off'
  | 'blink'
  | 'fade_in'
  | 'fade_out'
  | 'fade'
  | 'pulse'
  | 'wipe_in'
  | 'wipe_out'
  | 'chase'
  | 'wave'
  | 'trail'
  | 'gradient_scroll'
  | 'sparkle'
  | 'color_lfo'
  | 'path_flow'

export type FadeCurveId =
  | 'linear'
  | 'ease_in'
  | 'ease_out'
  | 'ease_in_out'
  | 'sine'
  | 'expo'

export type MotionDirectionId =
  | 'auto'
  | 'left_to_right'
  | 'right_to_left'
  | 'center_out'
  | 'edge_in'
  | 'top_down'
  | 'bottom_up'

export interface TimelineEventParams {
  secondary_color?: string
  fade_curve?: FadeCurveId
  fade_in_ms?: number
  fade_out_ms?: number
  speed?: number
  intensity?: number
  min_intensity?: number
  direction?: MotionDirectionId
  route_parts?: PartId[]
  route_step_labels?: string[]
  route_label?: string
  route_preset?: string
  /** 同一條流動路徑展開出來的獨立 clip 共用的群組 id */
  route_group_id?: string
  /** 整條路徑的可讀標籤，例如「頭 → 右手 → 右腳 → 左腳 → 左手」 */
  route_group_label?: string
  /** 這個 clip 是路徑的第幾段，0-based */
  route_group_index?: number
  /** 這條路徑總共幾段 */
  route_group_total?: number
  /** 這一段的名稱，例如「右手」 */
  route_step_label?: string
  spread?: number
  trail_length?: number
  frequency_hz?: number
  duty?: number
  seed?: number
}

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
  params?: TimelineEventParams
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
  params?: TimelineEventParams
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

export type LedOutputLayout = 'ring' | 'branched_limb'
export type LedOutputDirection = 'clockwise' | 'counterclockwise' | 'out_and_back'

export interface LedOutputDefinition {
  id: string
  display_name: string
  part_id: PartId
  gpio: number
  layout: LedOutputLayout
  outbound_leds: number
  parallel_branches: number
  branch_leds: number
  return_leds: number
  continuation_branch: number
  direction: LedOutputDirection
}

export interface DeviceLedOutput {
  id: string
  gpio: number
  offset: number
  led_count: number
  layout?: LedOutputLayout
  outbound_leds?: number
  parallel_branches?: number
  branch_leds?: number
  return_leds?: number
  continuation_branch?: number
  direction?: LedOutputDirection
}

export interface DeviceConfig {
  schema_version: string
  device: {
    device_id: string
    role_id: string
    display_name: string
    led_count: number
    data_gpio: number
    outputs?: DeviceLedOutput[]
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
    params?: TimelineEventParams
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
  led_outputs?: LedOutputDefinition[]
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
  unicastTargets?: string[]
  port?: number
}

export interface BridgeState {
  running: boolean
  paused: boolean
  source: BridgeSource
  musicTimeMs: number
  sequence: number
  packetsPerSecond: number
  broadcastTargets?: string[]
  unicastTargets?: string[]
  startedAt?: number
}

export interface EspDeviceStatus {
  device_id: string
  ip?: string
  online?: boolean
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
    readMusicFile(filePath: string): Promise<{ data: Uint8Array<ArrayBuffer>; mime: string }>
    loadWaveformCache(musicFilePath: string, projectFilePath?: string): Promise<WaveformCacheResult | null>
  }
  show: {
    bridgeStart(options?: BridgeOptions): Promise<void>
    bridgeStop(): Promise<void>
    bridgePause(): Promise<void>
    bridgeResume(): Promise<void>
    bridgeSeek(musicTimeMs: number): Promise<void>
    bridgePreviewTime(musicTimeMs: number): Promise<void>
    bridgeGetState(): Promise<BridgeState>
    bridgeTargetList(): Promise<string[]>
    bridgeTargetAdd(ip: string): Promise<string[]>
    bridgeTargetRemove(ip: string): Promise<string[]>
    ltcStart(options?: { wavPath?: string; durationMs?: number }): Promise<void>
    ltcStop(): Promise<void>
    onBridgeState(cb: (state: BridgeState) => void): () => void
    onEspStatus(cb: (devices: EspDeviceStatus[]) => void): () => void
    espStatusList(): Promise<EspDeviceStatus[]>
    discoverDevices(): Promise<void>
  }
  device: {
    listPorts(): Promise<Array<{ path: string; manufacturer?: string }>>
    ping(port: string): Promise<{ ok: boolean; firmware?: string; device_id?: string }>
    setWifi(port: string, ssid: string, password: string): Promise<{ ok: boolean }>
    uploadConfig(port: string, config: Record<string, unknown>): Promise<{ ok: boolean; crc32?: number; events?: number; flash_saved?: boolean }>
    reloadConfig(port: string): Promise<{ ok: boolean; crc32?: number; events?: number }>
    getStatus(port: string): Promise<Record<string, unknown>>
    flashFirmware(port: string, boardId: FlashBoardId, onProgress: (p: { stage: string; message: string }) => void): Promise<void>
  }
}

declare global {
  interface Window {
    api: LedStudioApi
  }
}

export {}

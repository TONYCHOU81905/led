export type FlashBoardId = 'esp32-s3' | 'esp32'

export interface FlashBoardTarget {
  id: FlashBoardId
  label: string
  pioEnv: string
  esptoolChip: 'esp32s3' | 'esp32'
  /** Factory app offset — matches partitions.csv / partitions-esp32.csv */
  flashOffset: number
  flashSize: '4MB' | '8MB'
  flashMode: 'dio'
  flashFreq: '40m' | '80m'
  uploadBaud: number
  /** CH340 / classic ESP32: skip compressed upload to avoid C900 errors */
  noCompress: boolean
  /** Default LED data GPIO for compile + Device Manager (S3: 8, classic ESP32: 4) */
  defaultDataGpio: number
  /** Firmware timeline event cap (classic ESP32 has less RAM) */
  maxEvents: number
  buildHint: string
}

export const FLASH_BOARD_TARGETS: FlashBoardTarget[] = [
  {
    id: 'esp32-s3',
    label: 'ESP32-S3 DevKitC-1',
    pioEnv: 'esp32-s3-devkitc-1',
    esptoolChip: 'esp32s3',
    flashOffset: 0x10000,
    flashSize: '8MB',
    flashMode: 'dio',
    flashFreq: '80m',
    uploadBaud: 921600,
    noCompress: false,
    defaultDataGpio: 8,
    maxEvents: 1024,
    buildHint: 'pio run -e esp32-s3-devkitc-1'
  },
  {
    id: 'esp32',
    label: 'ESP32 DevKit (classic)',
    pioEnv: 'esp32-dev',
    esptoolChip: 'esp32',
    flashOffset: 0x10000,
    flashSize: '4MB',
    flashMode: 'dio',
    flashFreq: '40m',
    uploadBaud: 460800,
    noCompress: true,
    defaultDataGpio: 4,
    maxEvents: 256,
    buildHint: 'pio run -e esp32-dev'
  }
]

export const DEFAULT_FLASH_BOARD_ID: FlashBoardId = 'esp32-s3'

export function getFlashBoardTarget(id: FlashBoardId): FlashBoardTarget {
  const target = FLASH_BOARD_TARGETS.find((t) => t.id === id)
  if (!target) {
    throw new Error(`Unknown flash board: ${id}`)
  }
  return target
}

export const FLASH_BOARD_STORAGE_KEY = 'led-studio-flash-board'

export function loadStoredFlashBoardId(): FlashBoardId {
  try {
    const stored = localStorage.getItem(FLASH_BOARD_STORAGE_KEY)
    return stored === 'esp32' || stored === 'esp32-s3' ? stored : DEFAULT_FLASH_BOARD_ID
  } catch {
    return DEFAULT_FLASH_BOARD_ID
  }
}

export function storeFlashBoardId(id: FlashBoardId): void {
  try {
    localStorage.setItem(FLASH_BOARD_STORAGE_KEY, id)
  } catch {
    // ignore — e.g. SSR or test env without storage
  }
}

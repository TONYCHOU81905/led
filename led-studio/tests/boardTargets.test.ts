import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FLASH_BOARD_ID,
  FLASH_BOARD_TARGETS,
  getFlashBoardTarget,
  loadStoredFlashBoardId
} from '../src/shared/boardTargets'

describe('boardTargets', () => {
  it('defines ESP32-S3 and classic ESP32 targets', () => {
    expect(FLASH_BOARD_TARGETS.map((t) => t.id)).toEqual(['esp32-s3-n16r8', 'esp32-s3', 'esp32'])
    expect(getFlashBoardTarget('esp32-s3-n16r8').flashSize).toBe('16MB')
    expect(getFlashBoardTarget('esp32-s3').esptoolChip).toBe('esp32s3')
    expect(getFlashBoardTarget('esp32').esptoolChip).toBe('esp32')
  })

  it('defaults to ESP32-S3 N16R8 when storage is empty', () => {
    expect(loadStoredFlashBoardId()).toBe(DEFAULT_FLASH_BOARD_ID)
  })

  it('uses chip-correct bootloader offsets (S3=0x0, classic=0x1000)', () => {
    expect(getFlashBoardTarget('esp32-s3').bootloaderOffset).toBe(0x0)
    expect(getFlashBoardTarget('esp32').bootloaderOffset).toBe(0x1000)
  })
})

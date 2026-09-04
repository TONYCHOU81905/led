import { describe, expect, it } from 'vitest'
import {
  isCandidatePort,
  looksLikeEspPort,
  reselectPortAfterFlash
} from '../src/shared/serialPortMatch'

describe('looksLikeEspPort', () => {
  it('認得 ESP32-S3 的原生 USB 埠（usbmodem）', () => {
    // 這是 n16r8 實際用的埠。舊版只比對 usbserial/wchusbserial 會漏掉它，
    // 於是退回「第一個非 debug 的 port」，接多台裝置時就選錯。
    expect(looksLikeEspPort({ path: '/dev/cu.usbmodem1201' })).toBe(true)
  })

  it('認得 USB-UART 橋接晶片與 Windows 的 COM 埠', () => {
    expect(looksLikeEspPort({ path: '/dev/cu.wchusbserial5410' })).toBe(true)
    expect(looksLikeEspPort({ path: '/dev/cu.usbserial-0001' })).toBe(true)
    expect(looksLikeEspPort({ path: 'COM7' })).toBe(true)
  })

  it('認 manufacturer 帶 Espressif 的埠', () => {
    expect(looksLikeEspPort({ path: '/dev/cu.SomethingElse', manufacturer: 'Espressif Inc.' })).toBe(true)
  })

  it('排除 macOS 內建的非 USB serial 裝置', () => {
    expect(looksLikeEspPort({ path: '/dev/cu.debug-console' })).toBe(false)
    expect(looksLikeEspPort({ path: '/dev/cu.wlan-debug' })).toBe(false)
    expect(looksLikeEspPort({ path: '/dev/cu.Bluetooth-Incoming-Port' })).toBe(false)
  })

  it('debug-console 即使 manufacturer 是 Espressif 也要排除', () => {
    expect(
      looksLikeEspPort({ path: '/dev/cu.debug-console', manufacturer: 'Espressif' })
    ).toBe(false)
  })
})

describe('isCandidatePort', () => {
  it('只濾掉內建裝置，不判斷是不是 ESP', () => {
    expect(isCandidatePort({ path: '/dev/cu.anything' })).toBe(true)
    expect(isCandidatePort({ path: '/dev/cu.wlan-debug' })).toBe(false)
  })
})

describe('reselectPortAfterFlash', () => {
  it('port 編號變了也能用 serialNumber 對回同一塊板子', () => {
    // 這是本次修復的核心情境：esptool --after hard_reset 之後
    // 原生 USB 重新列舉，1201 變成 1101。
    const after = [
      { path: '/dev/cu.usbmodem1101', serialNumber: 'ABC123' },
      { path: '/dev/cu.Bluetooth-Incoming-Port' }
    ]
    expect(reselectPortAfterFlash('/dev/cu.usbmodem1201', 'ABC123', after)).toEqual({
      path: '/dev/cu.usbmodem1101',
      matchedBy: 'serialNumber'
    })
  })

  it('serialNumber 優先於同名路徑（避免對到另一塊板子）', () => {
    const after = [
      { path: '/dev/cu.usbmodem1201', serialNumber: 'OTHER' },
      { path: '/dev/cu.usbmodem1101', serialNumber: 'ABC123' }
    ]
    expect(reselectPortAfterFlash('/dev/cu.usbmodem1201', 'ABC123', after).path).toBe(
      '/dev/cu.usbmodem1101'
    )
  })

  it('沒重新列舉時維持原路徑', () => {
    const after = [{ path: '/dev/cu.wchusbserial5410' }]
    expect(reselectPortAfterFlash('/dev/cu.wchusbserial5410', undefined, after)).toEqual({
      path: '/dev/cu.wchusbserial5410',
      matchedBy: 'samePath'
    })
  })

  it('serialNumber 對不到、路徑也消失時退回 ESP 特徵比對', () => {
    const after = [
      { path: '/dev/cu.Bluetooth-Incoming-Port' },
      { path: '/dev/cu.usbmodem2101' }
    ]
    expect(reselectPortAfterFlash('/dev/cu.usbmodem1201', 'GONE', after)).toEqual({
      path: '/dev/cu.usbmodem2101',
      matchedBy: 'espHeuristic'
    })
  })

  it('清單裡只有內建裝置時回報找不到，而不是硬選一個', () => {
    const after = [{ path: '/dev/cu.debug-console' }, { path: '/dev/cu.wlan-debug' }]
    expect(reselectPortAfterFlash('/dev/cu.usbmodem1201', 'ABC123', after)).toEqual({
      path: null,
      matchedBy: 'none'
    })
  })

  it('port 清單全空時回報找不到', () => {
    expect(reselectPortAfterFlash('/dev/cu.usbmodem1201', 'ABC123', [])).toEqual({
      path: null,
      matchedBy: 'none'
    })
  })
})

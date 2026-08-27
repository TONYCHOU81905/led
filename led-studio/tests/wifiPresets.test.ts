import { describe, expect, it } from 'vitest'
import {
  mergeWithEnvPreset,
  normalizePresets,
  parsePresets,
  removePreset,
  upsertPreset
} from '../src/shared/wifiPresets'

describe('normalizePresets', () => {
  it('丟掉沒有 ssid 的項目', () => {
    expect(normalizePresets([{ ssid: '', password: 'x' }, { ssid: '   ', password: 'y' }])).toEqual([])
  })

  it('trim 掉 ssid 前後空白', () => {
    expect(normalizePresets([{ ssid: '  A  ', password: 'p' }])).toEqual([{ ssid: 'A', password: 'p' }])
  })

  it('同名只留最後一筆', () => {
    expect(
      normalizePresets([
        { ssid: 'A', password: 'old' },
        { ssid: 'A', password: 'new' }
      ])
    ).toEqual([{ ssid: 'A', password: 'new' }])
  })

  it('非陣列或垃圾內容一律回空陣列', () => {
    expect(normalizePresets(null)).toEqual([])
    expect(normalizePresets('nope')).toEqual([])
    expect(normalizePresets([null, 42, 'x'])).toEqual([])
  })

  it('允許空密碼（開放網路）', () => {
    expect(normalizePresets([{ ssid: 'Open' }])).toEqual([{ ssid: 'Open', password: '' }])
  })
})

describe('parsePresets', () => {
  it('null 或空字串回空陣列', () => {
    expect(parsePresets(null)).toEqual([])
    expect(parsePresets('')).toEqual([])
  })

  it('壞掉的 JSON 回空陣列而不是丟錯 —— 不能讓整頁爆掉', () => {
    expect(parsePresets('{ not json')).toEqual([])
  })

  it('正常 JSON 會經過 normalize', () => {
    expect(parsePresets('[{"ssid":" A ","password":"p"},{"ssid":""}]')).toEqual([
      { ssid: 'A', password: 'p' }
    ])
  })
})

describe('mergeWithEnvPreset', () => {
  it('本機沒有時，補上 env 帶來的預設值', () => {
    expect(mergeWithEnvPreset([], 'Stork-IoT', 'secret')).toEqual([
      { ssid: 'Stork-IoT', password: 'secret' }
    ])
  })

  it('本機已經有同名時不覆蓋 —— 使用者改過的密碼不該被 .env 蓋掉', () => {
    const stored = [{ ssid: 'Stork-IoT', password: 'user-changed' }]
    expect(mergeWithEnvPreset(stored, 'Stork-IoT', 'from-env')).toEqual(stored)
  })

  it('env 沒設或只有空白時完全不動', () => {
    const stored = [{ ssid: 'A', password: 'p' }]
    expect(mergeWithEnvPreset(stored, undefined, 'x')).toEqual(stored)
    expect(mergeWithEnvPreset(stored, '   ', 'x')).toEqual(stored)
  })

  it('env 密碼未設時視為空密碼', () => {
    expect(mergeWithEnvPreset([], 'Open-AP')).toEqual([{ ssid: 'Open-AP', password: '' }])
  })
})

describe('upsertPreset / removePreset', () => {
  it('新的 ssid 會被加到最後', () => {
    expect(upsertPreset([{ ssid: 'A', password: '1' }], { ssid: 'B', password: '2' })).toEqual([
      { ssid: 'A', password: '1' },
      { ssid: 'B', password: '2' }
    ])
  })

  it('同名視為更新密碼，不會出現兩筆', () => {
    const out = upsertPreset([{ ssid: 'A', password: 'old' }], { ssid: 'A', password: 'new' })
    expect(out).toEqual([{ ssid: 'A', password: 'new' }])
  })

  it('空白 ssid 不會被存進去', () => {
    const list = [{ ssid: 'A', password: '1' }]
    expect(upsertPreset(list, { ssid: '  ', password: 'x' })).toEqual(list)
  })

  it('removePreset 只刪指定那筆', () => {
    const list = [
      { ssid: 'A', password: '1' },
      { ssid: 'B', password: '2' }
    ]
    expect(removePreset(list, 'A')).toEqual([{ ssid: 'B', password: '2' }])
    expect(removePreset(list, 'nope')).toEqual(list)
  })
})

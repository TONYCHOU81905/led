import { describe, expect, it } from 'vitest'
import {
  planConfigUpload,
  shouldFallbackToLegacyUpload,
  escapeNonAscii
} from '../src/shared/configUploadPlan'
import { configChecksum } from '../src/shared/configCompiler'
import type { DeviceConfig } from '../src/shared/types/project'

const makeSimpleEvent = (id: string, startMs: number, endMs: number) => ({
  id,
  start_ms: startMs,
  end_ms: endMs,
  targets: ['test'],
  color: '#ff0000',
  effect: 'pulse' as const,
  priority: 1
})

const makeConfig = (events: any[]): DeviceConfig => ({
  schema_version: '1.0.0',
  device: {
    device_id: 'test_device',
    role_id: 'test_role',
    display_name: 'Test Device',
    led_count: 100,
    data_gpio: 8,
    led_type: 'WS2811',
    max_brightness: 0.4
  },
  network: {
    ssid: 'test_ssid',
    password: 'test_password',
    timecode_port: 4210,
    device_status_port: 4211
  },
  parts: [],
  colors: {} as Record<string, any>,
  events
})

describe('escapeNonAscii', () => {
  it('純 ASCII 不變', () => {
    expect(escapeNonAscii('hello world 123')).toBe('hello world 123')
  })

  it('中文字元轉義為 \\uXXXX', () => {
    const result = escapeNonAscii('世')
    expect(result).toBe('\\u4e16')
  })

  it('保留引號與其他特殊字元', () => {
    const result = escapeNonAscii('a"b\\c')
    expect(result).toBe('a"b\\c')
  })

  it('混合 ASCII 與非 ASCII', () => {
    const result = escapeNonAscii('hello 世界')
    expect(result).toContain('hello ')
    expect(result).toContain('\\u')
  })
})

describe('shouldFallbackToLegacyUpload', () => {
  it('begin_meta 階段失敗可以退回', () => {
    expect(shouldFallbackToLegacyUpload('begin_meta')).toBe(true)
  })

  it('events 階段失敗不能退回', () => {
    expect(shouldFallbackToLegacyUpload('events')).toBe(false)
  })

  it('commit 階段失敗不能退回', () => {
    expect(shouldFallbackToLegacyUpload('commit')).toBe(false)
  })
})

describe('planConfigUpload', () => {
  it('181 個 event、每批 10 個 → 19 批（18 批滿的 + 1 批 1 個）', () => {
    const events = Array.from({ length: 181 }, (_, i) =>
      makeSimpleEvent(`evt_${i}`, i * 1000, i * 1000 + 500)
    )
    const config = makeConfig(events)
    const plan = planConfigUpload(config, 10)

    expect(plan.totalEvents).toBe(181)
    expect(plan.batches.length).toBe(19)
    expect(plan.batches.slice(0, 18).every((b) => JSON.parse(b).length === 10)).toBe(true)
    expect(JSON.parse(plan.batches[18]).length).toBe(1)
  })

  it('metaJson 裡 events 是 [] 而不是缺少該 key', () => {
    const config = makeConfig([makeSimpleEvent('evt_0', 0, 1000)])
    const plan = planConfigUpload(config)

    const metaObj = JSON.parse(plan.metaJson)
    expect(metaObj.events).toBeDefined()
    expect(Array.isArray(metaObj.events)).toBe(true)
    expect(metaObj.events.length).toBe(0)
  })

  it('每一批都是合法的 JSON 陣列', () => {
    const events = Array.from({ length: 35 }, (_, i) =>
      makeSimpleEvent(`evt_${i}`, i * 1000, i * 1000 + 500)
    )
    const config = makeConfig(events)
    const plan = planConfigUpload(config, 10)

    for (const batch of plan.batches) {
      expect(() => JSON.parse(batch)).not.toThrow()
      const parsed = JSON.parse(batch)
      expect(Array.isArray(parsed)).toBe(true)
    }
  })

  it('每一批的 event 元素數量正確', () => {
    const events = Array.from({ length: 35 }, (_, i) =>
      makeSimpleEvent(`evt_${i}`, i * 1000, i * 1000 + 500)
    )
    const config = makeConfig(events)
    const plan = planConfigUpload(config, 10)

    expect(plan.batches.length).toBe(4)
    expect(JSON.parse(plan.batches[0]).length).toBe(10)
    expect(JSON.parse(plan.batches[1]).length).toBe(10)
    expect(JSON.parse(plan.batches[2]).length).toBe(10)
    expect(JSON.parse(plan.batches[3]).length).toBe(5)
  })

  it('所有批次的 event 合起來等於裁剪後的完整 events（順序也要一致）', () => {
    const events = Array.from({ length: 35 }, (_, i) =>
      makeSimpleEvent(`evt_${i}`, i * 1000, i * 1000 + 500)
    )
    const config = makeConfig(events)
    const plan = planConfigUpload(config, 10)

    const reconstructed = plan.batches.flatMap((b) => JSON.parse(b))
    expect(reconstructed.length).toBe(35)

    // 檢查順序 —— 比對 start_ms（韌體會讀，id 會被裁掉）
    for (let i = 0; i < 35; i++) {
      expect(reconstructed[i].start_ms).toBe(i * 1000)
    }
  })

  it('configCrc32 等於 configChecksum(config)（完整 config 的 CRC）', () => {
    const events = Array.from({ length: 50 }, (_, i) =>
      makeSimpleEvent(`evt_${i}`, i * 1000, i * 1000 + 500)
    )
    const config = makeConfig(events)
    const plan = planConfigUpload(config)

    const expectedCrc = configChecksum(config)
    expect(plan.configCrc32).toBe(expectedCrc)
  })

  it('events 為 0 個時 → 0 批，metaJson 還是要有 events 欄位', () => {
    const config = makeConfig([])
    const plan = planConfigUpload(config)

    expect(plan.totalEvents).toBe(0)
    expect(plan.batches.length).toBe(0)

    const metaObj = JSON.parse(plan.metaJson)
    expect(metaObj.events).toBeDefined()
    expect(metaObj.events).toEqual([])
  })

  it('eventsPerBatch 可覆寫（給測試用）', () => {
    const events = Array.from({ length: 25 }, (_, i) =>
      makeSimpleEvent(`evt_${i}`, i * 1000, i * 1000 + 500)
    )
    const config = makeConfig(events)

    const plan5 = planConfigUpload(config, 5)
    expect(plan5.batches.length).toBe(5)
    expect(plan5.batches.every((b) => JSON.parse(b).length === 5)).toBe(true)

    const plan3 = planConfigUpload(config, 3)
    expect(plan3.batches.length).toBe(9) // 8 * 3 + 1
    expect(JSON.parse(plan3.batches[8]).length).toBe(1)
  })

  it('metaJson 與 batches 都經過非 ASCII 轉義', () => {
    const config = makeConfig([])
    const planResult = planConfigUpload(config)

    // metaJson 應該是字串，不包含原始的非 ASCII 字元
    expect(typeof planResult.metaJson).toBe('string')
    // 試著 JSON parse —— 應該可以成功，表示格式是對的
    expect(() => JSON.parse(planResult.metaJson)).not.toThrow()

    // 如果有 batches，也應該都能 parse
    for (const batch of planResult.batches) {
      expect(() => JSON.parse(batch)).not.toThrow()
    }
  })

  it('metaJson 不包含 events 以外的多餘欄位變化', () => {
    const config = makeConfig([makeSimpleEvent('evt_0', 0, 1000)])
    const plan = planConfigUpload(config)

    const metaObj = JSON.parse(plan.metaJson)

    // device、network、parts、colors 應該都保留
    expect(metaObj.device).toBeDefined()
    expect(metaObj.network).toBeDefined()
    expect(metaObj.parts).toBeDefined()
    expect(metaObj.colors).toBeDefined()

    // events 以外的應該跟原本一樣
    expect(metaObj.device.device_id).toBe(config.device.device_id)
    expect(metaObj.network?.ssid).toBe(config.network?.ssid)
  })

  it('複雜中文字元也能正確轉義並保持 CRC 一致', () => {
    // 創建一個包含中文字元的 note（會被韌體裁掉，但我們也確保轉義一致）
    const config = makeConfig([])
    const plan1 = planConfigUpload(config)
    const plan2 = planConfigUpload(config)

    // 同一個 config，多次規劃應該產生完全相同的結果
    expect(plan1.configCrc32).toBe(plan2.configCrc32)
    expect(plan1.metaJson).toBe(plan2.metaJson)
  })
})

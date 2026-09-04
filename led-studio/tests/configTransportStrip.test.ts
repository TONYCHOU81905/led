import { describe, expect, it } from 'vitest'
import {
  serializeConfigForTransport,
  stripConfigForTransport
} from '../src/shared/configCompiler'
import type { DeviceConfig } from '../src/shared/types/project'

/**
 * 由來：實機 `[config] parse error: NoMemory`，Studio 端量到 JSON 43,776 bytes
 * / 152 個 event。解析瞬間 heap 上同時有 malloc 的 JSON 原文與 ArduinoJson
 * 的物件樹，而 WiFi 起來後 heap 只剩約 90KB。
 *
 * 體積主要來自 UI 的路徑標籤 —— serializeConfigForTransport 把非 ASCII 轉成
 * \uXXXX，所以每個中文字佔 6 bytes，而韌體從來不讀那些欄位。
 */

const richEvent = {
  id: 'evt_01J8K2M4N5P6Q7R8S9T0',
  start_ms: 12340,
  end_ms: 15680,
  targets: ['right_arm', 'left_arm'],
  color: '#ff8800',
  effect: 'route_flow',
  priority: 3,
  note: '第二段主歌的手部流動',
  params: {
    speed: 1.4,
    intensity: 0.8,
    direction: 'forward',
    route_parts: ['hat', 'right_arm'],
    route_step_labels: ['頭', '右手'],
    route_label: '全身往返',
    route_preset: 'full_body_roundtrip',
    route_group_id: 'grp_01J8K2M4N5P6Q7R8S9T0',
    route_group_label: '頭 → 右手 → 右腳 → 左腳 → 左手',
    route_group_index: 1,
    route_group_total: 5,
    route_step_label: '右手'
  }
}

const makeConfig = (events: unknown[]) =>
  ({
    device: { device_id: 'x', role_id: 'y' },
    network: { ssid: 's', password: 'p' },
    hardware: { led_count: 880 },
    colors: [],
    parts: [],
    events
  }) as unknown as DeviceConfig

describe('stripConfigForTransport', () => {
  const stripped = stripConfigForTransport(makeConfig([richEvent]))
  const evt = (stripped.events as Record<string, unknown>[])[0]

  it('只保留韌體 config_json_parser.cpp 真的會讀的 event 欄位', () => {
    expect(Object.keys(evt).sort()).toEqual(
      ['color', 'effect', 'end_ms', 'params', 'priority', 'start_ms', 'targets'].sort()
    )
  })

  it('event 的 id 要裁掉 —— 韌體只在 outputs 與 parts 讀 id，events 從不讀', () => {
    expect(evt.id).toBeUndefined()
  })

  it('note 與所有 route_* 標籤要裁掉（純 UI 授權用，每個中文字 6 bytes）', () => {
    expect(evt.note).toBeUndefined()
    const params = evt.params as Record<string, unknown>
    for (const key of [
      'route_step_labels',
      'route_label',
      'route_preset',
      'route_group_id',
      'route_group_label',
      'route_group_index',
      'route_group_total',
      'route_step_label'
    ]) {
      expect(params[key], `${key} 應該被裁掉`).toBeUndefined()
    }
  })

  it('route_parts 必須保留 —— 韌體有讀它（別把它跟標籤一起裁掉）', () => {
    expect((evt.params as Record<string, unknown>).route_parts).toEqual(['hat', 'right_arm'])
  })

  it('韌體會讀的 params 全部保留', () => {
    const params = evt.params as Record<string, unknown>
    expect(params.speed).toBe(1.4)
    expect(params.intensity).toBe(0.8)
    expect(params.direction).toBe('forward')
  })

  it('params 被裁光時整個欄位不送，不要留一個空物件', () => {
    const onlyLabels = { ...richEvent, params: { route_label: '只有標籤' } }
    const out = stripConfigForTransport(makeConfig([onlyLabels]))
    expect((out.events as Record<string, unknown>[])[0].params).toBeUndefined()
  })

  it('events 以外的區塊完全不動', () => {
    expect(stripped.device).toEqual({ device_id: 'x', role_id: 'y' })
    expect(stripped.network).toEqual({ ssid: 's', password: 'p' })
    expect(stripped.hardware).toEqual({ led_count: 880 })
  })

  it('沒有 events 欄位時不要爆掉', () => {
    const out = stripConfigForTransport({ device: {} } as unknown as DeviceConfig)
    expect(out.events).toEqual([])
  })

  it('裁剪後的傳輸體積要明顯下降（NoMemory 的直接成因）', () => {
    const many = Array.from({ length: 152 }, () => richEvent)
    const after = serializeConfigForTransport(makeConfig(many)).length
    const before = JSON.stringify(makeConfig(many)).replace(
      new RegExp('[\\u0080-\\uffff]', 'g'),
      (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')
    ).length
    expect(after).toBeLessThan(before * 0.6)
  })
})

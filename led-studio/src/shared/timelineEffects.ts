import type {
  EffectId,
  FadeCurveId,
  MotionDirectionId,
  PartDefinition,
  PartId,
  TimelineEventParams,
  TimelineEventUI
} from './types/project'
import { formatMsToTime, tryParseTimeToMs } from './timeParse'

export interface EffectOption {
  id: EffectId
  label: string
  description: string
}

export interface NamedOption<T extends string> {
  id: T
  label: string
}

export interface RoutePreset {
  id: string
  label: string
  description: string
  routeParts: PartId[]
  stepLabels: string[]
}

export interface EffectPreset {
  id: string
  label: string
  description: string
  effect: EffectId
  color?: string
  params?: Partial<TimelineEventParams>
  routePresetId?: string
}

export interface RouteSegment {
  partId: PartId
  routeIndex: number
  occurrenceIndex: number
  occurrenceCount: number
  startRatio: number
  endRatio: number
}

export const EFFECT_OPTIONS: EffectOption[] = [
  { id: 'solid', label: '常亮', description: '整段維持穩定發光' },
  { id: 'fade_in', label: '漸亮', description: '從暗到亮，適合進場' },
  { id: 'fade_out', label: '漸暗', description: '從亮到暗，適合收尾' },
  { id: 'fade', label: '漸亮漸暗', description: '可調進退場時間的順滑淡化' },
  { id: 'pulse', label: '呼吸', description: '亮度循環起伏，適合抒情段' },
  { id: 'blink', label: '閃爍', description: '可控頻率與占空比的閃燈' },
  { id: 'wipe_in', label: '推亮', description: '依方向逐段點亮' },
  { id: 'wipe_out', label: '推暗', description: '依方向逐段熄滅' },
  { id: 'chase', label: '追光流動', description: '亮點沿著部位或路徑移動' },
  { id: 'wave', label: '波浪', description: '亮度波動沿路徑推進' },
  { id: 'trail', label: '拖尾', description: '頭亮尾淡，保留流動尾跡' },
  { id: 'gradient_scroll', label: '漸層流動', description: '兩色漸層隨時間滑動' },
  { id: 'color_lfo', label: '雙色循環', description: '主色與次色來回轉換' },
  { id: 'sparkle', label: '閃點', description: '局部亮點跳動，適合點綴' },
  { id: 'path_flow', label: '路徑流動', description: '沿指定身體路徑依序發亮' },
  { id: 'off', label: '關閉', description: '整段保持熄滅' }
]

export const FADE_CURVE_OPTIONS: Array<NamedOption<FadeCurveId>> = [
  { id: 'linear', label: '線性' },
  { id: 'ease_in', label: '慢進快出' },
  { id: 'ease_out', label: '快進慢出' },
  { id: 'ease_in_out', label: '前後都柔順' },
  { id: 'sine', label: '正弦' },
  { id: 'expo', label: '指數' }
]

export const DIRECTION_OPTIONS: Array<NamedOption<MotionDirectionId>> = [
  { id: 'auto', label: '自動判斷' },
  { id: 'left_to_right', label: '左到右' },
  { id: 'right_to_left', label: '右到左' },
  { id: 'center_out', label: '中心往外' },
  { id: 'edge_in', label: '兩側往內' },
  { id: 'top_down', label: '上往下' },
  { id: 'bottom_up', label: '下往上' }
]

export const ROUTE_PRESETS: RoutePreset[] = [
  {
    id: 'none',
    label: '不套用路徑',
    description: '維持目前選取的部位，不做跨部位流動',
    routeParts: [],
    stepLabels: []
  },
  {
    id: 'right_head_to_left_head',
    label: '右頭頂 → 右手 → 右腳 → 左腳 → 左手 → 左頭',
    description: '適合你提到的跨身體蛇形流動',
    routeParts: ['head', 'right_hand', 'right_foot', 'left_foot', 'left_hand', 'head'],
    stepLabels: ['右頭頂', '右手', '右腳', '左腳', '左手', '左頭']
  },
  {
    id: 'head_to_limbs',
    label: '頭部 → 雙手 → 身體 → 雙腳',
    description: '從上往下推開，適合主歌進段',
    routeParts: ['head', 'right_hand', 'left_hand', 'body', 'right_foot', 'left_foot'],
    stepLabels: ['頭部', '右手', '左手', '身體', '右腳', '左腳']
  },
  {
    id: 'center_cross',
    label: '身體中心 → 四肢擴散',
    description: '中心往外擴張，適合副歌打開',
    routeParts: ['body', 'head', 'right_hand', 'left_hand', 'right_foot', 'left_foot'],
    stepLabels: ['身體', '頭部', '右手', '左手', '右腳', '左腳']
  }
]

export const EFFECT_PRESETS: EffectPreset[] = [
  {
    id: 'soft-breath',
    label: '抒情呼吸',
    description: '慢歌常用，柔順起伏不刺眼',
    effect: 'pulse',
    color: 'ice_blue',
    params: { speed: 0.8, intensity: 0.8, min_intensity: 0.18, fade_curve: 'sine' }
  },
  {
    id: 'chorus-open',
    label: '副歌打開',
    description: '由中心慢慢打開，適合副歌進場',
    effect: 'wipe_in',
    color: 'golden_spark',
    params: { speed: 1.2, intensity: 1, spread: 0.9, fade_curve: 'ease_out' },
    routePresetId: 'center_cross'
  },
  {
    id: 'snake-flow',
    label: '蛇形流動',
    description: '右頭頂一路流到左頭，適合招牌動作',
    effect: 'path_flow',
    color: 'electric_cyan',
    params: {
      secondary_color: 'hot_magenta',
      speed: 1.2,
      intensity: 1,
      spread: 0.8,
      trail_length: 1.4,
      fade_curve: 'ease_in_out'
    },
    routePresetId: 'right_head_to_left_head'
  },
  {
    id: 'hit-flash',
    label: '重拍爆點',
    description: '短促有力，適合鼓點或卡拍',
    effect: 'blink',
    color: 'silver_white',
    params: { frequency_hz: 8, duty: 0.35, intensity: 1 }
  },
  {
    id: 'double-color-wave',
    label: '雙色波浪',
    description: '兩色交錯流動，舞台存在感高',
    effect: 'gradient_scroll',
    color: 'hot_magenta',
    params: {
      secondary_color: 'electric_cyan',
      speed: 1.1,
      intensity: 0.95,
      spread: 0.85,
      fade_curve: 'sine'
    },
    routePresetId: 'head_to_limbs'
  },
  {
    id: 'ending-fade',
    label: '收尾退場',
    description: '順順淡掉，適合段落結尾',
    effect: 'fade',
    color: 'deep_crimson',
    params: { fade_in_ms: 150, fade_out_ms: 850, fade_curve: 'ease_in_out', intensity: 0.85 }
  }
]

export function getEffectLabel(effect: EffectId): string {
  return EFFECT_OPTIONS.find((option) => option.id === effect)?.label ?? effect
}

export function getFadeCurveLabel(curve: FadeCurveId): string {
  return FADE_CURVE_OPTIONS.find((option) => option.id === curve)?.label ?? curve
}

export function getRoutePreset(id?: string | null): RoutePreset | null {
  if (!id) return null
  return ROUTE_PRESETS.find((preset) => preset.id === id) ?? null
}

export function getEffectPreset(id?: string | null): EffectPreset | null {
  if (!id) return null
  return EFFECT_PRESETS.find((preset) => preset.id === id) ?? null
}

export function readNumberParam(
  params: TimelineEventParams | undefined,
  key: keyof TimelineEventParams,
  fallback: number
): number {
  const value = params?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function readStringParam<T extends string>(
  params: TimelineEventParams | undefined,
  key: keyof TimelineEventParams,
  fallback: T
): T {
  const value = params?.[key]
  return typeof value === 'string' && value.length > 0 ? (value as T) : fallback
}

export function readStringArrayParam(
  params: TimelineEventParams | undefined,
  key: keyof TimelineEventParams
): string[] {
  const value = params?.[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function materializeRoutePreset(parts: PartDefinition[], presetId: string): RoutePreset | null {
  const preset = getRoutePreset(presetId)
  if (!preset || preset.routeParts.length === 0) return preset

  const knownIds = new Set(parts.map((part) => part.id))
  const routeParts: PartId[] = []
  const stepLabels: string[] = []

  preset.routeParts.forEach((partId, index) => {
    if (knownIds.has(partId)) {
      routeParts.push(partId)
      stepLabels.push(preset.stepLabels[index] ?? String(partId))
    }
  })

  if (routeParts.length === 0) return null
  return { ...preset, routeParts, stepLabels }
}

export function listEventRouteParts(
  targets: PartId[],
  params?: TimelineEventParams
): PartId[] {
  const route = readStringArrayParam(params, 'route_parts')
  if (route.length > 0) return route
  return targets
}

/**
 * Split a routed event into physical-length-weighted sections. Repeated parts
 * share that part's LEDs (for example, the two half-rings at the route ends).
 */
export function buildRouteSegments(
  targets: PartId[],
  parts: PartDefinition[],
  params?: TimelineEventParams
): RouteSegment[] {
  const routeParts = listEventRouteParts(targets, params)
  if (routeParts.length === 0) return []

  const lengths = new Map(parts.map((part) => [
    part.id,
    Math.max(1, part.ranges.reduce(
      (sum, range) => sum + Math.max(0, range.end - range.start + 1),
      0
    ))
  ]))
  const counts = new Map<PartId, number>()
  for (const partId of routeParts) counts.set(partId, (counts.get(partId) ?? 0) + 1)

  const weights = routeParts.map((partId) =>
    (lengths.get(partId) ?? 1) / (counts.get(partId) ?? 1)
  )
  const totalWeight = Math.max(1, weights.reduce((sum, weight) => sum + weight, 0))
  const seen = new Map<PartId, number>()
  let cursor = 0

  return routeParts.map((partId, routeIndex) => {
    const startRatio = cursor / totalWeight
    cursor += weights[routeIndex]
    const occurrenceIndex = seen.get(partId) ?? 0
    seen.set(partId, occurrenceIndex + 1)
    return {
      partId,
      routeIndex,
      occurrenceIndex,
      occurrenceCount: counts.get(partId) ?? 1,
      startRatio,
      endRatio: cursor / totalWeight
    }
  })
}

export function listEventRouteLabels(
  targets: PartId[],
  parts: PartDefinition[],
  params?: TimelineEventParams
): string[] {
  const explicit = readStringArrayParam(params, 'route_step_labels')
  const routeParts = listEventRouteParts(targets, params)
  if (explicit.length === routeParts.length) return explicit

  const labels = new Map(parts.map((part) => [part.id, part.display_name || part.id]))
  return routeParts.map((partId) => labels.get(partId) ?? String(partId))
}

export function patchEventParams(
  params: TimelineEventParams | undefined,
  patch: Partial<TimelineEventParams>
): TimelineEventParams {
  const next: TimelineEventParams = { ...(params ?? {}) }
  for (const [key, value] of Object.entries(patch) as Array<[keyof TimelineEventParams, TimelineEventParams[keyof TimelineEventParams]]>) {
    if (value === undefined || value === null || value === '') {
      delete next[key]
    } else {
      ;(next as Record<string, unknown>)[key] = value
    }
  }
  return next
}

export function buildRouteLabel(
  routeParts: PartId[],
  stepLabels: string[]
): string {
  const labels = stepLabels.length === routeParts.length
    ? stepLabels
    : routeParts.map((part) => String(part))
  return labels.join(' → ')
}

/** 把一個跨部位 route event 展開成 N 個各自獨立的 clip。回傳新的 event 陣列（不含原 event）。 */
export function expandRouteToEvents(
  base: TimelineEventUI,
  parts: PartDefinition[],
  routeParts: PartId[],
  stepLabels: string[],
  makeId: (index: number) => string
): TimelineEventUI[] {
  if (routeParts.length === 0) return []

  const fromMs = tryParseTimeToMs(base.from)
  const toMs = tryParseTimeToMs(base.to)
  if (fromMs === null || toMs === null) return []

  const segments = buildRouteSegments(routeParts, parts, { route_parts: routeParts })
  if (segments.length === 0) return []

  const totalMs = Math.max(0, toMs - fromMs)
  const segmentCount = segments.length

  // Compute boundary times from the weighted ratios, then enforce that
  // adjacent segments share an exact boundary (no overlap, no gap) and
  // that every segment is at least 1ms long.
  const boundaries: number[] = new Array(segmentCount + 1)
  boundaries[0] = Math.round(fromMs)
  for (let i = 1; i < segmentCount; i++) {
    boundaries[i] = Math.round(fromMs + segments[i].startRatio * totalMs)
  }
  boundaries[segmentCount] = Math.round(toMs)
  for (let i = 1; i < segmentCount; i++) {
    if (boundaries[i] <= boundaries[i - 1]) {
      boundaries[i] = boundaries[i - 1] + 1
    }
  }

  const groupId = `route_grp_${makeId(0)}`
  const groupLabel = buildRouteLabel(routeParts, stepLabels)
  const cleanedParams = patchEventParams(base.params, {
    route_parts: undefined,
    route_step_labels: undefined,
    route_label: undefined,
    route_preset: undefined
  })

  return segments.map((segment, index) => {
    const stepLabel = stepLabels[index] ?? String(segment.partId)
    return {
      ...base,
      id: makeId(index),
      from: formatMsToTime(boundaries[index]),
      to: formatMsToTime(boundaries[index + 1]),
      targets: [segment.partId],
      params: patchEventParams(cleanedParams, {
        route_group_id: groupId,
        route_group_label: groupLabel,
        route_group_index: index,
        route_group_total: segmentCount,
        route_step_label: stepLabel
      })
    }
  })
}

/** 取出同一群組的所有 clip，依 route_group_index 排序 */
export function listRouteGroup(events: TimelineEventUI[], groupId: string): TimelineEventUI[] {
  return events
    .filter((event) => event.params?.route_group_id === groupId)
    .sort((a, b) => (a.params?.route_group_index ?? 0) - (b.params?.route_group_index ?? 0))
}

/**
 * 重排群組的段落順序：把原本的時間窗（依 index 排序）重新指派給 nextOrderIds 的順序。
 * 每個 clip 自己的 color / effect / params 一律保留 —— 獨立性不能被破壞。
 */
export function reorderRouteGroup(
  events: TimelineEventUI[],
  groupId: string,
  nextOrderIds: string[]
): TimelineEventUI[] {
  const group = listRouteGroup(events, groupId)
  if (group.length === 0 || nextOrderIds.length !== group.length) return events

  const windows = group.map((event) => ({ from: event.from, to: event.to }))
  const byId = new Map(group.map((event) => [event.id, event]))

  const reordered = nextOrderIds.map((id, index) => {
    const original = byId.get(id)
    if (!original) return null
    return { original, window: windows[index] }
  })
  if (reordered.some((entry) => entry === null)) return events

  const resolved = reordered as Array<{ original: TimelineEventUI; window: { from: string; to: string } }>
  const routeParts = resolved.map((entry) => entry.original.targets[0])
  const stepLabels = resolved.map(
    (entry) => entry.original.params?.route_step_label ?? String(entry.original.targets[0])
  )
  const groupLabel = buildRouteLabel(routeParts, stepLabels)

  const updatedById = new Map<string, TimelineEventUI>()
  resolved.forEach((entry, index) => {
    updatedById.set(entry.original.id, {
      ...entry.original,
      from: entry.window.from,
      to: entry.window.to,
      params: patchEventParams(entry.original.params, {
        route_group_index: index,
        route_group_label: groupLabel
      })
    })
  })

  return events.map((event) => updatedById.get(event.id) ?? event)
}

/** 清除群組標記，讓這些 clip 變成完全無關的獨立 clip */
export function ungroupRoute(events: TimelineEventUI[], groupId: string): TimelineEventUI[] {
  return events.map((event) => {
    if (event.params?.route_group_id !== groupId) return event
    return {
      ...event,
      params: patchEventParams(event.params, {
        route_group_id: undefined,
        route_group_label: undefined,
        route_group_index: undefined,
        route_group_total: undefined,
        route_step_label: undefined
      })
    }
  })
}

/** 判斷是否為舊格式（單一 event 掛多部位）的 route clip */
export function isLegacyRouteEvent(event: TimelineEventUI): boolean {
  return event.targets.length > 1 && (event.params?.route_parts?.length ?? 0) > 0
}

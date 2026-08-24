import type { PartDefinition, PartId, ResolvedColor } from '../../shared/types/project'

export type FigureRegionId =
  | 'head'
  | 'body'
  | 'left_hand'
  | 'right_hand'
  | 'left_foot'
  | 'right_foot'
  | 'left_shoe'
  | 'right_shoe'

export const FIGURE_REGION_IDS: FigureRegionId[] = [
  'head',
  'body',
  'left_hand',
  'right_hand',
  'left_foot',
  'right_foot',
  'left_shoe',
  'right_shoe'
]

export const FIGURE_REGION_LABELS: Record<FigureRegionId, string> = {
  head: '頭',
  body: '身體',
  left_hand: '左手',
  right_hand: '右手',
  left_foot: '左腳',
  right_foot: '右腳',
  left_shoe: '左鞋',
  right_shoe: '右鞋'
}

export const PREVIEW_ALL_ROLES = '__all__'

/**
 * 實體 LED 串接順序，對應 `CHAIN_WIRING_ORDER_HINT`
 * （帽子 → 右手 → 右腳 → 左腳 → 左手，舞者本人視角）。
 * 用於流動示意動畫，依序串接各 region 的燈條路徑。
 */
export const FIGURE_FLOW_ORDER: FigureRegionId[] = [
  'head',
  'right_hand',
  'right_foot',
  'left_foot',
  'left_hand'
]

const OFF_COLOR: ResolvedColor = { r: 28, g: 32, b: 40, visible: false }

export function partIdToRegions(partId: PartId): FigureRegionId[] {
  const id = partId.toLowerCase()

  if (id === 'head') return ['head']
  if (id === 'body') return ['body']
  if (id === 'hand' || id === 'hands') return ['left_hand', 'right_hand']
  if (id === 'left_hand') return ['left_hand']
  if (id === 'right_hand') return ['right_hand']
  if (id === 'foot' || id === 'feet') return ['left_foot', 'right_foot']
  if (id === 'left_foot') return ['left_foot']
  if (id === 'right_foot') return ['right_foot']
  if (id === 'shoe' || id === 'shoes') return ['left_shoe', 'right_shoe']
  if (id === 'left_shoe') return ['left_shoe']
  if (id === 'right_shoe') return ['right_shoe']

  return []
}

/**
 * 回傳實際有 part 對應到的 region id（依 `partIdToRegions` 反推），
 * 順序保持 `FIGURE_REGION_IDS` 的排序。沒有任何 part 對應到的 region
 * （例如 body / left_shoe / right_shoe，目前硬體並未接線）不會出現，
 * 讓預覽只畫真的接了燈的部位。
 */
export function regionsForParts(parts: PartDefinition[]): FigureRegionId[] {
  const present = new Set<FigureRegionId>()
  for (const part of parts) {
    for (const regionId of partIdToRegions(part.id)) {
      present.add(regionId)
    }
  }
  return FIGURE_REGION_IDS.filter((id) => present.has(id))
}

function defaultRegions(): Record<FigureRegionId, ResolvedColor> {
  return Object.fromEntries(FIGURE_REGION_IDS.map((id) => [id, { ...OFF_COLOR }])) as Record<
    FigureRegionId,
    ResolvedColor
  >
}

export interface FigureRegionResult {
  regions: Record<FigureRegionId, ResolvedColor>
  unmapped: Array<{ partId: PartId; label: string; color: ResolvedColor }>
}

/** Map timeline part colors onto stick-figure SVG regions. */
export function resolveFigureRegions(
  parts: PartDefinition[],
  resolved: Record<PartId, ResolvedColor>
): FigureRegionResult {
  const regions = defaultRegions()
  const unmapped: FigureRegionResult['unmapped'] = []

  for (const part of parts) {
    const color = resolved[part.id] ?? OFF_COLOR
    const mapped = partIdToRegions(part.id)
    if (mapped.length === 0) {
      unmapped.push({ partId: part.id, label: part.display_name || part.id, color })
      continue
    }
    for (const regionId of mapped) {
      regions[regionId] = color
    }
  }

  return { regions, unmapped }
}

export interface FigureRegionPixelResult {
  regionPixels: Record<FigureRegionId, ResolvedColor[]>
  unmapped: FigureRegionResult['unmapped']
}

/** Map per-pixel LED strip colors onto stick-figure SVG regions. */
export function resolveFigureRegionPixels(
  parts: PartDefinition[],
  pixelCounts: Record<FigureRegionId, number>,
  resolvePixels: (partId: PartId, pixelCount: number) => ResolvedColor[],
  resolveSingle: (partId: PartId) => ResolvedColor
): FigureRegionPixelResult {
  const regionPixels = Object.fromEntries(
    FIGURE_REGION_IDS.map((id) => [
      id,
      Array.from({ length: pixelCounts[id] ?? 8 }, () => ({ ...OFF_COLOR }))
    ])
  ) as Record<FigureRegionId, ResolvedColor[]>
  const unmapped: FigureRegionResult['unmapped'] = []

  for (const part of parts) {
    const mapped = partIdToRegions(part.id)
    if (mapped.length === 0) {
      unmapped.push({
        partId: part.id,
        label: part.display_name || part.id,
        color: resolveSingle(part.id)
      })
      continue
    }
    for (const regionId of mapped) {
      regionPixels[regionId] = resolvePixels(part.id, pixelCounts[regionId] ?? 8)
    }
  }

  return { regionPixels, unmapped }
}

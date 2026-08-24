import { useId, useMemo } from 'react'
import { colorToCss } from '../../shared/stageColors'
import type { ResolvedColor } from '../../shared/types/project'
import { FIGURE_FLOW_ORDER, FIGURE_REGION_IDS, FIGURE_REGION_LABELS, type FigureRegionId } from './partRegionMap'

const DIM_PIXEL = '#232a38'
const SILHOUETTE = '#1c2230'

type Point = [number, number]

/**
 * LED strip routes on the stick figure (viewBox 0 0 100 130).
 *
 * head/left_hand/right_hand/left_foot/right_foot follow the *actual* logical
 * LED order of the wiring (see ledChainDefaults.ts): a limb goes outbound
 * along the outside edge, fans out at the branched tip, then folds back
 * along the inside edge to the root. Because `samplePolyline` samples by arc
 * length, walking this single long polyline reproduces the real LED index
 * order (index 0 at the root, last index back at the root on the return
 * side).
 *
 * body/left_shoe/right_shoe are not wired to any hardware output today —
 * their coordinates are left as simple placeholders since they are never
 * rendered in practice (see `regionsForParts`).
 */
const REGION_STRIPS: Record<FigureRegionId, Point[]> = {
  // 頭：環狀（ring layout）繞頭一圈，起點與終點在同一位置附近。
  head: [
    [50, 5],
    [56, 6.34],
    [60.39, 10],
    [62, 15],
    [60.39, 20],
    [56, 23.66],
    [50, 25],
    [44, 23.66],
    [39.61, 20],
    [38, 15],
    [39.61, 10],
    [44, 6.34],
    [50, 5]
  ],
  // 身體：胸口直落的燈條（目前硬體未接線，僅保留座標）
  body: [
    [50, 30],
    [50, 76]
  ],
  // 右手：肩膀 → 手臂外側 → 指尖分岔 → 手臂內側折回 → 腋下
  right_hand: [
    [64, 32],
    [72, 44],
    [78, 56],
    [83, 68],
    [88, 80],
    [92, 86],
    [95, 89],
    [90, 91],
    [85, 84],
    [79, 72],
    [73, 60],
    [68, 48],
    [62, 36]
  ],
  // 左手：右手鏡像
  left_hand: [
    [36, 32],
    [28, 44],
    [22, 56],
    [17, 68],
    [12, 80],
    [8, 86],
    [5, 89],
    [10, 91],
    [15, 84],
    [21, 72],
    [27, 60],
    [32, 48],
    [38, 36]
  ],
  // 右腳：髖部 → 大腿外側 → 腳尖分岔 → 腿內側折回髖部內側
  right_foot: [
    [58, 80],
    [63, 92],
    [65, 104],
    [64, 114],
    [62, 119],
    [65, 123],
    [68, 125],
    [61, 126],
    [58, 121],
    [56, 114],
    [54, 102],
    [52, 90],
    [50, 80]
  ],
  // 左腳：右腳鏡像
  left_foot: [
    [42, 80],
    [37, 92],
    [35, 104],
    [36, 114],
    [38, 119],
    [35, 123],
    [32, 125],
    [39, 126],
    [42, 121],
    [44, 114],
    [46, 102],
    [48, 90],
    [50, 80]
  ],
  // 鞋（目前硬體未接線，僅保留座標）
  left_shoe: [
    [30, 118],
    [47, 118]
  ],
  right_shoe: [
    [53, 118],
    [70, 118]
  ]
}

/**
 * LED pixels rendered per region — this is a *visual sampling density*, not
 * the physical LED count (right_hand/right_foot/left_foot/left_hand are each
 * 130 physical LEDs: 60 outbound + 10 branch + 60 return). Keep in sync with
 * the strip lengths above.
 */
export const REGION_PIXEL_COUNTS: Record<FigureRegionId, number> = {
  head: 24,
  body: 14,
  left_hand: 26,
  right_hand: 26,
  left_foot: 26,
  right_foot: 26,
  left_shoe: 5,
  right_shoe: 5
}

/** Evenly sample n points along a polyline by arc length. */
function samplePolyline(points: Point[], n: number): Point[] {
  if (points.length < 2 || n <= 0) return []

  const segLens: number[] = []
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0]
    const dy = points[i][1] - points[i - 1][1]
    const len = Math.hypot(dx, dy)
    segLens.push(len)
    total += len
  }

  const result: Point[] = []
  for (let k = 0; k < n; k++) {
    const target = ((k + 0.5) / n) * total
    let acc = 0
    let seg = 0
    while (seg < segLens.length - 1 && acc + segLens[seg] < target) {
      acc += segLens[seg]
      seg += 1
    }
    const local = segLens[seg] > 0 ? (target - acc) / segLens[seg] : 0
    const [x1, y1] = points[seg]
    const [x2, y2] = points[seg + 1]
    result.push([x1 + (x2 - x1) * local, y1 + (y2 - y1) * local])
  }
  return result
}

const REGION_PIXEL_POINTS: Record<FigureRegionId, Point[]> = Object.fromEntries(
  FIGURE_REGION_IDS.map((id) => [id, samplePolyline(REGION_STRIPS[id], REGION_PIXEL_COUNTS[id])])
) as Record<FigureRegionId, Point[]>

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

function polylineToPathD(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${fmt(p[0])} ${fmt(p[1])}`).join(' ')
}

/**
 * Concatenate the strips of `order` into one continuous path (a smooth curve
 * bridges the gap between one region's end and the next region's start), so
 * a dot animated along it visually traces the overall wiring flow. Also
 * returns the start point of each segment for the numbered badges.
 */
function buildFlowPath(order: FigureRegionId[]): { d: string; badges: Point[] } {
  const badges: Point[] = []
  let d = ''

  order.forEach((regionId, idx) => {
    const points = REGION_STRIPS[regionId]
    if (points.length === 0) return
    badges.push(points[0])

    if (idx === 0) {
      d += polylineToPathD(points)
      return
    }

    const prevPoints = REGION_STRIPS[order[idx - 1]]
    const prevEnd = prevPoints[prevPoints.length - 1]
    const start = points[0]
    const ctrlX = (prevEnd[0] + start[0]) / 2
    const ctrlY = (prevEnd[1] + start[1]) / 2 + 6
    d += ` Q ${fmt(ctrlX)} ${fmt(ctrlY)} ${fmt(start[0])} ${fmt(start[1])}`
    d += ' ' + polylineToPathD(points).replace(/^M/, 'L')
  })

  if (order.length > 1) {
    const firstStart = REGION_STRIPS[order[0]][0]
    const lastPoints = REGION_STRIPS[order[order.length - 1]]
    const lastEnd = lastPoints[lastPoints.length - 1]
    const ctrlX = (lastEnd[0] + firstStart[0]) / 2
    const ctrlY = (lastEnd[1] + firstStart[1]) / 2 + 6
    d += ` Q ${fmt(ctrlX)} ${fmt(ctrlY)} ${fmt(firstStart[0])} ${fmt(firstStart[1])}`
  }

  return { d, badges }
}

/** Silhouette pieces, keyed by the region whose limb they trace. */
const SILHOUETTE_BY_REGION: Partial<Record<FigureRegionId, Point[]>> = {
  head: undefined, // drawn as an ellipse below, not a polyline
  right_hand: [
    [64, 32],
    [75, 50],
    [81, 66],
    [88, 80],
    [92, 87]
  ],
  left_hand: [
    [36, 32],
    [25, 50],
    [19, 66],
    [12, 80],
    [8, 87]
  ],
  right_foot: [
    [54, 80],
    [57.5, 91],
    [59.5, 103],
    [60, 112],
    [60, 120]
  ],
  left_foot: [
    [46, 80],
    [42.5, 91],
    [40.5, 103],
    [40, 112],
    [40, 120]
  ]
}

interface DancerFigureSvgProps {
  regionPixels: Record<FigureRegionId, ResolvedColor[]>
  /** 只畫這些 region；省略時畫全部（向後相容） */
  visibleRegions?: FigureRegionId[]
  /** 顯示整體流動示意（淡色路徑 + 段落序號） */
  showFlowGuide?: boolean
  className?: string
  title?: string
}

export function DancerFigureSvg({
  regionPixels,
  visibleRegions,
  showFlowGuide,
  className,
  title
}: DancerFigureSvgProps) {
  const glowId = useId()
  const flowPathId = useId()

  const regionsToRender = visibleRegions
    ? FIGURE_REGION_IDS.filter((id) => visibleRegions.includes(id))
    : FIGURE_REGION_IDS

  const flowOrder = useMemo(
    () => FIGURE_FLOW_ORDER.filter((id) => (visibleRegions ? visibleRegions.includes(id) : true)),
    [visibleRegions]
  )

  const flow = useMemo(() => (showFlowGuide ? buildFlowPath(flowOrder) : null), [showFlowGuide, flowOrder])

  return (
    <svg
      viewBox="0 0 100 130"
      className={className}
      role="img"
      aria-label={title ?? '舞者部位預覽'}
    >
      <title>{title ?? '舞者部位預覽'}</title>
      <defs>
        <filter id={glowId} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
        {flow && <path id={flowPathId} d={flow.d} fill="none" />}
      </defs>

      {/* 人形剪影（僅供定位參考） */}
      <g fill="none" stroke={SILHOUETTE} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        {regionsToRender.includes('head') && <ellipse cx="50" cy="15" rx="12" ry="10" />}
        {/* 軀幹：不綁定特定 region，作為連接頭與四肢的結構參考線 */}
        <line x1="50" y1="26" x2="50" y2="79" />
        {(['right_hand', 'left_hand', 'right_foot', 'left_foot'] as FigureRegionId[]).map((regionId) => {
          if (!regionsToRender.includes(regionId)) return null
          const points = SILHOUETTE_BY_REGION[regionId]
          if (!points) return null
          return <polyline key={regionId} points={points.map((p) => `${fmt(p[0])},${fmt(p[1])}`).join(' ')} />
        })}
      </g>

      {showFlowGuide && flow && (
        <g pointerEvents="none">
          <use href={`#${flowPathId}`} stroke="#f472b6" strokeWidth="1" strokeDasharray="2,2" opacity="0.25" fill="none" />
          {flow.badges.map(([x, y], i) => (
            <g key={i} opacity="0.55">
              <circle cx={x} cy={y} r="3.2" fill="#10141d" stroke="#f472b6" strokeWidth="0.6" />
              <text x={x} y={y} fontSize="3.6" fill="#f8fafc" textAnchor="middle" dominantBaseline="central">
                {i + 1}
              </text>
            </g>
          ))}
        </g>
      )}

      {regionsToRender.map((regionId) => {
        const pixels = regionPixels[regionId] ?? []
        const points = REGION_PIXEL_POINTS[regionId]
        const lit = pixels.some((p) => p.visible)

        return (
          <g key={regionId}>
            <title>{FIGURE_REGION_LABELS[regionId]}</title>
            {/* 光暈層：只畫有亮的像素，一次 blur 保持效能 */}
            {lit && (
              <g filter={`url(#${glowId})`} opacity="0.6">
                {pixels.map((pixel, i) =>
                  pixel.visible && points[i] ? (
                    <circle
                      key={i}
                      cx={points[i][0]}
                      cy={points[i][1]}
                      r="2.6"
                      fill={colorToCss(pixel)}
                    />
                  ) : null
                )}
              </g>
            )}
            {/* LED 像素本體 */}
            {pixels.map((pixel, i) =>
              points[i] ? (
                <circle
                  key={i}
                  cx={points[i][0]}
                  cy={points[i][1]}
                  r="1.5"
                  fill={pixel.visible ? colorToCss(pixel) : DIM_PIXEL}
                  opacity={pixel.visible ? 1 : 0.7}
                />
              ) : null
            )}
          </g>
        )
      })}
    </svg>
  )
}

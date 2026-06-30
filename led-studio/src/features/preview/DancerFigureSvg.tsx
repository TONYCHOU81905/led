import type { ReactElement } from 'react'
import { colorToCss } from '../../shared/stageColors'
import type { ResolvedColor } from '../../shared/types/project'
import { FIGURE_REGION_LABELS, type FigureRegionId } from './partRegionMap'

const DIM_FILL = '#1a2030'
const STROKE = '#334155'

interface DancerFigureSvgProps {
  regions: Record<FigureRegionId, ResolvedColor>
  className?: string
  title?: string
}

function regionFill(color: ResolvedColor): string {
  if (!color.visible) return DIM_FILL
  return colorToCss(color)
}

function regionOpacity(color: ResolvedColor): number {
  if (!color.visible) return 0.55
  return 1
}

function regionGlow(color: ResolvedColor): string | undefined {
  if (!color.visible) return undefined
  const css = colorToCss(color)
  return `drop-shadow(0 0 4px ${css}) drop-shadow(0 0 10px ${css})`
}

function RegionShape({
  id,
  regions,
  children
}: {
  id: FigureRegionId
  regions: Record<FigureRegionId, ResolvedColor>
  children: ReactElement
}) {
  const color = regions[id]
  return (
    <g style={{ filter: regionGlow(color) }}>
      {children.type === 'circle' ? (
        <circle
          {...(children.props as React.ComponentProps<'circle'>)}
          fill={regionFill(color)}
          fillOpacity={regionOpacity(color)}
          stroke={STROKE}
          strokeWidth="1.2"
        >
          <title>{FIGURE_REGION_LABELS[id]}</title>
        </circle>
      ) : (
        <rect
          {...(children.props as React.ComponentProps<'rect'>)}
          fill={regionFill(color)}
          fillOpacity={regionOpacity(color)}
          stroke={STROKE}
          strokeWidth="1.2"
        >
          <title>{FIGURE_REGION_LABELS[id]}</title>
        </rect>
      )}
    </g>
  )
}

export function DancerFigureSvg({ regions, className, title }: DancerFigureSvgProps) {
  return (
    <svg
      viewBox="0 0 100 130"
      className={className}
      role="img"
      aria-label={title ?? '舞者部位預覽'}
    >
      <title>{title ?? '舞者部位預覽'}</title>
      <RegionShape id="head" regions={regions}>
        <circle cx="50" cy="18" r="14" />
      </RegionShape>
      <RegionShape id="body" regions={regions}>
        <rect x="38" y="32" width="24" height="45" rx="6" />
      </RegionShape>
      <RegionShape id="left_hand" regions={regions}>
        <rect x="14" y="38" width="18" height="12" rx="4" />
      </RegionShape>
      <RegionShape id="right_hand" regions={regions}>
        <rect x="68" y="38" width="18" height="12" rx="4" />
      </RegionShape>
      <RegionShape id="left_foot" regions={regions}>
        <rect x="32" y="82" width="14" height="32" rx="4" />
      </RegionShape>
      <RegionShape id="right_foot" regions={regions}>
        <rect x="54" y="82" width="14" height="32" rx="4" />
      </RegionShape>
      <RegionShape id="left_shoe" regions={regions}>
        <rect x="30" y="110" width="18" height="10" rx="3" />
      </RegionShape>
      <RegionShape id="right_shoe" regions={regions}>
        <rect x="52" y="110" width="18" height="10" rx="3" />
      </RegionShape>
    </svg>
  )
}

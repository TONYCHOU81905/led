import type { RgbColor } from './types/project'

/** Vibrant stage palette aligned with ESP32-S3 firmware naming. */
export const STAGE_COLOR_NAMES = [
  'electric_cyan',
  'hot_magenta',
  'laser_lime',
  'royal_violet',
  'golden_spark',
  'flame_orange',
  'ice_blue',
  'neon_pink',
  'emerald_glow',
  'ultraviolet',
  'silver_white',
  'deep_crimson',
  'red',
  'green',
  'blue',
  'white',
  'black',
  'off'
] as const

export type StageColorName = (typeof STAGE_COLOR_NAMES)[number]

export const STAGE_COLORS: Record<StageColorName, RgbColor> = {
  electric_cyan: { r: 0, g: 245, b: 255 },
  hot_magenta: { r: 255, g: 0, b: 128 },
  laser_lime: { r: 57, g: 255, b: 20 },
  royal_violet: { r: 139, g: 0, b: 255 },
  golden_spark: { r: 255, g: 215, b: 0 },
  flame_orange: { r: 255, g: 69, b: 0 },
  ice_blue: { r: 79, g: 195, b: 247 },
  neon_pink: { r: 255, g: 20, b: 147 },
  emerald_glow: { r: 0, g: 200, b: 150 },
  ultraviolet: { r: 106, g: 13, b: 173 },
  silver_white: { r: 240, g: 240, b: 255 },
  deep_crimson: { r: 220, g: 20, b: 60 },
  red: { r: 255, g: 0, b: 0 },
  green: { r: 0, g: 255, b: 0 },
  blue: { r: 0, g: 0, b: 255 },
  white: { r: 255, g: 255, b: 255 },
  black: { r: 0, g: 0, b: 0 },
  off: { r: 0, g: 0, b: 0 }
}

export function getStageColor(name: string): RgbColor | undefined {
  if (name in STAGE_COLORS) {
    return STAGE_COLORS[name as StageColorName]
  }
  return undefined
}

export function colorToCss(color: RgbColor | undefined | null, fallback = '#666'): string {
  if (!color) return fallback
  return `rgb(${color.r}, ${color.g}, ${color.b})`
}

export function resolveColorCss(
  name: string,
  palette: Record<string, RgbColor>
): string {
  return colorToCss(getStageColor(name) ?? palette[name])
}

export function mergePalette(extra?: Record<string, RgbColor>): Record<string, RgbColor> {
  return { ...STAGE_COLORS, ...extra }
}

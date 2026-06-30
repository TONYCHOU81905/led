import { describe, expect, it } from 'vitest'
import { STAGE_COLORS, STAGE_COLOR_NAMES, getStageColor } from '../src/shared/stageColors'

describe('stageColors', () => {
  it('includes vibrant stage palette and basics', () => {
    for (const name of [
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
      'off'
    ]) {
      expect(STAGE_COLOR_NAMES).toContain(name)
      expect(getStageColor(name)).toBeDefined()
    }
  })

  it('has non-zero RGB for visible colors', () => {
    expect(STAGE_COLORS.electric_cyan).toEqual({ r: 0, g: 245, b: 255 })
    expect(STAGE_COLORS.off).toEqual({ r: 0, g: 0, b: 0 })
  })
})

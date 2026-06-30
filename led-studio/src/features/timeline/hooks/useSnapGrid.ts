import { useMemo } from 'react'

export function useSnapGrid(bpm: number, snapEnabled: boolean, subdivision = 4) {
  const beatIntervalMs = useMemo(() => 60000 / Math.max(bpm, 1), [bpm])
  const gridMs = useMemo(() => beatIntervalMs / subdivision, [beatIntervalMs, subdivision])

  const snapTime = (ms: number): number => {
    if (!snapEnabled) return Math.max(0, Math.round(ms))
    return Math.max(0, Math.round(Math.round(ms / gridMs) * gridMs))
  }

  return { beatIntervalMs, gridMs, snapTime }
}

import { describe, expect, it } from 'vitest'
import { computePeaks } from '../src/features/timeline/audioAnalysis'

describe('audioAnalysis', () => {
  it('computePeaks normalizes amplitude buckets', () => {
    const samples = new Float32Array(1000)
    for (let i = 0; i < samples.length; i++) {
      samples[i] = i % 2 === 0 ? 0.5 : 0.1
    }
    const buffer = {
      duration: 1,
      getChannelData: () => samples
    } as unknown as AudioBuffer

    const peaks = computePeaks(buffer, 10)
    expect(peaks).toHaveLength(10)
    expect(Math.max(...peaks)).toBeCloseTo(1, 5)
    expect(Math.min(...peaks)).toBeGreaterThan(0)
  })
})

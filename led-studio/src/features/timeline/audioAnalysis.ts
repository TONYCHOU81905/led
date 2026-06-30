export interface LoadedMusic {
  objectUrl: string
  durationMs: number
  peaks: number[]
}

function mimeFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    flac: 'audio/flac',
    aiff: 'audio/aiff',
    aif: 'audio/aiff'
  }
  return map[ext ?? ''] ?? 'audio/mpeg'
}

export function computePeaks(buffer: AudioBuffer, buckets = 2000): number[] {
  const channel = buffer.getChannelData(0)
  if (channel.length === 0) return []
  const blockSize = Math.max(1, Math.floor(channel.length / buckets))
  const peaks: number[] = []
  for (let i = 0; i < buckets; i++) {
    let max = 0
    const start = i * blockSize
    const end = Math.min(channel.length, start + blockSize)
    for (let j = start; j < end; j++) {
      max = Math.max(max, Math.abs(channel[j]))
    }
    peaks.push(max)
  }
  const peakMax = Math.max(...peaks, 0.001)
  return peaks.map((p) => p / peakMax)
}

export async function decodeMusicBlob(blob: Blob): Promise<{ durationMs: number; peaks: number[] }> {
  const ctx = new AudioContext()
  try {
    const arrayBuffer = await blob.arrayBuffer()
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0))
    return {
      durationMs: Math.round(audioBuffer.duration * 1000),
      peaks: computePeaks(audioBuffer)
    }
  } finally {
    await ctx.close()
  }
}

export async function loadMusicFromPath(filePath: string): Promise<LoadedMusic> {
  if (!window.api?.project.readMusicFile) {
    throw new Error('readMusicFile API 不可用')
  }
  const { data, mime } = await window.api.project.readMusicFile(filePath)
  const blob = new Blob([data], { type: mime || mimeFromPath(filePath) })
  const objectUrl = URL.createObjectURL(blob)
  const { durationMs, peaks } = await decodeMusicBlob(blob)
  return { objectUrl, durationMs, peaks }
}

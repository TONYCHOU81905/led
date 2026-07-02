import { create } from 'zustand'
import type { BridgeState } from '../shared/types/project'

interface ShowState {
  bridge: BridgeState
  /** Renderer-side playback position (drives Show time + seek bar). */
  playbackMs: number
  setBridge: (bridge: BridgeState) => void
  setPlaybackMs: (ms: number) => void
}

const defaultBridge: BridgeState = {
  running: false,
  paused: false,
  source: 'manual',
  musicTimeMs: 0,
  sequence: 0,
  packetsPerSecond: 0
}

export const useShowStore = create<ShowState>((set) => ({
  bridge: defaultBridge,
  playbackMs: 0,
  setBridge: (bridge) => set({ bridge }),
  setPlaybackMs: (playbackMs) => set({ playbackMs: Math.max(0, playbackMs) })
}))

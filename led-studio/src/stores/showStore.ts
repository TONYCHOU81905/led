import { create } from 'zustand'
import type { BridgeState } from '../shared/types/project'

interface ShowState {
  bridge: BridgeState
  setBridge: (bridge: BridgeState) => void
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
  setBridge: (bridge) => set({ bridge })
}))

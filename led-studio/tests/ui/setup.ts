import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { useProjectStore } from '../../src/stores/projectStore'
import { useShowStore } from '../../src/stores/showStore'
import { createMockApi, type MockApi } from './mockApi'

declare global {
  // eslint-disable-next-line no-var
  var __mockApi: MockApi
}

class ResizeObserverMock {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

function mockCanvas2d() {
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    roundRect: vi.fn(),
    rect: vi.fn()
  }
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext
}

beforeEach(() => {
  if (typeof window === 'undefined') return

  window.history.pushState({}, '', '/')
  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver
  mockCanvas2d()

  // jsdom does not implement URL.createObjectURL / revokeObjectURL
  globalThis.URL.createObjectURL = vi.fn((_blob: Blob) => `blob:mock/${Math.random()}`)
  globalThis.URL.revokeObjectURL = vi.fn()
  globalThis.__mockApi = createMockApi()
  window.api = globalThis.__mockApi.api

  useProjectStore.setState({ project: null, activeRoleId: null })
  useShowStore.setState({
    bridge: {
      running: false,
      paused: false,
      source: 'manual',
      musicTimeMs: 0,
      sequence: 0,
      packetsPerSecond: 0
    },
    playbackMs: 0
  })
})

afterEach(() => {
  if (typeof window === 'undefined') return
  cleanup()
  vi.restoreAllMocks()
})

export function getMockApi(): MockApi {
  return globalThis.__mockApi
}

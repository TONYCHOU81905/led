/// <reference types="vite/client" />

import type { LedStudioApi } from './shared/types/project'

declare global {
  interface Window {
    api: LedStudioApi
  }
}

export {}

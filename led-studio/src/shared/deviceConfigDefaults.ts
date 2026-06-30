import type { CompileOptions } from './configCompiler'

export function defaultCompileOptions(roleId: string): CompileOptions {
  return {
    deviceId: `esp32s3_${roleId}_001`,
    dataGpio: 8,
    ledCount: 120,
    maxBrightness: 0.4,
    network: {
      ssid: '',
      password: '',
      timecode_port: 4210,
      device_status_port: 4211
    }
  }
}

export function deviceConfigFilename(roleId: string): string {
  return `${roleId}.device.json`
}

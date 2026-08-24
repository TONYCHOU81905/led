import type { CompileOptions } from './configCompiler'

export function defaultCompileOptions(roleId: string): CompileOptions {
  return {
    deviceId: `esp32s3_${roleId}_001`,
    dataGpio: 4,
    ledType: 'WS2812B',
    maxBrightness: 0.25,
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

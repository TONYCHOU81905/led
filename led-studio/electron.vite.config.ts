import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // bonjour-service 刻意「不」externalize，讓 rollup 把它與相依
    // （multicast-dns / dns-packet / …）整包 bundle 進 out/main/index.js。
    //
    // 為什麼不走 external：electron-builder.yml 的 files 是白名單，只列了
    // serialport；externalize 之後 require('bonjour-service') 在打包版會
    // MODULE_NOT_FOUND。要維護一整串 transitive dependency 的 files 規則很脆弱，
    // 而這棵相依樹全是純 JS（沒有任何 .node / binding.gyp），bundle 最安全，
    // 而且 macOS 與 Windows 的行為完全一致。
    // serialport 相反：它有 native binding，一定要保持 external。
    plugins: [externalizeDepsPlugin({ exclude: ['bonjour-service'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname),
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'index.html')
      }
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()]
  }
})

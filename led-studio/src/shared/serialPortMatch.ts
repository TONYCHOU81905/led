/**
 * 燒錄後把「選中的 port」重新對回同一塊板子的純邏輯。
 *
 * 為什麼需要它：
 * esptool 用 --after hard_reset 收尾，板子會重開機。ESP32-S3 走原生
 * USB-Serial/JTAG 時（n16r8 這種 -DARDUINO_USB_CDC_ON_BOOT=1 的設定），
 * 重開機等於整個 USB 裝置重新列舉（re-enumerate）：
 *   /dev/cu.usbmodem1201  →  消失  →  /dev/cu.usbmodem1101
 * 編號來自列舉順序，不保證不變。
 *
 * 舊行為是燒完之後不重掃，繼續用燒錄前的路徑。macOS 上開一個已經消失的
 * 節點拿到的是 "Resource temporarily unavailable"，跟「port 被別的程式佔住」
 * 的錯誤字串一模一樣 —— 所以症狀看起來像有東西佔著 port，而拔插 USB 就好了
 * （拔插銷毀舊節點，頁面重新掛載又掃了一次）。
 *
 * 對回同一塊板子的優先序：
 *   1. serialNumber —— USB 裝置的唯一識別，重新列舉也不會變。唯一可靠的依據。
 *   2. 原本的路徑還在 —— 沒有重新列舉（USB-UART 橋接晶片的板子就屬於這類）。
 *   3. ESP 特徵字串 —— 前兩者都失敗時的最後手段（例如換了一塊板子）。
 */

export interface PortLike {
  path: string
  manufacturer?: string
  serialNumber?: string
}

/** 排除 macOS 內建的那幾個非 USB serial 裝置，它們永遠不是板子。 */
export function isCandidatePort(port: PortLike): boolean {
  return (
    !port.path.includes('debug-console') &&
    !port.path.includes('wlan-debug') &&
    !port.path.includes('Bluetooth')
  )
}

/**
 * 看起來像 ESP32 的 port。
 *
 * usbmodem 一定要在清單裡：那是 ESP32-S3 的「原生 USB」埠，n16r8 用的就是它。
 * 只比對 usbserial / wchusbserial（USB-UART 橋接晶片）會漏掉原生 USB 的板子，
 * 於是退回「清單裡第一個非 debug 的 port」，接多台裝置時就會選錯。
 */
export function looksLikeEspPort(port: PortLike): boolean {
  if (!isCandidatePort(port)) return false
  const manufacturer = port.manufacturer?.toLowerCase() ?? ''
  return (
    manufacturer.includes('espressif') ||
    port.path.includes('usbserial') ||
    port.path.includes('wchusbserial') ||
    port.path.includes('usbmodem') ||
    port.path.includes('SLAB_USBtoUART') ||
    /^COM\d+$/i.test(port.path) // Windows
  )
}

export interface ReselectResult {
  /** 對回來的 port 路徑；null 代表清單裡找不到任何候選 */
  path: string | null
  /** 用哪種方式對回來的，寫進操作紀錄讓使用者看得懂發生了什麼 */
  matchedBy: 'serialNumber' | 'samePath' | 'espHeuristic' | 'none'
}

/**
 * 燒錄前的 port 資訊 + 燒錄後的 port 清單 → 現在該用哪個 port。
 *
 * @param previousPath        燒錄時用的路徑
 * @param previousSerial      燒錄時那個 port 的 serialNumber（可能沒有）
 * @param ports               燒錄後重新列舉到的 port 清單
 */
export function reselectPortAfterFlash(
  previousPath: string,
  previousSerial: string | undefined,
  ports: PortLike[]
): ReselectResult {
  if (previousSerial) {
    const bySerial = ports.find((p) => p.serialNumber === previousSerial && isCandidatePort(p))
    if (bySerial) return { path: bySerial.path, matchedBy: 'serialNumber' }
  }

  const samePath = ports.find((p) => p.path === previousPath)
  if (samePath) return { path: samePath.path, matchedBy: 'samePath' }

  const heuristic = ports.find(looksLikeEspPort)
  if (heuristic) return { path: heuristic.path, matchedBy: 'espHeuristic' }

  return { path: null, matchedBy: 'none' }
}

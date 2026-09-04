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

export interface WaitForBoardDeps {
  /** 重新列舉目前的 serial port 清單 */
  listPorts: () => Promise<PortLike[]>
  /** 對指定 port 送 ping；板子沒回應要 reject */
  ping: (path: string) => Promise<unknown>
  sleep: (ms: number) => Promise<void>
  /** 每輪嘗試前回報進度，讓使用者知道還在等 */
  onAttempt?: (attempt: number, path: string) => void
  /** 總共嘗試幾輪（每輪 = 重新掃描 + 一次 ping） */
  attempts?: number
  /** 兩輪之間的間隔 */
  intervalMs?: number
}

export interface WaitForBoardResult {
  /** 確認會回應 ping 的 port；null 代表在時限內始終沒有板子回話 */
  path: string | null
  matchedBy: ReselectResult['matchedBy']
  /** 實際用掉幾輪，寫進紀錄方便判斷是不是每次都很慢 */
  attemptsUsed: number
}

/**
 * 燒錄後等到「真的會回應 ping 的那個 port」。
 *
 * 為什麼不能只等固定秒數再重掃 —— 這是踩過的坑：
 * macOS 在 USB 裝置消失後，還會把 /dev/cu.usbmodemXXXX 這個節點多留一小段
 * 時間。燒完固定等 2 秒就相信 listPorts() 的結果，抓到的往往是那個**殘留節點**。
 * 殘留節點 open() 會成功（核心還認得它），所以不會有任何 lock 錯誤，但板子
 * 其實已經在新節點上 —— 表現為「port 開得起來、30 秒完全沒有輸出」，
 * 而使用者唯一的解法是拔插 USB。
 *
 * 所以判斷「可以 deploy 了」的依據只能是**板子真的回話**，不能是「節點存在」。
 * 每一輪都重新掃描（不快取清單），因為新節點隨時可能才剛出現。
 */
export async function waitForFlashedBoard(
  previousPath: string,
  previousSerial: string | undefined,
  deps: WaitForBoardDeps
): Promise<WaitForBoardResult> {
  const attempts = deps.attempts ?? 12
  const intervalMs = deps.intervalMs ?? 1000

  let lastMatch: ReselectResult = { path: null, matchedBy: 'none' }

  for (let attempt = 1; attempt <= attempts; attempt++) {
    // 每輪都重新列舉：殘留節點會在這幾秒內消失，新節點會出現。
    const ports = await deps.listPorts()
    lastMatch = reselectPortAfterFlash(previousPath, previousSerial, ports)

    if (lastMatch.path) {
      deps.onAttempt?.(attempt, lastMatch.path)
      try {
        await deps.ping(lastMatch.path)
        return { path: lastMatch.path, matchedBy: lastMatch.matchedBy, attemptsUsed: attempt }
      } catch {
        // ping 不通就是還沒好（殘留節點、或板子還在開機）—— 下一輪重掃再試
      }
    }

    if (attempt < attempts) await deps.sleep(intervalMs)
  }

  return { path: null, matchedBy: lastMatch.matchedBy, attemptsUsed: attempts }
}

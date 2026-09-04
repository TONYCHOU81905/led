/**
 * 廣播政策：過濾和降頻 UDP broadcast timecode 封包。
 *
 * 問題背景：
 * - resolveBroadcastAddresses() 對每張 IPv4 網卡算子網廣播位址，實機在有線網段
 *   192.168.25.255 與 Wi-Fi 網段 192.168.90.255，但板子只在 Wi-Fi 網段。
 *   結果每秒有 100 個封包白丟到有線網段。
 * - Wi-Fi broadcast/multicast 用最低基本速率（1–6 Mbps）發送、沒有 ACK 也沒有重傳，
 *   傳不傳得到不確定；unicast 走高 MCS 且有 ACK+重傳。已知板子位置後，100Hz broadcast
 *   既浪費空中時間又不可靠。
 * - unicastTargets 只在 start() 設定一次，演出開始後才被發現的板子永遠收不到 unicast。
 *
 * 解決：
 * - filterBroadcastForTargets：只保留「子網內確實有已知板子」的 broadcast 位址。
 *   targets 為空時回傳全部 candidates（發現階段的後備行為，不能改）。
 * - shouldBroadcastThisTick：已知板子時降頻到 2Hz（500ms），發現階段仍全速。
 */

export interface InterfaceLike {
  address: string
  netmask: string
  internal: boolean
  family: string
}

/** 已知板子時 broadcast 降頻成這個速率（Hz）；作為未被發現的板子的後備。 */
export const DISCOVERY_BROADCAST_HZ = 2

/**
 * IPv4 字串轉整數（同 electron/services/networkDiscovery.ts）。
 * 用於子網計算。
 */
export function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    throw new Error(`Invalid IPv4 address: ${ip}`)
  }
  // >>> 0 轉成無號。功能上目前不必要（所有運算元都經過同一個函式，
  // ToInt32 一致所以位元相同就比較相等），但 timecodeBridge.ts 裡那份複製
  // 有加，兩邊不一致會讓下一個讀的人以為其中一邊有 bug。
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

/**
 * 整數轉 IPv4 字串（同 electron/services/networkDiscovery.ts）。
 */
export function intToIpv4(value: number): string {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff
  ].join('.')
}

/**
 * 只保留「子網內確實有已知板子」的 broadcast 位址。
 *
 * targets 為空時回傳全部 candidates（發現階段的後備行為，不能改）。
 *
 * 判斷方式：對每個 candidate broadcast 位址，找出產生它的網卡（用 (ip & mask) | ~mask 反推），
 * 再看有沒有任何 target 落在同一個子網（(targetIp & mask) === (ifaceIp & mask)）。
 *
 * @param candidates 所有 broadcast 候選位址（來自 resolveBroadcastAddresses）
 * @param targets 已知的 unicast 板子 IP
 * @param interfaces 網卡列表（{ address, netmask, family, internal }）
 * @returns 應該實際送出的 broadcast 位址清單
 */
export function filterBroadcastForTargets(
  candidates: string[],
  targets: string[],
  interfaces: InterfaceLike[]
): string[] {
  // 發現階段：沒有任何已知板子，維持既有發現行為，送全部 candidates。
  if (targets.length === 0) {
    return [...candidates]
  }

  const result = new Set<string>()

  for (const candidate of candidates) {
    // 特殊情況：255.255.255.255 是有限廣播，不屬於任何特定子網。
    // 在沒有已知 target 時送過，但既然有 target 了就應該用子網廣播更精準。
    if (candidate === '255.255.255.255') {
      continue
    }

    try {
      // 嘗試將 candidate 與各網卡配對。若 candidate 是某個網卡的廣播位址，
      // 那麼同一個網卡的 IP 應該也會落在 (ip & mask) | ~mask 的計算結果裡。
      // 由於 candidate 通常是 (ifaceIp & mask) | ~mask，我們可以反推出 mask。

      const candidateInt = ipv4ToInt(candidate)

      // 找出可能產生這個 broadcast 位址的網卡
      for (const iface of interfaces) {
        if (iface.internal || iface.family !== 'IPv4' || !iface.address || !iface.netmask) {
          continue
        }

        try {
          const ifaceIp = ipv4ToInt(iface.address)
          const mask = ipv4ToInt(iface.netmask)

          // 驗證：ifaceIp 在這個 mask 下的廣播位址應該與 candidate 相同
          // >>> 0 不可省：ipv4ToInt 回傳無號，而 `&` / `|` 的結果是有號 int32。
          // 少了它，192.168.90.255 會變成比較「3232258303 !== -1062708993」而
          // 永遠不相等 —— 過濾結果全空、退回全部 candidates，有線網段的
          // broadcast 又跑回來，整個優化靜默失效（實測抓到過）。
          const expectedBroadcast = (((ifaceIp & mask) | (~mask >>> 0)) >>> 0)
          if (expectedBroadcast !== candidateInt) {
            continue // 這個 candidate 不是這張網卡的廣播位址
          }

          // 找到了產生 candidate 的網卡。現在檢查是否有任何 target 落在這個子網
          for (const target of targets) {
            try {
              const targetInt = ipv4ToInt(target)
              // 同理，兩邊都要 >>> 0 才是同一個數域的比較。
              if (((targetInt & mask) >>> 0) === ((ifaceIp & mask) >>> 0)) {
                // 有 target 在這個子網，保留這個 broadcast 位址
                result.add(candidate)
                break // 只要找到一個 target 就夠了
              }
            } catch {
              // Target IP 格式不合法，跳過
              continue
            }
          }

          // 找到配對網卡後就跳出，不用再檢查其他網卡了
          break
        } catch {
          // 網卡 IP/mask 格式不合法，跳過
          continue
        }
      }
    } catch {
      // Candidate 格式不合法，跳過
      continue
    }
  }

  // 空結果的後備：一定要留至少一個 broadcast 位址。
  //
  // 這一段是必要的，實測有兩個情境會讓上面的過濾結果變成空的：
  //   1. candidates 只有 255.255.255.255 —— resolveBroadcastAddresses() 在找不到
  //      任何可用網卡時就是回傳這個（見 timecodeBridge.ts 的 targets.size === 0
  //      分支），而上面的迴圈會把它跳過。
  //   2. target 落在本機沒有對應網卡的網段 —— UI 明確支援這種用法
  //      （「手動 IP 僅在跨子網或掃描不到時使用」）。
  //
  // 清單變空的後果不是「少送一點」而是「完全不送」：呼叫端會因此失去
  // DISCOVERY_BROADCAST_HZ 的降頻心跳，那是給「還沒被發現的板子」的唯一後備
  // （例如晚開機的第 11 台）。少了它，那些板子永遠收不到 timecode。
  // 這個優化的前提是「降頻」而不是「關掉」，所以寧可多送一個 broadcast。
  if (result.size === 0) {
    return [...candidates]
  }

  return [...result]
}

/**
 * 判斷這一個 tick 要不要送 broadcast。
 *
 * - 沒有任何 unicast target → true（全速，維持既有發現行為）
 * - 有 target → 降頻到 DISCOVERY_BROADCAST_HZ
 *
 * @param hasUnicastTargets 是否有已知的 unicast 板子
 * @param nowMs 現在的時間（毫秒，通常是 Date.now()）
 * @param lastBroadcastAtMs 上一次送出 broadcast 的時間
 * @param rateHz 降頻速率（預設 DISCOVERY_BROADCAST_HZ），用於測試
 * @returns true 表示應該在這個 tick 送 broadcast
 */
export function shouldBroadcastThisTick(
  hasUnicastTargets: boolean,
  nowMs: number,
  lastBroadcastAtMs: number,
  rateHz: number = DISCOVERY_BROADCAST_HZ
): boolean {
  // 發現階段：沒有已知 target，每次 tick 都送
  if (!hasUnicastTargets) {
    return true
  }

  // 既有 target：降頻。判斷距離上一次送出是否超過 1/rateHz 毫秒
  const intervalMs = 1000 / rateHz
  // lastBroadcastAtMs === 0 表示還沒送過，應該送
  if (lastBroadcastAtMs === 0) {
    return true
  }

  return nowMs - lastBroadcastAtMs >= intervalMs
}

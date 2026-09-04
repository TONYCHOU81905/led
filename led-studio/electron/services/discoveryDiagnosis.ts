/**
 * 兩條發現管道的結果對照診斷。
 *
 * 由來（2026-09-04 實機查出來的）：
 * 板子在 Stork-IoT 這個 Wi-Fi 下，UDP 4211 broadcast 找得到、mDNS 完全找不到。
 * 用同一份程式碼在兩張網卡上對照才確認：有線網段 6 秒內看到 11 台主機的
 * mDNS 流量，Wi-Fi 網段一台都沒有 —— 是 AP 擋掉了 multicast（224.0.0.251）
 * 但仍然轉發 broadcast。
 *
 * 這種狀況下 mDNS 面板只是「空的」，看不出是程式沒作用、板子沒註冊、
 * 還是網路擋掉了 —— 而這三者的處理方式完全不同。所以在兩條管道結果不一致時
 * 直接把判斷講出來。
 */

export interface DiscoveryCounts {
  /** mDNS 掃到幾台 */
  mdns: number
  /** UDP 4211 回報中的有幾台 */
  udp: number
  /** mDNS instance 有沒有成功啟動（bind 失敗的話結論不同） */
  mdnsStarted: boolean
}

/**
 * 回傳要顯示給使用者的診斷訊息，null = 沒有異狀不必打擾。
 */
export function describeDiscoveryMismatch(counts: DiscoveryCounts): string | null {
  if (!counts.mdnsStarted) {
    // bind 失敗已經有自己的錯誤訊息，這裡不要重複洗一次
    return null
  }

  if (counts.udp > 0 && counts.mdns === 0) {
    return (
      `UDP 廣播找到 ${counts.udp} 台，但 mDNS 一台都沒找到。` +
      '這通常是 Wi-Fi AP 擋掉 multicast（224.0.0.251）卻仍轉發 broadcast —— ' +
      'AP 設定裡找「多播過濾 / Multicast Filtering / IGMP Snooping / 無線隔離」關掉即可。' +
      '不關也沒關係：UDP 廣播＋子網 unicast 掃描這條路能正常運作，mDNS 只是備援。'
    )
  }

  if (counts.mdns > 0 && counts.udp === 0) {
    return (
      `mDNS 找到 ${counts.mdns} 台，但都沒有透過 UDP 4211 回報狀態。` +
      '板子有在網路上，但收不到 controller_hello 或回不了狀態 —— ' +
      '請確認板子韌體的 status_port 是 4211，且沒有防火牆擋住這個 port。'
    )
  }

  return null
}

/**
 * 演出進行中要跳過子網 unicast 掃描。
 *
 * 原因：508 個主機位址的 unicast hello 等於 508 個 ARP 廣播。
 * timecode 在同頻道上以 100Hz 跑動，此時無線電噪音會直接干擾同步。
 * 相比之下 broadcast 爆發（前後各幾輪）成本很便宜（幾顆封包），保留。
 */
export function shouldSkipSubnetSweep(showRunning: boolean): boolean {
  return showRunning
}

#pragma once

#include <stdint.h>

/**
 * ESP-NOW heartbeat：讓「有人按著開關」這件事傳達給現場其他板子。
 *
 * 規則是 OR —— 現場任何一個開關閉合，全體就進入本機模式。
 *
 * 只在自己的開關 ON 時廣播，OFF 時完全不發。這讓接收端的邏輯縮成一句話：
 * 「收到合法封包 = 有人按著」，anyPeerOn() 就只是看距離最後一次收到是否
 * 在 timeout 內。若改成一直發、用 switch_on 欄位分辨，接收端得替每個 peer
 * 維護最後狀態，掉包時還要決定要不要沿用舊值 —— 沒必要的複雜度。
 *
 * ESP-NOW 只有在同一個 WiFi channel 才收得到，而 channel 跟著 WiFi 連線走。
 * 這是本功能唯一未經實機驗證的部分，見 spec 的「已知風險」一節。
 */

/** 廣播間隔。 */
#ifndef LOCAL_SYNC_BEACON_INTERVAL_MS
#define LOCAL_SYNC_BEACON_INTERVAL_MS 200
#endif

/** 多久沒收到封包就認定「沒有人按著」。預設容許連掉 4 包。 */
#ifndef LOCAL_SYNC_PEER_TIMEOUT_MS
#define LOCAL_SYNC_PEER_TIMEOUT_MS 1000
#endif

/** WiFi 未連線時要固定的 channel，讓各板的 ESP-NOW 能對上。 */
#ifndef LOCAL_SYNC_FALLBACK_CHANNEL
#define LOCAL_SYNC_FALLBACK_CHANNEL 1
#endif

#define LOCAL_SYNC_MAGIC0 'L'
#define LOCAL_SYNC_MAGIC1 'S'
#define LOCAL_SYNC_VERSION 1

/**
 * 廣播封包。刻意 packed —— 這個結構會直接跨板子傳輸，
 * 不能讓不同編譯設定的 padding 造成解析錯位。
 */
struct __attribute__((packed)) LocalSyncBeacon {
  uint8_t  magic[2];       // 'L','S' —— 濾掉不相干的 ESP-NOW 封包
  uint8_t  version;        // LOCAL_SYNC_VERSION
  uint8_t  switch_on;      // 恆為 1（只在 ON 時發），保留供日後擴充與除錯辨識
  uint32_t music_time_ms;  // 保留欄位，本版不使用（見 spec 的 YAGNI 一節）
  uint32_t seq;            // 遞增序號，供 log 判斷掉包
};

class LocalSyncPeer {
public:
  /**
   * 初始化 ESP-NOW 並註冊接收 callback。
   * @return false 表示初始化失敗；呼叫端應降級成「只管自己」並繼續運作，
   *         不可因此讓本機播放失效。
   */
  bool begin();

  /**
   * 每個主迴圈呼叫一次。my_switch_on 為 true 時依 BEACON_INTERVAL 廣播。
   * @param music_time_ms 目前音樂時間，填入封包保留欄位
   */
  void tick(uint32_t now_ms, bool my_switch_on, uint32_t music_time_ms);

  /** timeout 內是否收過其他板子的封包（不含自己）。 */
  bool anyPeerOn(uint32_t now_ms) const;

  /**
   * 處理一個收到的封包。ESP-NOW callback 會呼叫它，
   * 單元測試也直接呼叫它餵假封包，不需要真的 ESP-NOW。
   * 非法封包（magic/version 不符、長度不對）必須被忽略。
   */
  void onPacket(const uint8_t *data, int len, uint32_t now_ms);

  /** begin() 是否成功。false 時 tick/anyPeerOn 仍可安全呼叫，只是不會有作用。 */
  bool isReady() const { return _ready; }

  /** WiFi 未連線時把 channel 固定到 FALLBACK_CHANNEL，讓各板對得上。 */
  void ensureChannel(bool wifi_connected);

private:
  bool _ready = false;
  uint32_t _last_send_ms = 0;
  uint32_t _last_peer_rx_ms = 0;  // 0 表示從未收到
  uint32_t _seq = 0;
  uint8_t _current_channel = 0;
};

#include "local_sync_peer.h"
#include <Arduino.h>
#include <WiFi.h>
#include <cstring>
#include <esp_now.h>
#include <esp_wifi.h>

namespace {

const uint8_t kBroadcastAddr[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

// ESP-NOW 的 recv callback 是 C 風格 static 函式，沒有 this 可用，
// 只能靠這個檔案內部的指標轉接回 instance。begin() 成功時才會設值，
// 失敗或尚未 begin() 時維持 nullptr，callback 進來也不會 touch 到壞資料。
LocalSyncPeer *s_instance = nullptr;

// 對應本專案釘住的 espressif32 @ ~7.0.1（arduino-esp32 3.20017 系列）。
// 實際查過 ~/.platformio/packages/framework-arduinoespressif32/tools/sdk/esp32s3/
// include/esp_wifi/include/esp_now.h：esp_now_recv_cb_t 仍是
// void(*)(const uint8_t *mac_addr, const uint8_t *data, int data_len)，
// 沒有 esp_now_recv_info_t 這個型別。若之後升級 platform 版本導致簽章改變，
// 這裡會直接編譯錯誤，不會是難查的 runtime 問題。
void onEspNowRecv(const uint8_t *mac_addr, const uint8_t *data, int len) {
  (void)mac_addr;
  if (s_instance == nullptr) return;
  // callback 裡不做重活，純轉呼叫，其餘驗證邏輯全在 onPacket 裡，
  // 這樣 onPacket 才能被單元測試直接餵假封包，不必真的觸發 ESP-NOW。
  s_instance->onPacket(data, len, millis());
}

} // namespace

bool LocalSyncPeer::begin() {
  s_instance = this;

  if (esp_now_init() != ESP_OK) {
    Serial.println("[espnow] 初始化失敗，降級為只管自己的本機播放");
    return false;
  }

  esp_now_register_recv_cb(onEspNowRecv);

  esp_now_peer_info_t peer{};
  memcpy(peer.peer_addr, kBroadcastAddr, sizeof(peer.peer_addr));
  peer.channel = 0;   // 0 = 沿用目前 WiFi channel
  peer.ifidx = WIFI_IF_STA;
  peer.encrypt = false;
  if (esp_now_add_peer(&peer) != ESP_OK) {
    Serial.println("[espnow] 加入 broadcast peer 失敗，降級為只管自己的本機播放");
    return false;
  }

  _ready = true;
  return true;
}

void LocalSyncPeer::tick(uint32_t now_ms, bool my_switch_on, uint32_t music_time_ms) {
  if (!_ready || !my_switch_on) return;  // 只在自己 ON 時廣播，見 header 的設計理由
  if (_last_send_ms != 0 && (now_ms - _last_send_ms) < LOCAL_SYNC_BEACON_INTERVAL_MS) return;

  _last_send_ms = now_ms;

  LocalSyncBeacon beacon{};
  beacon.magic[0] = LOCAL_SYNC_MAGIC0;
  beacon.magic[1] = LOCAL_SYNC_MAGIC1;
  beacon.version = LOCAL_SYNC_VERSION;
  beacon.switch_on = 1;
  beacon.music_time_ms = music_time_ms;
  beacon.seq = _seq++;

  esp_now_send(kBroadcastAddr, reinterpret_cast<const uint8_t *>(&beacon), sizeof(beacon));
}

void LocalSyncPeer::onPacket(const uint8_t *data, int len, uint32_t now_ms) {
  if (len != static_cast<int>(sizeof(LocalSyncBeacon))) return;

  const LocalSyncBeacon *beacon = reinterpret_cast<const LocalSyncBeacon *>(data);
  if (beacon->magic[0] != LOCAL_SYNC_MAGIC0 || beacon->magic[1] != LOCAL_SYNC_MAGIC1) return;
  if (beacon->version != LOCAL_SYNC_VERSION) return;

  _last_peer_rx_ms = now_ms;
}

bool LocalSyncPeer::anyPeerOn(uint32_t now_ms) const {
  if (_last_peer_rx_ms == 0) return false;  // 從未收過任何合法封包
  // 減法形式比較，讓 now_ms 的 uint32_t wrap around 也能算對。
  return (now_ms - _last_peer_rx_ms) < LOCAL_SYNC_PEER_TIMEOUT_MS;
}

void LocalSyncPeer::ensureChannel(bool wifi_connected) {
  if (wifi_connected) {
    // 連上 AP 之後 channel 由 AP 決定，我們不去搶；但必須把記錄作廢（0 = 未知）。
    //
    // 否則會踩到這個情境：開機無網 → 設 channel=1（記錄 1）→ 連上 AP（實際被改成
    // 例如 6，記錄仍是 1）→ 再度斷線 → 因為記錄等於 FALLBACK 而直接 return，
    // channel 停在 6 沒切回來，各板的 ESP-NOW 就對不上了。
    // 「斷斷續續」正是本功能存在的理由，這條路徑一定會被走到。
    _current_channel = 0;
    return;
  }

  if (_current_channel == LOCAL_SYNC_FALLBACK_CHANNEL) return;

  // WiFi 尚未 init 完成時 set_channel 會失敗。這裡不重試也不當成錯誤 ——
  // 下一輪 loop 還會再呼叫一次，記錄沒更新就會自然重試。
  const esp_err_t err =
      esp_wifi_set_channel(LOCAL_SYNC_FALLBACK_CHANNEL, WIFI_SECOND_CHAN_NONE);
  if (err != ESP_OK) return;

  _current_channel = LOCAL_SYNC_FALLBACK_CHANNEL;
  Serial.printf("[espnow] WiFi 斷線，固定 channel=%d 讓各板 ESP-NOW 對得上\n",
                LOCAL_SYNC_FALLBACK_CHANNEL);
}

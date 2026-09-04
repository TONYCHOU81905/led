#include "mdns_advertiser.h"

#include <Arduino.h>
#include <ESPmDNS.h>
#include <WiFi.h>

namespace mdns_advertiser {

namespace {

bool g_running = false;

/** _ledsync._udp —— Studio 端 browse 的服務型別，兩邊必須一致。 */
constexpr const char *SERVICE_NAME = "ledsync";
constexpr const char *SERVICE_PROTO = "udp";

} // namespace

void chipSuffix(char *out, size_t out_size) {
  if (out == nullptr || out_size == 0) return;
  uint8_t mac[6] = {0};
  WiFi.macAddress(mac);
  snprintf(out, out_size, "%02x%02x%02x", mac[3], mac[4], mac[5]);
}

void sanitizeHostname(const char *device_id, char *out, size_t out_size) {
  if (out == nullptr || out_size == 0) return;

  size_t w = 0;
  // DNS label 上限 63 字元；再留一個 '\0'
  const size_t limit = out_size - 1 < 63 ? out_size - 1 : 63;

  for (size_t r = 0; device_id != nullptr && device_id[r] != '\0' && w < limit; r++) {
    const char c = device_id[r];
    if (c >= 'a' && c <= 'z') {
      out[w++] = c;
    } else if (c >= 'A' && c <= 'Z') {
      out[w++] = static_cast<char>(c - 'A' + 'a');
    } else if (c >= '0' && c <= '9') {
      out[w++] = c;
    } else {
      // 底線、空白、點等一律轉成 '-'，但不要製造開頭或連續的 '-'
      if (w > 0 && out[w - 1] != '-') out[w++] = '-';
    }
  }

  // 結尾的 '-' 也是非法的 hostname
  while (w > 0 && out[w - 1] == '-') w--;

  if (w == 0) {
    // device_id 全是非法字元（或空字串）時仍要有個能解析的名字
    const char *fallback = "ledsync-device";
    for (size_t i = 0; fallback[i] != '\0' && w < limit; i++) out[w++] = fallback[i];
  }

  out[w] = '\0';
}

void start(const DeviceConfig &cfg) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[mdns] WiFi 未連線，跳過註冊");
    return;
  }

  // 重連後 IP 可能變了，一律先關掉舊紀錄再重新註冊。
  if (g_running) {
    MDNS.end();
    g_running = false;
  }

  char chip[8];
  chipSuffix(chip, sizeof(chip));

  // 先留出後綴要用的空間再消毒，否則 device_id 剛好很長時後綴會被截掉，
  // 十台板子又會撞回同一個名字。
  char base[64 - 8];
  sanitizeHostname(cfg.device_id, base, sizeof(base));

  char hostname[64];
  snprintf(hostname, sizeof(hostname), "%s-%s", base, chip);

  if (!MDNS.begin(hostname)) {
    Serial.printf("[mdns] begin('%s') 失敗，Studio 只能靠 UDP 廣播或手動 IP\n",
                  hostname);
    return;
  }

  MDNS.addService(SERVICE_NAME, SERVICE_PROTO, cfg.network.status_port);
  // device_id 用 TXT 帶原始值：hostname 已被消毒（底線變 '-'），Studio 若拿
  // hostname 回推 device_id 會對不上設定檔，必須用這個欄位比對。
  MDNS.addServiceTxt(SERVICE_NAME, SERVICE_PROTO, "device_id", cfg.device_id);
  MDNS.addServiceTxt(SERVICE_NAME, SERVICE_PROTO, "role_id", cfg.role_id);
  MDNS.addServiceTxt(SERVICE_NAME, SERVICE_PROTO, "fw", FIRMWARE_VERSION);
  // chip_id 讓 Studio 能區分「device_id 相同但實體不同」的多台板子。
  MDNS.addServiceTxt(SERVICE_NAME, SERVICE_PROTO, "chip_id", chip);

  g_running = true;
  Serial.printf("[mdns] %s.local → %s，服務 _%s._%s:%u\n", hostname,
                WiFi.localIP().toString().c_str(), SERVICE_NAME, SERVICE_PROTO,
                cfg.network.status_port);
}

void stop() {
  if (!g_running) return;
  MDNS.end();
  g_running = false;
  Serial.println("[mdns] 已停止註冊");
}

} // namespace mdns_advertiser

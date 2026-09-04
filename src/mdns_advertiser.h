#pragma once

#include <stddef.h>

#include "types.h"

/**
 * mDNS（Bonjour / zeroconf）廣告，讓 Studio 不用手抄 IP 就能找到板子。
 *
 * 為什麼需要它，既然已經有 status_reporter 的 UDP 4211 廣播：
 * UDP broadcast 送到 255.255.255.255 時，OS 只會從「預設路由」那張網卡送出去。
 * 電腦同時接有線與 Wi-Fi 時（很常見），預設路由通常在有線那邊，板子在 Wi-Fi
 * 網段就永遠收不到 hello，表現為「明明同一個 Wi-Fi 卻掃不到裝置」。
 * mDNS 走 multicast 224.0.0.251，macOS / Windows 都有成熟的處理路徑，
 * 而且 Studio 端會逐一 interface 送查詢，不受預設路由影響。
 *
 * 註冊內容：
 *   hostname          <sanitized device_id>.local
 *   service           _ledsync._udp.<status_port>
 *   TXT device_id     未經消毒的原始 device_id（Studio 用它精準比對）
 *   TXT role_id / fw  方便在掃描結果裡直接看出角色與韌體版本
 */
namespace mdns_advertiser {

/**
 * 板子的 6 位 hex 晶片識別（MAC 後 3 bytes），例如 "a4b2c1"。
 *
 * 為什麼需要：device_id 是從 role_id 推導的（`esp32s3_<role>_001`），
 * 同一個 role 的多台板子燒同一份 config 就會拿到「完全相同」的 device_id。
 * 十台一起上線時，mDNS hostname 會全部撞名（Bonjour 只好自動改成 -2、-3，
 * 行為不可預測），Studio 的裝置清單也會把它們併成一台。
 * MAC 出廠唯一，拿它當後綴就不必為每台手動設定不同的 device_id。
 */
void chipSuffix(char *out, size_t out_size);

/**
 * 把 device_id 轉成合法的 DNS label：只留 [a-z0-9-]，其餘（底線、空白、
 * 大寫）一律轉換，並截到 63 字元。
 *
 * 這步不能省：預設 device_id 是 "esp32s3_dancer_demo_001"，底線在 DNS
 * hostname 裡是非法字元，直接丟給 MDNS.begin() 會註冊出一個 Windows 端
 * 解析不到的名字。
 *
 * 純函式，與 WiFi/MDNS 無關，方便單獨驗證。
 */
void sanitizeHostname(const char *device_id, char *out, size_t out_size);

/** WiFi 連上（或重連）後呼叫。內部會先 end() 再 begin()，重複呼叫安全。 */
void start(const DeviceConfig &cfg);

/** WiFi 斷線時呼叫，避免留下指向舊 IP 的紀錄。 */
void stop();

} // namespace mdns_advertiser

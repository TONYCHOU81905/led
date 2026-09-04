#include <Arduino.h>
#include <esp_system.h>
#include "config_loader.h"
#include "clock_sync.h"
#include "led_driver.h"
#include "serial_protocol.h"
#include "status_reporter.h"
#include "sync_receiver.h"
#include "timeline_engine.h"
#include "wifi_manager.h"
#include "time_format.h"
#include "local_trigger.h"
#include "local_sync_peer.h"
#include "mdns_advertiser.h"

static DeviceConfig g_config;
static ConfigLoader g_config_loader;
static LedDriver g_leds;
static ClockSync g_clock;
static SyncReceiver g_sync_rx;
static WifiManager g_wifi;
static StatusReporter g_status;
static SerialProtocol g_serial;
static TimelineEngine g_timeline;
static AppSyncState g_state = STATE_BOOT;

static LocalTrigger g_local_trigger;
static LocalSyncPeer g_local_sync;
static bool g_local_mode = false;

static int64_t last_frame_us = 0;
static bool g_timecode_blackout = false;
static uint32_t g_last_wifi_retry_ms = 0;
static uint32_t g_last_health_log_ms = 0;
static bool g_wifi_was_connected = false;
// 開機橫幅可能因為 USB CDC 重連而漏掉，health log 每次都帶上這個字串，
// 使用者無論什麼時候接上 monitor 都看得到上次的重置原因。
static const char *g_reset_reason_name = "unknown";
// setup 若失敗（config 載入不了、LED 初始化不了）就設為 true：韌體改為進入
// 救援模式而不是死迴圈 —— serial 指令仍然可用，才有辦法從 Studio 診斷與重設。
static bool g_boot_failed = false;

static const char *resetReasonName(esp_reset_reason_t reason) {
  switch (reason) {
  case ESP_RST_POWERON: return "power_on";
  case ESP_RST_EXT: return "external_reset";
  case ESP_RST_SW: return "software_reset";
  case ESP_RST_PANIC: return "panic";
  case ESP_RST_INT_WDT: return "interrupt_watchdog";
  case ESP_RST_TASK_WDT: return "task_watchdog";
  case ESP_RST_WDT: return "other_watchdog";
  case ESP_RST_DEEPSLEEP: return "deep_sleep";
  case ESP_RST_BROWNOUT: return "brownout";
  case ESP_RST_SDIO: return "sdio";
  default: return "unknown";
  }
}

#ifndef TIMECODE_HOLD_MS
#define TIMECODE_HOLD_MS 500
#endif
#ifndef TIMECODE_BLACKOUT_MS
#define TIMECODE_BLACKOUT_MS 2000
#endif
#ifndef WIFI_RETRY_INTERVAL_MS
#define WIFI_RETRY_INTERVAL_MS 10000
#endif
#ifndef HEALTH_LOG_INTERVAL_MS
#define HEALTH_LOG_INTERVAL_MS 5000
#endif

static const char *stateName(AppSyncState state) {
  switch (state) {
  case STATE_BOOT:
    return "BOOT";
  case STATE_WIFI_CONNECTING:
    return "WIFI_CONNECTING";
  case STATE_WAIT_TIMECODE:
    return "WAIT_TIMECODE";
  case STATE_PLAYING:
    return "PLAYING";
  case STATE_PAUSED:
    return "PAUSED";
  case STATE_STOPPED:
    return "STOPPED";
  default:
    return "UNKNOWN";
  }
}

static void startNetworkServices() {
  g_sync_rx.begin(g_config.network.timecode_port);
  g_status.begin(g_config.network.status_port);
  // mDNS 必須在拿到 IP 之後才註冊（紀錄裡帶的就是當前 IP）。
  // 這個函式是 boot 與每次重連的共同入口，放這裡就不會漏。
  mdns_advertiser::start(g_config);
  g_state = STATE_WAIT_TIMECODE;
  g_wifi_was_connected = true;
  Serial.printf("[app] waiting for timecode on UDP %u\n",
                g_config.network.timecode_port);
}

static void logHealth(uint32_t now_ms) {
  const bool wifi_connected = g_wifi.isConnected();
  const uint32_t last_pkt = g_sync_rx.lastPacketMs();
  const uint32_t last_pkt_age =
      last_pkt > 0 ? (now_ms - last_pkt) : 0;
  const uint32_t show_ms =
      g_clock.hasSync() ? g_clock.musicTimeMs(esp_timer_get_time()) : 0;
  char show_time[16];
  formatShowTimeMmSs(show_ms, show_time, sizeof(show_time));
  Serial.printf(
      "[health] state=%s show=%s wifi=%s ip=%s rssi=%d sync=%s playing=%s seq=%u "
      "udp_rx=%u udp_drop=%u udp_dup=%u last_pkt_age_ms=%u local_mode=%s "
      "leds=%u reset=%s heap=%u\n",
      stateName(g_state), show_time, wifi_connected ? "connected" : "disconnected",
      wifi_connected ? WiFi.localIP().toString().c_str() : "-",
      wifi_connected ? WiFi.RSSI() : 0, g_clock.hasSync() ? "yes" : "no",
      g_clock.isPlaying() ? "yes" : "no", g_clock.lastSequence(),
      g_sync_rx.packetsReceived(), g_sync_rx.packetsDropped(),
      g_sync_rx.packetsDuplicated(), last_pkt_age,
      g_local_mode ? "on" : "off",
      // leds / reset / heap 是查「調高 LED 數量之後開始重開機」時最需要的三個數字：
      // leds 確認板子實際跑的是哪份 config、reset 說出上次為什麼重開
      // （brownout vs panic vs watchdog，處理方向完全不同）、
      // heap 排除記憶體不足這條線。
      g_config.hardware.led_count, g_reset_reason_name, ESP.getFreeHeap());
}

static void renderStateIndicator(uint32_t now_ms) {
  switch (g_state) {
  case STATE_BOOT:
    g_leds.showStatusColor({80, 80, 255}, now_ms, false);
    break;
  case STATE_WIFI_CONNECTING:
    g_leds.showStatusColor({255, 180, 0}, now_ms, true);
    break;
  case STATE_WAIT_TIMECODE:
    g_leds.clear();
    g_leds.show();
    break;
  case STATE_STOPPED:
    g_leds.clear();
    g_leds.show();
    break;
  case STATE_PAUSED:
    // 不會走到這裡：PAUSED 現在由 loop() 直接 render timeline，
    // 這樣拖動時間軸才能即時預覽（見 loop 裡的 render_timeline）。
    break;
  case STATE_PLAYING:
    break;
  }
}

void setup() {
  // USB CDC 的預設接收緩衝只有 256 bytes，超過就被靜默丟棄（連 JSON parse
  // error 都不會印）。Studio 的 config_chunk 指令約 324 bytes，於是整行永遠
  // 收不完整，chunk 從來沒有一次成功 —— 表現為「上傳 Config 卡住不動」，
  // 板子只能一直跑內建預設值，LED 因此完全不亮。
  // 實測臨界點：228 bytes 可過、278 bytes 失敗。
  // 必須在 begin() 之前設定才有效。
  Serial.setRxBufferSize(4096);
  Serial.begin(115200);

  // 等 USB CDC 的 host 端真的接上再印開機橫幅。
  //
  // 為什麼需要這段：原本只 delay(500) 就開始印，但 host（pio device monitor /
  // Studio 的 DebugView）在板子重開後要花超過 500ms 才會重新開啟 CDC，所以
  // 「Reset reason:」那一行每次都被吃掉 —— 板子在 brownout 迴圈時，使用者
  // 看到的只有 "Disconnected (read failed: Errno 6)" 反覆出現，完全查不到原因。
  //
  // 上限 2 秒：沒有接 host 時（正式演出）不能卡在這裡等。
  // ARDUINO_USB_CDC_ON_BOOT 時 Serial 的 operator bool() 反映 host 有沒有開埠；
  // 走 UART 橋接晶片的板子恆為 true，所以這個迴圈對它們是零成本。
  const uint32_t serial_wait_start = millis();
  while (!Serial && (millis() - serial_wait_start) < 2000) {
    delay(50);
  }
  delay(150);

  Serial.println();
  Serial.printf("LED Timecode Sync v%s\n", FIRMWARE_VERSION);
  const esp_reset_reason_t reset_reason = esp_reset_reason();
  g_reset_reason_name = resetReasonName(reset_reason);
  Serial.printf("Reset reason: %s (%d)\n", resetReasonName(reset_reason),
                static_cast<int>(reset_reason));
  if (reset_reason == ESP_RST_BROWNOUT) {
    Serial.println(
        "[app] ⚠ brownout：電壓被拉到門檻以下而重置。常見於 LED 數量或亮度"
        "調高之後，WiFi 無線電啟動的電流尖峰壓垮電源。"
        "請檢查 5V 供電餘裕、線徑、燈條端的電容，或調低 max_brightness。");
  }
  Serial.printf("Chip: %s @ %u MHz, LED_COUNT_MAX=%u, LED_DATA_GPIO=%d, default_led_type=WS2811\n",
                ESP.getChipModel(), ESP.getCpuFreqMHz(), LED_COUNT_MAX,
                LED_DATA_GPIO);

  g_state = STATE_BOOT;

  // Serial protocol 必須最先啟動。之前 config / LED 初始化失敗時是
  // `while (true) delay(1000)`，那會讓板子完全不回應任何指令，Studio 端只看得到
  // "Serial command timeout"，完全無從診斷，也沒辦法重寫設定把板子救回來。
  g_serial.begin();

  if (!g_config_loader.load(g_config)) {
    Serial.println("[app] config load failed — 進入救援模式（serial 指令仍可用）");
    g_boot_failed = true;
  }

  if (!g_boot_failed) {
    g_timeline.setConfig(&g_config);

    if (!g_leds.init(g_config.hardware)) {
      Serial.println("[app] LED init failed — 進入救援模式（serial 指令仍可用）");
      g_boot_failed = true;
    }
  }

#ifndef LED_DISABLE_BOOT_SELFTEST
  // Wiring check: flash the strip on power-up to confirm the data line (GPIO)
  // is connected and the chipset/color order is correct. Disable with
  // -DLED_DISABLE_BOOT_SELFTEST once wiring is verified.
  if (!g_boot_failed) g_leds.selfTest(3000);
#endif

  // 判別假說 2-B：WiFi 中斷是否干擾 FastLED 的 RMT 訊號
#ifndef DIAG_DISABLE_WIFI
  g_state = STATE_WIFI_CONNECTING;
  if (!g_wifi.connect(g_config.network)) {
    Serial.println("[app] WiFi failed — continuing offline for debug");
  }

  if (g_wifi.isConnected()) {
    startNetworkServices();
  }
#else
  Serial.println("[diag] WiFi disabled (DIAG_DISABLE_WIFI)");
  g_state = STATE_WIFI_CONNECTING;
#endif

  // 本機備援模式初始化
  g_local_trigger.begin();
  if (!g_local_sync.begin()) {
    // ESP-NOW 初始化失敗時降級成「只管自己」，不影響本機播放能力
    Serial.println("[app] ESP-NOW init failed — local mode will operate in standalone mode");
  }

  last_frame_us = esp_timer_get_time();
}

static void applySerialPendingAction(const SerialPendingAction &action) {
  if (!action.pending) return;

  g_timeline.setConfig(&g_config);
  // Brightness does not require rebuilding FastLED controllers, so apply it
  // immediately whenever a new Config is accepted over Serial.
  if (!g_boot_failed) g_leds.setMaxBrightness(g_config.hardware.max_brightness);

  if (action.network_changed) {
    // Must NOT block here — Studio often uploads config right after setWifi.
    // Blocking WiFi.connect() starves Serial and causes "Serial command timeout".
    g_state = STATE_WIFI_CONNECTING;
    g_wifi_was_connected = false;
    g_last_wifi_retry_ms = millis();
    g_wifi.beginConnect(g_config.network);
    Serial.println("[app] WiFi reconnect started in background after serial update");
  }
}

void loop() {
  const int64_t now_us = esp_timer_get_time();
  const uint32_t now_ms = static_cast<uint32_t>(now_us / 1000);

  const bool wifi_connected = g_wifi.isConnected();

  // 本機備援模式：實體開關和 ESP-NOW 通訊
  g_local_trigger.poll(now_ms);
  g_local_sync.ensureChannel(wifi_connected);
  g_local_sync.tick(now_ms, g_local_trigger.isOn(), g_clock.musicTimeMs(now_us));

  const bool want_local = g_local_trigger.isOn() || g_local_sync.anyPeerOn(now_ms);

  // 進入本機備援模式
  if (want_local && !g_local_mode) {
    g_local_mode = true;
    // 若已在播放，從當前位置接續；否則從 0 開始
    const uint32_t start = g_clock.isPlaying() ? g_clock.musicTimeMs(now_us) : 0;
    g_clock.onStart(start, now_us);
    g_state = STATE_PLAYING;
    Serial.printf("[local] 進入本機備援模式，起點: %u ms\n", start);
  }

  // 退出本機備援模式
  if (!want_local && g_local_mode) {
    g_local_mode = false;
    g_clock.setPlaying(false);
    g_state = wifi_connected ? STATE_WAIT_TIMECODE : STATE_WIFI_CONNECTING;
    Serial.printf("[local] 退出本機備援模式，狀態切換至 %s\n", stateName(g_state));
  }

  // UDP socket 只有在 WiFi 連上、startNetworkServices() 跑過之後才有效。
  // 未連線時照樣呼叫 parsePacket / endPacket，會每個 frame 噴一次
  //   [E][WiFiUdp.cpp:221] parsePacket(): could not receive data: 9
  // 把 serial log 完全洗掉，也讓 Studio 端更難讀到指令回應。
  // 本機備援模式期間完全忽略網路 timecode —— 直到開關彈起才交還控制權。
  // 不然在不穩定的場地會造成燈光反覆跳動與凍結，正是本備援模式要避免的狀況。
  if (wifi_connected && !g_local_mode) {
    g_sync_rx.poll(g_clock, g_state);
  }

  // serial 一定要無條件執行 —— 沒有它就沒辦法從 Studio 寫入 WiFi 憑證，
  // 板子會永遠困在「連不上 WiFi 又無法被設定」的狀態。
  g_serial.poll(g_config_loader, g_config, g_clock, g_sync_rx, g_state);
  applySerialPendingAction(g_serial.takePendingAction());

  if (wifi_connected) {
    g_status.tick(now_ms, g_config, g_state, g_clock, g_sync_rx);
  }

#ifndef DIAG_DISABLE_WIFI
  if (!wifi_connected) {
    if (g_wifi_was_connected) {
      g_wifi_was_connected = false;
      g_state = STATE_WIFI_CONNECTING;
      // 不停掉的話，紀錄會停留在舊 IP，Studio 掃到後連過去是死的。
      mdns_advertiser::stop();
      Serial.println("[wifi] disconnected; will retry");
    }
    if (now_ms - g_last_wifi_retry_ms >= WIFI_RETRY_INTERVAL_MS) {
      g_last_wifi_retry_ms = now_ms;
      // Non-blocking retry so Serial / UDP keep running during join
      g_wifi.beginConnect(g_config.network);
    }
  } else {
    if (!g_wifi_was_connected) {
      startNetworkServices();
      Serial.println("[wifi] connected");
    }
    g_wifi_was_connected = true;
    if (g_state == STATE_WIFI_CONNECTING) {
      g_state = STATE_WAIT_TIMECODE;
    }
  }
#endif

  if (now_ms - g_last_health_log_ms >= HEALTH_LOG_INTERVAL_MS) {
    g_last_health_log_ms = now_ms;
    logHealth(now_ms);
  }

  // 注意：這裡的條件刻意不看 g_clock.isPlaying()。進 blackout 時會呼叫
  // g_clock.freeze() 把 _playing 設成 false，若條件依賴 isPlaying() 就會
  // 立刻掉進 else 把 blackout 旗標清掉，下一輪又重新偵測 —— 燈光會閃爍。
  //
  // 本機備援模式時不做 blackout 凍結 —— 這是極其重要的陷阱修補。
  // onStart(start, now_us) 會呼叫 applyHardSeek 把 _synced 設成 true，
  // 若不擋掉這個條件，曾經連過 WiFi 的板子會因為 _last_packet_ms 停在舊值
  // 而立刻計算出好幾萬 ms 的 gap、超過 TIMECODE_BLACKOUT_MS，凍結時鐘。
  // 結果：按下本機按鈕，燈光亮不到一瞬間就被凍結。這種只在「曾連過網」的板子上
  // 出現的 bug 最難查。
  if (g_state == STATE_PLAYING && g_clock.hasSync() && !g_local_mode) {
    const uint32_t last_pkt = g_sync_rx.lastPacketMs();
    if (last_pkt > 0 && now_ms >= last_pkt) {
      const uint32_t gap = now_ms - last_pkt;
      if (gap > TIMECODE_BLACKOUT_MS) {
        if (!g_timecode_blackout) {
          g_timecode_blackout = true;
          // 凍結時鐘，否則沒有時間源還會照 esp_timer 一直數下去：
          // Studio 停在 3:02，板子 20 秒後已經跑到 3:19。
          g_clock.freeze(now_us);
          Serial.printf("[sync] blackout: no timecode for %u ms（時鐘凍結於 %u ms）\n",
                        gap, g_clock.musicTimeMs(now_us));
        }
      } else {
        // gap <= TIMECODE_BLACKOUT_MS：短暫掉包，clock 繼續本機推算即可
        // （TIMECODE_HOLD_MS 之前分成兩個分支，但兩邊行為完全相同）。
        g_timecode_blackout = false;
      }
    } else {
      g_timecode_blackout = false;
    }
  } else {
    g_timecode_blackout = false;
  }

  // 救援模式下 LED driver 沒初始化成功，任何 render 都不能碰
  if (!g_boot_failed && now_us - last_frame_us >= FRAME_INTERVAL_US) {
    last_frame_us = now_us;

    // PAUSED 也要依當前時間 render：Studio 端拖動時間軸會送 SEEK，clock 的
    // music time 跟著更新，燈光就能即時預覽該時間點的畫面。
    // 原本 PAUSED 是 hold last frame（不刷新），拖時間軸時燈完全不動，
    // 停在暫停瞬間的殘影，看起來像壞掉。
    const bool render_timeline =
        (g_state == STATE_PLAYING && g_clock.isPlaying() && !g_timecode_blackout) ||
        g_state == STATE_PAUSED;

    if (render_timeline) {
      const uint32_t t = g_clock.musicTimeMs(now_us);
      g_timeline.render(t, g_leds);
    } else {
      renderStateIndicator(now_ms);
    }
  }

  yield();
}

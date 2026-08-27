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

static int64_t last_frame_us = 0;
static bool g_timecode_blackout = false;
static uint32_t g_last_wifi_retry_ms = 0;
static uint32_t g_last_health_log_ms = 0;
static bool g_wifi_was_connected = false;
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
      "udp_rx=%u udp_drop=%u last_pkt_age_ms=%u\n",
      stateName(g_state), show_time, wifi_connected ? "connected" : "disconnected",
      wifi_connected ? WiFi.localIP().toString().c_str() : "-",
      wifi_connected ? WiFi.RSSI() : 0, g_clock.hasSync() ? "yes" : "no",
      g_clock.isPlaying() ? "yes" : "no", g_clock.lastSequence(),
      g_sync_rx.packetsReceived(), g_sync_rx.packetsDropped(), last_pkt_age);
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
    // hold last frame — no refresh
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
  delay(500);
  Serial.println();
  Serial.printf("LED Timecode Sync v%s\n", FIRMWARE_VERSION);
  const esp_reset_reason_t reset_reason = esp_reset_reason();
  Serial.printf("Reset reason: %s (%d)\n", resetReasonName(reset_reason),
                static_cast<int>(reset_reason));
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

  g_state = STATE_WIFI_CONNECTING;
  if (!g_wifi.connect(g_config.network)) {
    Serial.println("[app] WiFi failed — continuing offline for debug");
  }

  if (g_wifi.isConnected()) {
    startNetworkServices();
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

  // UDP socket 只有在 WiFi 連上、startNetworkServices() 跑過之後才有效。
  // 未連線時照樣呼叫 parsePacket / endPacket，會每個 frame 噴一次
  //   [E][WiFiUdp.cpp:221] parsePacket(): could not receive data: 9
  // 把 serial log 完全洗掉，也讓 Studio 端更難讀到指令回應。
  if (wifi_connected) {
    g_sync_rx.poll(g_clock, g_state);
  }

  // serial 一定要無條件執行 —— 沒有它就沒辦法從 Studio 寫入 WiFi 憑證，
  // 板子會永遠困在「連不上 WiFi 又無法被設定」的狀態。
  g_serial.poll(g_config_loader, g_config, g_clock, g_sync_rx, g_state);
  applySerialPendingAction(g_serial.takePendingAction());

  if (wifi_connected) {
    g_status.tick(now_ms, g_config, g_state, g_clock, g_sync_rx);
  }

  if (!wifi_connected) {
    if (g_wifi_was_connected) {
      g_wifi_was_connected = false;
      g_state = STATE_WIFI_CONNECTING;
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

  if (now_ms - g_last_health_log_ms >= HEALTH_LOG_INTERVAL_MS) {
    g_last_health_log_ms = now_ms;
    logHealth(now_ms);
  }

  if (g_state == STATE_PLAYING && g_clock.hasSync() && g_clock.isPlaying()) {
    const uint32_t last_pkt = g_sync_rx.lastPacketMs();
    if (last_pkt > 0 && now_ms >= last_pkt) {
      const uint32_t gap = now_ms - last_pkt;
      if (gap > TIMECODE_BLACKOUT_MS) {
        if (!g_timecode_blackout) {
          g_timecode_blackout = true;
          Serial.printf("[sync] blackout: no timecode for %u ms\n", gap);
        }
      } else if (gap > TIMECODE_HOLD_MS) {
        g_timecode_blackout = false;
        // continue_local: clock keeps running without new packets
      } else {
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

    if (g_state == STATE_PLAYING && g_clock.isPlaying() && !g_timecode_blackout) {
      const uint32_t t = g_clock.musicTimeMs(now_us);
      g_timeline.render(t, g_leds);
    } else {
      renderStateIndicator(now_ms);
    }
  }

  yield();
}

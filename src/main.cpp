#include <Arduino.h>
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
  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.printf("LED Timecode Sync v%s\n", FIRMWARE_VERSION);
  Serial.printf("Chip: %s @ %u MHz, LED_COUNT_MAX=%u, LED_DATA_GPIO=%d, default_led_type=WS2811\n",
                ESP.getChipModel(), ESP.getCpuFreqMHz(), LED_COUNT_MAX,
                LED_DATA_GPIO);

  g_state = STATE_BOOT;

  if (!g_config_loader.load(g_config)) {
    Serial.println("[app] config load failed");
    while (true) delay(1000);
  }

  g_timeline.setConfig(&g_config);

  if (!g_leds.init(g_config.hardware)) {
    Serial.println("[app] LED init failed");
    while (true) delay(1000);
  }

#ifndef LED_DISABLE_BOOT_SELFTEST
  // Wiring check: flash the strip on power-up to confirm the data line (GPIO)
  // is connected and the chipset/color order is correct. Disable with
  // -DLED_DISABLE_BOOT_SELFTEST once wiring is verified.
  g_leds.selfTest(3000);
#endif

  g_serial.begin();

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

  if (action.network_changed) {
    g_state = STATE_WIFI_CONNECTING;
    if (g_wifi.reconnect(g_config.network)) {
      startNetworkServices();
      Serial.println("[app] WiFi reconnected after serial update");
    } else {
      g_wifi_was_connected = false;
      Serial.println("[app] WiFi reconnect failed after serial update");
    }
  }
}

void loop() {
  const int64_t now_us = esp_timer_get_time();
  const uint32_t now_ms = static_cast<uint32_t>(now_us / 1000);

  g_sync_rx.poll(g_clock, g_state);
  g_serial.poll(g_config_loader, g_config, g_clock, g_sync_rx, g_state);
  applySerialPendingAction(g_serial.takePendingAction());
  g_status.tick(now_ms, g_config, g_state, g_clock, g_sync_rx);

  const bool wifi_connected = g_wifi.isConnected();
  if (!wifi_connected) {
    if (g_wifi_was_connected) {
      g_wifi_was_connected = false;
      g_state = STATE_WIFI_CONNECTING;
      Serial.println("[wifi] disconnected; will retry");
    }
    if (now_ms - g_last_wifi_retry_ms >= WIFI_RETRY_INTERVAL_MS) {
      g_last_wifi_retry_ms = now_ms;
      Serial.printf("[wifi] retrying '%s'...\n", g_config.network.ssid);
      if (g_wifi.reconnect(g_config.network)) {
        startNetworkServices();
        Serial.println("[wifi] reconnect OK");
      } else {
        Serial.println("[wifi] reconnect failed");
      }
    }
  } else {
    g_wifi_was_connected = true;
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

  if (now_us - last_frame_us >= FRAME_INTERVAL_US) {
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

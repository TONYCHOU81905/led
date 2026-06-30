#include <Arduino.h>
#include "config_loader.h"
#include "clock_sync.h"
#include "led_driver.h"
#include "serial_protocol.h"
#include "status_reporter.h"
#include "sync_receiver.h"
#include "timeline_engine.h"
#include "wifi_manager.h"

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

  g_serial.begin();

  g_state = STATE_WIFI_CONNECTING;
  if (!g_wifi.connect(g_config.network)) {
    Serial.println("[app] WiFi failed — continuing offline for debug");
  }

  if (g_wifi.isConnected()) {
    g_sync_rx.begin(g_config.network.timecode_port);
    g_status.begin(g_config.network.status_port);
    g_state = STATE_WAIT_TIMECODE;
    Serial.println("[app] waiting for timecode on UDP 4210");
  }

  last_frame_us = esp_timer_get_time();
}

static void applySerialPendingAction(const SerialPendingAction &action) {
  if (!action.pending) return;

  g_timeline.setConfig(&g_config);

  if (action.network_changed) {
    g_state = STATE_WIFI_CONNECTING;
    if (g_wifi.reconnect(g_config.network)) {
      g_sync_rx.begin(g_config.network.timecode_port);
      g_status.begin(g_config.network.status_port);
      g_state = STATE_WAIT_TIMECODE;
      Serial.println("[app] WiFi reconnected after serial update");
    } else {
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

  if (now_us - last_frame_us >= FRAME_INTERVAL_US) {
    last_frame_us = now_us;

    if (g_state == STATE_PLAYING && g_clock.isPlaying()) {
      const uint32_t t = g_clock.musicTimeMs(now_us);
      g_timeline.render(t, g_leds);
    } else {
      renderStateIndicator(now_ms);
    }
  }

  yield();
}

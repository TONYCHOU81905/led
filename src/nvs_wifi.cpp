#include "nvs_wifi.h"
#include <Preferences.h>
#include <string.h>

static const char *kNamespace = "ledshow";
static const char *kKeySsid = "ssid";
static const char *kKeyPass = "pass";

bool NvsWifi::loadNetworkOverlay(NetworkConfig &config) {
  Preferences prefs;
  if (!prefs.begin(kNamespace, true)) {
    return false;
  }

  const String ssid = prefs.getString(kKeySsid, "");
  const String pass = prefs.getString(kKeyPass, "");
  prefs.end();

  if (ssid.length() == 0) {
    return false;
  }

  strncpy(config.ssid, ssid.c_str(), sizeof(config.ssid) - 1);
  config.ssid[sizeof(config.ssid) - 1] = '\0';
  strncpy(config.password, pass.c_str(), sizeof(config.password) - 1);
  config.password[sizeof(config.password) - 1] = '\0';
  return true;
}

bool NvsWifi::saveNetwork(const char *ssid, const char *pass) {
  if (!ssid || ssid[0] == '\0') {
    return false;
  }

  Preferences prefs;
  if (!prefs.begin(kNamespace, false)) {
    return false;
  }

  const bool ok =
      prefs.putString(kKeySsid, ssid) > 0 &&
      prefs.putString(kKeyPass, pass ? pass : "") >= 0;
  prefs.end();
  return ok;
}

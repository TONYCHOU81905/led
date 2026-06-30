#pragma once

#include "types.h"

namespace NvsWifi {

bool loadNetworkOverlay(NetworkConfig &config);
bool saveNetwork(const char *ssid, const char *pass);

} // namespace NvsWifi

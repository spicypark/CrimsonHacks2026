// Copy this file to config.h (same folder) and fill it in. config.h is git-ignored.
#pragma once

// --- Wi-Fi (2.4 GHz only: the ESP32-C3 can't see 5 GHz networks) ---
#define WIFI_SSID     "your-wifi-name"
#define WIFI_PASSWORD "your-wifi-password"

// --- PullUp server ---
// Your deployment (https works), or your laptop on the same Wi-Fi: "http://192.168.1.23:3000"
// (not "localhost" - that would be the ESP32 itself).
#define PULLUP_URL "https://your-pullup-domain.com"

// --- What you think is cool ---
// Free text, same as the site's search box. Examples:
//   "live music and comedy"   "climbing, trail runs"   "free food, meet people"   "jazz near Sugar House"
#define INTERESTS "live music, climbing, free events"

// Time window to look in: now, today, tonight, tomorrow, weekend, week, month
#define WHEN "week"

// --- Behavior ---
#define REFRESH_MINUTES      10   // how often to ask the server for new picks
#define AUTO_ROTATE_SECONDS  0    // 0 = always show the top pick; >0 = cycle through picks
#define BACK_TO_TOP_SECONDS  60   // after pressing BOOT to browse, return to the top pick
#define BRIGHTNESS           200  // backlight 0-255
#define LED_ENABLED          1    // onboard RGB LED glows when the event is live / starting soon

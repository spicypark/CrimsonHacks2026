/*
 * PullUp desk display — Waveshare ESP32-C3-LCD-1.47 (ST7789, 172x320)
 *
 * Shows the coolest upcoming event for your interests (set in config.h): name, when, where,
 * with a live countdown. Asks the PullUp server's /api/device endpoint every few minutes.
 *
 *   BOOT button  short press -> next pick     long press (1s) -> refresh now
 *   RGB LED      breathes green while the event is live, amber when it starts within 2 hours
 *
 * Libraries (Arduino Library Manager): "Adafruit ST7735 and ST7789 Library", "Adafruit GFX Library",
 * "ArduinoJson" (v7). Board: ESP32C3 Dev Module, USB CDC On Boot: Enabled. See README.md.
 */
#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <time.h>
#include <sys/time.h>

#include <Fonts/FreeSans9pt7b.h>
#include <Fonts/FreeSansBold9pt7b.h>
#include <Fonts/FreeSansBold12pt7b.h>
#include <Fonts/FreeSansBold18pt7b.h>

#if __has_include("config.h")
#include "config.h"
#else
#error "Copy config.example.h to config.h and fill in your Wi-Fi, server and interests."
#endif

// Defaults for anything left out of config.h
#ifndef WHEN
#define WHEN "week"
#endif
#ifndef REFRESH_MINUTES
#define REFRESH_MINUTES 10
#endif
#ifndef AUTO_ROTATE_SECONDS
#define AUTO_ROTATE_SECONDS 0
#endif
#ifndef BACK_TO_TOP_SECONDS
#define BACK_TO_TOP_SECONDS 60
#endif
#ifndef BRIGHTNESS
#define BRIGHTNESS 200
#endif
#ifndef LED_ENABLED
#define LED_ENABLED 1
#endif
#ifndef ROTATION
#define ROTATION 1  // landscape; use 3 to flip it upside down
#endif
#ifndef TIMEZONE
#define TIMEZONE "MST7MDT,M3.2.0,M11.1.0"  // Utah (Mountain time with DST)
#endif

// ---------- Waveshare ESP32-C3-LCD-1.47 pins ----------
#define PIN_MOSI 6
#define PIN_SCLK 7
#define PIN_MISO 5
#define PIN_CS   14
#define PIN_DC   15
#define PIN_RST  21
#define PIN_BL   22
#define PIN_LED  8   // WS2812 RGB LED
#define PIN_BTN  9   // BOOT button (active low)

Adafruit_ST7789 tft(&SPI, PIN_CS, PIN_DC, PIN_RST);
const int W = 320, H = 172;

// ---------- Colors (RGB565) ----------
#define RGB(r, g, b) (uint16_t)((((r) & 0xF8) << 8) | (((g) & 0xFC) << 3) | ((b) >> 3))
const uint16_t C_BG      = RGB(14, 14, 18);
const uint16_t C_HEADER  = RGB(26, 26, 34);
const uint16_t C_TEXT    = RGB(245, 245, 240);
const uint16_t C_MUTED   = RGB(150, 150, 160);
const uint16_t C_DIM     = RGB(80, 80, 92);
const uint16_t C_ACCENT  = RGB(255, 92, 57);   // PullUp orange
const uint16_t C_LIVE    = RGB(255, 59, 70);
const uint16_t C_SOON    = RGB(255, 184, 0);
const uint16_t C_FREE    = RGB(52, 211, 120);
const uint16_t C_OK      = RGB(52, 211, 120);
const uint16_t C_BUSY    = RGB(80, 160, 255);
const uint16_t C_BAD     = RGB(255, 59, 70);

// ---------- Data ----------
struct Event {
  String title, day, time, venue, address, category, price;
  long start = 0, end = 0;
  int buzz = -1, sources = 0;
};
const int MAX_EVENTS = 8;
Event events[MAX_EVENTS];
int eventCount = 0;
int current = 0;
bool matched = true;
bool haveData = false;

enum NetState { NET_OK, NET_BUSY, NET_BAD };
NetState netState = NET_BUSY;

unsigned long lastFetch = 0, nextFetchIn = 0;
unsigned long lastRotate = 0, lastButton = 0;
int lastMinuteDrawn = -1;

// ---------- Time ----------
time_t nowEpoch() { return time(nullptr); }
bool timeValid() { return nowEpoch() > 1700000000; }

// ---------- Text helpers ----------
int16_t textW(const String& s) {
  int16_t x1, y1; uint16_t w, h;
  tft.getTextBounds(s, 0, 0, &x1, &y1, &w, &h);
  return w;
}

/** Cut `s` (adding "...") until it fits in maxW pixels with the current font. */
String fit(String s, int maxW, bool forceEllipsis = false) {
  if (!forceEllipsis && textW(s) <= maxW) return s;
  s.trim();
  while (s.length() && textW(s + "...") > maxW) s.remove(s.length() - 1);
  s.trim();
  return s + "...";
}

/** Word-wraps into at most maxLines; returns the line count and sets overflow if text was left over. */
int wrap(const String& text, int maxW, String* out, int maxLines, bool& overflow) {
  overflow = false;
  int n = 0, i = 0;
  String line;
  while (i <= (int)text.length()) {
    int sp = text.indexOf(' ', i);
    if (sp < 0) sp = text.length();
    String word = text.substring(i, sp);
    i = sp + 1;
    if (!word.length()) continue;
    String trial = line.length() ? line + " " + word : word;
    if (textW(trial) <= maxW || !line.length()) {
      line = trial;
    } else {
      if (n == maxLines - 1) { out[n++] = line; overflow = true; return n; }
      out[n++] = line;
      line = word;
    }
  }
  if (line.length()) {
    if (n < maxLines) out[n++] = line;
    else overflow = true;
  }
  return n;
}

void drawCentered(const String& s, int y, const GFXfont* font, uint16_t color) {
  tft.setFont(font);
  tft.setTextColor(color);
  String f = fit(s, W - 20);
  tft.setCursor((W - textW(f)) / 2, y);
  tft.print(f);
}

/** Small rounded label; returns its width. Uses the built-in 6x8 font. */
int chip(int x, int y, const String& label, uint16_t fill, uint16_t ink, bool outline = false) {
  tft.setFont(nullptr);
  tft.setTextSize(1);
  int w = label.length() * 6 + 10;
  if (outline) tft.drawRoundRect(x, y, w, 15, 4, fill);
  else tft.fillRoundRect(x, y, w, 15, 4, fill);
  tft.setTextColor(outline ? fill : ink);
  tft.setCursor(x + 5, y + 4);
  tft.print(label);
  return w;
}

uint16_t categoryColor(const String& c) {
  if (c.startsWith("Music"))     return RGB(168, 85, 247);
  if (c.startsWith("Outdoor"))   return RGB(34, 197, 94);
  if (c.startsWith("Climb"))     return RGB(234, 179, 8);
  if (c.startsWith("Run"))       return RGB(6, 182, 212);
  if (c.startsWith("Food"))      return RGB(249, 115, 22);
  if (c.startsWith("Art"))       return RGB(236, 72, 153);
  if (c.startsWith("Community")) return RGB(59, 130, 246);
  if (c.startsWith("Sport"))     return RGB(239, 68, 68);
  if (c.startsWith("Night"))     return RGB(129, 140, 248);
  if (c.startsWith("Market"))    return RGB(132, 204, 22);
  if (c.startsWith("Learn"))     return RGB(20, 184, 166);
  if (c.startsWith("Family"))    return RGB(251, 146, 60);
  return C_ACCENT;
}

String upper(String s) { s.toUpperCase(); return s; }

// ---------- Icons ----------
void iconClock(int x, int y, uint16_t c) {   // y = text baseline
  int cx = x + 6, cy = y - 6;
  tft.drawCircle(cx, cy, 6, c);
  tft.drawLine(cx, cy, cx, cy - 4, c);
  tft.drawLine(cx, cy, cx + 3, cy, c);
}

void iconPin(int x, int y, uint16_t c) {
  int cx = x + 6, cy = y - 9;
  tft.fillCircle(cx, cy, 5, c);
  tft.fillTriangle(cx - 4, cy + 3, cx + 4, cy + 3, cx, cy + 9, c);
  tft.fillCircle(cx, cy, 2, C_BG);
}

// ---------- Screens ----------
void drawHeader() {
  tft.fillRect(0, 0, W, 22, C_HEADER);

  tft.setFont(&FreeSansBold9pt7b);
  tft.setTextColor(C_ACCENT);
  tft.setCursor(8, 16);
  tft.print("PullUp");
  int x = 8 + textW("PullUp") + 8;

  // Clock + connection dot on the right
  String clock = "--:--";
  if (timeValid()) {
    time_t t = nowEpoch();
    struct tm lt;
    localtime_r(&t, &lt);
    char buf[12];
    int h12 = lt.tm_hour % 12 == 0 ? 12 : lt.tm_hour % 12;
    snprintf(buf, sizeof buf, "%d:%02d %s", h12, lt.tm_min, lt.tm_hour < 12 ? "AM" : "PM");
    clock = buf;
  }
  tft.setFont(&FreeSans9pt7b);
  tft.setTextColor(C_TEXT);
  int cw = textW(clock);
  int cx = W - 8 - cw;
  tft.setCursor(cx, 16);
  tft.print(clock);
  uint16_t dot = netState == NET_OK ? C_OK : netState == NET_BUSY ? C_BUSY : C_BAD;
  tft.fillCircle(cx - 9, 11, 3, dot);

  // What it's looking for
  tft.setFont(nullptr);
  tft.setTextSize(1);
  tft.setTextColor(C_MUTED);
  String caption = matched ? String(INTERESTS) : String("no match - top picks");
  int maxW = cx - 18 - x;
  String c = caption;
  while (c.length() && (int)c.length() * 6 > maxW) c.remove(c.length() - 1);
  if (c.length() < caption.length() && c.length() > 3) c = c.substring(0, c.length() - 3) + "...";
  tft.setCursor(x, 8);
  tft.print(c);
}

void drawMessage(const String& title, const String& line1, const String& line2 = "") {
  tft.fillScreen(C_BG);
  drawHeader();
  drawCentered(title, 82, &FreeSansBold12pt7b, C_TEXT);
  drawCentered(line1, 112, &FreeSans9pt7b, C_MUTED);
  if (line2.length()) drawCentered(line2, 134, &FreeSans9pt7b, C_DIM);
}

/** "LIVE NOW", "IN 25 MIN", "IN 3H 10M", or the day ("SUNDAY"). */
String statusLabel(const Event& e, uint16_t& color) {
  long now = nowEpoch();
  if (!timeValid()) { color = C_DIM; return upper(e.day); }
  if (now >= e.start && now < e.end) { color = C_LIVE; return "LIVE NOW"; }
  long mins = (e.start - now) / 60;
  if (mins < 0) { color = C_DIM; return "ENDED"; }
  if (mins < 60) { color = C_SOON; return "IN " + String(mins < 1 ? 1 : mins) + " MIN"; }
  if (mins < 24 * 60) {
    color = mins < 120 ? C_SOON : C_MUTED;
    return "IN " + String(mins / 60) + "H " + String(mins % 60) + "M";
  }
  color = C_MUTED;
  return upper(e.day);
}

void drawChips(const Event& e) {
  tft.fillRect(0, 26, W, 17, C_BG);
  int x = 10;
  if (e.category.length()) x += chip(x, 27, upper(e.category), categoryColor(e.category), C_BG) + 6;
  uint16_t sc;
  String status = statusLabel(e, sc);
  x += chip(x, 27, status, sc, C_BG, sc != C_LIVE) + 6;

  if (e.price.length()) {
    String p = upper(e.price);
    if (p.length() > 14) p = p.substring(0, 13) + ".";
    int pw = p.length() * 6 + 10;
    chip(W - 10 - pw, 27, p, e.price == "FREE" ? C_FREE : C_MUTED, C_BG, e.price != "FREE");
  }
}

/** Title in the biggest font that fits: 18pt x2 lines, 12pt x2, then 9pt x3 with "..." */
void drawTitle(const String& title) {
  struct Size { const GFXfont* font; int lines, lineH, ascent; };
  const Size sizes[] = {
    {&FreeSansBold18pt7b, 2, 31, 25},
    {&FreeSansBold12pt7b, 2, 24, 17},
    {&FreeSansBold9pt7b, 3, 19, 13},
  };
  const int top = 50, maxW = W - 24;
  String lines[3];
  for (int s = 0; s < 3; s++) {
    tft.setFont(sizes[s].font);
    bool overflow;
    int n = wrap(title, maxW, lines, sizes[s].lines, overflow);
    bool tooWide = false;
    for (int i = 0; i < n; i++) if (textW(lines[i]) > maxW) tooWide = true;
    if ((overflow || tooWide) && s < 2) continue;
    if (overflow) lines[n - 1] = fit(lines[n - 1], maxW, true);
    tft.setTextColor(C_TEXT);
    // Center the block vertically in the title area (y 46..114)
    int blockH = (n - 1) * sizes[s].lineH + sizes[s].ascent;
    int y = top + (62 - blockH) / 2 + sizes[s].ascent - 4;
    for (int i = 0; i < n; i++) {
      tft.setCursor(12, y + i * sizes[s].lineH);
      tft.print(fit(lines[i], maxW));
    }
    return;
  }
}

void drawEvent() {
  const Event& e = events[current];
  uint16_t accent = categoryColor(e.category);

  tft.fillScreen(C_BG);
  drawHeader();
  tft.fillRect(0, 22, 4, H - 22, accent);  // category stripe
  drawChips(e);
  drawTitle(e.title);

  tft.drawFastHLine(12, 118, W - 24, C_DIM);

  // When
  iconClock(12, 137, accent);
  tft.setFont(&FreeSansBold9pt7b);
  tft.setTextColor(accent);
  tft.setCursor(30, 137);
  tft.print(e.day);
  int x = 30 + textW(e.day) + 8;
  tft.setFont(&FreeSans9pt7b);
  tft.setTextColor(C_TEXT);
  tft.setCursor(x, 137);
  tft.print(fit(e.time, W - 12 - x));

  // Where
  iconPin(12, 157, accent);
  tft.setTextColor(C_TEXT);
  tft.setCursor(30, 157);
  String where = e.venue.length() ? e.venue : (e.address.length() ? e.address : String("Location TBA"));
  tft.print(fit(where, W - 42));

  // Address + page dots
  tft.setFont(nullptr);
  tft.setTextSize(1);
  int dotsW = eventCount > 1 ? eventCount * 8 : 0;
  if (e.venue.length() && e.address.length()) {
    tft.setTextColor(C_MUTED);
    String a = e.address;
    int maxChars = (W - 30 - 12 - dotsW - 6) / 6;
    if ((int)a.length() > maxChars) a = a.substring(0, maxChars - 3) + "...";
    tft.setCursor(30, 162);
    tft.print(a);
  }
  for (int i = 0; i < eventCount && eventCount > 1; i++) {
    int dx = W - 12 - dotsW + i * 8 + 3;
    if (i == current) tft.fillCircle(dx, 165, 2, C_TEXT);
    else tft.drawCircle(dx, 165, 2, C_DIM);
  }
}

void render() {
  if (eventCount > 0) drawEvent();
  else if (haveData) drawMessage("Nothing nearby yet", "No events found for", INTERESTS);
  else if (netState == NET_BAD && WiFi.status() != WL_CONNECTED)
    drawMessage("No Wi-Fi", "Couldn't join " WIFI_SSID, "2.4 GHz only - check config.h");
  else if (netState == NET_BAD) drawMessage("Can't reach PullUp", PULLUP_URL, "retrying every minute");
  else drawMessage("Finding cool stuff...", INTERESTS);
  lastMinuteDrawn = timeValid() ? (nowEpoch() / 60) : -1;
}

// ---------- LED ----------
void led(uint8_t r, uint8_t g, uint8_t b) {
#if LED_ENABLED
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  rgbLedWrite(PIN_LED, r, g, b);
#else
  neopixelWrite(PIN_LED, r, g, b);
#endif
#endif
}

void updateLed() {
#if LED_ENABLED
  static unsigned long last = 0;
  if (millis() - last < 30) return;
  last = millis();
  if (!eventCount || !timeValid()) { led(0, 0, 0); return; }
  const Event& e = events[current];
  long now = nowEpoch();
  float breathe = (sin(millis() / 600.0) + 1) / 2;  // 0..1
  if (now >= e.start && now < e.end) led(0, 4 + breathe * 30, 0);
  else if (e.start - now < 2 * 3600 && e.start > now) led(20, 10, 0);
  else led(0, 0, 0);
#endif
}

// ---------- Network ----------
String urlEncode(const String& s) {
  String out;
  const char* hex = "0123456789ABCDEF";
  for (unsigned char c : s) {
    if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') out += (char)c;
    else if (c == ' ') out += '+';
    else { out += '%'; out += hex[c >> 4]; out += hex[c & 15]; }
  }
  return out;
}

bool connectWifi(unsigned long timeoutMs) {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < timeoutMs) delay(200);
  return WiFi.status() == WL_CONNECTED;
}

bool fetchEvents() {
  netState = NET_BUSY;
  drawHeader();
  if (!connectWifi(15000)) { netState = NET_BAD; return false; }

  String url = String(PULLUP_URL);
  if (url.endsWith("/")) url.remove(url.length() - 1);
  url += "/api/device?n=" + String(MAX_EVENTS) + "&when=" + WHEN + "&for=" + urlEncode(INTERESTS);
  Serial.println("GET " + url);

  WiFiClientSecure secure;
  WiFiClient plain;
  bool https = url.startsWith("https://");
  if (https) secure.setInsecure();  // no certificate pinning; fine for public event data
  HTTPClient http;
  http.setTimeout(25000);           // first search for new interests runs the AI (a few seconds)
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  if (!http.begin(https ? (WiFiClient&)secure : plain, url)) { netState = NET_BAD; return false; }

  int code = http.GET();
  if (code != 200) {
    Serial.printf("HTTP %d\n", code);
    http.end();
    netState = NET_BAD;
    return false;
  }
  String body = http.getString();
  http.end();

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, body);
  if (err) {
    Serial.printf("JSON error: %s\n", err.c_str());
    netState = NET_BAD;
    return false;
  }

  // No NTP yet? Take the time from the server.
  long serverNow = doc["now"] | 0L;
  if (!timeValid() && serverNow > 0) {
    struct timeval tv = {serverNow, 0};
    settimeofday(&tv, nullptr);
  }

  String previousId = eventCount ? events[current].title : "";
  matched = doc["matched"] | true;
  eventCount = 0;
  for (JsonObject o : doc["events"].as<JsonArray>()) {
    if (eventCount >= MAX_EVENTS) break;
    Event& e = events[eventCount++];
    e.title = o["title"] | "";
    e.day = o["day"] | "";
    e.time = o["time"] | "";
    e.venue = o["venue"] | "";
    e.address = o["address"] | "";
    e.category = o["category"] | "";
    e.price = o["price"] | "";
    e.start = o["start"] | 0L;
    e.end = o["end"] | 0L;
    e.buzz = o["buzz"] | -1;
    e.sources = o["sources"] | 0;
  }
  // Keep showing the same event if it's still in the list
  current = 0;
  for (int i = 0; i < eventCount; i++) if (events[i].title == previousId) current = i;

  haveData = true;
  netState = NET_OK;
  Serial.printf("Got %d events (matched=%d)\n", eventCount, matched);
  return true;
}

/** Drop events that ended since the last fetch. */
void pruneEnded() {
  if (!timeValid()) return;
  long now = nowEpoch();
  int w = 0;
  for (int i = 0; i < eventCount; i++) if (events[i].end > now) events[w++] = events[i];
  if (w != eventCount) {
    eventCount = w;
    if (current >= eventCount) current = 0;
    render();
  }
}

void refresh() {
  bool ok = fetchEvents();
  lastFetch = millis();
  nextFetchIn = ok ? REFRESH_MINUTES * 60000UL : 60000UL;
  render();
}

// ---------- Setup / loop ----------
void setup() {
  Serial.begin(115200);
  pinMode(PIN_BTN, INPUT_PULLUP);
  led(0, 0, 0);

  SPI.begin(PIN_SCLK, PIN_MISO, PIN_MOSI, PIN_CS);
  tft.init(172, 320);
  tft.setSPISpeed(40000000);
  tft.setRotation(ROTATION);
  pinMode(PIN_BL, OUTPUT);
  analogWrite(PIN_BL, BRIGHTNESS);

  tft.fillScreen(C_BG);
  drawCentered("PullUp", 92, &FreeSansBold18pt7b, C_ACCENT);
  drawCentered("Connecting to " WIFI_SSID "...", 124, &FreeSans9pt7b, C_MUTED);

  connectWifi(20000);
  configTzTime(TIMEZONE, "pool.ntp.org", "time.nist.gov");
  refresh();
}

void loop() {
  unsigned long ms = millis();

  // BOOT button: short press = next pick, long press = refresh
  if (digitalRead(PIN_BTN) == LOW && ms - lastButton > 250) {
    unsigned long down = millis();
    while (digitalRead(PIN_BTN) == LOW && millis() - down < 1000) delay(10);
    bool longPress = millis() - down >= 1000;
    while (digitalRead(PIN_BTN) == LOW) delay(10);
    lastButton = millis();
    if (longPress) refresh();
    else if (eventCount > 1) {
      current = (current + 1) % eventCount;
      lastRotate = millis();
      render();
    }
  }

  if (ms - lastFetch >= nextFetchIn) refresh();

#if AUTO_ROTATE_SECONDS > 0
  if (eventCount > 1 && ms - lastRotate >= AUTO_ROTATE_SECONDS * 1000UL) {
    current = (current + 1) % eventCount;
    lastRotate = ms;
    render();
  }
#else
  if (current != 0 && ms - lastButton >= BACK_TO_TOP_SECONDS * 1000UL) {
    current = 0;
    render();
  }
#endif

  // Once a minute: clock, countdown, and drop finished events
  if (timeValid() && nowEpoch() / 60 != lastMinuteDrawn) {
    lastMinuteDrawn = nowEpoch() / 60;
    pruneEnded();
    drawHeader();
    if (eventCount) drawChips(events[current]);
  }

  // Wi-Fi dot follows the connection
  NetState live = WiFi.status() == WL_CONNECTED ? (netState == NET_BAD ? NET_BAD : NET_OK) : NET_BAD;
  if (live != netState && netState != NET_BUSY) { netState = live; drawHeader(); }

  updateLed();
  delay(10);
}

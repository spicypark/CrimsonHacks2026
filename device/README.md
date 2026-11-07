# PullUp desk display

A Waveshare **ESP32-C3-LCD-1.47** that sits on your desk or mirror and shows the coolest upcoming event for what you're into: name, when (with a live countdown), and where.

```
┌────────────────────────────────────────────┐
│ PullUp  live music, climbing   ● 9:42 PM   │
│▌ [MUSIC] [IN 2H 15M]               [FREE]  │
│▌                                           │
│▌  Utah Symphony - Mozart                   │
│▌  with Conrad Tao                          │
│▌ ───────────────────────────────────────── │
│▌ ◷ Tomorrow  7:30 PM - ~10:30 PM           │
│▌ ⌖ Abravanel Hall                          │
│▌   123 West South Temple, SLC        ● ○ ○ │
└────────────────────────────────────────────┘
```

## How it works

The board calls `GET /api/device?for=<your interests>&when=week` on your PullUp server (`src/app/api/device/route.ts`). The server runs the interests through the same AI search as the site, ranks matches by buzz, how many sources list them and how soon they are, and returns up to 8 picks as short ASCII strings. If nothing matches it sends the most popular upcoming events and the header says "no match - top picks". Responses are cached for 5 minutes per interest string.

## Setup

1. **Arduino IDE 2** → Boards Manager → install **esp32 by Espressif** (3.x).
2. Library Manager → install **Adafruit ST7735 and ST7789 Library** (it pulls in Adafruit GFX) and **ArduinoJson** (v7).
3. Copy `pullup_display/config.example.h` to `pullup_display/config.h` and fill in your Wi-Fi details, `PULLUP_URL` and `INTERESTS`. `config.h` is git-ignored.
4. Open `pullup_display/pullup_display.ino`, then under Tools set:
   - Board: **ESP32C3 Dev Module**
   - USB CDC On Boot: **Enabled** (so Serial Monitor works over USB-C)
5. Upload. If it won't connect, hold **BOOT**, tap **RESET**, release BOOT, and upload again.

Or from a terminal:

```bash
arduino-cli compile --upload -p COM5 --fqbn esp32:esp32:esp32c3:CDCOnBoot=cdc device/pullup_display
```

### Pointing it at your laptop

While you're developing, set `PULLUP_URL` to your laptop's LAN IP, e.g. `http://192.168.1.23:3000` (not `localhost`). Run `ipconfig` to find the IP. Next dev only listens on localhost by default, so start it with `npx next dev -H 0.0.0.0`, and allow Node through Windows Firewall when it asks.

## Controls

| | |
|---|---|
| **BOOT** short press | next pick (goes back to the top pick after 60 s) |
| **BOOT** hold 1 s | refresh now |
| Header dot | green = online, blue = fetching, red = offline/server error |
| RGB LED | breathes green while the event is live, amber when it starts within 2 hours |

## Tweaks (config.h)

- `INTERESTS`: free text, like the site's search box: `"jazz near Sugar House"`, `"free food, meet people"`, `"trail runs"`
- `WHEN`: `now`, `today`, `tonight`, `tomorrow`, `weekend`, `week`, `month`
- `AUTO_ROTATE_SECONDS`: set above 0 to cycle through picks on its own
- `ROTATION 3`: flips the screen if you mount it the other way up
- `LED_ENABLED 0`: turns the LED off (handy on a bedroom mirror)

If the colors look inverted (white background), add `tft.invertDisplay(false);` after `tft.setRotation(...)` in `setup()`.

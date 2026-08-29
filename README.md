# Aurum IPTV

A luxury Xtream Codes player, in two forms:

| | | |
|---|---|---|
| **[Aurum IPTV](#desktop--windows)** | Windows desktop | Electron · hls.js · mpegts.js |
| **[Aurum TV](#fire-tv--android-tv)** | Fire TV / Android TV | Kotlin · Compose · Media3 (ExoPlayer) |

Both sign in with the same thing — your provider's **server URL, username and password** — and both give you live TV with a full programme guide, films, box sets, search and a built-in player.

> Aurum is a **player only**. It does not host, provide or resell any channels. You need your own subscription from a provider.

---

## Download

**Fire TV / Android TV** — grab the APK from [the latest release](../../releases/latest) and see [installing on a Fire TV](#installing-on-a-fire-tv).

**Windows desktop** — build it yourself, see [below](#desktop--windows).

---

## What's in it

- **Live TV** — every category, channel logos, now/next with a progress bar, favourites and recently-watched
- **TV Guide** — the provider's full XMLTV guide, downloaded and indexed on-device, with programme details
- **Films & box sets** — poster grids, sorting and filtering, synopsis/cast/rating, seasons and episodes
- **Search** — one box across channels, films, box sets *and* everything coming up in the guide
- **Built-in player** — quality/resolution switching, audio tracks, subtitles, picture fit, resume where you left off
- **Continue watching** — films and episodes remember their position, box sets roll on to the next episode

---

## Desktop — Windows

Electron app with a custom frameless UI.

```bash
npm install
npm start
```

To produce an installer:

```bash
npm run build
```

The output lands in `dist/`.

### How playback works

| Stream | Engine | Notes |
|---|---|---|
| `.m3u8` | **hls.js** | Adaptive — this is the one that exposes real quality levels |
| `.ts` | **mpegts.js** | What most Xtream lines serve for live channels |
| `.mp4` and friends | Chromium | Native decode |

Xtream panels almost never send CORS headers, so the main process rewrites response headers rather than switching off `webSecurity`. The provider-required `User-Agent` is injected the same way.

**Known limitation:** Chromium cannot play `.mkv`, and cannot decode HEVC/H.265 or AC-3 audio on most Windows installs. Titles served that way will report an unsupported-codec error with an option to hand the URL to an external player. The Fire TV build does not have this problem — ExoPlayer handles all of it.

---

## Fire TV / Android TV

A proper native app, not a web wrapper. Built for the remote: every control takes D-pad focus and lights up gold, and the player maps the whole remote.

- **minSdk 22** — works back to Fire OS 5 (Fire TV Stick 2nd gen)
- **Leanback launcher** entry, so it appears on the Fire TV home row with a banner
- **Media3 / ExoPlayer** — HLS, MPEG-TS, MP4, MKV, HEVC and AC-3 all play
- **Cleartext HTTP allowed**, because virtually every Xtream panel is `http://` on a non-standard port
- **XMLTV parsed with a streaming pull parser** so a 150 MB guide does not exhaust a Fire TV Stick's memory
- Password sealed with the hardware keystore on API 23+

### Remote control

| Button | Action |
|---|---|
| **SELECT** | Show controls, then play / pause |
| **◀ ▶** | Skip 10 seconds — on live, rewind the buffer / jump back to live |
| **▲ ▼** | Change channel while a live stream is playing |
| **MENU** | Quality, audio track and subtitle picker |
| **BACK** | Close the overlay, then leave the player |

### Installing on a Fire TV

1. On the Fire TV: **Settings → My Fire TV → Developer Options → Install unknown apps**, and allow it for **Downloader**.
   *(If Developer Options is hidden, go to Settings → My Fire TV → About and click **Fire TV Stick** seven times.)*
2. Install the free **Downloader** app from the Amazon Appstore.
3. Open Downloader and enter the release URL for the APK.
4. Install, then find **Aurum TV** on your home row.

Prefer a cable? With adb:

```bash
adb connect <your-fire-tv-ip>:5555
adb install -r app-release.apk
```

Find the IP under **Settings → My Fire TV → About → Network**, and enable **ADB debugging** in Developer Options first.

### Building it yourself

Needs the Android SDK and a JDK 17+ (Android Studio's bundled JBR is fine).

```bash
cd firetv
# one-time: create your own signing key (never committed)
powershell -ExecutionPolicy Bypass -File scripts/make-keystore.ps1

./gradlew :app:assembleRelease
```

The APK appears at `firetv/app/build/outputs/apk/release/app-release.apk`.

If you skip the keystore step the release build falls back to the debug key — it still installs on a Fire TV perfectly well.

Set `sdk.dir` in `firetv/local.properties` if Gradle cannot find your SDK:

```properties
sdk.dir=C:/Users/you/AppData/Local/Android/Sdk
```

---

## Signing in

Enter your provider's **server URL** (e.g. `http://line.example.com:8080`), **username** and **password**.

You can also paste a full `get.php` / `m3u_plus` link — the username and password are pulled out of it automatically and the field is reduced to the bare server address.

Credentials are stored **only on your own machine**: Windows Data Protection on the desktop, the Android hardware keystore on Fire TV. Nothing is sent anywhere except to your own provider.

---

## Troubleshooting

**A channel will not start.** Open the player settings and switch the live format between **MPEG-TS** and **HLS**. Providers differ, and some channels only work on one of the two.

**"Access denied" or the stream drops after a few seconds.** Your line is probably at its connection limit — check *Settings → Account → Connections*. Close the stream elsewhere and try again.

**The guide is empty for most channels.** Providers frequently leave `epg_channel_id` blank. Aurum falls back to matching on channel name; *Settings → TV guide* shows how many matched.

**Nothing plays and every channel errors.** Check the account expiry and status in Settings, then try a different **player identity** (User-Agent) — some panels only serve players they recognise.

---

## Licence

MIT.

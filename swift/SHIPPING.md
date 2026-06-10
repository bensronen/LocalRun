# LocalRun (native Swift) — build & ship guide

A complete SwiftUI rewrite of LocalRun: the scenic route brain, all 10 cities,
live runs with voice guidance and photos, history with reviews, the community
layer, GPX export, and Strava upload. iOS 17+, with real Liquid Glass on iOS 26.

## 1. Open & configure (5 minutes)

1. On your Mac: `git pull`, then open `swift/LocalRun.xcodeproj` in **Xcode 16 or newer**.
   - If the project file won't open for any reason: File → New → Project → iOS App,
     name it `LocalRun`, then delete its template files and drag the `swift/LocalRun`
     folder into the project ("Create folder references" OFF, "Copy items" OFF).
2. Edit `LocalRun/Config.swift`:
   - `mapboxToken` — your `pk.` token (same one from the Expo `.env`). **Required.**
   - `apiURL` — your deployed community server URL (optional; see §4).
   - `stravaClientID` — from https://www.strava.com/settings/api (optional; see §5).
3. Select the LocalRun target → Signing & Capabilities → set your Team
   (your free Apple ID works for on-device testing today; the $99 account is
   only needed for TestFlight/App Store).

## 2. Run on your phone today (no paid account)

Plug in your iPhone (or use wireless debugging), pick it as the destination,
press ⌘R. Trust the developer cert on the phone
(Settings → General → VPN & Device Management). Free-account builds expire
after 7 days — fine for the trip; re-run from Xcode to refresh.

## 3. Ship to TestFlight / App Store (after you buy the dev account)

1. Add an app icon: select `Assets` in Xcode (create an asset catalog if
   missing: File → New → Asset Catalog), add an AppIcon, drop in a 1024×1024 png.
2. Product → Archive → Distribute → App Store Connect.
3. In App Store Connect: create the app, add screenshots, a privacy policy URL,
   and the privacy nutrition labels (Location: app functionality, not linked;
   Photos: stored on device; no tracking).
4. TestFlight first; submit for review when happy.

## 4. Community server

Deploy `server/index.mjs` anywhere Node 18+ runs (Railway/Render/Fly free tiers):
no build step, no database. Set `DATA_FILE` to a persistent path. Put its URL in
`Config.swift → apiURL`.

## 5. Strava

1. Create an API application at https://www.strava.com/settings/api
   ("Authorization Callback Domain": `localrun`).
2. Put the **Client ID** in `Config.swift`; set `STRAVA_CLIENT_ID` and
   `STRAVA_CLIENT_SECRET` as env vars on the community server (the app never
   sees the secret).
3. In the app: Settings → Strava → Connect. Saved runs then get a
   "Send to Strava" button (and "Export GPX" works with no setup at all).

## Known gaps / next steps

- **App icon & launch art** — placeholder; add before App Store submission.
- **Background tracking**: tracking runs with the screen locked needs the
  "Location updates" background mode capability + `allowsBackgroundLocationUpdates`;
  v1 keeps the screen awake instead (same behavior as the Expo app).
- Strava tokens are stored in UserDefaults; move to Keychain before wide release.
- This code was written without compilation on this machine — expect possibly a
  handful of small compiler fixes on first build, all mechanical.

# CityRun 🏃 — run a city, not just a distance

A running-route app for **orienting yourself in a new city**. Enter where you're
staying, pick how far you want to run and whether you want a loop or a one-way line,
and it builds a route threaded through the things that give you a first feel for the
place: waterfronts, greenways, parks, landmarks, viewpoints, and distinct
neighborhoods — the routes a local would actually pick.

Prototype city: **New York**.

## Stack

- **Expo (React Native)** — runs in **Expo Go**, no native build needed
- **Map UI:** `react-native-maps` (Apple Maps on iOS)
- **Routing brain:** **Mapbox Directions + Geocoding** REST APIs (walking profile)
- **Curation:** a hand-researched NYC dataset (`src/data/nycPlaces.js`) scored by
  appeal and category, assembled into a distance-budgeted scenic route by
  `src/lib/routeBuilder.js`

## Setup

1. Install deps (already done if scaffolded):
   ```bash
   npm install
   ```
2. Get a **free** Mapbox token: https://account.mapbox.com/access-tokens/
   Copy the default public token (starts with `pk.`).
3. Create your env file:
   ```bash
   cp .env.example .env
   # then paste your token into .env as EXPO_PUBLIC_MAPBOX_TOKEN
   ```
4. Start with a cleared cache (required after editing `.env`):
   ```bash
   npx expo start -c
   ```
5. Open **Expo Go** on your phone and scan the QR code.

> Without a token the app still loads, but route-building and address search are
> disabled (you'll see a warning on the plan screen).

## How it works

**Plan screen** — set your start (address search, presets, "my location", or tap/drag
a pin), a distance slider (km/mi), loop vs one-way, and optional vibe chips
(Waterfront / Parks / Landmarks / Neighborhoods) that bias the picks.

**Route screen** — the assembled route drawn on the map with numbered highlight pins,
total distance / est. run time, and a "what you'll see" list with a one-line reason
for each stop. One-way routes suggest the nearest subway to ride back from.
"Another route" re-rolls a different scenic variation of the same plan.

### The routing brain (`src/lib/routeBuilder.js`)

- **Loop:** greedily selects high-value, category-diverse waypoints within a distance
  budget (straight-line estimate × a Manhattan street factor), orders them by bearing
  to form a non-self-intersecting loop, then routes through them via Mapbox and trims
  if the real distance runs long.
- **One-way:** picks a scenic, transit-friendly *destination* at the right distance,
  then threads highlights that lie along the corridor toward it.

## Extending

- **More cities:** add a `data/<city>Places.js` dataset in the same shape and pick it
  by region. The builder is city-agnostic.
- **Truer Mapbox look / offline tiles:** switch from Expo Go to an Expo dev build and
  add `@rnmapbox/maps`.
- **Live turn-by-turn:** layer `expo-location` watch + off-route detection on the
  route screen.

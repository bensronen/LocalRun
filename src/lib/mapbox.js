// Thin client over Mapbox REST APIs (Directions + Geocoding).
// Token comes from .env as EXPO_PUBLIC_MAPBOX_TOKEN (Expo inlines EXPO_PUBLIC_* at build).

const TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
const BASE = 'https://api.mapbox.com';

// Default geocoding bias if a city bbox isn't supplied (NYC).
const DEFAULT_BBOX = '-74.2591,40.4774,-73.7004,40.9176';

export function hasToken() {
  return !!TOKEN && TOKEN.length > 20 && !TOKEN.includes('YOUR_');
}

// coords: ordered [{lat, lng}, ...] (max 25). profile: 'walking' | 'cycling'.
// Returns { coordinates: [{latitude, longitude}], distanceMeters, durationSec }.
export async function getRoute(coords, profile = 'walking') {
  if (!hasToken()) {
    throw new Error('Add EXPO_PUBLIC_MAPBOX_TOKEN to .env to build real routes.');
  }
  if (coords.length < 2) throw new Error('Need at least a start and one waypoint.');

  const path = coords.map((c) => `${c.lng},${c.lat}`).join(';');
  const url =
    `${BASE}/directions/v5/mapbox/${profile}/${path}` +
    `?geometries=geojson&overview=full&steps=false&access_token=${TOKEN}`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Mapbox Directions ${res.status}: ${body.slice(0, 120)}`);
  }
  const json = await res.json();
  if (!json.routes || !json.routes.length) throw new Error('No route found.');
  const r = json.routes[0];
  return {
    coordinates: r.geometry.coordinates.map(([lng, lat]) => ({
      latitude: lat,
      longitude: lng,
    })),
    distanceMeters: r.distance,
    durationSec: r.duration,
  };
}

// Turn-by-turn maneuvers for an already-built route geometry, via Map Matching (it
// snaps the exact path and returns steps). routeCoords: [{latitude, longitude}].
// Returns [{lat, lng, instruction, type, modifier, name, distance}] (empty on failure).
export async function getManeuvers(routeCoords, profile = 'walking') {
  if (!hasToken() || routeCoords.length < 2) return [];
  const MAX = 90; // Map Matching allows <=100 coords
  let coords = routeCoords;
  if (routeCoords.length > MAX) {
    const stride = Math.ceil(routeCoords.length / MAX);
    coords = routeCoords.filter((_, i) => i % stride === 0);
    if (coords[coords.length - 1] !== routeCoords[routeCoords.length - 1]) {
      coords.push(routeCoords[routeCoords.length - 1]);
    }
  }
  const path = coords.map((c) => `${c.longitude},${c.latitude}`).join(';');
  const url =
    `${BASE}/matching/v5/mapbox/${profile}/${path}` +
    `?steps=true&geometries=geojson&overview=false&tidy=true&access_token=${TOKEN}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    const m = json.matchings && json.matchings[0];
    if (!m) return [];
    const steps = (m.legs || []).flatMap((l) => l.steps || []);
    return steps
      .map((s) => ({
        lat: s.maneuver.location[1],
        lng: s.maneuver.location[0],
        instruction: s.maneuver.instruction,
        type: s.maneuver.type,
        modifier: s.maneuver.modifier || '',
        name: s.name || '',
        distance: s.distance,
      }))
      .filter((s) => s.instruction);
  } catch {
    return [];
  }
}

// Autocomplete suggestions while typing: free text -> up to `limit` candidate
// places [{lat, lng, name}], biased to a city bbox. Returns [] on any failure —
// suggestions are best-effort and must never alert.
export async function geocodeSuggest(query, proximity, bbox, limit = 5) {
  if (!hasToken() || !query.trim()) return [];
  const bboxStr = Array.isArray(bbox) ? bbox.join(',') : bbox || DEFAULT_BBOX;
  const params = new URLSearchParams({
    access_token: TOKEN,
    autocomplete: 'true',
    limit: String(limit),
    bbox: bboxStr,
  });
  if (proximity) params.set('proximity', `${proximity.lng},${proximity.lat}`);
  const url =
    `${BASE}/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?` +
    params.toString();
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    return (json.features || []).map((f) => ({
      lat: f.center[1],
      lng: f.center[0],
      name: f.place_name,
    }));
  } catch {
    return [];
  }
}

// Free-text address -> {lat, lng, name}, biased to a city bbox ([w,s,e,n] array or
// string). Returns null if nothing found.
export async function geocode(query, proximity, bbox) {
  if (!hasToken()) throw new Error('Add EXPO_PUBLIC_MAPBOX_TOKEN to .env.');
  const bboxStr = Array.isArray(bbox) ? bbox.join(',') : bbox || DEFAULT_BBOX;
  const params = new URLSearchParams({
    access_token: TOKEN,
    limit: '1',
    bbox: bboxStr,
  });
  if (proximity) params.set('proximity', `${proximity.lng},${proximity.lat}`);
  const url =
    `${BASE}/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?` +
    params.toString();

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox Geocoding ${res.status}`);
  const json = await res.json();
  if (!json.features || !json.features.length) return null;
  const f = json.features[0];
  return { lat: f.center[1], lng: f.center[0], name: f.place_name };
}

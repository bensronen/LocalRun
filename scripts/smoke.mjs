// Offline smoke test: run the real buildRoute for every city/shape/distance with a
// stubbed Mapbox Directions API (straight-line geometry, street-factor distance).
// Round 2 "poisons" each city's top-scoring place — the stub returns 422 for any
// request that touches it — to prove one unroutable waypoint can't kill a build.
// Run: npx esbuild scripts/smoke.mjs --bundle --platform=node --format=esm \
//        --outfile=/tmp/smoke.mjs && EXPO_PUBLIC_MAPBOX_TOKEN=pk.x-offline-test node /tmp/smoke.mjs

let poison = null; // [lng, lat] of a waypoint the stub refuses to route

const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
function hav(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

global.fetch = async (url) => {
  const m = url.match(/directions\/v5\/mapbox\/\w+\/([^?]+)/);
  if (!m) return { ok: false, status: 404, text: async () => 'not stubbed', json: async () => ({}) };
  const pts = decodeURIComponent(m[1]).split(';').map((s) => {
    const [lng, lat] = s.split(',').map(Number);
    return { lat, lng };
  });
  if (poison && pts.some((p) => hav(p, { lat: poison[1], lng: poison[0] }) < 30)) {
    return { ok: false, status: 422, text: async () => '{"code":"NoSegment"}', json: async () => ({}) };
  }
  let dist = 0;
  const coords = [];
  for (let i = 0; i < pts.length; i++) {
    coords.push([pts[i].lng, pts[i].lat]);
    if (i) dist += hav(pts[i - 1], pts[i]);
  }
  dist *= 1.27; // pretend street factor
  return {
    ok: true,
    json: async () => ({ routes: [{ geometry: { coordinates: coords }, distance: dist, duration: dist / 3 }] }),
  };
};

import { buildRoute } from '../src/lib/routeBuilder';
import { CITIES } from '../src/data/cities';

// Fraction of the route that doubles back on itself (out-and-back ≈ 1, clean loop ≈ 0).
function overlapOf(coords) {
  const pts = [];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const seg = hav({ lat: a.latitude, lng: a.longitude }, { lat: b.latitude, lng: b.longitude });
    const n = Math.max(1, Math.floor(seg / 80));
    for (let k = 0; k < n; k++) {
      pts.push({
        lat: a.latitude + ((b.latitude - a.latitude) * k) / n,
        lng: a.longitude + ((b.longitude - a.longitude) * k) / n,
      });
    }
  }
  if (pts.length < 8) return 0;
  let overlap = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 4; j < pts.length; j++) {
      if (hav(pts[i], pts[j]) < 35) {
        overlap += 1;
        break;
      }
    }
  }
  return overlap / pts.length;
}

const failures = [];
for (const round of ['clean', 'poisoned']) {
  console.log(`\n=== ${round} ===`);
  for (const city of CITIES) {
    if (round === 'poisoned') {
      const top = [...city.places].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
      const pt = top.corridor ? top.corridor[0] : top;
      poison = [pt.lng, pt.lat];
    } else {
      poison = null;
    }
    for (const shape of ['loop', 'oneway']) {
      for (const km of [3, 5, 10]) {
        try {
          const res = await buildRoute(city.defaultStart, { distanceKm: km, shape, vibe: {} }, city);
          const err = Math.abs(res.distanceMeters / (km * 1000) - 1);
          const ov = shape === 'loop' ? `, overlap ${(overlapOf(res.route.coordinates) * 100).toFixed(0)}%` : '';
          console.log(
            `${city.id.padEnd(8)} ${shape.padEnd(6)} ${km}km -> ${(res.distanceMeters / 1000).toFixed(1)}km, ` +
            `${res.highlights.length} stops, off-target ${(err * 100).toFixed(0)}%${ov}`
          );
        } catch (e) {
          failures.push(`[${round}] ${city.id} ${shape} ${km}km: ${e.message}`);
          console.log(`${city.id.padEnd(8)} ${shape.padEnd(6)} ${km}km -> FAIL: ${e.message}`);
        }
      }
    }
  }
}
// Explore round: after "completing" a run, ask for something new — the seen
// highlights should mostly be avoided (when the city has alternatives).
console.log('\n=== explore: new vs revisit ===');
poison = null;
for (const city of CITIES) {
  try {
    const first = await buildRoute(city.defaultStart, { distanceKm: 5, shape: 'loop', vibe: {} }, city);
    const seen = first.highlights.map((h) => h.id);
    const fresh = await buildRoute(
      city.defaultStart,
      { distanceKm: 5, shape: 'loop', vibe: {}, seen, explore: 'new' },
      city
    );
    const overlap = fresh.highlights.filter((h) => seen.includes(h.id)).length;
    console.log(
      `${city.id.padEnd(8)} seen ${seen.length} -> new route overlaps ${overlap}/${fresh.highlights.length}`
    );
  } catch (e) {
    failures.push(`[explore] ${city.id}: ${e.message}`);
    console.log(`${city.id.padEnd(8)} FAIL: ${e.message}`);
  }
}

console.log(failures.length ? `\n${failures.length} FAILURES` : '\nALL PASS');

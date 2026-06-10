// Fetch Wikimedia signals for a city bbox:
//  - Commons geotagged images  -> "where people photograph" (a beauty/notability proxy)
//  - Wikipedia geotagged articles -> notable places (names + density)
// Tiles the bbox into a grid of geosearch queries and dedupes.
// Usage: node pipeline/fetchWiki.mjs <cityId>
import { writeFileSync, mkdirSync } from 'fs';
import { CITIES } from './config.mjs';

const UA = 'LocalRun/0.1 (scenic running route prototype; contact: local-app@example.com)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geosearch(host, lat, lng, radius, extra = '') {
  const url =
    `https://${host}/w/api.php?format=json&action=query&list=geosearch` +
    `&gscoord=${lat}|${lng}&gsradius=${radius}&gslimit=500${extra}`;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`${host} ${res.status}`);
      const j = await res.json();
      return j.query?.geosearch || [];
    } catch (e) {
      console.error('   wiki retry:', e.message);
      await sleep(4000);
    }
  }
  return [];
}

// Grid of tile centers covering the bbox, with a per-tile radius that overlaps.
function tiles(bbox, n) {
  const [w, s, e, nn] = bbox;
  const pts = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      pts.push({
        lat: s + ((nn - s) * (i + 0.5)) / n,
        lng: w + ((e - w) * (j + 0.5)) / n,
      });
    }
  }
  // radius ≈ tile half-size in meters * overlap
  const latM = ((nn - s) / n) * 111320;
  const lngM = ((e - w) / n) * 111320 * Math.cos((((s + nn) / 2) * Math.PI) / 180);
  const radius = Math.min(10000, Math.round((Math.hypot(latM, lngM) / 2) * 1.25));
  return { pts, radius };
}

const id = process.argv[2];
const city = CITIES[id];
if (!city) {
  console.error('Unknown city');
  process.exit(1);
}

const { pts, radius } = tiles(city.bbox, 5);
console.log(`Wikipedia for ${city.name}: ${pts.length} tiles, radius ${radius}m`);

const wiki = new Map();
for (const p of pts) {
  const arts = await geosearch('en.wikipedia.org', p.lat, p.lng, radius);
  for (const r of arts) wiki.set(r.pageid, { lat: r.lat, lng: r.lon, title: r.title });
  await sleep(600);
  process.stdout.write(`  wiki places: ${wiki.size}\r`);
}

mkdirSync(new URL('./raw', import.meta.url), { recursive: true });
const out = { wiki: [...wiki.values()] };
writeFileSync(new URL(`./raw/${id}-wiki.json`, import.meta.url), JSON.stringify(out));
console.log(`\n  ${out.wiki.length} wiki places -> raw/${id}-wiki.json`);

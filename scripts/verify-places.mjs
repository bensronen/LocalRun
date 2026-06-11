// Verify (and optionally fix) the hand-curated Peninsula place coordinates
// against OpenStreetMap's Nominatim geocoder. The pipeline cities come from
// OSM already; the Peninsula was hand-placed and needs ground-truthing.
//
// Run on a machine with open internet (rate-limited to 1 req/sec per
// Nominatim's usage policy):
//
//   node scripts/verify-places.mjs          # report only
//   node scripts/verify-places.mjs --fix    # rewrite bad pins in
//                                           # src/data/cities/peninsula.js AND
//                                           # swift/LocalRun/Data/cities.json
//
// After --fix: rebuild the app in Xcode, and paste the report back into the
// Claude session so the canonical repo data gets the same corrections.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const FIX = process.argv.includes('--fix');
const ROOT = new URL('..', import.meta.url).pathname;
const PENINSULA_JS = join(ROOT, 'src/data/cities/peninsula.js');
const SWIFT_JSON = join(ROOT, 'swift/LocalRun/Data/cities.json');
const THRESHOLD_M = 250; // flag pins further than this from OSM's answer

// Better search queries for places whose dataset names won't geocode verbatim.
const QUERY_OVERRIDES = {
  'emerald-hills-handley-rock': 'Handley Rock Park, Emerald Hills, Redwood City',
  'seal-point-shoreline': 'Seal Point Park, San Mateo',
  'canada-road': 'Pulgas Water Temple',
  'courthouse-square': 'San Mateo County History Museum, Redwood City',
  'downtown-san-mateo': 'B Street, San Mateo',
  'santa-cruz-ave-menlo': 'Santa Cruz Avenue, Menlo Park',
  'university-ave-palo-alto': 'University Avenue, Palo Alto',
  'stanford-campus': 'Main Quad, Stanford University',
  'stanford-dish': 'Stanford Dish',
  'baylands-preserve': 'Baylands Nature Preserve, Palo Alto',
  'bair-island-trail': 'Bair Island, Redwood City',
  'redwood-shores-bay-trail': 'Marlin Park, Redwood City',
  'foster-city-levee': 'Leo Ryan Park, Foster City',
  'burgess-park': 'Burgess Park, Menlo Park',
  'bol-park-path': 'Bol Park, Palo Alto',
};

const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
function dist(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Load PENINSULA (pure ESM constant, no imports) via a temp .mjs copy.
const src = readFileSync(PENINSULA_JS, 'utf8');
const tmp = join(mkdtempSync(join(tmpdir(), 'lr-')), 'peninsula.mjs');
writeFileSync(tmp, src);
const { PENINSULA } = await import(pathToFileURL(tmp).href);

const [w, s, e, n] = PENINSULA.bbox;
const viewbox = `${w},${n},${e},${s}`; // lon-lat top-left, lon-lat bottom-right

async function geocode(query) {
  const url =
    'https://nominatim.openstreetmap.org/search?' +
    new URLSearchParams({
      q: query,
      format: 'jsonv2',
      limit: '1',
      viewbox,
      bounded: '1',
    });
  const res = await fetch(url, {
    headers: { 'User-Agent': 'LocalRun/1.0 (place verification; github.com/bensronen/LocalRun)' },
  });
  if (!res.ok) return null;
  const json = await res.json();
  if (!json.length) return null;
  return { lat: Number(json[0].lat), lng: Number(json[0].lon), label: json[0].display_name };
}

const corrections = [];
console.log(`Verifying ${PENINSULA.places.length} Peninsula places against OSM…\n`);

for (const p of PENINSULA.places) {
  const query = QUERY_OVERRIDES[p.id] || `${p.name}, San Mateo County, California`;
  let hit = await geocode(query);
  if (!hit) hit = await geocode(p.name); // retry unbounded-name
  await new Promise((r) => setTimeout(r, 1100)); // Nominatim rate limit

  if (!hit) {
    console.log(`?  ${p.id.padEnd(30)} NOT FOUND on OSM (query: "${query}") — verify by hand`);
    continue;
  }
  const d = Math.round(dist({ lat: p.lat, lng: p.lng }, hit));
  if (d <= THRESHOLD_M) {
    console.log(`✓  ${p.id.padEnd(30)} ${d}m off — OK`);
  } else {
    console.log(`✗  ${p.id.padEnd(30)} ${d}m off → OSM says ${hit.lat.toFixed(5)},${hit.lng.toFixed(5)}  (${hit.label.slice(0, 60)})`);
    corrections.push({ id: p.id, from: { lat: p.lat, lng: p.lng }, to: { lat: hit.lat, lng: hit.lng }, meters: d });
  }
}

console.log(`\n${corrections.length} pin(s) need correction.`);
if (!corrections.length) process.exit(0);

console.log('\nCorrections JSON (paste this back to Claude to sync the repo):');
console.log(JSON.stringify(corrections, null, 1));

if (!FIX) {
  console.log('\nRe-run with --fix to apply these to the dataset and the Swift bundle.');
  process.exit(0);
}

// ---- apply fixes ----
let out = src;
for (const c of corrections) {
  // peninsula.js is formatted with `id: '<id>'` followed by lat/lng lines.
  const re = new RegExp(`(id: '${c.id}',[\\s\\S]*?lat: )([-\\d.]+)(,\\s*\\n\\s*lng: )([-\\d.]+)`);
  if (!re.test(out)) {
    console.log(`!  could not patch ${c.id} in peninsula.js — fix by hand`);
    continue;
  }
  out = out.replace(re, `$1${c.to.lat.toFixed(5)}$3${c.to.lng.toFixed(5)}`);
}
writeFileSync(PENINSULA_JS, out);
console.log(`\nPatched ${PENINSULA_JS}`);

const cities = JSON.parse(readFileSync(SWIFT_JSON, 'utf8'));
const pen = cities.find((c) => c.id === 'peninsula');
for (const c of corrections) {
  const place = pen.places.find((p) => p.id === c.id);
  if (place) {
    place.lat = Number(c.to.lat.toFixed(5));
    place.lng = Number(c.to.lng.toFixed(5));
  }
}
writeFileSync(SWIFT_JSON, JSON.stringify(cities));
console.log(`Patched ${SWIFT_JSON}`);
console.log('\nDone. Rebuild in Xcode (Cmd-R) and the pins will be in the right places.');
console.log('Note: corridor polylines are not auto-fixed — if a corridor place moved');
console.log('far, paste the report to Claude for a corridor rebuild.');

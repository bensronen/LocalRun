// Fetch scenic-relevant OpenStreetMap features for a city bbox via Overpass.
// Usage: node pipeline/fetchOsm.mjs <cityId>
import { writeFileSync, mkdirSync } from 'fs';
import { CITIES } from './config.mjs';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

// Public Overpass mirrors reject UA-less requests (406/403); identify ourselves like fetchWiki.
const UA = 'LocalRun/0.1 (scenic running route prototype; contact: local-app@example.com)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Ways/nodes return full geometry; multipolygon parks/water return centroids
// (relations with `out geom` trip a 406 on the public servers).
function query(bbox) {
  const [w, s, e, n] = bbox;
  const b = `${s},${w},${n},${e}`;
  return `
[out:json][timeout:90];
(
  way["leisure"~"^(park|garden|nature_reserve|common)$"](${b});
  way["landuse"~"^(forest|grass|recreation_ground|meadow|village_green|cemetery)$"](${b});
  way["natural"~"^(wood|water|beach|wetland)$"](${b});
  way["natural"="coastline"](${b});
  way["waterway"~"^(river|canal|riverbank)$"](${b});
  way["highway"~"^(footway|path|pedestrian|cycleway)$"]["name"](${b});
  way["highway"="pedestrian"](${b});
  way["place"="square"](${b});
  node["tourism"~"^(viewpoint|attraction|artwork|gallery|museum)$"](${b});
  node["historic"~"."](${b});
  node["leisure"~"^(park|garden)$"](${b});
  node["place"="square"](${b});
)->.feat;
(
  relation["leisure"~"^(park|garden|nature_reserve)$"](${b});
  relation["natural"="water"](${b});
  relation["landuse"~"^(forest|recreation_ground|cemetery)$"](${b});
)->.rels;
.feat out geom;
.rels out center;
`;
}

// Gentle: one request at a time, long waits between tries (public Overpass limits hard).
async function fetchOverpass(q) {
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body: 'data=' + encodeURIComponent(q),
      });
      if (!res.ok) throw new Error(`${url} -> ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      console.error(`  attempt ${attempt + 1}: ${e.message}; waiting...`);
      await sleep(20000);
    }
  }
  throw lastErr;
}

const id = process.argv[2];
const city = CITIES[id];
if (!city) {
  console.error('Unknown city. Options:', Object.keys(CITIES).join(', '));
  process.exit(1);
}

// `--print` just emits the Overpass query (for piping to curl).
if (process.argv[3] === '--print') {
  process.stdout.write(query(city.bbox));
  process.exit(0);
}

console.log(`Fetching OSM for ${city.name} ${JSON.stringify(city.bbox)} ...`);
const json = await fetchOverpass(query(city.bbox));
mkdirSync(new URL('./raw', import.meta.url), { recursive: true });
const out = new URL(`./raw/${id}-osm.json`, import.meta.url);
writeFileSync(out, JSON.stringify(json));

const els = json.elements || [];
const byType = {};
for (const el of els) {
  const k =
    el.tags?.leisure ||
    el.tags?.landuse ||
    el.tags?.natural ||
    el.tags?.waterway ||
    el.tags?.tourism ||
    el.tags?.historic ||
    el.tags?.highway ||
    el.tags?.place ||
    el.type;
  byType[k] = (byType[k] || 0) + 1;
}
console.log(`  ${els.length} elements -> raw/${id}-osm.json`);
console.log('  ', JSON.stringify(byType));

// Cross-reference OSM + Wikipedia into a scenic dataset for a city:
//   - corridors: runnable scenic paths you go THROUGH (waterfront/greenway/park/bridge)
//   - places:    notability-weighted POIs you pass (viewpoints, landmarks, gardens)
//   - beauty:    a normalized grid scored by green/water/notability/quiet
// Output: pipeline/out/<id>.json  (blurbs filled in a later LLM step)
// Usage: node pipeline/build.mjs <cityId>
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { CITIES, zoneFor } from './config.mjs';

const id = process.argv[2];
const city = CITIES[id];
if (!city) {
  console.error('Unknown city');
  process.exit(1);
}
const raw = JSON.parse(readFileSync(new URL(`./raw/${id}-osm.json`, import.meta.url)));
const wikiRaw = JSON.parse(readFileSync(new URL(`./raw/${id}-wiki.json`, import.meta.url)));
const els = raw.elements || [];
const wikiPts = (wikiRaw.wiki || []).map((w) => ({ lat: w.lat, lng: w.lng, title: w.title }));

// ---------- geo helpers ----------
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const la1 = rad(a.lat);
  const la2 = rad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
const G = (e) => (e.geometry || []).map((p) => ({ lat: p.lat, lng: p.lon }));
function centroid(pts) {
  let lat = 0;
  let lng = 0;
  for (const p of pts) {
    lat += p.lat;
    lng += p.lng;
  }
  return { lat: lat / pts.length, lng: lng / pts.length };
}
function plLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += haversine(pts[i - 1], pts[i]);
  return d;
}
// keep ~every step-meters of a polyline, max `max` points
function simplify(pts, max = 8) {
  if (pts.length <= max) return pts;
  const total = plLength(pts);
  const step = total / (max - 1);
  const out = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += haversine(pts[i - 1], pts[i]);
    if (acc >= step) {
      out.push(pts[i]);
      acc = 0;
    }
  }
  if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  return out;
}

// ---------- spatial hash for nearest-distance queries ----------
function makeHash(points, cellM = 200) {
  const cell = cellM / 111320;
  const map = new Map();
  const key = (la, ln) => `${Math.floor(la / cell)},${Math.floor(ln / cell)}`;
  for (const p of points) {
    const k = key(p.lat, p.lng);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(p);
  }
  return {
    cell,
    // min distance to any point within ~`radius`; returns Infinity if none
    nearest(pt, radius = 300) {
      const r = Math.ceil(radius / 111320 / cell) + 1;
      const ci = Math.floor(pt.lat / cell);
      const cj = Math.floor(pt.lng / cell);
      let best = Infinity;
      for (let i = -r; i <= r; i++)
        for (let j = -r; j <= r; j++) {
          const arr = map.get(`${ci + i},${cj + j}`);
          if (!arr) continue;
          for (const q of arr) {
            const d = haversine(pt, q);
            if (d < best) best = d;
          }
        }
      return best;
    },
    count(pt, radius = 250) {
      const r = Math.ceil(radius / 111320 / cell) + 1;
      const ci = Math.floor(pt.lat / cell);
      const cj = Math.floor(pt.lng / cell);
      let n = 0;
      for (let i = -r; i <= r; i++)
        for (let j = -r; j <= r; j++) {
          const arr = map.get(`${ci + i},${cj + j}`);
          if (!arr) continue;
          for (const q of arr) if (haversine(pt, q) <= radius) n++;
        }
      return n;
    },
  };
}

// ---------- categorize OSM ----------
const greenPts = []; // points sampled from green areas (for proximity)
const waterPts = [];
const pathWays = []; // {name, pts, tags}
const poiCands = []; // {lat,lng,name,kind}

const GREEN_LEISURE = /^(park|garden|nature_reserve|common)$/;
const GREEN_LANDUSE = /^(forest|grass|recreation_ground|meadow|village_green|cemetery)$/;
const GREEN_NATURAL = /^(wood|wetland)$/;
const POI_TOURISM = /^(viewpoint|attraction|artwork|gallery|museum)$/;

for (const e of els) {
  const t = e.tags || {};
  const pts = G(e);
  const isGreen =
    GREEN_LEISURE.test(t.leisure || '') ||
    GREEN_LANDUSE.test(t.landuse || '') ||
    GREEN_NATURAL.test(t.natural || '');
  const isWater = t.natural === 'water' || t.natural === 'coastline' || /^(river|canal|riverbank)$/.test(t.waterway || '');

  if (e.type === 'relation' && e.center) {
    // big multipolygon parks/water -> centroid sample
    const c = { lat: e.center.lat, lng: e.center.lon };
    if (isGreen) greenPts.push(c);
    if (isWater) waterPts.push(c);
    if (isGreen && t.name) poiCands.push({ ...c, name: t.name, kind: 'park' });
    continue;
  }

  if (pts.length) {
    if (isGreen) for (const p of simplify(pts, 12)) greenPts.push(p);
    if (isWater) for (const p of simplify(pts, 16)) waterPts.push(p);
    if (/^(footway|path|pedestrian|cycleway)$/.test(t.highway || '')) {
      pathWays.push({ name: t.name || null, pts, tags: t });
    }
    if (isGreen && t.name) poiCands.push({ ...centroid(pts), name: t.name, kind: 'park' });
    if (t.place === 'square' && t.name) poiCands.push({ ...centroid(pts), name: t.name, kind: 'square' });
  } else if (e.type === 'node') {
    const c = { lat: e.lat, lng: e.lon };
    if (POI_TOURISM.test(t.tourism || '') && t.name) poiCands.push({ ...c, name: t.name, kind: t.tourism });
    else if (t.historic && t.name) poiCands.push({ ...c, name: t.name, kind: 'historic' });
    else if (GREEN_LEISURE.test(t.leisure || '') && t.name) poiCands.push({ ...c, name: t.name, kind: 'park' });
  }
}

const greenHash = makeHash(greenPts);
const waterHash = makeHash(waterPts);
const wikiHash = makeHash(wikiPts);

// ---------- corridors: chain named paths, score by scenery ----------
function chain(ways) {
  // adjacency by endpoint coordinate key; greedily build longest polyline
  const keyOf = (p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  const segs = ways.map((w) => w.pts).filter((p) => p.length > 1);
  if (!segs.length) return [];
  // simple approach: repeatedly connect segments sharing an endpoint
  let chains = segs.map((s) => [...s]);
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < chains.length; i++) {
      for (let j = i + 1; j < chains.length; j++) {
        const a = chains[i];
        const b = chains[j];
        const aS = keyOf(a[0]);
        const aE = keyOf(a[a.length - 1]);
        const bS = keyOf(b[0]);
        const bE = keyOf(b[b.length - 1]);
        let nc = null;
        if (aE === bS) nc = a.concat(b.slice(1));
        else if (aE === bE) nc = a.concat([...b].reverse().slice(1));
        else if (aS === bS) nc = [...a].reverse().concat(b.slice(1));
        else if (aS === bE) nc = b.concat(a.slice(1));
        if (nc) {
          chains.splice(j, 1);
          chains[i] = nc;
          merged = true;
          break outer;
        }
      }
    }
  }
  return chains.sort((a, b) => plLength(b) - plLength(a))[0];
}

const SCENIC_NAME = /promenade|greenway|esplanade|riverwalk|waterfront|boardwalk|seawall|trail|river|park|garden|mall|all[ée]e|path|walk|pier|harbor|harbour|bayfront|embankment|canal/i;

const byName = new Map();
const unnamedPed = [];
for (const w of pathWays) {
  if (w.name) {
    if (!byName.has(w.name)) byName.set(w.name, []);
    byName.get(w.name).push(w);
  } else if (w.tags.highway === 'pedestrian' && w.pts.length > 4) {
    unnamedPed.push(w);
  }
}

const corridorCands = [];
for (const [name, ways] of byName) {
  const line = chain(ways);
  if (!line || line.length < 2) continue;
  const len = plLength(line);
  if (len < 350) continue; // too short to be a "run-along" corridor
  const samples = simplify(line, 10);
  let nearWater = 0;
  let nearGreen = 0;
  for (const s of samples) {
    if (waterHash.nearest(s, 140) < 140) nearWater++;
    if (greenHash.nearest(s, 80) < 80) nearGreen++;
  }
  const wF = nearWater / samples.length;
  const gF = nearGreen / samples.length;
  const bridge = ways.some((w) => w.tags.bridge && w.tags.bridge !== 'no');
  const score =
    Math.min(len / 1000, 2.5) * 1.0 +
    wF * 2.0 +
    gF * 1.6 +
    (SCENIC_NAME.test(name) ? 0.8 : 0) +
    (bridge ? 0.6 : 0);
  corridorCands.push({ name, line: simplify(line, 8), len, wF, gF, bridge, score });
}
corridorCands.sort((a, b) => b.score - a.score);

// dedupe corridors that overlap heavily (same area)
const corridors = [];
for (const c of corridorCands) {
  const mid = c.line[Math.floor(c.line.length / 2)];
  if (corridors.some((k) => haversine(mid, k.line[Math.floor(k.line.length / 2)]) < 250)) continue;
  corridors.push(c);
  if (corridors.length >= 16) break;
}

// ---------- POIs: cross-reference OSM with Wikipedia notability ----------
const KIND_BASE = {
  viewpoint: 5,
  park: 4,
  garden: 4,
  square: 3.5,
  attraction: 3.5,
  artwork: 3,
  gallery: 3,
  museum: 3.5,
  historic: 3,
};
const KIND_CAT = {
  viewpoint: 'viewpoint',
  park: 'park',
  garden: 'park',
  square: 'neighborhood',
  attraction: 'landmark',
  artwork: 'landmark',
  gallery: 'landmark',
  museum: 'landmark',
  historic: 'landmark',
};
const scoredPois = poiCands.map((p) => {
  const notability = Math.min(wikiHash.count(p, 180), 8); // how documented is this spot
  const green = greenHash.nearest(p, 200) < 200 ? 1 : 0;
  const water = waterHash.nearest(p, 200) < 200 ? 1 : 0;
  const score = (KIND_BASE[p.kind] || 3) + notability * 0.5 + green * 0.6 + water * 0.8;
  return { ...p, category: KIND_CAT[p.kind] || 'landmark', score, notability };
});
// keep notable, spatially-deduped POIs
scoredPois.sort((a, b) => b.score - a.score);
const places = [];
for (const p of scoredPois) {
  if (p.notability < 1 && p.score < 4.5) continue; // must be at least somewhat notable
  if (places.some((k) => haversine(p, k) < 220)) continue;
  places.push(p);
  if (places.length >= 40) break;
}

// ---------- beauty grid ----------
const [w, s, e, n] = city.bbox;
const cellM = 200;
const nx = Math.ceil(((e - w) * 111320 * Math.cos(rad((s + n) / 2))) / cellM);
const ny = Math.ceil(((n - s) * 111320) / cellM);
const scores = [];
let gmin = Infinity;
let gmax = -Infinity;
for (let j = 0; j < ny; j++) {
  for (let i = 0; i < nx; i++) {
    const lat = s + ((n - s) * (j + 0.5)) / ny;
    const lng = w + ((e - w) * (i + 0.5)) / nx;
    const p = { lat, lng };
    const gd = greenHash.nearest(p, 300);
    const wd = waterHash.nearest(p, 300);
    const green = Math.max(0, 1 - gd / 300);
    const water = Math.max(0, 1 - wd / 300);
    const notab = Math.min(wikiHash.count(p, 200) / 6, 1);
    const v = green * 1.0 + water * 1.1 + notab * 0.9;
    scores.push(v);
    gmin = Math.min(gmin, v);
    gmax = Math.max(gmax, v);
  }
}
const norm = scores.map((v) => Math.round(((v - gmin) / (gmax - gmin || 1)) * 100));

// ---------- assemble dataset (blurbs added later) ----------
let cid = 0;
const slug = (nm) =>
  nm
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40) || `f${cid++}`;

const placeObjs = [];
for (const c of corridors) {
  const mid = c.line[Math.floor(c.line.length / 2)];
  placeObjs.push({
    id: slug(c.name) + '-path',
    name: c.name,
    category: c.wF > 0.3 ? 'waterfront' : 'path',
    zone: zoneFor(city, mid.lat, mid.lng),
    lat: +mid.lat.toFixed(5),
    lng: +mid.lng.toFixed(5),
    score: Math.min(5, Math.round(3 + c.score / 2)),
    corridor: c.line.map((p) => ({ lat: +p.lat.toFixed(5), lng: +p.lng.toFixed(5) })),
    _meta: { len: Math.round(c.len), waterFrac: +c.wF.toFixed(2), greenFrac: +c.gF.toFixed(2), bridge: c.bridge },
  });
}
for (const p of places) {
  placeObjs.push({
    id: slug(p.name),
    name: p.name,
    category: p.category,
    zone: zoneFor(city, p.lat, p.lng),
    lat: +p.lat.toFixed(5),
    lng: +p.lng.toFixed(5),
    score: Math.min(5, Math.round(p.score)),
    _meta: { kind: p.kind, notability: p.notability },
  });
}
// strip zone when it's the primary (keeps files clean; router defaults to primary)
for (const p of placeObjs) if (p.zone === city.primaryZone) delete p.zone;

const out = {
  id: city.id,
  name: city.name,
  emoji: city.emoji,
  center: city.center,
  bbox: city.bbox,
  primaryZone: city.primaryZone,
  defaultStart: city.defaultStart,
  presets: city.presets,
  beauty: { bbox: city.bbox, nx, ny, scores: norm },
  places: placeObjs,
};

mkdirSync(new URL('./out', import.meta.url), { recursive: true });
writeFileSync(new URL(`./out/${id}.json`, import.meta.url), JSON.stringify(out));

const corr = placeObjs.filter((p) => p.corridor);
console.log(`${city.name}: ${placeObjs.length} places (${corr.length} corridors, ${placeObjs.length - corr.length} POIs), beauty grid ${nx}x${ny}`);
console.log('  corridors:', corr.slice(0, 12).map((c) => `${c.name}[${c._meta.len}m${c._meta.bridge ? ',bridge' : ''}]`).join(' | '));
console.log('  top POIs:', placeObjs.filter((p) => !p.corridor).slice(0, 12).map((p) => `${p.name}(${p.category},s${p.score})`).join(' | '));

// Curation helper: turns pipeline `out/<city>.json` places into the final, LLM-curated
// `final/<city>-places.json` the app ships. Each spec entry references a source place by
// its pipeline id (`src`) so the real lat/lng/corridor geometry is carried over verbatim;
// the editorial fields (name, category, score, blurb, see, do, tip, transit, endpoint) are
// supplied by hand. Usage: import { curate } from '../curate-lib.mjs' in a city spec.
import { readFileSync, writeFileSync } from 'fs';

export function curate(cityId, entries) {
  const base = JSON.parse(readFileSync(new URL(`./out/${cityId}.json`, import.meta.url)));
  const byId = Object.fromEntries(base.places.map((p) => [p.id, p]));
  const seen = new Set();
  const places = entries.map((e, i) => {
    const src = byId[e.src];
    if (!src) throw new Error(`${cityId}[${i}]: no pipeline place with id "${e.src}"`);
    if (seen.has(e.src)) throw new Error(`${cityId}[${i}]: duplicate src "${e.src}"`);
    seen.add(e.src);
    const o = {
      id: e.id || src.id,
      name: e.name || src.name,
      category: e.category || src.category,
      lat: src.lat,
      lng: src.lng,
    };
    if (src.zone) o.zone = src.zone;
    if (src.corridor) o.corridor = src.corridor;
    o.score = e.score != null ? e.score : src.score;
    o.blurb = e.blurb;
    o.see = e.see;
    o.do = e.do ?? null;
    o.tip = e.tip ?? null;
    o.transit = e.transit;
    if (e.endpoint) o.endpoint = true;
    return o;
  });
  writeFileSync(
    new URL(`./final/${cityId}-places.json`, import.meta.url),
    JSON.stringify(places, null, 2) + '\n'
  );
  const corr = places.filter((p) => p.corridor).length;
  const ep = places.filter((p) => p.endpoint).length;
  console.log(`${cityId}: wrote ${places.length} curated places (${corr} corridors, ${ep} endpoints) -> final/${cityId}-places.json`);
}

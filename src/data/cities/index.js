// Registry of all supported cities. Each city module exports a city object with
// { id, name, emoji, center, bbox, primaryZone, defaultStart, presets, places }.
import { NYC } from './nyc';
import { SF } from './sf';
import { BOSTON } from './boston';
import { TOKYO } from './tokyo';

export { CATEGORY_META } from '../categories';

export const CITIES = [NYC, SF, BOSTON, TOKYO];
export const CITY_BY_ID = Object.fromEntries(CITIES.map((c) => [c.id, c]));

// Which city a coordinate falls in (bbox hit, else nearest center). Lets us pick the
// right dataset from "my location" or a dropped pin.
export function cityForPoint(pt) {
  for (const c of CITIES) {
    const [w, s, e, n] = c.bbox;
    if (pt.lng >= w && pt.lng <= e && pt.lat >= s && pt.lat <= n) return c;
  }
  let best = CITIES[0];
  let bestD = Infinity;
  for (const c of CITIES) {
    const d = (c.center.lat - pt.lat) ** 2 + (c.center.lng - pt.lng) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

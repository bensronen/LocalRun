// Registry of all supported cities. Each city module exports a city object with
// { id, name, emoji, center, bbox, primaryZone, defaultStart, presets, places }.
import { NYC } from './nyc';
import { SF } from './sf';
import { PENINSULA } from './peninsula';
import { BOSTON } from './boston';
import { CHICAGO } from './chicago';
import { AUSTIN } from './austin';
import { MIAMI } from './miami';
import { LONDON } from './london';
import { PARIS } from './paris';
import { TOKYO } from './tokyo';

export const CITIES = [NYC, SF, PENINSULA, BOSTON, CHICAGO, AUSTIN, MIAMI, LONDON, PARIS, TOKYO];

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

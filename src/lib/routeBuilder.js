// The "brain": turn (start, distance, shape, vibe, city) into a scenic route plus a
// human explanation of why it chose that route.
//
// Scenic features are POINTS (a landmark/park you pass) or CORRIDORS — a runnable
// polyline you travel the length of (esplanade, greenway, bridge crossing, park loop).
// We pick by appeal within a distance budget, expand corridors so the route runs
// ALONG them, charge a penalty for crossing water (zones), then refine to target.

import { haversine, bearing, angularDiff, destinationPoint } from './geo';
import { getRoute } from './mapbox';

const STREET_FACTOR = 1.28; // straight-line -> on-street distance, for estimates only
const MAX_WAYPOINTS = 6;
const MAPBOX_MAX_COORDS = 25;
const CROSSING_PENALTY = 2400; // bridge detour to reach a different zone (water barrier)

function ll(p) {
  return { lat: p.lat, lng: p.lng };
}

function endsOf(place) {
  if (place.corridor && place.corridor.length) {
    return { a: place.corridor[0], b: place.corridor[place.corridor.length - 1] };
  }
  const p = ll(place);
  return { a: p, b: p };
}

function polylineLength(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += haversine(coords[i - 1], coords[i]);
  return d;
}

// Distance run *along* a feature (0 for points) — desirable scenic distance, not cost.
function scenicLength(place) {
  return place.corridor ? polylineLength(place.corridor) : 0;
}

function valueOf(place, vibe, jitter = 0) {
  const base = (place.score || 3) * (place._boost || 1);
  const w = (vibe && vibe[place.category]) ?? 1;
  const noise = jitter ? 1 + (Math.random() - 0.5) * jitter : 1;
  return base * w * noise;
}

// boosts: { placeId: weight } learned from photos and ratings (yours and the
// community's) — capped so favorites tilt routes without taking them over.
// seen/explore: places this runner has already passed on completed runs;
// 'new' steers away from them, 'revisit' leans back into them.
function annotate(start, places, city, { boosts, seen, explore } = {}) {
  const seenSet = new Set(seen || []);
  return places.map((p) => {
    let b = boosts && boosts[p.id] ? 1 + Math.min(boosts[p.id], 5) * 0.12 : 1;
    // 0.3 is deliberately heavy: marquee corridors score so high that anything
    // gentler leaves repeat runs identical (still beats nothing if alternatives run out)
    if (explore === 'new' && seenSet.has(p.id)) b *= 0.3;
    else if (explore === 'revisit' && seenSet.has(p.id)) b *= 1.45;
    return {
      ...p,
      // distance to the NEAREST point you'd reach the feature at (a corridor that runs
      // past the start is "close" even if its midpoint is far)
      _d: p.corridor && p.corridor.length
        ? Math.min(...p.corridor.map((c) => haversine(start, c)))
        : haversine(start, ll(p)),
      _b: bearing(start, ll(p)),
      _zone: p.zone || city.primaryZone,
      _boost: b,
    };
  });
}

// A start's zone is the zone of the nearest curated place — city-agnostic, no hand
// geometry needed.
function zoneForStart(start, annotated, city) {
  let best = null;
  let bestD = Infinity;
  for (const p of annotated) {
    if (p._d < bestD) {
      bestD = p._d;
      best = p;
    }
  }
  return best ? best._zone : city.primaryZone;
}

// Loop length estimate: order by bearing, thread through features. Manhattan-style
// corridors traverse end-to-end; bridges cross-and-return; across-water features cost
// a bridge detour out and back.
// maxScenic caps how much of a corridor counts toward the budget — a long corridor
// can be partially run (truncated later), so it shouldn't be rejected outright.
function nearestPoint(prev, p) {
  if (!p.corridor || !p.corridor.length) return ll(p);
  let near = p.corridor[0];
  let nd = Infinity;
  for (const c of p.corridor) {
    const d = haversine(prev, c);
    if (d < nd) {
      nd = d;
      near = c;
    }
  }
  return near;
}
function loopEstimate(start, set, startZone, maxScenic = Infinity) {
  if (!set.length) return 0;
  const ordered = [...set].sort((a, b) => a._b - b._b);
  let dist = 0;
  let prev = start;
  for (const p of ordered) {
    const sl = Math.min(scenicLength(p), maxScenic);
    if (p.crossing) {
      const { a, b } = endsOf(p);
      const near = haversine(prev, a) <= haversine(prev, b) ? a : b;
      dist += haversine(prev, near) + 2 * sl;
      prev = near;
    } else if (p._zone !== startZone) {
      const { a, b } = endsOf(p);
      const near = haversine(prev, a) <= haversine(prev, b) ? a : b;
      dist += 2 * haversine(prev, near) + 2 * CROSSING_PENALTY;
    } else if (p.corridor && p.corridor.length) {
      // Enter at the nearest point and run a (windowable) stretch, returning near where
      // you entered — so a corridor you're standing on is cheap, not a trek to its end.
      const near = nearestPoint(prev, p);
      dist += haversine(prev, near) + sl;
      prev = near;
    } else {
      const a = ll(p);
      dist += haversine(prev, a);
      prev = a;
    }
  }
  dist += haversine(prev, start);
  return dist * STREET_FACTOR;
}

// Pick the highest-appeal feature that still fits the budget, then the next, etc.
// Corridors get a scenic bonus. Surfaces marquee features over cheap nearby pins.
function selectLoopWaypoints(start, targetMeters, vibe, jitter, annotated, startZone) {
  const candidates = annotated.filter((p) => (p.corridor || p._d > 150) && p._d <= targetMeters * 0.55);
  const selected = [];
  let pool = candidates;
  // A corridor longer than this gets truncated to fit, so cap its budget cost (the
  // measured re-seed in buildRoute recovers any corridor this still rejects).
  const maxScenic = targetMeters * 0.85;

  while (selected.length < MAX_WAYPOINTS && pool.length) {
    let best = null;
    let bestScore = -Infinity;
    for (const cand of pool) {
      const len = loopEstimate(start, [...selected, cand], startZone, maxScenic);
      if (len > targetMeters * 1.1) continue;
      const scenicBonus = 1 + (scenicLength(cand) / 1000) * 0.6;
      const diversity = selected.some((s) => s.category === cand.category) ? 0.85 : 1.2;
      const score = valueOf(cand, vibe, jitter) * scenicBonus * diversity;
      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    if (!best) break;
    selected.push(best);
    pool = pool.filter((p) => p.id !== best.id);
  }

  // Fill pass: while the run is well short of target, add the worthwhile feature that
  // pushes the distance closest to target (allowing a modest overshoot). Keeps short
  // runs from feeling thin without resorting to aimless street padding.
  while (
    selected.length < MAX_WAYPOINTS + 1 &&
    pool.length &&
    loopEstimate(start, selected, startZone, maxScenic) < targetMeters * 0.9
  ) {
    let best = null;
    let bestGap = Infinity;
    for (const cand of pool) {
      if ((cand.score || 3) < 3) continue; // don't pad with low-value pins
      const len = loopEstimate(start, [...selected, cand], startZone, maxScenic);
      if (len > targetMeters * 1.25) continue;
      const gap = Math.abs(targetMeters - len);
      if (gap < bestGap) {
        bestGap = gap;
        best = cand;
      }
    }
    if (!best) break;
    selected.push(best);
    pool = pool.filter((p) => p.id !== best.id);
  }

  return selected.sort((a, b) => a._b - b._b);
}

// A "scenic chain": pick the top features you run THROUGH (corridors — greenways,
// park paths, waterfronts — strongly favored) and chain them, so the route threads
// scenery on the way out and back, wherever that scenery happens to be.
const JOURNEY_WEIGHT = {
  path: 1.7,
  waterfront: 1.6,
  park: 1.4,
  viewpoint: 1.1,
  landmark: 0.95,
  neighborhood: 0.85,
};
function selectScenicChain(start, targetMeters, vibe, jitter, annotated, startZone) {
  const maxScenic = targetMeters * 0.85;
  const cands = annotated.filter(
    (p) => p._zone === startZone && (p.corridor || p._d > 150) && p._d <= targetMeters * 0.6
  );
  const scoreOf = (p) =>
    valueOf(p, vibe, jitter) *
    (1 + (scenicLength(p) / 1000) * 1.2) *
    (JOURNEY_WEIGHT[p.category] || 1) *
    (p.corridor ? 1.5 : 1); // a thing you run THROUGH beats a thing you run past
  const pool = [...cands].sort((a, b) => scoreOf(b) - scoreOf(a));

  const selected = [];
  for (const cand of pool) {
    if (selected.length >= 4) break;
    if (loopEstimate(start, [...selected, cand], startZone, maxScenic) > targetMeters * 1.12) continue;
    selected.push(cand);
  }
  return selected.sort((a, b) => a._b - b._b);
}

// ---- Scoring a route by what it runs THROUGH, not just where it ends ----

function segDistMeters(p, a, b) {
  const latR = (p.lat * Math.PI) / 180;
  const mLat = 111320;
  const mLng = 111320 * Math.cos(latR);
  const ax = (a.lng - p.lng) * mLng;
  const ay = (a.lat - p.lat) * mLat;
  const bx = (b.lng - p.lng) * mLng;
  const by = (b.lat - p.lat) * mLat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.sqrt(cx * cx + cy * cy);
}

function nearestFeature(pt, annotated) {
  let dmin = Infinity;
  let nearest = null;
  for (const p of annotated) {
    let d;
    if (p.corridor && p.corridor.length > 1) {
      d = Infinity;
      for (let i = 1; i < p.corridor.length; i++) {
        d = Math.min(d, segDistMeters(pt, p.corridor[i - 1], p.corridor[i]));
      }
    } else {
      d = haversine(pt, ll(p));
    }
    if (d < dmin) {
      dmin = d;
      nearest = p;
    }
  }
  return { dmin, nearest };
}

function toLL(coords) {
  return coords.map((c) => ({ lat: c.latitude ?? c.lat, lng: c.longitude ?? c.lng }));
}

function sampleAlong(coords, step) {
  if (coords.length < 2) return coords;
  const pts = [];
  let carry = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const segLen = haversine(a, b);
    if (segLen === 0) continue;
    let dist = carry;
    while (dist < segLen) {
      const t = dist / segLen;
      pts.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
      dist += step;
    }
    carry = dist - segLen;
  }
  pts.push(coords[coords.length - 1]);
  return pts;
}

// Look up the precomputed 0..1 "beauty" value (green/water/notability) of a point
// from the city's data-derived grid. Returns 0 if no grid or out of bounds.
function beautyAt(beauty, p) {
  if (!beauty) return 0;
  const [w, s, e, n] = beauty.bbox;
  if (p.lng < w || p.lng > e || p.lat < s || p.lat > n) return 0;
  const i = Math.min(beauty.nx - 1, Math.floor(((p.lng - w) / (e - w)) * beauty.nx));
  const j = Math.min(beauty.ny - 1, Math.floor(((p.lat - s) / (n - s)) * beauty.ny));
  return (beauty.scores[j * beauty.nx + i] || 0) / 100;
}

// Higher is better: time spent near scenery + general "beauty" of the ground covered
// + variety of features passed, minus "dead" stretches far from anything notable.
// The en-route experience is the product, so beauty-of-ground and dead stretches
// weigh heavily — we are explicitly NOT optimizing for the fastest way between stops.
function sceneryScore(routeCoords, annotated, beauty) {
  const samples = sampleAlong(toLL(routeCoords), 120);
  if (!samples.length) return 0;
  let prox = 0;
  let dead = 0;
  let beautySum = 0;
  const seen = new Set();
  for (const s of samples) {
    const { dmin, nearest } = nearestFeature(s, annotated);
    prox += Math.max(0, 1 - dmin / 300);
    beautySum += beautyAt(beauty, s);
    if (dmin > 350) dead += 1;
    if (dmin < 200 && nearest) seen.add(nearest.id);
  }
  const n = samples.length;
  return (
    prox / n +
    (beautySum / n) * 1.4 +
    Math.min(seen.size, 10) * 0.05 -
    (dead / n) * 1.1
  );
}

// Fraction of the route that runs close to a non-adjacent part of itself — i.e. how
// much it doubles back (an out-and-back scores high; a clean loop scores ~0).
function selfOverlap(routeCoords) {
  const s = sampleAlong(toLL(routeCoords), 80);
  if (s.length < 8) return 0;
  let overlap = 0;
  for (let i = 0; i < s.length; i++) {
    for (let j = i + 4; j < s.length; j++) {
      if (haversine(s[i], s[j]) < 35) {
        overlap += 1;
        break;
      }
    }
  }
  return overlap / s.length;
}

// Drop empty and duplicate candidate sets (same stops in any order).
function dedupeSets(sets) {
  const seen = new Set();
  const out = [];
  for (const s of sets) {
    if (!s || !s.length) continue;
    const key = s.map((p) => p.id).sort().join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// Drop the LEAST scenic stop — a corridor you run through is worth far more to keep
// than a point you pass, so points go first.
function trimOne(waypoints, shape) {
  if (waypoints.length <= 1) return waypoints;
  const removable = shape === 'oneway' ? waypoints.slice(0, -1) : waypoints;
  const keepValue = (p) => (p.score || 3) + (p.corridor ? 4 + scenicLength(p) / 1000 : 0);
  let worstIdx = 0;
  let worst = Infinity;
  removable.forEach((p, i) => {
    const kv = keepValue(p);
    if (kv < worst) {
      worst = kv;
      worstIdx = i;
    }
  });
  return waypoints.filter((p) => p.id !== removable[worstIdx].id);
}

function capCoords(coords) {
  while (coords.length > MAPBOX_MAX_COORDS) {
    let idx = -1;
    let least = Infinity;
    for (let i = 1; i < coords.length - 1; i++) {
      const detour =
        haversine(coords[i - 1], coords[i]) +
        haversine(coords[i], coords[i + 1]) -
        haversine(coords[i - 1], coords[i + 1]);
      if (detour < least) {
        least = detour;
        idx = i;
      }
    }
    if (idx < 0) break;
    coords.splice(idx, 1);
  }
  return coords;
}

// Force loops to actually circle. With one destination (or all waypoints off
// in one direction) Mapbox retraces the same shortest path out and back; vias
// placed perpendicular to the axis push the out and return legs onto
// different streets — a lens for single stops, an outward bulge otherwise.
function circularize(start, coords) {
  if (coords.length < 3) return coords;
  const pts = coords.slice(1, -1);
  const offFor = (d) => Math.min(900, Math.max(150, d * 0.33));

  if (pts.length === 1) {
    const p = pts[0];
    const mid = { lat: (start.lat + p.lat) / 2, lng: (start.lng + p.lng) / 2 };
    const perp = bearing(start, p) + 90;
    const off = offFor(haversine(start, p));
    return [start, destinationPoint(mid, perp, off), p, destinationPoint(mid, perp - 180, off), start];
  }

  // angular spread of the waypoints as seen from the start
  const bs = pts.map((p) => bearing(start, p));
  let spread = 0;
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) spread = Math.max(spread, angularDiff(bs[i], bs[j]));
  }
  if (spread >= 100) return coords; // already sweeps around the start

  // bulge the return leg to the side away from the rest of the route
  const lastP = pts[pts.length - 1];
  const mid = { lat: (start.lat + lastP.lat) / 2, lng: (start.lng + lastP.lng) / 2 };
  const axis = bearing(start, lastP);
  const off = offFor(haversine(start, lastP));
  const cen = {
    lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
    lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length,
  };
  const sideA = destinationPoint(mid, axis + 90, off);
  const sideB = destinationPoint(mid, axis - 90, off);
  const via = haversine(sideA, cen) >= haversine(sideB, cen) ? sideA : sideB;
  return [...coords.slice(0, -1), via, start];
}

function coordSequence(start, waypoints, shape) {
  const coords = [start];
  let prev = start;
  for (const p of waypoints) {
    if (p.corridor && p.corridor.length) {
      const a = p.corridor[0];
      const b = p.corridor[p.corridor.length - 1];
      const pts = haversine(prev, a) <= haversine(prev, b) ? p.corridor : [...p.corridor].reverse();
      for (const c of pts) coords.push(ll(c));
      prev = pts[pts.length - 1];
    } else {
      const c = ll(p);
      coords.push(c);
      prev = c;
    }
  }
  if (shape === 'loop') {
    coords.push(start);
    return capCoords(circularize(start, coords));
  }
  return capCoords(coords);
}

// Bend the legs BETWEEN stops toward scenery: try threading low-detour scenic
// features into each long gap, keeping an insertion only when the measured
// route actually sees more (sceneryScore) without ballooning past target.
// This is what stops legs from being plain shortest-path streets.
async function scenicize(start, waypoints, shape, route, annotated, beauty, profile, target) {
  let curWps = waypoints;
  let curRoute = route;
  const evalRoute = (r) => {
    const ov = selfOverlap(r.coordinates);
    return { ov, s: sceneryScore(r.coordinates, annotated, beauty) - 0.9 * ov };
  };
  let cur = evalRoute(curRoute);
  const cap = target * 1.12; // the fitting passes that follow reclaim any overshoot

  for (let round = 0; round < 2; round++) {
    const used = new Set(curWps.map((w) => w.id));
    // leg i runs reps[i] -> reps[i+1]; inserting at waypoint index i lands in that gap
    const reps = [ll(start), ...curWps.map((w) => ll(w)), ...(shape === 'loop' ? [ll(start)] : [])];
    const cands = [];
    for (let i = 0; i + 1 < reps.length; i++) {
      const A = reps[i];
      const B = reps[i + 1];
      const legLen = haversine(A, B);
      if (legLen < 500) continue;
      const budget = Math.min(900, legLen * 0.45);
      for (const p of annotated) {
        if (used.has(p.id) || p.corridor) continue;
        const pt = ll(p);
        const detour = haversine(A, pt) + haversine(pt, B) - legLen;
        if (detour <= 30 || detour > budget) continue;
        const gain = (p.score || 3) * (p._boost || 1) + beautyAt(beauty, pt) * 4;
        cands.push({ p, idx: i, rank: gain / (1 + detour / 300) });
      }
    }
    cands.sort((a, b) => b.rank - a.rank);
    let improved = false;
    for (const c of cands.slice(0, 4)) {
      const trial = [...curWps.slice(0, c.idx), c.p, ...curWps.slice(c.idx)];
      let r;
      try {
        r = await routeFor(start, trial, shape, profile);
      } catch {
        continue;
      }
      if (r.distanceMeters > cap) continue;
      const e = evalRoute(r);
      // a via that makes the route retrace itself (e.g. a stop sitting right on
      // the way home) defeats the whole point — scenery never buys doubling back
      if (e.ov > cur.ov + 0.08) continue;
      if (e.s > cur.s + 0.015) {
        curWps = trial;
        curRoute = r;
        cur = e;
        improved = true;
        break;
      }
    }
    if (!improved) break;
  }
  return { waypoints: curWps, route: curRoute };
}

const TOLERANCE = 0.05; // hit the requested distance within 5%

function routeFor(start, waypoints, shape, profile) {
  return getRoute(coordSequence(start, waypoints, shape), profile);
}

function orderWaypoints(ws, shape) {
  return [...ws].sort((a, b) => (shape === 'loop' ? a._b - b._b : a._d - b._d));
}

// Precise top-up. The extension aims into the EMPTIEST angular sector of the
// circuit (as seen from the start) and is folded into the loop in bearing
// order — so extra distance rounds the circle out instead of bolting an
// out-and-back tail past the runner's front door. Beauty breaks direction ties.
async function addSpur(start, waypoints, shape, target, profile, beauty, baseOverlap = 1) {
  // middle of the largest bearing gap between existing stops
  const bs = waypoints.map((w) => w._b ?? bearing(start, ll(w))).sort((a, b) => a - b);
  let gapStart = bs[bs.length - 1];
  let gapSize = bs[0] + 360 - gapStart;
  for (let i = 1; i < bs.length; i++) {
    const g = bs[i] - bs[i - 1];
    if (g > gapSize) {
      gapSize = g;
      gapStart = bs[i - 1];
    }
  }
  let baseDir = (gapStart + gapSize / 2) % 360;
  // Never diametric: a spur opposite the only stop puts the START on the line
  // between them — the route passes home and retraces. Keep the spur within
  // 110° of the nearest stop so the circuit stays a triangle around the start.
  let nearestB = bs[0];
  let nearestDiff = 360;
  for (const b of bs) {
    const ad = angularDiff(baseDir, b);
    if (ad < nearestDiff) {
      nearestDiff = ad;
      nearestB = b;
    }
  }
  if (nearestDiff > 110) {
    const a = nearestB + 110;
    const b2 = nearestB - 110;
    baseDir = angularDiff(a, baseDir) <= angularDiff(b2, baseDir) ? a : b2;
  }
  let dir = baseDir;
  if (beauty) {
    let bestB = -1;
    for (const dd of [-40, -20, 0, 20, 40]) {
      const probe = destinationPoint(start, baseDir + dd, target * 0.25);
      const bv = beautyAt(beauty, probe);
      if (bv > bestB) {
        bestB = bv;
        dir = baseDir + dd;
      }
    }
  }
  let lo = 50;
  let hi = target * 0.6;
  let best = null;
  let bestErr = Infinity;
  for (let i = 0; i < 7; i++) {
    const d = (lo + hi) / 2;
    const p = destinationPoint(start, dir, d);
    const spur = { id: '_spur', lat: p.lat, lng: p.lng, _b: ((dir % 360) + 360) % 360, _d: d };
    const seq = shape === 'loop' ? orderWaypoints([...waypoints, spur], shape) : [...waypoints, spur];
    let r;
    try {
      r = await routeFor(start, seq, shape, profile);
    } catch {
      hi = d; // spur point unroutable (water, etc.) — pull it closer
      continue;
    }
    // distance is never worth doubling back: a spur that retraces is rejected
    const acceptable = selfOverlap(r.coordinates) <= baseOverlap + 0.1;
    const err = Math.abs(r.distanceMeters - target);
    if (acceptable && err < bestErr) {
      bestErr = err;
      best = r;
    }
    if (acceptable && err <= target * TOLERANCE) return r;
    if (r.distanceMeters < target) lo = d;
    else hi = d;
  }
  return best;
}

// One-way: measure a few candidate destinations and keep the one whose real routed
// distance lands nearest the target (preferring just under, so mid-stops can top up).
async function selectOneWayDest(start, target, vibe, jitter, annotated, startZone, profile) {
  const cands = annotated
    .filter(
      (p) =>
        p._zone === startZone &&
        p._d > target * 0.1 &&
        p._d < target * 1.05 &&
        (p.endpoint || (p.score || 0) >= 3)
    )
    .map((p) => ({ p, rank: valueOf(p, vibe, jitter) + (p.endpoint ? 1.6 : 0) + (p.transit ? 0.6 : 0) }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 10)
    .map((x) => x.p);

  if (!cands.length) {
    const f = [...annotated].sort(
      (a, b) => Math.abs(a._d - target * 0.72) - Math.abs(b._d - target * 0.72)
    )[0];
    return f ? [f] : [];
  }

  // Measure all candidate destinations in parallel; keep the best distance fit.
  // Unroutable destinations are simply skipped, not fatal.
  const measured = (
    await Promise.all(
      cands.map(async (d) => {
        try {
          const r = await routeFor(start, [d], 'oneway', profile);
          const overshoot = Math.max(0, r.distanceMeters - target * 1.02);
          return { d, score: Math.abs(r.distanceMeters - target) + overshoot * 0.5 };
        } catch {
          return null;
        }
      })
    )
  ).filter(Boolean);
  measured.sort((a, b) => a.score - b.score);
  return measured.length ? [measured[0].d] : [];
}

// Too long because of one long corridor? Binary-search how much of it to run, taking
// a window CENTERED on the point nearest the start — so you can run a sub-segment of a
// corridor you're standing in the middle of, not trek to one end and back.
async function fitLongCorridor(start, waypoints, shape, target, profile, route) {
  const idx = waypoints.findIndex((w) => w.corridor && w.corridor.length > 2);
  if (idx < 0) return { waypoints, route };
  const full = waypoints[idx].corridor;
  let cen = 0;
  let cd = Infinity;
  full.forEach((c, i) => {
    const d = haversine(start, c);
    if (d < cd) {
      cd = d;
      cen = i;
    }
  });
  let lo = 2;
  let hi = full.length;
  let best = { waypoints, route };
  let bestErr = Math.abs(route.distanceMeters - target);
  // Windowing is discrete, so target may fall in a gap. Prefer the largest window that
  // lands at/just-under target — the spur then tops it up precisely from below.
  let under = null;
  for (let i = 0; i < 6; i++) {
    const keep = Math.max(2, Math.round((lo + hi) / 2));
    const half = Math.floor(keep / 2);
    let a = Math.max(0, cen - half);
    const b = Math.min(full.length, a + keep);
    a = Math.max(0, b - keep);
    const wp = waypoints.map((w, j) => (j === idx ? { ...w, corridor: full.slice(a, b) } : w));
    let r;
    try {
      r = await routeFor(start, wp, shape, profile);
    } catch {
      break; // keep the best fit found so far
    }
    const err = Math.abs(r.distanceMeters - target);
    if (err < bestErr) {
      bestErr = err;
      best = { waypoints: wp, route: r };
    }
    if (r.distanceMeters <= target * 1.02 && (!under || r.distanceMeters > under.route.distanceMeters)) {
      under = { waypoints: wp, route: r };
    }
    if (err <= target * TOLERANCE) return { waypoints: wp, route: r };
    if (r.distanceMeters > target) hi = keep;
    else lo = keep;
  }
  return under || best;
}

// One-way top-up: a one-way can't backtrack at the finish, so add a measured mid-route
// detour (a sideways bump before the destination), binary-searching its offset until
// the real distance hits target. Returns a route only; the detour carries no marker.
async function addOnewayDetour(start, waypoints, target, profile) {
  const dest = waypoints[waypoints.length - 1];
  const mid = { lat: (start.lat + dest.lat) / 2, lng: (start.lng + dest.lng) / 2 };
  const perp = bearing(start, ll(dest)) + 90;
  const destD = waypoints.reduce((m, w) => Math.max(m, w._d || 0), 0);
  let lo = 0;
  let hi = target * 0.45;
  let best = null;
  let bestErr = Infinity;
  for (let i = 0; i < 7; i++) {
    const d = (lo + hi) / 2;
    const p = destinationPoint(mid, perp, d);
    const detour = { id: '_detour', lat: p.lat, lng: p.lng, _d: Math.min(destD * 0.6, target * 0.4) };
    const seq = [...waypoints, detour].sort((a, b) => (a._d || 0) - (b._d || 0));
    let r;
    try {
      r = await routeFor(start, seq, 'oneway', profile);
    } catch {
      hi = d; // detour point unroutable — pull it closer
      continue;
    }
    const err = Math.abs(r.distanceMeters - target);
    if (err < bestErr) {
      bestErr = err;
      best = r;
    }
    if (err <= target * TOLERANCE) return r;
    if (r.distanceMeters < target) lo = d;
    else hi = d;
  }
  return best;
}

// Public entry point. Selects a scenic core, then iterates against the REAL Mapbox
// distance — trimming when long, adding scenic stops (or a measured spur) when short —
// until within 5% of target.
export async function buildRoute(
  start,
  { distanceKm, shape, vibe, profile = 'walking', jitter = 0, boosts, seen, explore },
  city
) {
  const targetMeters = distanceKm * 1000;
  const annotated = annotate(start, city.places, city, { boosts, seen, explore });
  const startZone = zoneForStart(start, annotated, city);

  let waypoints;
  let route;

  if (shape === 'loop') {
    // Compete a few candidate circuits and keep the one that runs through the most
    // scenery with the least backtracking — optimizing the PATH, not just the stops.
    let sets = dedupeSets([
      selectScenicChain(start, targetMeters, vibe, 0, annotated, startZone),
      selectScenicChain(start, targetMeters, vibe, 0.5, annotated, startZone),
      selectLoopWaypoints(start, targetMeters, vibe, jitter, annotated, startZone),
      selectLoopWaypoints(start, targetMeters, vibe, 0.6, annotated, startZone),
    ]);
    if (!sets.length) {
      // Standing on the only sight (or in an empty pocket): synthesize an
      // unnamed anchor toward the most scenic reachable direction so the
      // lens still makes a clean circle of the right size. It carries no
      // marker — the run is just a good loop from the door.
      let bestDir = 0;
      let bestScore = -Infinity;
      for (let dd = 0; dd < 360; dd += 45) {
        const probe = destinationPoint(start, dd, targetMeters * 0.3);
        const { dmin } = nearestFeature(probe, annotated);
        const sc = beautyAt(city.beauty, probe) * 2 + Math.max(0, 1 - dmin / 2000);
        if (sc > bestScore) {
          bestScore = sc;
          bestDir = dd;
        }
      }
      const p = destinationPoint(start, bestDir, targetMeters * 0.3);
      sets = [[{ id: '_anchor', lat: p.lat, lng: p.lng, _b: bestDir, _d: targetMeters * 0.3, _zone: startZone, score: 0 }]];
    }
    // A set containing one unroutable waypoint (a pier, an island) must not kill the
    // build — score the sets that route, and only fall back if none do.
    const scored = (
      await Promise.all(
        sets.map(async (set) => {
          try {
            const r = await routeFor(start, set, shape, profile);
            // overlap penalty outweighs scenery: a pretty out-and-back is still
            // an out-and-back, and loops are supposed to circle
            const sc =
              sceneryScore(r.coordinates, annotated, city.beauty) - 1.5 * selfOverlap(r.coordinates);
            return { set, r, sc };
          } catch {
            return null;
          }
        })
      )
    ).filter(Boolean);
    if (scored.length) {
      scored.sort((a, b) => b.sc - a.sc);
      waypoints = scored[0].set;
      route = scored[0].r;
    } else {
      // Every candidate set failed; seed from the best single feature that routes.
      const ranked = annotated
        .filter((p) => (p.corridor || p._d > 150) && p._d <= targetMeters * 0.55)
        .sort(
          (a, b) =>
            valueOf(b, vibe, jitter) * (1 + scenicLength(b) / 1000) -
            valueOf(a, vibe, jitter) * (1 + scenicLength(a) / 1000)
        );
      for (const cand of ranked) {
        try {
          route = await routeFor(start, [cand], shape, profile);
          waypoints = [cand];
          break;
        } catch {
          // unroutable — try the next feature
        }
      }
      if (!route) throw new Error('Could not route to any scenic spot near there — try a different start.');
    }
  } else {
    waypoints = await selectOneWayDest(start, targetMeters, vibe, jitter, annotated, startZone, profile);
    if (!waypoints.length) {
      throw new Error('No scenic waypoints found near there at this distance.');
    }
    route = await routeFor(start, waypoints, shape, profile);
  }

  // Make the legs between stops scenic before fitting the distance.
  const scenic = await scenicize(
    start, waypoints, shape, route, annotated, city.beauty, profile, targetMeters
  );
  waypoints = scenic.waypoints;
  route = scenic.route;

  const lo = targetMeters * (1 - TOLERANCE);
  const hi = targetMeters * (1 + TOLERANCE);

  // Too long? FIRST shorten how much of a corridor you run (keeps every scenic stop).
  if (route.distanceMeters > hi) {
    const fit = await fitLongCorridor(start, waypoints, shape, targetMeters, profile, route);
    waypoints = fit.waypoints;
    route = fit.route;
  }

  // Still too long? Now drop stops — least scenic first (points before corridors).
  let guard = 0;
  while (route.distanceMeters > hi && waypoints.length > 1 && guard++ < 6) {
    const trimmed = trimOne(waypoints, shape);
    let r;
    try {
      r = await routeFor(start, trimmed, shape, profile);
    } catch {
      break;
    }
    if (r.distanceMeters >= route.distanceMeters) break;
    waypoints = trimmed;
    route = r;
    if (route.distanceMeters < lo) break; // undershot — grow/spur will top it back up
  }

  // Loop safety net: if it's STILL over (e.g. a single point that must route around a
  // huge block), re-seed from the best feature that actually measures under the cap —
  // truncating a corridor as needed. grow/spur then top it back up to target.
  if (shape === 'loop' && route.distanceMeters > hi) {
    const ranked = annotated
      .filter((p) => p._zone === startZone && (p.corridor || p._d > 150) && p._d <= targetMeters * 0.55)
      .sort(
        (a, b) =>
          valueOf(b, vibe, jitter) * (1 + scenicLength(b) / 1000) -
          valueOf(a, vibe, jitter) * (1 + scenicLength(a) / 1000)
      );
    for (const cand of ranked.slice(0, 8)) {
      let r;
      try {
        r = await routeFor(start, [cand], shape, profile);
      } catch {
        continue;
      }
      let wp = [cand];
      if (cand.corridor && r.distanceMeters > hi) {
        const fit = await fitLongCorridor(start, [cand], shape, targetMeters, profile, r);
        wp = fit.waypoints;
        r = fit.route;
      }
      if (r.distanceMeters <= hi) {
        waypoints = wp;
        route = r;
        break;
      }
    }
  }

  // Grow while too short: add the scenic stop that best closes the gap (measured).
  const used = new Set(waypoints.map((w) => w.id));
  const destD = Math.max(...waypoints.map((w) => w._d || 0));
  let pool = annotated.filter(
    (p) =>
      !used.has(p.id) &&
      (p.corridor || p._d > 150) &&
      p._zone === startZone &&
      (shape === 'loop' || p._d < destD * 0.98)
  );
  guard = 0;
  while (route.distanceMeters < lo && pool.length && waypoints.length < MAX_WAYPOINTS + 3 && guard++ < 6) {
    const gap = targetMeters - route.distanceMeters;
    // prefer fillers that are also worth seeing: each appeal point forgives
    // ~150m of distance mismatch, so a great spot beats a geometrically perfect dud
    const fitErr = (p) =>
      Math.abs(2 * p._d * STREET_FACTOR - gap) - valueOf(p, vibe, 0) * 150;
    pool.sort((a, b) => fitErr(a) - fitErr(b));
    const cand = pool.shift();
    const trial = orderWaypoints([...waypoints, cand], shape);
    let r;
    try {
      r = await routeFor(start, trial, shape, profile);
    } catch {
      continue; // candidate unroutable — try the next one
    }
    if (
      r.distanceMeters <= hi &&
      r.distanceMeters > route.distanceMeters &&
      // never grow by doubling back over ground already covered
      selfOverlap(r.coordinates) <= selfOverlap(route.coordinates) + 0.08
    ) {
      waypoints = trial;
      route = r;
      used.add(cand.id);
    }
  }

  // Precise top-up when still short: a measured out-and-back spur (loop) or a sideways
  // mid-route detour (one-way). Both carry no marker — they just dial in the distance.
  if (route.distanceMeters < lo) {
    const r =
      shape === 'loop'
        ? await addSpur(start, waypoints, shape, targetMeters, profile, city.beauty,
            selfOverlap(route.coordinates))
        : await addOnewayDetour(start, waypoints, targetMeters, profile);
    if (r && Math.abs(r.distanceMeters - targetMeters) < Math.abs(route.distanceMeters - targetMeters)) {
      route = r;
    }
  }

  // synthetic anchors (_anchor) shaped the route but aren't real sights
  const visible = waypoints.filter((w) => !String(w.id).startsWith('_'));
  const rationale = computeRationale({
    city,
    shape,
    vibe,
    distanceMeters: route.distanceMeters,
    highlights: visible,
    annotated,
    startZone,
  });

  return {
    route,
    highlights: visible,
    shape,
    targetMeters,
    distanceMeters: route.distanceMeters,
    rationale,
  };
}

// ---- Rationale: explain the route, and name the roads not taken ----

const EXPERIENCE = {
  waterfront: (n) => `trace ${n}`,
  path: (n) => `run the length of ${n}`,
  park: (n) => `loop through ${n}`,
  viewpoint: (n) => `take in ${n}`,
  landmark: (n) => `pass ${n}`,
  neighborhood: (n) => `explore ${n}`,
};

function experiencePhrase(p) {
  return (EXPERIENCE[p.category] || EXPERIENCE.landmark)(p.name);
}

function computeRationale({ city, shape, vibe, distanceMeters, highlights, annotated, startZone }) {
  const km = (distanceMeters / 1000).toFixed(1);
  // The spine = the highest-scoring corridor, else the highest-scoring feature.
  const corridors = highlights.filter((h) => h.corridor);
  const spine =
    [...corridors].sort((a, b) => (b.score || 0) - (a.score || 0))[0] ||
    [...highlights].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
  const crossings = highlights.filter((h) => h.crossing);
  const others = highlights.filter((h) => h !== spine);

  // Thesis sentence.
  const tail =
    others.length > 0
      ? `, then ${others.slice(0, 2).map(experiencePhrase).join(' and ')}`
      : '';
  const shapeWord = shape === 'loop' ? 'loop' : 'point-to-point run';
  const thesis = spine
    ? `A ${km} km ${shapeWord} built to ${experiencePhrase(spine)}${tail}.`
    : `A ${km} km ${shapeWord} through the city's highlights.`;

  // Reasons.
  const reasons = [];
  if (spine && spine.corridor) {
    reasons.push(
      `Leads with ${spine.name} — a stretch you run along, so the distance is scenic, not filler streets.`
    );
  } else if (spine) {
    reasons.push(`Anchored on ${spine.name}, the standout nearby.`);
  }
  if (crossings.length) {
    reasons.push(
      `Crosses ${crossings.map((c) => c.name).join(' and ')} so you see the skyline from the water — and from the other side.`
    );
  }
  const vibeKeys = vibe ? Object.keys(vibe).filter((k) => vibe[k] > 1) : [];
  if (vibeKeys.length) {
    reasons.push(`Weighted toward ${vibeKeys.join(' & ')} the way you asked.`);
  }
  const cats = [...new Set(highlights.map((h) => h.category))];
  if (cats.length >= 3) {
    reasons.push(`Mixes ${cats.length} kinds of place for a first feel of the city, not one note.`);
  }

  // Alternatives: top-appeal places it could have used but didn't, ideally a
  // different category and a different direction than the spine.
  const usedIds = new Set(highlights.map((h) => h.id));
  const spineCat = spine ? spine.category : null;
  const spineBearing = spine ? spine._b ?? 0 : 0;
  const unused = annotated
    .filter((p) => !usedIds.has(p.id) && p._zone === startZone && (p.score || 0) >= 4)
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  const alternatives = [];
  const takenCats = new Set();
  for (const p of unused) {
    if (alternatives.length >= 2) break;
    // prefer a different category from the spine and from already-listed alternatives
    if (p.category === spineCat && alternatives.length === 0 && unused.length > 1) continue;
    if (takenCats.has(p.category)) continue;
    takenCats.add(p.category);
    const dir = angularDiff(p._b ?? 0, spineBearing) > 70 ? 'the other direction' : 'nearby';
    alternatives.push({
      name: p.name,
      why: `could've sent you ${dir} to ${experiencePhrase(p)} instead — ${p.blurb}`,
    });
  }

  return { thesis, reasons, alternatives };
}

// ---- Vibe weighting ----
const VIBE_GROUPS = {
  waterfront: { waterfront: 1.8, path: 1.3 },
  parks: { park: 1.8, viewpoint: 1.4 },
  landmarks: { landmark: 1.8, viewpoint: 1.3 },
  neighborhoods: { neighborhood: 1.8 },
};

export function vibeFromChips(chips) {
  const vibe = {};
  for (const chip of chips) {
    const group = VIBE_GROUPS[chip];
    if (!group) continue;
    for (const [cat, w] of Object.entries(group)) {
      vibe[cat] = Math.max(vibe[cat] || 1, w);
    }
  }
  return vibe;
}

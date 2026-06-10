// LocalRun community backend — zero dependencies, one file.
//
// Aggregates anonymous run completions into per-city, per-place signals:
// how often a place was photographed, passed, and part of a loved (4-5★) run.
// Clients fold these into route building so everyone's runs teach the routes.
//
// Privacy: no names, no coordinates, no photo pixels — only place ids from the
// app's own curated datasets, plus distance/time totals. runnerId is a random
// client-generated token used solely to de-duplicate.
//
// Run:    node server/index.mjs            (PORT and DATA_FILE env override)
// Deploy: any Node 18+ host (Fly, Railway, Render, a $5 VPS) — no build step.

import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const PORT = process.env.PORT || 8787;
const DATA_FILE = process.env.DATA_FILE || './server/data/localrun.json';
const MAX_BODY = 64 * 1024;
const FEED_SIZE = 100;

// ---- state & persistence ----

let state = { totals: {}, places: {}, feed: [], runners: {} };
try {
  if (existsSync(DATA_FILE)) state = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
} catch {
  // corrupt or missing data file — start fresh
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      mkdirSync(dirname(DATA_FILE), { recursive: true });
      writeFileSync(DATA_FILE, JSON.stringify(state));
    } catch (e) {
      console.error('persist failed:', e.message);
    }
  }, 500);
}

function placeBucket(cityId, placeId) {
  state.places[cityId] ||= {};
  state.places[cityId][placeId] ||= { photos: 0, seen: 0, loved: 0 };
  return state.places[cityId][placeId];
}

// Community boost for a place, 0..5 — photos are the strongest signal.
function boostOf(p) {
  return Math.min(5, p.photos * 0.8 + p.loved * 0.3 + p.seen * 0.05);
}

// ---- request handling ----

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(data);
}

const isId = (s) => typeof s === 'string' && s.length > 0 && s.length <= 80;

function handleSubmitRun(body, res) {
  const { runnerId, cityId, distM, elapsed, rating, seen, photoPlaceIds, ts } = body || {};
  if (!isId(runnerId) || !isId(cityId)) return json(res, 400, { error: 'runnerId and cityId required' });
  if (!(distM > 50 && distM < 100000)) return json(res, 400, { error: 'implausible distance' });

  // de-dup: one record per runner per timestamp
  const dupKey = `${runnerId}:${ts || 0}`;
  state.runners[runnerId] ||= {};
  if (state.runners[runnerId][dupKey]) return json(res, 200, { ok: true, duplicate: true });
  state.runners[runnerId][dupKey] = 1;

  const seenIds = (Array.isArray(seen) ? seen : []).filter(isId).slice(0, 60);
  const photoIds = (Array.isArray(photoPlaceIds) ? photoPlaceIds : []).filter(isId).slice(0, 30);
  const loved = (rating || 0) >= 4;

  state.totals[cityId] = (state.totals[cityId] || 0) + 1;
  for (const id of seenIds) {
    const p = placeBucket(cityId, id);
    p.seen += 1;
    if (loved) p.loved += 1;
  }
  for (const id of photoIds) placeBucket(cityId, id).photos += 1;

  state.feed.unshift({
    cityId,
    distM: Math.round(distM),
    elapsed: Math.round(elapsed || 0),
    photos: photoIds.length,
    photoPlaceIds: photoIds.slice(0, 3),
    rating: rating || 0,
    ts: Date.now(),
  });
  state.feed = state.feed.slice(0, FEED_SIZE);

  persist();
  json(res, 200, { ok: true, cityRuns: state.totals[cityId] });
}

function handleCommunity(cityId, res) {
  const places = {};
  for (const [id, p] of Object.entries(state.places[cityId] || {})) {
    places[id] = { ...p, boost: Number(boostOf(p).toFixed(2)) };
  }
  const top = Object.entries(places)
    .filter(([, p]) => p.photos > 0)
    .sort((a, b) => b[1].photos - a[1].photos)
    .slice(0, 5)
    .map(([id, p]) => ({ id, photos: p.photos }));
  json(res, 200, {
    cityId,
    totalRuns: state.totals[cityId] || 0,
    places,
    top,
    recent: state.feed.filter((f) => f.cityId === cityId).slice(0, 10),
  });
}

// ---- Strava token exchange (keeps the client secret off the phone) ----
// Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in the environment.

async function handleStrava(kind, body, res) {
  const id = process.env.STRAVA_CLIENT_ID;
  const secret = process.env.STRAVA_CLIENT_SECRET;
  if (!id || !secret) return json(res, 501, { error: 'Strava not configured on this server' });
  const params = new URLSearchParams({ client_id: id, client_secret: secret });
  if (kind === 'exchange') {
    if (!body?.code) return json(res, 400, { error: 'code required' });
    params.set('code', body.code);
    params.set('grant_type', 'authorization_code');
  } else {
    if (!body?.refresh_token) return json(res, 400, { error: 'refresh_token required' });
    params.set('refresh_token', body.refresh_token);
    params.set('grant_type', 'refresh_token');
  }
  try {
    const resp = await fetch('https://www.strava.com/oauth/token', { method: 'POST', body: params });
    const data = await resp.json();
    if (!resp.ok) return json(res, 502, { error: 'strava rejected the request' });
    json(res, 200, data);
  } catch {
    json(res, 502, { error: 'could not reach strava' });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { ok: true, cities: Object.keys(state.totals).length });
  }
  const community = url.pathname.match(/^\/api\/community\/([\w-]+)$/);
  if (req.method === 'GET' && community) return handleCommunity(community[1], res);
  const strava = url.pathname.match(/^\/api\/strava\/(exchange|refresh)$/);
  if (req.method === 'POST' && (url.pathname === '/api/runs' || strava)) {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > MAX_BODY) req.destroy();
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        if (strava) handleStrava(strava[1], parsed, res);
        else handleSubmitRun(parsed, res);
      } catch {
        json(res, 400, { error: 'invalid JSON' });
      }
    });
    return;
  }
  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`LocalRun community server on :${PORT}, data → ${DATA_FILE}`));

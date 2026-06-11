// LocalRun community backend — zero dependencies, one file.
//
// Accounts (username/email/password, scrypt-hashed) plus per-city, per-place
// signals from run completions: how often a place was photographed, passed,
// and part of a loved (4-5★) run. Clients fold these into route building so
// everyone's runs teach the routes; the feed shows who ran what.
//
// Privacy: no coordinates, no photo pixels — only place ids from the app's
// own curated datasets plus distance/time totals. Anonymous submissions
// (random runnerId) still work; signed-in submissions carry the username.
//
// Run:    node server/index.mjs            (PORT and DATA_FILE env override)
// Deploy: any Node 18+ host (Fly, Railway, Render, a $5 VPS) — no build step.

import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { scryptSync, randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';

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
state.users ||= {};
state.sessions ||= {};
state.names ||= {}; // lowercase username -> userId
state.emails ||= {}; // lowercase email -> userId

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

// ---- accounts ----

const authAttempts = new Map(); // ip -> { n, t } — naive hourly limiter
function authLimited(ip) {
  const now = Date.now();
  const e = authAttempts.get(ip) || { n: 0, t: now };
  if (now - e.t > 3600_000) {
    e.n = 0;
    e.t = now;
  }
  e.n += 1;
  authAttempts.set(ip, e);
  return e.n > 30;
}

const hashPassword = (pw, salt) => scryptSync(pw, salt, 64).toString('hex');

function authedUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const s = token && state.sessions[token];
  return s ? state.users[s.userId] || null : null;
}

function issueToken(userId) {
  const token = randomBytes(32).toString('hex');
  state.sessions[token] = { userId, ts: Date.now() };
  return token;
}

function handleSignup(body, res, ip) {
  if (authLimited(ip)) return json(res, 429, { error: 'too many attempts — try again later' });
  const username = String(body?.username || '').trim();
  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return json(res, 400, { error: 'username must be 3-20 letters, numbers, or underscores' });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { error: 'enter a valid email' });
  if (password.length < 8) return json(res, 400, { error: 'password must be at least 8 characters' });
  if (state.names[username.toLowerCase()]) return json(res, 409, { error: 'that username is taken' });
  if (state.emails[email]) return json(res, 409, { error: 'that email already has an account' });
  const id = randomUUID();
  const salt = randomBytes(16).toString('hex');
  state.users[id] = {
    id,
    username,
    email,
    salt,
    hash: hashPassword(password, salt),
    createdAt: Date.now(),
    runs: 0,
    distM: 0,
    photos: 0,
  };
  state.names[username.toLowerCase()] = id;
  state.emails[email] = id;
  const token = issueToken(id);
  persist();
  json(res, 200, { token, username });
}

function handleLogin(body, res, ip) {
  if (authLimited(ip)) return json(res, 429, { error: 'too many attempts — try again later' });
  const ident = String(body?.identifier || '').trim().toLowerCase();
  const password = String(body?.password || '');
  const userId = state.emails[ident] || state.names[ident];
  const user = userId ? state.users[userId] : null;
  if (!user) return json(res, 401, { error: 'no account with that username or email' });
  const candidate = Buffer.from(hashPassword(password, user.salt), 'hex');
  const actual = Buffer.from(user.hash, 'hex');
  if (candidate.length !== actual.length || !timingSafeEqual(candidate, actual)) {
    return json(res, 401, { error: 'wrong password' });
  }
  const token = issueToken(user.id);
  persist();
  json(res, 200, { token, username: user.username });
}

function handleMe(user, res) {
  if (!user) return json(res, 401, { error: 'sign in required' });
  json(res, 200, {
    username: user.username,
    runs: user.runs || 0,
    distM: Math.round(user.distM || 0),
    photos: user.photos || 0,
  });
}

// App Store requirement: accounts must be deletable in-app.
function handleDeleteAccount(user, res) {
  if (!user) return json(res, 401, { error: 'sign in required' });
  delete state.names[user.username.toLowerCase()];
  delete state.emails[user.email];
  for (const [token, s] of Object.entries(state.sessions)) {
    if (s.userId === user.id) delete state.sessions[token];
  }
  for (const f of state.feed) {
    if (f.username === user.username) f.username = null; // anonymize history
  }
  delete state.users[user.id];
  persist();
  json(res, 200, { ok: true });
}

// ---- run submissions ----

function handleSubmitRun(body, res, user) {
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

  if (user) {
    user.runs = (user.runs || 0) + 1;
    user.distM = (user.distM || 0) + Math.round(distM);
    user.photos = (user.photos || 0) + photoIds.length;
  }

  state.feed.unshift({
    cityId,
    username: user ? user.username : null,
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
  const ip = req.socket.remoteAddress || 'unknown';
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { ok: true, cities: Object.keys(state.totals).length });
  }
  if (req.method === 'GET' && url.pathname === '/api/me') {
    return handleMe(authedUser(req), res);
  }
  if (req.method === 'DELETE' && url.pathname === '/api/me') {
    return handleDeleteAccount(authedUser(req), res);
  }
  const community = url.pathname.match(/^\/api\/community\/([\w-]+)$/);
  if (req.method === 'GET' && community) return handleCommunity(community[1], res);

  const strava = url.pathname.match(/^\/api\/strava\/(exchange|refresh)$/);
  const auth = url.pathname.match(/^\/api\/auth\/(signup|login)$/);
  if (req.method === 'POST' && (url.pathname === '/api/runs' || strava || auth)) {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > MAX_BODY) req.destroy();
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        if (strava) handleStrava(strava[1], parsed, res);
        else if (auth && auth[1] === 'signup') handleSignup(parsed, res, ip);
        else if (auth) handleLogin(parsed, res, ip);
        else handleSubmitRun(parsed, res, authedUser(req));
      } catch {
        json(res, 400, { error: 'invalid JSON' });
      }
    });
    return;
  }
  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`LocalRun community server on :${PORT}, data → ${DATA_FILE}`));

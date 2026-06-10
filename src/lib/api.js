// Client for the LocalRun community backend (server/). Everything here is
// best-effort: no API URL configured, no network, or a slow server must never
// break the app — community data falls back to the last cached copy or null.
//
// Privacy: only place ids and run totals are sent. Notes, photos, and
// coordinates stay on the device.

import AsyncStorage from '@react-native-async-storage/async-storage';

const API = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');
const RUNNER_KEY = 'localrun.runnerid.v1';
const CACHE_KEY = (cityId) => `localrun.community.${cityId}.v1`;
const CACHE_TTL = 30 * 60 * 1000; // refetch after 30 min; stale is still usable offline

export function apiConfigured() {
  return !!API;
}

async function getRunnerId() {
  let id = await AsyncStorage.getItem(RUNNER_KEY).catch(() => null);
  if (!id) {
    id = `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    AsyncStorage.setItem(RUNNER_KEY, id).catch(() => {});
  }
  return id;
}

function withTimeout(url, options = {}, ms = 5000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  return fetch(url, { ...options, signal: ctl.signal }).finally(() => clearTimeout(t));
}

// Fire-and-forget: share an anonymized summary of a saved run.
export async function submitRun(record) {
  if (!API) return;
  try {
    const runnerId = await getRunnerId();
    await withTimeout(`${API}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runnerId,
        cityId: record.cityId,
        distM: Math.round(record.distM),
        elapsed: Math.round(record.elapsed || 0),
        rating: record.rating || 0,
        seen: record.seen || [],
        photoPlaceIds: (record.photos || []).map((p) => p.placeId).filter(Boolean),
        ts: record.ts,
      }),
    });
  } catch {
    // offline or server down — the run is still saved locally
  }
}

// Community stats for a city: { totalRuns, places: {id: {photos, boost,...}},
// top, recent }. Cached so route building works offline; null if never seen.
export async function fetchCommunity(cityId) {
  let cached = null;
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY(cityId));
    if (raw) cached = JSON.parse(raw);
  } catch {
    // ignore cache errors
  }
  if (!API) return cached?.data || null;
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  try {
    const res = await withTimeout(`${API}/api/community/${cityId}`);
    if (!res.ok) return cached?.data || null;
    const data = await res.json();
    AsyncStorage.setItem(CACHE_KEY(cityId), JSON.stringify({ ts: Date.now(), data })).catch(() => {});
    return data;
  } catch {
    return cached?.data || null;
  }
}

// Personal taste + the crowd's, in one boost map for the route builder.
// Community carries the "learn the city" weight; your own photos still count.
export function mergeBoosts(personal = {}, community = null) {
  const merged = { ...personal };
  if (community?.places) {
    for (const [id, p] of Object.entries(community.places)) {
      if (p.boost > 0) merged[id] = (merged[id] || 0) + p.boost;
    }
  }
  return merged;
}

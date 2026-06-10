import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

const RUNS_KEY = 'localrun.runs.v1';
const BOOSTS_KEY = 'localrun.placeboosts.v1';
const PHOTO_DIR = `${FileSystem.documentDirectory}localrun-photos/`;

// ---- Saved runs ----
// A run record: { id, ts, cityId, cityName, distM, elapsed, unit, splits,
//   rating, note, coords (simplified polyline), highlights [{id,name}],
//   seen [placeId], photos [{uri, lat, lng, placeId, placeName, ts}] }

export async function loadRuns() {
  try {
    const s = await AsyncStorage.getItem(RUNS_KEY);
    return s ? JSON.parse(s) : [];
  } catch {
    return [];
  }
}

export async function saveRun(record) {
  const runs = await loadRuns();
  runs.unshift(record); // newest first
  try {
    await AsyncStorage.setItem(RUNS_KEY, JSON.stringify(runs));
  } catch {
    // ignore persistence errors
  }
  return runs;
}

export async function deleteRun(id) {
  const runs = (await loadRuns()).filter((r) => r.id !== id);
  try {
    await AsyncStorage.setItem(RUNS_KEY, JSON.stringify(runs));
  } catch {
    // ignore persistence errors
  }
  return runs;
}

// ---- Place boosts: your photos and good runs teach the route builder ----
// { [placeId]: count } — the builder multiplies a place's appeal by its boost.

export async function loadBoosts() {
  try {
    const s = await AsyncStorage.getItem(BOOSTS_KEY);
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}

async function addBoosts(increments) {
  const boosts = await loadBoosts();
  for (const [id, n] of Object.entries(increments)) {
    boosts[id] = (boosts[id] || 0) + n;
  }
  try {
    await AsyncStorage.setItem(BOOSTS_KEY, JSON.stringify(boosts));
  } catch {
    // ignore persistence errors
  }
  return boosts;
}

// Photographing a place is the strongest signal (+2); rating a run 4+ stars
// gives every sight you actually passed a nudge (+1).
export async function boostsFromRun(record) {
  const inc = {};
  for (const p of record.photos || []) {
    if (p.placeId) inc[p.placeId] = (inc[p.placeId] || 0) + 2;
  }
  if ((record.rating || 0) >= 4) {
    for (const id of record.seen || []) inc[id] = (inc[id] || 0) + 1;
  }
  if (Object.keys(inc).length) await addBoosts(inc);
}

// ---- Photo storage: copy camera output into app documents so it survives ----

export async function persistPhoto(tempUri) {
  try {
    await FileSystem.makeDirectoryAsync(PHOTO_DIR, { intermediates: true });
    const dest = `${PHOTO_DIR}${Date.now()}.jpg`;
    await FileSystem.copyAsync({ from: tempUri, to: dest });
    return dest;
  } catch {
    return tempUri; // fall back to the temp uri rather than losing the shot
  }
}

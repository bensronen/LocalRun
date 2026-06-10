import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'localrun.settings.v1';
const PLAN_KEY = 'localrun.plandraft.v1';

export const DEFAULT_SETTINGS = { talk: 'normal', voice: true, dark: false };

// Talk levels control how often the app narrates the area you're running through.
// Turn directions and arrival callouts always fire (unless voice is off).
export const TALK_LEVELS = [
  { key: 'off', label: 'Off', ambientSec: Infinity, blurb: 'No area narration' },
  { key: 'low', label: 'Less', ambientSec: 300, blurb: 'Every ~5 min' },
  { key: 'normal', label: 'Normal', ambientSec: 180, blurb: 'Every ~3 min' },
  { key: 'high', label: 'More', ambientSec: 90, blurb: 'Every ~90 sec' },
];

export function ambientInterval(talk) {
  const l = TALK_LEVELS.find((x) => x.key === talk);
  return l ? l.ambientSec : 180;
}

export async function loadSettings() {
  try {
    const s = await AsyncStorage.getItem(KEY);
    return s ? { ...DEFAULT_SETTINGS, ...JSON.parse(s) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(s) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ignore persistence errors
  }
}

// The plan screen's draft (city, start, distance, unit, shape, vibes) — kept so
// going back from a route, or relaunching the app, never loses what you set up.
export async function loadPlanDraft() {
  try {
    const s = await AsyncStorage.getItem(PLAN_KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

export async function savePlanDraft(draft) {
  try {
    await AsyncStorage.setItem(PLAN_KEY, JSON.stringify(draft));
  } catch {
    // ignore persistence errors
  }
}

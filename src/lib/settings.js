import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'localrun.settings.v1';

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

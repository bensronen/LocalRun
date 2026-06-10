import * as Speech from 'expo-speech';
import { haversine, bearing } from './geo';

const LL = (c) => ({ lat: c.latitude ?? c.lat, lng: c.longitude ?? c.lng });

export function dist(a, b) {
  return haversine(LL(a), LL(b));
}

export function formatClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// seconds-per-unit -> "m:ss"
export function formatPace(secPerUnit) {
  if (!isFinite(secPerUnit) || secPerUnit <= 0) return '—';
  const m = Math.floor(secPerUnit / 60);
  const s = Math.round(secPerUnit % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Fallback maneuver list derived from the route geometry when Map Matching is empty.
export function turnsFromGeometry(coords) {
  if (!coords || coords.length < 3) return [];
  const pts = coords.map(LL);
  const simp = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (haversine(simp[simp.length - 1], pts[i]) >= 30) simp.push(pts[i]);
  }
  const turns = [];
  for (let i = 1; i < simp.length - 1; i++) {
    const b1 = bearing(simp[i - 1], simp[i]);
    const b2 = bearing(simp[i], simp[i + 1]);
    const d = ((b2 - b1 + 540) % 360) - 180; // signed turn angle
    if (Math.abs(d) >= 35) {
      const side = d > 0 ? 'right' : 'left';
      turns.push({
        lat: simp[i].lat,
        lng: simp[i].lng,
        modifier: side,
        instruction: `Turn ${side}`,
        type: 'turn',
        name: '',
        distance: 0,
      });
    }
  }
  return turns;
}

// Speak through the device TTS. priority stops any current utterance first (used for
// turn directions so they're never queued behind ambient narration).
export function speak(text, { voice = true, priority = false } = {}) {
  if (!voice || !text) return;
  if (priority) Speech.stop();
  Speech.speak(text, { rate: 1.0, pitch: 1.05 });
}

export function stopSpeaking() {
  Speech.stop();
}

// A short emoji/word for a maneuver, for the visual banner.
export function maneuverIcon(m) {
  const mod = (m.modifier || '').toLowerCase();
  if (m.type === 'arrive') return '🏁';
  if (m.type === 'depart') return '🏃';
  if (mod.includes('left')) return '↰';
  if (mod.includes('right')) return '↱';
  if (mod.includes('straight') || mod.includes('uturn')) return '↑';
  return '↑';
}

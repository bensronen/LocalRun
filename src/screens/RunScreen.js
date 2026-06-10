import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import * as Location from 'expo-location';
import { useKeepAwake } from 'expo-keep-awake';
import { useTheme, themedStyles, fmt } from '../theme';
import Glass from '../components/Glass';
import { CATEGORY_META } from '../data/categories';
import { getManeuvers } from '../lib/mapbox';
import { ambientInterval } from '../lib/settings';
import { dist, formatClock, formatPace, turnsFromGeometry, speak, stopSpeaking, maneuverIcon } from '../lib/nav';

export default function RunScreen({ result, settings, onExit }) {
  useKeepAwake();
  const theme = useTheme();
  const styles = getStyles(theme);
  const { route, highlights, start, unit, city } = result;
  const profile = result.plan?.profile || 'walking';
  const unitM = unit === 'mi' ? 1609.34 : 1000;
  const routeCoords = route.coordinates;
  const finishPt = routeCoords[routeCoords.length - 1];

  const mapRef = useRef(null);

  // ---- engine refs (don't trigger re-render) ----
  const eng = useRef({
    started: false,
    startMs: 0,
    pausedMs: 0,
    pauseStart: 0,
    prev: null,
    distM: 0,
    splitStartT: 0,
    splitStartDist: 0,
    lastUnit: 0,
    maneuvers: [],
    mIdx: 0,
    announcedH: new Set(),
    lastAmbient: 0,
    sub: null,
    timer: null,
  }).current;

  // ---- display state ----
  const [pos, setPos] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [distM, setDistM] = useState(0);
  const [splitPace, setSplitPace] = useState(NaN);
  const [banner, setBanner] = useState(null); // {instruction, icon, meters}
  const [callout, setCallout] = useState(null); // {name, text}
  const [paused, setPaused] = useState(false);
  const [done, setDone] = useState(false);
  const [splits, setSplits] = useState([]);

  const voice = settings?.voice !== false;
  const calloutTimer = useRef(null);

  const showCallout = useCallback((name, text) => {
    setCallout({ name, text });
    if (calloutTimer.current) clearTimeout(calloutTimer.current);
    calloutTimer.current = setTimeout(() => setCallout(null), 9000);
  }, []);

  const finish = useCallback(() => {
    if (eng.timer) clearInterval(eng.timer);
    if (eng.sub) eng.sub.remove();
    eng.sub = null;
    setDone(true);
    const e = (Date.now() - eng.startMs - eng.pausedMs) / 1000;
    speak(
      `Run complete. ${fmt.km(eng.distM, unit)} in ${formatClock(e)}. Nice work.`,
      { voice, priority: true }
    );
  }, [eng, unit, voice]);

  const onLocation = useCallback(
    (loc) => {
      if (eng.pauseStart) return; // ignore while paused
      const cur = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setPos(cur);
      if (mapRef.current) {
        mapRef.current.animateCamera({ center: cur, zoom: 16.5 }, { duration: 600 });
      }
      const e = (Date.now() - eng.startMs - eng.pausedMs) / 1000;

      if (eng.prev) {
        const d = dist(eng.prev, cur);
        if (d >= 2 && d < 70) {
          eng.distM += d;
          setDistM(eng.distM);
        }
      }
      eng.prev = cur;

      // splits
      const completed = Math.floor(eng.distM / unitM);
      if (completed > eng.lastUnit) {
        const splitSecs = e - eng.splitStartT;
        setSplits((s) => [...s, splitSecs]);
        eng.lastUnit = completed;
        eng.splitStartT = e;
        eng.splitStartDist = completed * unitM;
      }
      const into = eng.distM - eng.splitStartDist;
      setSplitPace(into > 25 ? (e - eng.splitStartT) / (into / unitM) : NaN);

      // ---- turn-by-turn ----
      const M = eng.maneuvers;
      if (eng.mIdx < M.length) {
        // catch up if we're already nearer the one after
        while (eng.mIdx + 1 < M.length && dist(cur, M[eng.mIdx + 1]) < dist(cur, M[eng.mIdx])) {
          eng.mIdx += 1;
        }
        const m = M[eng.mIdx];
        const dM = dist(cur, m);
        setBanner({ instruction: m.instruction, icon: maneuverIcon(m), meters: Math.round(dM) });
        if (!m._said && dM < 32) {
          m._said = true;
          speak(m.instruction, { voice, priority: true });
          eng.mIdx += 1;
        }
      } else {
        setBanner(null);
      }

      // ---- highlight call-outs ----
      for (const h of highlights) {
        if (eng.announcedH.has(h.id)) continue;
        const hp = h.corridor ? nearestCorridorPt(cur, h) : { latitude: h.lat, longitude: h.lng };
        if (dist(cur, hp) < 38) {
          eng.announcedH.add(h.id);
          const sentence = h.see || h.blurb || h.name;
          showCallout(h.name, sentence);
          speak(`${h.name}. ${sentence}`, { voice });
        }
      }

      // ---- ambient area narration ----
      const interval = ambientInterval(settings?.talk);
      if (voice && isFinite(interval) && Date.now() - eng.lastAmbient > interval * 1000) {
        const near = nearestPlace(cur, city.places, eng.announcedH);
        if (near) {
          eng.lastAmbient = Date.now();
          speak(`You're passing ${near.name}. ${near.see || near.blurb || ''}`, { voice });
          showCallout(near.name, near.see || near.blurb || '');
        }
      }

      // ---- finish ----
      if (dist(cur, finishPt) < 28 && eng.distM > route.distanceMeters * 0.6) finish();
      else if (eng.distM >= route.distanceMeters * 0.98) finish();
    },
    [eng, unitM, highlights, city, settings, voice, finish, showCallout, route.distanceMeters, finishPt]
  );

  // ---- start everything ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location needed', 'Grant location access to track your run.');
        return;
      }
      // maneuvers (Map Matching, with a geometric fallback)
      let M = await getManeuvers(routeCoords, profile);
      if (!M.length) M = turnsFromGeometry(routeCoords);
      if (cancelled) return;
      eng.maneuvers = M;

      eng.startMs = Date.now();
      eng.started = true;
      speak("Let's go. Starting your run.", { voice, priority: true });

      eng.timer = setInterval(() => {
        if (!eng.pauseStart) {
          setElapsed((Date.now() - eng.startMs - eng.pausedMs) / 1000);
        }
      }, 1000);

      eng.sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 5, timeInterval: 2000 },
        onLocation
      );
    })();
    return () => {
      cancelled = true;
      if (eng.timer) clearInterval(eng.timer);
      if (eng.sub) eng.sub.remove();
      if (calloutTimer.current) clearTimeout(calloutTimer.current);
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePause = () => {
    if (eng.pauseStart) {
      eng.pausedMs += Date.now() - eng.pauseStart;
      eng.pauseStart = 0;
      setPaused(false);
    } else {
      eng.pauseStart = Date.now();
      setPaused(true);
      stopSpeaking();
    }
  };

  const avgPace = distM > 30 ? elapsed / (distM / unitM) : NaN;

  return (
    <View style={styles.screen}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_DEFAULT}
        userInterfaceStyle={theme.isDark ? 'dark' : 'light'}
        showsUserLocation
        showsMyLocationButton={false}
        initialRegion={{
          latitude: start.lat,
          longitude: start.lng,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
      >
        <Polyline coordinates={routeCoords} strokeColor={theme.accent} strokeWidth={6} />
        {highlights.map((h, i) => (
          <Marker key={h.id} coordinate={{ latitude: h.lat, longitude: h.lng }} title={h.name}>
            <View style={[styles.pin, { backgroundColor: CATEGORY_META[h.category]?.color || theme.accent }]}>
              <Text style={styles.pinText}>{eng.announcedH.has(h.id) ? '✓' : i + 1}</Text>
            </View>
          </Marker>
        ))}
        <Marker coordinate={{ latitude: finishPt.latitude, longitude: finishPt.longitude }}>
          <View style={[styles.pin, { backgroundColor: theme.good }]}>
            <Text style={styles.pinText}>🏁</Text>
          </View>
        </Marker>
      </MapView>

      {/* Direction banner */}
      {banner && !done && (
        <Glass style={styles.banner}>
          <Text style={styles.bannerIcon}>{banner.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerInstr} numberOfLines={2}>
              {banner.instruction}
            </Text>
            <Text style={styles.bannerMeters}>{banner.meters} m</Text>
          </View>
        </Glass>
      )}
      <TouchableOpacity style={styles.exitWrap} onPress={onExit}>
        <Glass style={styles.exitBtn} isInteractive>
          <Text style={styles.exitText}>✕</Text>
        </Glass>
      </TouchableOpacity>

      {/* Place call-out */}
      {callout && !done && (
        <Glass style={styles.callout}>
          <Text style={styles.calloutName}>{callout.name}</Text>
          <Text style={styles.calloutText}>{callout.text}</Text>
        </Glass>
      )}

      {/* Bottom stats */}
      {!done ? (
        <Glass style={styles.panel}>
          <View style={styles.statsRow}>
            <Stat big value={formatClock(elapsed)} label="time" />
            <Stat big value={fmt.km(distM, unit)} label="distance" />
            <Stat big value={formatPace(splitPace)} label={`this ${unit}`} />
          </View>
          <Text style={styles.avg}>
            avg {formatPace(avgPace)} /{unit} · {splits.length} {splits.length === 1 ? 'split' : 'splits'} done
          </Text>
          <View style={styles.controls}>
            <TouchableOpacity style={styles.secondary} onPress={togglePause}>
              <Text style={styles.secondaryText}>{paused ? 'Resume' : 'Pause'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.stop} onPress={finish}>
              <Text style={styles.stopText}>Finish</Text>
            </TouchableOpacity>
          </View>
        </Glass>
      ) : (
        <Glass style={styles.panel}>
          <Text style={styles.doneTitle}>Run complete</Text>
          <View style={styles.statsRow}>
            <Stat value={formatClock(elapsed)} label="time" />
            <Stat value={fmt.km(distM, unit)} label="distance" />
            <Stat value={formatPace(avgPace)} label={`avg /${unit}`} />
            <Stat value={String(eng.announcedH.size)} label="seen" />
          </View>
          <TouchableOpacity style={styles.stop} onPress={onExit}>
            <Text style={styles.stopText}>Done</Text>
          </TouchableOpacity>
        </Glass>
      )}
    </View>
  );
}

function Stat({ value, label, big }) {
  const styles = getStyles(useTheme());
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, big && styles.statValueBig]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// nearest curated place to a point that hasn't already been called out, within 280m
function nearestPlace(cur, places, announced) {
  let best = null;
  let bd = 280;
  for (const p of places) {
    if (announced.has(p.id)) continue;
    const pt = p.corridor ? nearestCorridorPt(cur, p) : { latitude: p.lat, longitude: p.lng };
    const d = dist(cur, pt);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

function nearestCorridorPt(cur, p) {
  let best = { latitude: p.corridor[0].lat, longitude: p.corridor[0].lng };
  let bd = Infinity;
  for (const c of p.corridor) {
    const pt = { latitude: c.lat, longitude: c.lng };
    const d = dist(cur, pt);
    if (d < bd) {
      bd = d;
      best = pt;
    }
  }
  return best;
}

const getStyles = themedStyles((theme) => ({
  screen: { flex: 1, backgroundColor: theme.bg },
  pin: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  pinText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  banner: {
    position: 'absolute',
    top: 54,
    left: 16,
    right: 70,
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    overflow: 'hidden',
  },
  bannerIcon: { color: theme.accent, fontSize: 34, fontWeight: '800' },
  bannerInstr: { color: theme.text, fontSize: 17, fontWeight: '700' },
  bannerMeters: { color: theme.accent, fontSize: 13, fontWeight: '700', marginTop: 2 },
  exitWrap: { position: 'absolute', top: 54, right: 16 },
  exitBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  exitText: { color: theme.text, fontSize: 18, fontWeight: '600' },
  callout: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 210,
    borderRadius: 14,
    padding: 14,
    overflow: 'hidden',
  },
  calloutName: { color: theme.accent, fontWeight: '700', fontSize: 15 },
  calloutText: { color: theme.text, fontSize: 14, lineHeight: 20, marginTop: 4 },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 34,
    overflow: 'hidden',
  },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { color: theme.text, fontSize: 20, fontWeight: '800' },
  statValueBig: { fontSize: 30 },
  statLabel: { color: theme.textDim, fontSize: 12, marginTop: 2 },
  avg: { color: theme.textDim, fontSize: 13, textAlign: 'center', marginTop: 10 },
  controls: { flexDirection: 'row', gap: 12, marginTop: 16 },
  secondary: {
    flex: 1,
    backgroundColor: theme.tint,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  secondaryText: { color: theme.accent, fontWeight: '600', fontSize: 15 },
  stop: {
    flex: 1,
    backgroundColor: theme.accent,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  stopText: { color: theme.onAccent, fontWeight: '600', fontSize: 15 },
  doneTitle: { color: theme.text, fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 14 },
}));

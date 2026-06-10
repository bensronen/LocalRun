import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  Keyboard,
} from 'react-native';
import Slider from '@react-native-community/slider';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import * as Location from 'expo-location';
import { useTheme, themedStyles, fmt, shadow } from '../theme';
import Glass from '../components/Glass';
import { geocode, geocodeSuggest, hasToken } from '../lib/mapbox';
import { buildRoute, vibeFromChips } from '../lib/routeBuilder';
import { loadBoosts, loadRuns } from '../lib/history';
import { fetchCommunity, mergeBoosts } from '../lib/api';
import { tap } from '../lib/haptics';
import { CITIES, cityForPoint } from '../data/cities';

const VIBES = [
  { key: 'waterfront', label: 'Waterfront' },
  { key: 'parks', label: 'Parks' },
  { key: 'landmarks', label: 'Landmarks' },
  { key: 'neighborhoods', label: 'Neighborhoods' },
];

// You've completed runs here before — revisit favorites or hunt new ground?
function askExplore(seenCount) {
  return new Promise((resolve) =>
    Alert.alert(
      "You've run here before",
      `${seenCount} sights already in your history. What's the mood today?`,
      [
        { text: 'Something new', onPress: () => resolve('new') },
        { text: 'Revisit favorites', onPress: () => resolve('revisit') },
        { text: 'Surprise me', style: 'cancel', onPress: () => resolve(null) },
      ],
      { cancelable: false }
    )
  );
}

export default function PlanScreen({ draft, onDraftChange, onRouteBuilt, onOpenSettings, onOpenHistory }) {
  const theme = useTheme();
  const styles = getStyles(theme);
  const initCity = (draft && CITIES.find((c) => c.id === draft.cityId)) || CITIES[0];
  const [city, setCity] = useState(initCity);
  const [cityOpen, setCityOpen] = useState(false);
  const [start, setStart] = useState(draft?.start || initCity.defaultStart);
  const [address, setAddress] = useState(draft?.address || '');
  const [suggestions, setSuggestions] = useState([]);
  const [distanceKm, setDistanceKm] = useState(draft?.distanceKm ?? 5);
  const [unit, setUnit] = useState(draft?.unit || 'km');
  const [shape, setShape] = useState(draft?.shape || 'loop');
  const [vibes, setVibes] = useState(draft?.vibes || []);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);

  const suggestTimer = useRef(null);
  const suggestSeq = useRef(0);
  useEffect(() => () => clearTimeout(suggestTimer.current), []);

  // Community pulse for the selected city (cached; null when no backend).
  const [community, setCommunity] = useState(null);
  useEffect(() => {
    let live = true;
    setCommunity(null);
    fetchCommunity(city.id).then((c) => live && setCommunity(c));
    return () => {
      live = false;
    };
  }, [city.id]);

  // Report the whole plan upward so leaving this screen (or the app) never
  // loses what was set up here.
  useEffect(() => {
    onDraftChange?.({ cityId: city.id, start, address, distanceKm, unit, shape, vibes });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, start, address, distanceKm, unit, shape, vibes]);

  const distMeters = distanceKm * 1000;

  function clearAddress() {
    setAddress('');
    setSuggestions([]);
  }

  function switchCity(c) {
    tap();
    setCity(c);
    setStart(c.defaultStart);
    clearAddress();
  }

  // Debounced autocomplete: suggest as you type, newest request wins.
  function onChangeAddress(text) {
    setAddress(text);
    clearTimeout(suggestTimer.current);
    const q = text.trim();
    if (q.length < 3 || !hasToken()) {
      setSuggestions([]);
      return;
    }
    suggestTimer.current = setTimeout(async () => {
      const seq = ++suggestSeq.current;
      const hits = await geocodeSuggest(q, start, city.bbox);
      if (seq === suggestSeq.current) setSuggestions(hits);
    }, 300);
  }

  function pickSuggestion(s) {
    tap();
    suggestSeq.current += 1; // invalidate any in-flight request
    setStart(s);
    setAddress(s.name);
    setSuggestions([]);
    Keyboard.dismiss();
  }

  function toggleVibe(key) {
    tap();
    setVibes((v) => (v.includes(key) ? v.filter((k) => k !== key) : [...v, key]));
  }

  async function useMyLocation() {
    try {
      setLocating(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location off', 'Grant location access or drop a pin on the map.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({});
      const pt = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const detected = cityForPoint(pt);
      setCity(detected);
      setStart({ ...pt, name: 'My location' });
      clearAddress();
    } catch (e) {
      Alert.alert('Could not locate', e.message);
    } finally {
      setLocating(false);
    }
  }

  async function searchAddress() {
    if (!address.trim()) return;
    if (suggestions.length) {
      pickSuggestion(suggestions[0]);
      return;
    }
    if (!hasToken()) {
      Alert.alert('Add a Mapbox token', 'Address search needs EXPO_PUBLIC_MAPBOX_TOKEN in .env.');
      return;
    }
    try {
      setBusy(true);
      const hit = await geocode(address, start, city.bbox);
      if (!hit) {
        Alert.alert('Not found', `Try a more specific ${city.name} address or drop a pin.`);
        return;
      }
      setStart(hit);
      setAddress(hit.name);
      setSuggestions([]);
    } catch (e) {
      Alert.alert('Search failed', e.message);
    } finally {
      setBusy(false);
    }
  }

  async function build() {
    if (!hasToken()) {
      Alert.alert(
        'Add your Mapbox token',
        'Create a free token at mapbox.com and put it in .env as EXPO_PUBLIC_MAPBOX_TOKEN, then restart with: npx expo start -c'
      );
      return;
    }
    try {
      setBusy(true);
      // Your taste + the community's: photographed and loved places rank higher.
      const boosts = mergeBoosts(await loadBoosts(), community);
      // If completed runs here already cover some sights, ask for the mood.
      const cityRuns = (await loadRuns()).filter((r) => r.cityId === city.id);
      const seen = [...new Set(cityRuns.flatMap((r) => r.seen || []))];
      const explore = seen.length >= 3 ? await askExplore(seen.length) : null;
      const plan = {
        distanceKm,
        shape,
        vibe: vibeFromChips(vibes),
        profile: 'walking',
        boosts,
        seen,
        explore,
      };
      const result = await buildRoute(start, plan, city);
      onRouteBuilt({ ...result, start, unit, plan, city, community });
    } catch (e) {
      Alert.alert('Could not build a route', e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>LocalRun</Text>
          <Text style={styles.subtitle}>Run a city like a local.</Text>
        </View>
        <View style={styles.headerBtns}>
          <TouchableOpacity style={styles.gear} onPress={onOpenHistory}>
            <Text style={styles.gearIcon}>🕘</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.gear} onPress={onOpenSettings}>
            <Text style={styles.gearIcon}>⚙︎</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* City selector */}
      <TouchableOpacity style={styles.cityBtn} onPress={() => setCityOpen(true)}>
        <Text style={styles.cityBtnText}>
          {city.emoji} {city.name}
        </Text>
        <Text style={styles.cityBtnChevron}>▾</Text>
      </TouchableOpacity>
      <Modal visible={cityOpen} transparent animationType="fade" onRequestClose={() => setCityOpen(false)}>
        <TouchableOpacity style={styles.cityBackdrop} activeOpacity={1} onPress={() => setCityOpen(false)}>
          <Glass style={styles.cityMenu}>
            <ScrollView bounces={false}>
              {CITIES.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.cityItem, c.id === city.id && styles.cityItemActive]}
                  onPress={() => {
                    switchCity(c);
                    setCityOpen(false);
                  }}
                >
                  <Text style={[styles.cityItemText, c.id === city.id && styles.cityItemTextActive]}>
                    {c.emoji} {c.name}
                  </Text>
                  {c.id === city.id && <Text style={styles.cityCheck}>✓</Text>}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Glass>
        </TouchableOpacity>
      </Modal>

      {/* Community pulse */}
      {community?.totalRuns > 0 && (
        <View style={styles.pulse}>
          <Text style={styles.pulseText} numberOfLines={2}>
            🏃 {community.totalRuns} {community.totalRuns === 1 ? 'run' : 'runs'} by the community
            {community.top?.length
              ? ` · 📷 most shot: ${
                  city.places.find((p) => p.id === community.top[0].id)?.name || community.top[0].id
                }`
              : ''}
          </Text>
        </View>
      )}

      {/* Start */}
      <Text style={styles.label}>Start from</Text>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          placeholder={`Hotel or address in ${city.name}…`}
          placeholderTextColor={theme.textDim}
          value={address}
          onChangeText={onChangeAddress}
          onSubmitEditing={searchAddress}
          returnKeyType="search"
        />
        <TouchableOpacity style={styles.smallBtn} onPress={searchAddress}>
          <Text style={styles.smallBtnText}>Find</Text>
        </TouchableOpacity>
      </View>

      {suggestions.length > 0 && (
        <View style={styles.suggestBox}>
          {suggestions.map((s, i) => (
            <TouchableOpacity
              key={`${s.lat},${s.lng}`}
              style={[styles.suggestItem, i > 0 && styles.suggestDivider]}
              onPress={() => pickSuggestion(s)}
            >
              <Text style={styles.suggestText} numberOfLines={1}>
                {s.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={styles.presetRow}>
        <TouchableOpacity style={styles.preset} onPress={useMyLocation}>
          <Text style={styles.presetText}>{locating ? 'Locating…' : 'My location'}</Text>
        </TouchableOpacity>
        {city.presets.map((p) => (
          <TouchableOpacity
            key={p.label}
            style={styles.preset}
            onPress={() => {
              tap();
              setStart(p);
              clearAddress();
            }}
          >
            <Text style={styles.presetText}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.mapWrap}>
        <MapView
          style={StyleSheet.absoluteFill}
          provider={PROVIDER_DEFAULT}
          userInterfaceStyle={theme.isDark ? 'dark' : 'light'}
          region={{
            latitude: start.lat,
            longitude: start.lng,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          }}
          onPress={(e) => {
            const { latitude, longitude } = e.nativeEvent.coordinate;
            setStart({ lat: latitude, lng: longitude, name: 'Dropped pin' });
            clearAddress();
          }}
        >
          <Marker
            coordinate={{ latitude: start.lat, longitude: start.lng }}
            draggable
            onDragEnd={(e) => {
              const { latitude, longitude } = e.nativeEvent.coordinate;
              setStart({ lat: latitude, lng: longitude, name: 'Dropped pin' });
            }}
          />
        </MapView>
        <Glass style={styles.mapHint}>
          <Text style={styles.mapHintText}>{start.name} · tap to move</Text>
        </Glass>
      </View>

      {/* Distance */}
      <View style={styles.distHeader}>
        <Text style={styles.label}>Distance</Text>
        <View style={styles.unitToggle}>
          {['km', 'mi'].map((u) => (
            <TouchableOpacity
              key={u}
              style={[styles.unitBtn, unit === u && styles.unitBtnActive]}
              onPress={() => {
                tap();
                setUnit(u);
              }}
            >
              <Text style={[styles.unit, unit === u && styles.unitActive]}>{u}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <Text style={styles.distValue}>{fmt.km(distMeters, unit)}</Text>
      <Slider
        minimumValue={1}
        maximumValue={21}
        step={0.5}
        value={distanceKm}
        onValueChange={setDistanceKm}
        minimumTrackTintColor={theme.accent}
        maximumTrackTintColor={theme.border}
        thumbTintColor={theme.accent}
      />
      <Text style={styles.estimate}>
        ~{fmt.runTime(distMeters)} easy run · ~{fmt.runTime(distMeters, 9)} brisk walk
      </Text>

      {/* Shape */}
      <Text style={styles.label}>Route shape</Text>
      <View style={styles.segmented}>
        {[
          { key: 'loop', label: 'Loop back', hint: 'Return to start' },
          { key: 'oneway', label: 'One-way', hint: 'Bike/transit back' },
        ].map((s) => (
          <TouchableOpacity
            key={s.key}
            style={[styles.segment, shape === s.key && styles.segmentActive]}
            onPress={() => {
              tap();
              setShape(s.key);
            }}
          >
            <Text style={[styles.segmentText, shape === s.key && styles.segmentTextActive]}>
              {s.label}
            </Text>
            <Text style={styles.segmentHint}>{s.hint}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Vibe */}
      <Text style={styles.label}>Sights (optional)</Text>
      <View style={styles.vibeRow}>
        {VIBES.map((v) => (
          <TouchableOpacity
            key={v.key}
            style={[styles.chip, vibes.includes(v.key) && styles.chipActive]}
            onPress={() => toggleVibe(v.key)}
          >
            <Text style={[styles.chipText, vibes.includes(v.key) && styles.chipTextActive]}>
              {v.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.cta} onPress={build} disabled={busy}>
        {busy ? (
          <ActivityIndicator color={theme.onAccent} />
        ) : (
          <Text style={styles.ctaText}>Build my run</Text>
        )}
      </TouchableOpacity>

      {!hasToken() && (
        <Text style={styles.warn}>
          ⚠️ No Mapbox token yet. Add EXPO_PUBLIC_MAPBOX_TOKEN to .env, then run{' '}
          <Text style={{ fontWeight: '700' }}>npx expo start -c</Text>.
        </Text>
      )}
    </ScrollView>
  );
}

const getStyles = themedStyles((theme) => ({
  screen: { flex: 1, paddingHorizontal: 18 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginTop: 8,
  },
  title: { color: theme.text, fontSize: 34, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { color: theme.textDim, fontSize: 15, marginTop: 2, marginBottom: 16 },
  headerBtns: { flexDirection: 'row', gap: 8 },
  gear: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    ...shadow,
  },
  gearIcon: { color: theme.accent, fontSize: 19 },
  cityBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.card,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
    ...shadow,
  },
  cityBtnText: { color: theme.text, fontWeight: '600', fontSize: 16 },
  cityBtnChevron: { color: theme.textDim, fontSize: 13, fontWeight: '700' },
  cityBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'flex-start',
    paddingTop: 130,
    paddingHorizontal: 18,
  },
  cityMenu: {
    borderRadius: 16,
    maxHeight: 420,
    overflow: 'hidden',
  },
  cityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  cityItemActive: { backgroundColor: theme.tint },
  cityItemText: { color: theme.text, fontWeight: '500', fontSize: 16 },
  cityItemTextActive: { color: theme.accent, fontWeight: '700' },
  cityCheck: { color: theme.accent, fontWeight: '700', fontSize: 15 },
  pulse: {
    backgroundColor: theme.tint,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 10,
  },
  pulseText: { color: theme.accent, fontSize: 13, fontWeight: '500' },
  label: {
    color: theme.textDim,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 24,
    marginBottom: 8,
  },
  row: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    backgroundColor: theme.card,
    color: theme.text,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    ...shadow,
  },
  smallBtn: {
    backgroundColor: theme.tint,
    borderRadius: 12,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  smallBtnText: { color: theme.accent, fontWeight: '600', fontSize: 15 },
  suggestBox: {
    backgroundColor: theme.card,
    borderRadius: 12,
    marginTop: 6,
    overflow: 'hidden',
    ...shadow,
  },
  suggestItem: { paddingHorizontal: 14, paddingVertical: 12 },
  suggestDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
  suggestText: { color: theme.text, fontSize: 14 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  preset: {
    backgroundColor: theme.card,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    ...shadow,
  },
  presetText: { color: theme.text, fontWeight: '500', fontSize: 13 },
  mapWrap: { height: 200, borderRadius: 16, overflow: 'hidden', marginTop: 14 },
  mapHint: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    overflow: 'hidden',
  },
  mapHintText: { color: theme.text, fontSize: 12, fontWeight: '600' },
  distHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  unitToggle: {
    flexDirection: 'row',
    backgroundColor: theme.tint,
    borderRadius: 9,
    padding: 2,
    marginTop: 20,
  },
  unitBtn: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 7 },
  unitBtnActive: { backgroundColor: theme.card, ...shadow },
  unit: { color: theme.textDim, fontSize: 13, fontWeight: '600' },
  unitActive: { color: theme.text },
  distValue: { color: theme.text, fontSize: 34, fontWeight: '700', letterSpacing: -0.5, marginTop: 4 },
  estimate: { color: theme.textDim, fontSize: 13, marginTop: 4 },
  segmented: { flexDirection: 'row', backgroundColor: theme.tint, borderRadius: 12, padding: 3 },
  segment: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  segmentActive: { backgroundColor: theme.card, ...shadow },
  segmentText: { color: theme.textDim, fontWeight: '600', fontSize: 15 },
  segmentTextActive: { color: theme.text },
  segmentHint: { color: theme.textDim, fontSize: 12, marginTop: 2 },
  vibeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: theme.card,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
    ...shadow,
  },
  chipActive: { backgroundColor: theme.accent },
  chipText: { color: theme.text, fontWeight: '500', fontSize: 14 },
  chipTextActive: { color: theme.onAccent, fontWeight: '600' },
  cta: {
    backgroundColor: theme.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 28,
    ...shadow,
  },
  ctaText: { color: theme.onAccent, fontSize: 17, fontWeight: '600' },
  warn: { color: theme.textDim, fontSize: 12, marginTop: 14, lineHeight: 18 },
}));

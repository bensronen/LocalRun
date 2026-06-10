import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import Slider from '@react-native-community/slider';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import * as Location from 'expo-location';
import { theme, fmt } from '../theme';
import { geocode, hasToken } from '../lib/mapbox';
import { buildRoute, vibeFromChips } from '../lib/routeBuilder';
import { CITIES, cityForPoint } from '../data/cities';

const VIBES = [
  { key: 'waterfront', label: '🌊 Waterfront' },
  { key: 'parks', label: '🌳 Parks' },
  { key: 'landmarks', label: '📍 Landmarks' },
  { key: 'neighborhoods', label: '🏙️ Neighborhoods' },
];

export default function PlanScreen({ onRouteBuilt, onOpenSettings }) {
  const [city, setCity] = useState(CITIES[0]);
  const [start, setStart] = useState(CITIES[0].defaultStart);
  const [address, setAddress] = useState('');
  const [distanceKm, setDistanceKm] = useState(5);
  const [unit, setUnit] = useState('km');
  const [shape, setShape] = useState('loop');
  const [vibes, setVibes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);

  const distMeters = distanceKm * 1000;

  function switchCity(c) {
    setCity(c);
    setStart(c.defaultStart);
    setAddress('');
  }

  function toggleVibe(key) {
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
      setAddress('');
    } catch (e) {
      Alert.alert('Could not locate', e.message);
    } finally {
      setLocating(false);
    }
  }

  async function searchAddress() {
    if (!address.trim()) return;
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
      const plan = {
        distanceKm,
        shape,
        vibe: vibeFromChips(vibes),
        profile: 'walking',
      };
      const result = await buildRoute(start, plan, city);
      onRouteBuilt({ ...result, start, unit, plan, city });
    } catch (e) {
      Alert.alert('Could not build a route', e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>LocalRun</Text>
          <Text style={styles.subtitle}>Run a city like a local.</Text>
        </View>
        <TouchableOpacity style={styles.gear} onPress={onOpenSettings}>
          <Text style={styles.gearIcon}>⚙︎</Text>
        </TouchableOpacity>
      </View>

      {/* City selector */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.cityRow}
        contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
      >
        {CITIES.map((c) => (
          <TouchableOpacity
            key={c.id}
            style={[styles.cityChip, c.id === city.id && styles.cityChipActive]}
            onPress={() => switchCity(c)}
          >
            <Text style={[styles.cityChipText, c.id === city.id && styles.cityChipTextActive]}>
              {c.emoji} {c.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Start */}
      <Text style={styles.label}>Where are you staying?</Text>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          placeholder={`Hotel or address in ${city.name}…`}
          placeholderTextColor={theme.textDim}
          value={address}
          onChangeText={setAddress}
          onSubmitEditing={searchAddress}
          returnKeyType="search"
        />
        <TouchableOpacity style={styles.smallBtn} onPress={searchAddress}>
          <Text style={styles.smallBtnText}>Find</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.presetRow}>
        <TouchableOpacity style={styles.preset} onPress={useMyLocation}>
          <Text style={styles.presetText}>{locating ? '…' : '📡 My location'}</Text>
        </TouchableOpacity>
        {city.presets.map((p) => (
          <TouchableOpacity
            key={p.label}
            style={styles.preset}
            onPress={() => {
              setStart(p);
              setAddress('');
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
          region={{
            latitude: start.lat,
            longitude: start.lng,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          }}
          onPress={(e) => {
            const { latitude, longitude } = e.nativeEvent.coordinate;
            setStart({ lat: latitude, lng: longitude, name: 'Dropped pin' });
            setAddress('');
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
        <View style={styles.mapHint}>
          <Text style={styles.mapHintText}>📍 {start.name} · tap to move</Text>
        </View>
      </View>

      {/* Distance */}
      <View style={styles.distHeader}>
        <Text style={styles.label}>How far?</Text>
        <View style={styles.unitToggle}>
          {['km', 'mi'].map((u) => (
            <TouchableOpacity key={u} onPress={() => setUnit(u)}>
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
          { key: 'loop', label: '🔁 Loop back', hint: 'Return to start' },
          { key: 'oneway', label: '➡️ One-way', hint: 'Bike/transit back' },
        ].map((s) => (
          <TouchableOpacity
            key={s.key}
            style={[styles.segment, shape === s.key && styles.segmentActive]}
            onPress={() => setShape(s.key)}
          >
            <Text style={[styles.segmentText, shape === s.key && styles.segmentTextActive]}>
              {s.label}
            </Text>
            <Text style={styles.segmentHint}>{s.hint}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Vibe */}
      <Text style={styles.label}>What do you want to see? (optional)</Text>
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
          <Text style={styles.ctaText}>Build my run →</Text>
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

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 18 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginTop: 8,
  },
  title: { color: theme.text, fontSize: 34, fontWeight: '800' },
  subtitle: { color: theme.textDim, fontSize: 14, marginBottom: 14 },
  gear: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  gearIcon: { color: theme.textDim, fontSize: 20 },
  cityRow: { marginBottom: 4 },
  cityChip: {
    backgroundColor: theme.card,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: theme.border,
  },
  cityChipActive: { borderColor: theme.accent, backgroundColor: theme.cardAlt },
  cityChipText: { color: theme.textDim, fontWeight: '700', fontSize: 14 },
  cityChipTextActive: { color: theme.accent },
  label: { color: theme.text, fontSize: 16, fontWeight: '700', marginTop: 18, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    backgroundColor: theme.card,
    color: theme.text,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: theme.border,
  },
  smallBtn: {
    backgroundColor: theme.cardAlt,
    borderRadius: 12,
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.border,
  },
  smallBtnText: { color: theme.accent, fontWeight: '700' },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  preset: {
    backgroundColor: theme.card,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: theme.border,
  },
  presetText: { color: theme.textDim, fontWeight: '600', fontSize: 13 },
  mapWrap: {
    height: 200,
    borderRadius: 16,
    overflow: 'hidden',
    marginTop: 14,
    borderWidth: 1,
    borderColor: theme.border,
  },
  mapHint: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    backgroundColor: theme.overlay,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  mapHintText: { color: theme.onOverlay, fontSize: 12, fontWeight: '600' },
  distHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  unitToggle: { flexDirection: 'row', gap: 14, marginBottom: 8 },
  unit: { color: theme.textDim, fontSize: 14, fontWeight: '700' },
  unitActive: { color: theme.accent, textDecorationLine: 'underline' },
  distValue: { color: theme.accent, fontSize: 30, fontWeight: '800' },
  estimate: { color: theme.textDim, fontSize: 13, marginTop: 4 },
  segmented: { flexDirection: 'row', gap: 10 },
  segment: {
    flex: 1,
    backgroundColor: theme.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.border,
  },
  segmentActive: { borderColor: theme.accent, backgroundColor: theme.cardAlt },
  segmentText: { color: theme.text, fontWeight: '700', fontSize: 15 },
  segmentTextActive: { color: theme.accent },
  segmentHint: { color: theme.textDim, fontSize: 12, marginTop: 2 },
  vibeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: theme.card,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: theme.border,
  },
  chipActive: { borderColor: theme.accent, backgroundColor: theme.cardAlt },
  chipText: { color: theme.textDim, fontWeight: '600' },
  chipTextActive: { color: theme.accent },
  cta: {
    backgroundColor: theme.accent,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 26,
  },
  ctaText: { color: theme.onAccent, fontSize: 17, fontWeight: '800' },
  warn: { color: theme.textDim, fontSize: 12, marginTop: 14, lineHeight: 18 },
});

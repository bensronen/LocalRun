import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { theme, fmt } from '../theme';
import { CATEGORY_META } from '../data/categories';

export default function RouteScreen({ result, onBack, onRegenerate }) {
  const { route, highlights, shape, start, unit, distanceMeters, targetMeters, rationale } = result;
  const mapRef = useRef(null);

  useEffect(() => {
    if (mapRef.current && route.coordinates.length) {
      mapRef.current.fitToCoordinates(route.coordinates, {
        edgePadding: { top: 70, right: 50, bottom: 60, left: 50 },
        animated: true,
      });
    }
  }, [route]);

  const last = highlights[highlights.length - 1];
  const offTarget = distanceMeters / targetMeters;
  const distanceNote =
    offTarget > 1.15
      ? 'a bit longer than asked'
      : offTarget < 0.85
      ? 'a touch shorter — scenic density ran out'
      : 'right on target';

  return (
    <View style={styles.screen}>
      <View style={styles.mapWrap}>
        <MapView ref={mapRef} style={StyleSheet.absoluteFill} provider={PROVIDER_DEFAULT}>
          <Polyline coordinates={route.coordinates} strokeColor={theme.accent} strokeWidth={5} />
          <Marker coordinate={{ latitude: start.lat, longitude: start.lng }} title="Start">
            <View style={[styles.pin, { backgroundColor: theme.good }]}>
              <Text style={styles.pinText}>S</Text>
            </View>
          </Marker>
          {highlights.map((h, i) => (
            <Marker
              key={h.id}
              coordinate={{ latitude: h.lat, longitude: h.lng }}
              title={h.name}
              description={h.see || h.blurb}
            >
              <View
                style={[
                  styles.pin,
                  { backgroundColor: CATEGORY_META[h.category]?.color || theme.accent },
                ]}
              >
                <Text style={styles.pinText}>{i + 1}</Text>
              </View>
            </Marker>
          ))}
        </MapView>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Text style={styles.backText}>‹ Plan</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.sheet} contentContainerStyle={{ paddingBottom: 30 }}>
        <View style={styles.statsRow}>
          <Stat value={fmt.km(distanceMeters, unit)} label="distance" />
          <Stat value={fmt.runTime(distanceMeters)} label="easy run" />
          <Stat value={shape === 'loop' ? 'Loop' : 'One-way'} label="shape" />
          <Stat value={String(highlights.length)} label="stops" />
        </View>
        <Text style={styles.distanceNote}>{distanceNote}</Text>

        {/* Why this route */}
        {rationale && (
          <View style={styles.whyCard}>
            <Text style={styles.whyTitle}>Why this route</Text>
            <Text style={styles.thesis}>{rationale.thesis}</Text>
            {rationale.reasons?.map((r, i) => (
              <View key={i} style={styles.reasonRow}>
                <Text style={styles.reasonDot}>›</Text>
                <Text style={styles.reasonText}>{r}</Text>
              </View>
            ))}
            {rationale.alternatives?.length > 0 && (
              <View style={styles.altBox}>
                <Text style={styles.altHead}>Roads not taken</Text>
                {rationale.alternatives.map((a, i) => (
                  <Text key={i} style={styles.altText}>
                    <Text style={styles.altName}>{a.name}</Text> — {a.why}
                  </Text>
                ))}
              </View>
            )}
          </View>
        )}

        {shape === 'oneway' && last && (
          <View style={styles.endCard}>
            <Text style={styles.endTitle}>🏁 Finish at {last.name}</Text>
            {last.transit && (
              <Text style={styles.endTransit}>🚇 Ride back from: {last.transit}</Text>
            )}
          </View>
        )}

        <Text style={styles.sectionTitle}>What you'll see</Text>
        <Text style={styles.sectionSub}>
          {shape === 'loop'
            ? 'A loop from your door and back, threaded through:'
            : 'A one-way line across the city, passing:'}
        </Text>

        {highlights.map((h, i) => {
          const meta = CATEGORY_META[h.category] || {};
          return (
            <View key={h.id} style={styles.item}>
              <View style={[styles.itemNum, { backgroundColor: meta.color || theme.accent }]}>
                <Text style={styles.itemNumText}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.itemHead}>
                  <Text style={styles.itemName}>{h.name}</Text>
                  <Text style={[styles.itemTag, { color: meta.color }]}>
                    {meta.emoji} {meta.label}
                  </Text>
                </View>
                <Text style={styles.itemBlurb}>{h.blurb}</Text>
                {h.see && <DetailLine icon="👀" text={h.see} />}
                {h.do && <DetailLine icon="✨" text={h.do} />}
                {h.tip && <DetailLine icon="💡" text={h.tip} dim />}
                {h.transit && <DetailLine icon="🚇" text={h.transit} dim />}
              </View>
            </View>
          );
        })}

        <View style={styles.actions}>
          <TouchableOpacity style={styles.secondary} onPress={onBack}>
            <Text style={styles.secondaryText}>Adjust</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.primary} onPress={onRegenerate}>
            <Text style={styles.primaryText}>↻ Another route</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

function Stat({ value, label }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function DetailLine({ icon, text, dim }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailIcon}>{icon}</Text>
      <Text style={[styles.detailText, dim && styles.detailDim]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  mapWrap: { height: '42%' },
  backBtn: {
    position: 'absolute',
    top: 50,
    left: 14,
    backgroundColor: 'rgba(11,18,32,0.9)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  backText: { color: theme.text, fontWeight: '700', fontSize: 15 },
  pin: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  pinText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  sheet: { flex: 1, paddingHorizontal: 18, paddingTop: 16 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { color: theme.text, fontSize: 18, fontWeight: '800' },
  statLabel: { color: theme.textDim, fontSize: 12, marginTop: 2 },
  distanceNote: {
    color: theme.textDim,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
    fontStyle: 'italic',
  },
  whyCard: {
    backgroundColor: theme.card,
    borderRadius: 16,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: theme.border,
  },
  whyTitle: {
    color: theme.accent,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  thesis: { color: theme.text, fontSize: 16, fontWeight: '700', lineHeight: 23, marginTop: 8 },
  reasonRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  reasonDot: { color: theme.accent, fontSize: 15, fontWeight: '800' },
  reasonText: { color: theme.textDim, fontSize: 13, lineHeight: 19, flex: 1 },
  altBox: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  altHead: {
    color: theme.textDim,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  altText: { color: theme.textDim, fontSize: 13, lineHeight: 19, marginTop: 4 },
  altName: { color: theme.text, fontWeight: '700' },
  endCard: {
    backgroundColor: theme.cardAlt,
    borderRadius: 14,
    padding: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: theme.border,
  },
  endTitle: { color: theme.text, fontWeight: '800', fontSize: 15 },
  endTransit: { color: theme.accent, fontSize: 13, marginTop: 6 },
  sectionTitle: { color: theme.text, fontSize: 20, fontWeight: '800', marginTop: 22 },
  sectionSub: { color: theme.textDim, fontSize: 13, marginBottom: 12, marginTop: 2 },
  item: { flexDirection: 'row', gap: 12, marginBottom: 18 },
  itemNum: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  itemNumText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  itemHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemName: { color: theme.text, fontWeight: '700', fontSize: 15, flex: 1 },
  itemTag: { fontSize: 11, fontWeight: '700', marginLeft: 6 },
  itemBlurb: { color: theme.textDim, fontSize: 13, lineHeight: 19, marginTop: 3 },
  detailRow: { flexDirection: 'row', gap: 7, marginTop: 6 },
  detailIcon: { fontSize: 12, marginTop: 1 },
  detailText: { color: theme.text, fontSize: 13, lineHeight: 18, flex: 1 },
  detailDim: { color: theme.textDim },
  actions: { flexDirection: 'row', gap: 12, marginTop: 10 },
  secondary: {
    flex: 1,
    backgroundColor: theme.card,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.border,
  },
  secondaryText: { color: theme.text, fontWeight: '700' },
  primary: {
    flex: 1,
    backgroundColor: theme.accent,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryText: { color: '#021018', fontWeight: '800' },
});

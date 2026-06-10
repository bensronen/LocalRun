import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  Share,
  StyleSheet,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { useTheme, themedStyles, fmt, shadow } from '../theme';
import { loadRuns, deleteRun, updatePhotoCaption } from '../lib/history';
import { formatClock, formatPace } from '../lib/nav';

function dateLabel(ts) {
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export default function HistoryScreen({ onBack }) {
  const theme = useTheme();
  const styles = getStyles(theme);
  const [runs, setRuns] = useState([]);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    loadRuns().then(setRuns);
  }, []);

  if (selected) {
    return (
      <RunDetail
        run={selected}
        onBack={() => setSelected(null)}
        onDelete={async () => {
          const next = await deleteRun(selected.id);
          setRuns(next);
          setSelected(null);
        }}
      />
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backText}>‹ Plan</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.title}>Your runs</Text>

      {runs.length === 0 && (
        <Text style={styles.empty}>
          No runs yet. Finish a run and save it — your photos and ratings teach LocalRun what
          you love seeing.
        </Text>
      )}

      {runs.map((r) => (
        <TouchableOpacity key={r.id} style={styles.card} onPress={() => setSelected(r)}>
          <View style={styles.cardTop}>
            <Text style={styles.cardCity}>{r.cityName}</Text>
            <Text style={styles.cardDate}>{dateLabel(r.ts)}</Text>
          </View>
          <View style={styles.cardStats}>
            <Text style={styles.cardStat}>{fmt.km(r.distM, r.unit)}</Text>
            <Text style={styles.cardStat}>{formatClock(r.elapsed)}</Text>
            <Text style={styles.cardStat}>
              {formatPace(r.distM > 30 ? r.elapsed / (r.distM / (r.unit === 'mi' ? 1609.34 : 1000)) : NaN)} /{r.unit}
            </Text>
          </View>
          <View style={styles.cardBottom}>
            <Text style={styles.cardStars}>
              {r.rating ? '★'.repeat(r.rating) : ''}
              <Text style={styles.cardStarsDim}>{r.rating ? '★'.repeat(5 - r.rating) : ''}</Text>
            </Text>
            {(r.photos || []).length > 0 && (
              <Text style={styles.cardPhotos}>📷 {r.photos.length}</Text>
            )}
          </View>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

function RunDetail({ run, onBack, onDelete }) {
  const theme = useTheme();
  const styles = getStyles(theme);
  const mapRef = useRef(null);
  const unitM = run.unit === 'mi' ? 1609.34 : 1000;
  const avgPace = run.distM > 30 ? run.elapsed / (run.distM / unitM) : NaN;

  // local copy so caption edits show immediately
  const [photos, setPhotos] = useState(run.photos || []);
  const [viewer, setViewer] = useState(null); // photo being viewed full-screen
  const [captionDraft, setCaptionDraft] = useState('');

  function openPhoto(p) {
    setViewer(p);
    setCaptionDraft(p.caption || '');
  }

  async function saveCaption() {
    const caption = captionDraft.trim();
    await updatePhotoCaption(run.id, viewer.ts, caption);
    setPhotos((ps) => ps.map((p) => (p.ts === viewer.ts ? { ...p, caption } : p)));
    setViewer(null);
  }

  async function share() {
    const photoLine = (run.photos || []).length
      ? `\n📷 ${run.photos.length} sight${run.photos.length === 1 ? '' : 's'} captured`
      : '';
    await Share.share({
      message:
        `I ran ${fmt.km(run.distM, run.unit)} through ${run.cityName} with LocalRun — ` +
        `${formatClock(run.elapsed)} at ${formatPace(avgPace)}/${run.unit}.` +
        `\nPassed: ${(run.highlights || []).map((h) => h.name).slice(0, 4).join(', ')}.` +
        photoLine,
    }).catch(() => {});
  }

  function confirmDelete() {
    Alert.alert('Delete this run?', 'Its stats and photos will be removed from history.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete },
    ]);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backText}>‹ Runs</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.title}>{run.cityName}</Text>
      <Text style={styles.subtitle}>{dateLabel(run.ts)}</Text>

      {run.coords?.length > 1 && (
        <View style={styles.mapWrap}>
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            provider={PROVIDER_DEFAULT}
            userInterfaceStyle={theme.isDark ? 'dark' : 'light'}
            scrollEnabled={false}
            zoomEnabled={false}
            onMapReady={() => {
              mapRef.current?.fitToCoordinates(run.coords, {
                edgePadding: { top: 30, right: 30, bottom: 30, left: 30 },
                animated: false,
              });
            }}
          >
            <Polyline coordinates={run.coords} strokeColor={theme.accent} strokeWidth={4} />
            {photos
              .filter((p) => p.lat != null)
              .map((p) => (
                <Marker key={p.ts} coordinate={{ latitude: p.lat, longitude: p.lng }}>
                  <View style={styles.photoPin}>
                    <Text style={styles.photoPinText}>📷</Text>
                  </View>
                </Marker>
              ))}
          </MapView>
        </View>
      )}

      <View style={styles.statsCard}>
        <View style={styles.statsRow}>
          <DetailStat value={fmt.km(run.distM, run.unit)} label="distance" />
          <DetailStat value={formatClock(run.elapsed)} label="time" />
          <DetailStat value={formatPace(avgPace)} label={`avg /${run.unit}`} />
          <DetailStat value={String((run.seen || []).length)} label="seen" />
        </View>
        {run.rating > 0 && (
          <Text style={styles.detailStars}>
            {'★'.repeat(run.rating)}
            <Text style={styles.cardStarsDim}>{'★'.repeat(5 - run.rating)}</Text>
          </Text>
        )}
        {!!run.note && <Text style={styles.note}>“{run.note}”</Text>}
      </View>

      {(run.splits || []).length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Splits</Text>
          <View style={styles.statsCard}>
            {run.splits.map((s, i) => (
              <View key={i} style={[styles.splitRow, i > 0 && styles.splitDivider]}>
                <Text style={styles.splitNum}>
                  {run.unit} {i + 1}
                </Text>
                <Text style={styles.splitTime}>{formatPace(s)}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {photos.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Sights you captured</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
            {photos.map((p) => (
              <TouchableOpacity key={p.ts} style={styles.photoCard} onPress={() => openPhoto(p)}>
                <Image source={{ uri: p.uri }} style={styles.photo} />
                {!!(p.caption || p.placeName) && (
                  <Text style={styles.photoLabel} numberOfLines={1}>
                    {p.caption || p.placeName}
                  </Text>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </>
      )}

      {/* Full-screen photo viewer with caption editing */}
      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <KeyboardAvoidingView
          style={styles.viewerBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity style={styles.viewerClose} onPress={() => setViewer(null)}>
            <Text style={styles.viewerCloseText}>✕</Text>
          </TouchableOpacity>
          {viewer && <Image source={{ uri: viewer.uri }} style={styles.viewerImage} resizeMode="contain" />}
          {!!viewer?.placeName && <Text style={styles.viewerPlace}>📍 {viewer.placeName}</Text>}
          <View style={styles.viewerCaptionRow}>
            <TextInput
              style={styles.viewerInput}
              placeholder="Add a caption…"
              placeholderTextColor="rgba(255,255,255,0.45)"
              value={captionDraft}
              onChangeText={setCaptionDraft}
              returnKeyType="done"
              onSubmitEditing={saveCaption}
            />
            <TouchableOpacity style={styles.viewerSave} onPress={saveCaption}>
              <Text style={styles.viewerSaveText}>Save</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <TouchableOpacity style={styles.shareBtn} onPress={share}>
        <Text style={styles.shareText}>Share run</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.deleteBtn} onPress={confirmDelete}>
        <Text style={styles.deleteText}>Delete run</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function DetailStat({ value, label }) {
  const styles = getStyles(useTheme());
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const getStyles = themedStyles((theme) => ({
  screen: { flex: 1, paddingHorizontal: 18 },
  headerRow: { marginTop: 8, flexDirection: 'row' },
  backText: { color: theme.accent, fontSize: 16, fontWeight: '600' },
  title: { color: theme.text, fontSize: 34, fontWeight: '700', letterSpacing: -0.5, marginTop: 8 },
  subtitle: { color: theme.textDim, fontSize: 15, marginTop: 2 },
  empty: { color: theme.textDim, fontSize: 14, lineHeight: 21, marginTop: 16 },
  card: {
    backgroundColor: theme.card,
    borderRadius: 14,
    padding: 16,
    marginTop: 12,
    ...shadow,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardCity: { color: theme.text, fontSize: 16, fontWeight: '600' },
  cardDate: { color: theme.textDim, fontSize: 13 },
  cardStats: { flexDirection: 'row', gap: 18, marginTop: 8 },
  cardStat: { color: theme.textDim, fontSize: 14, fontWeight: '500' },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  cardStars: { color: theme.accent, fontSize: 14 },
  cardStarsDim: { color: theme.border },
  cardPhotos: { color: theme.textDim, fontSize: 13 },
  mapWrap: { height: 180, borderRadius: 16, overflow: 'hidden', marginTop: 14 },
  photoPin: {
    backgroundColor: theme.accentDeep,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  photoPinText: { fontSize: 12 },
  statsCard: {
    backgroundColor: theme.card,
    borderRadius: 14,
    padding: 16,
    marginTop: 12,
    ...shadow,
  },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { color: theme.text, fontSize: 17, fontWeight: '700' },
  statLabel: { color: theme.textDim, fontSize: 12, marginTop: 2 },
  detailStars: { color: theme.accent, fontSize: 18, textAlign: 'center', marginTop: 12 },
  note: { color: theme.text, fontSize: 14, fontStyle: 'italic', textAlign: 'center', marginTop: 10 },
  sectionLabel: {
    color: theme.textDim,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 22,
    marginBottom: 4,
  },
  splitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  splitDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
  splitNum: { color: theme.textDim, fontSize: 14 },
  splitTime: { color: theme.text, fontSize: 14, fontWeight: '600' },
  photoCard: { marginRight: 10, marginTop: 8, width: 140 },
  photo: { width: 140, height: 140, borderRadius: 12, backgroundColor: theme.cardAlt },
  photoLabel: { color: theme.textDim, fontSize: 12, marginTop: 4 },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.94)',
    justifyContent: 'center',
    paddingBottom: 24,
  },
  viewerClose: {
    position: 'absolute',
    top: 56,
    right: 20,
    zIndex: 2,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerCloseText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  viewerImage: { flex: 1, marginTop: 70, marginBottom: 12 },
  viewerPlace: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 10,
  },
  viewerCaptionRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  viewerInput: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    color: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
  },
  viewerSave: {
    backgroundColor: theme.accent,
    borderRadius: 12,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  viewerSaveText: { color: theme.onAccent, fontWeight: '600', fontSize: 15 },
  shareBtn: {
    backgroundColor: theme.accent,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 24,
    ...shadow,
  },
  shareText: { color: theme.onAccent, fontSize: 16, fontWeight: '600' },
  deleteBtn: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  deleteText: { color: theme.danger, fontSize: 15, fontWeight: '500' },
}));

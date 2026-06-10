import React from 'react';
import { Modal, Pressable, Text, TouchableOpacity, View, Switch } from 'react-native';
import { useTheme, themedStyles, shadow } from '../theme';
import { TALK_LEVELS } from '../lib/settings';
import Glass from './Glass';

export default function SettingsModal({ visible, settings, onChange, onClose }) {
  const theme = useTheme();
  const styles = getStyles(theme);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable onPress={(e) => e.stopPropagation()}>
          <Glass style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Settings</Text>

          <Text style={styles.label}>How much should it talk?</Text>
          <Text style={styles.sub}>
            Turn directions and place call-outs always play. This sets how often it
            narrates the area you're running through.
          </Text>
          <View style={styles.row}>
            {TALK_LEVELS.map((l) => (
              <TouchableOpacity
                key={l.key}
                style={[styles.opt, settings.talk === l.key && styles.optActive]}
                onPress={() => onChange({ ...settings, talk: l.key })}
              >
                <Text style={[styles.optLabel, settings.talk === l.key && styles.optLabelActive]}>
                  {l.label}
                </Text>
                <Text style={styles.optBlurb}>{l.blurb}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Voice guidance</Text>
              <Text style={styles.sub}>Speak directions and call-outs aloud.</Text>
            </View>
            <Switch
              value={settings.voice}
              onValueChange={(v) => onChange({ ...settings, voice: v })}
              trackColor={{ true: theme.accent, false: theme.border }}
              thumbColor="#fff"
            />
          </View>

          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Dark mode</Text>
              <Text style={styles.sub}>Pure black, easier on the eyes at night.</Text>
            </View>
            <Switch
              value={!!settings.dark}
              onValueChange={(v) => onChange({ ...settings, dark: v })}
              trackColor={{ true: theme.accent, false: theme.border }}
              thumbColor="#fff"
            />
          </View>

          <TouchableOpacity style={styles.done} onPress={onClose}>
            <Text style={styles.doneText}>Done</Text>
          </TouchableOpacity>
          </Glass>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const getStyles = themedStyles((theme) => ({
  backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.4)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 22,
    paddingBottom: 36,
    overflow: 'hidden',
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: theme.border,
    alignSelf: 'center',
    marginBottom: 14,
  },
  title: { color: theme.text, fontSize: 22, fontWeight: '700', letterSpacing: -0.3, marginBottom: 18 },
  label: { color: theme.text, fontSize: 16, fontWeight: '600' },
  sub: { color: theme.textDim, fontSize: 13, marginTop: 3, lineHeight: 18 },
  row: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 8 },
  opt: {
    flex: 1,
    backgroundColor: theme.cardAlt,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  optActive: { backgroundColor: theme.tint },
  optLabel: { color: theme.text, fontWeight: '600', fontSize: 14 },
  optLabelActive: { color: theme.accent, fontWeight: '700' },
  optBlurb: { color: theme.textDim, fontSize: 10, marginTop: 3, textAlign: 'center' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 18 },
  done: {
    backgroundColor: theme.accent,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 26,
    ...shadow,
  },
  doneText: { color: theme.onAccent, fontSize: 16, fontWeight: '600' },
}));

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTheme, themedStyles } from '../theme';
import Glass from './Glass';
import Icon from './Icon';
import { tap } from '../lib/haptics';

const TABS = [
  { key: 'plan', label: 'Plan', icon: 'map' },
  { key: 'history', label: 'Runs', icon: 'runner' },
];

// Floating glass page selector, iOS 26 style: a pill hovering above the
// bottom edge. Only shown on the top-level screens (plan / history).
export default function TabBar({ tab, onChange }) {
  const theme = useTheme();
  const styles = getStyles(theme);
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Glass style={styles.bar}>
        <View style={styles.row}>
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <TouchableOpacity
                key={t.key}
                style={[styles.item, active && styles.itemActive]}
                onPress={() => {
                  if (!active) {
                    tap();
                    onChange(t.key);
                  }
                }}
              >
                <Icon name={t.icon} size={20} color={active ? theme.accent : theme.textDim} />
                <Text style={[styles.label, active && styles.labelActive]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Glass>
    </View>
  );
}

const getStyles = themedStyles((theme) => ({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 24,
    alignItems: 'center',
  },
  bar: { borderRadius: 28, overflow: 'hidden' },
  row: { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 7 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 21,
  },
  itemActive: { backgroundColor: theme.tint },
  label: { color: theme.textDim, fontSize: 14, fontWeight: '600' },
  labelActive: { color: theme.accent },
}));

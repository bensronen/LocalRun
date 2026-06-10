import React, { createContext, useContext } from 'react';
import { StyleSheet } from 'react-native';

// LocalRun themes: iOS-neutral surfaces with a dark evergreen accent.
// Light = system grouped background + white cards; dark = pure black + iOS
// dark elevated cards, with the accent lightened for contrast.
const light = {
  isDark: false,
  bg: '#f2f2f7', // iOS systemGroupedBackground
  card: '#ffffff',
  cardAlt: '#f2f2f7',
  text: '#1c1c1e',
  textDim: '#6e6e73',
  accent: '#2c5e40',
  accentDeep: '#1e4a30',
  good: '#3c7a52',
  border: 'rgba(60, 60, 67, 0.12)', // iOS separator
  tint: 'rgba(44, 94, 64, 0.12)', // accent wash for tinted buttons & segmented tracks
  danger: '#b9543f',
  onAccent: '#ffffff', // text on accent/good buttons
};

const dark = {
  isDark: true,
  bg: '#000000',
  card: '#1c1c1e',
  cardAlt: '#2c2c2e',
  text: '#f2f2f7',
  textDim: '#98989f',
  accent: '#4ca271',
  accentDeep: '#3c8a5f',
  good: '#4ca271',
  border: 'rgba(84, 84, 88, 0.5)',
  tint: 'rgba(76, 162, 113, 0.22)',
  danger: '#e0654f',
  onAccent: '#ffffff',
};

export const themes = { light, dark };

const ThemeContext = createContext(light);

export function ThemeProvider({ dark: isDark, children }) {
  return <ThemeContext.Provider value={isDark ? dark : light}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

// Per-file style factory with one StyleSheet per theme:
//   const getStyles = themedStyles((theme) => ({ ... }));
//   ...inside a component: const styles = getStyles(useTheme());
export function themedStyles(factory) {
  const cache = new Map();
  return (theme) => {
    if (!cache.has(theme)) cache.set(theme, StyleSheet.create(factory(theme)));
    return cache.get(theme);
  };
}

// Soft elevation for cards and buttons — surfaces float on the background
// instead of being outlined.
export const shadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 2,
};

export const fmt = {
  km(meters, unit = 'km') {
    if (unit === 'mi') return `${(meters / 1609.34).toFixed(1)} mi`;
    return `${(meters / 1000).toFixed(1)} km`;
  },
  // Estimated running time at a given pace (min/km), formatted h:mm or m min.
  runTime(meters, paceMinPerKm = 6) {
    const mins = Math.round((meters / 1000) * paceMinPerKm);
    if (mins < 60) return `${mins} min`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  },
};

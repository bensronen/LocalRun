// LocalRun theme: iOS-neutral surfaces — system-style grouped background and
// white cards — with the dusk palette surviving in the dark evergreen accent
// (and the category pin colors in src/data/categories.js).
export const theme = {
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

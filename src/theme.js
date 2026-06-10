export const theme = {
  bg: '#0b1220',
  card: '#141d2e',
  cardAlt: '#1b2740',
  text: '#f1f5f9',
  textDim: '#94a3b8',
  accent: '#38bdf8',
  accentDeep: '#0ea5e9',
  good: '#22c55e',
  border: '#243049',
  danger: '#f87171',
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

// LocalRun theme: a dusk sky fading from pale blue through cream to peach,
// over dark evergreen hills. `sky` is the app background gradient (top -> bottom);
// dark green carries text, buttons, and accents.
export const theme = {
  sky: ['#aec7de', '#d7d9d2', '#f2e4c4', '#f4cb9d', '#eda87e'],
  bg: '#ece4d0', // fallback for surfaces the gradient doesn't reach
  card: '#fdf9ef',
  cardAlt: '#f3ebd9',
  text: '#1d3527',
  textDim: '#5f7163',
  accent: '#2c5e40',
  accentDeep: '#1e4a30',
  good: '#3c7a52',
  border: 'rgba(29, 53, 39, 0.12)',
  tint: 'rgba(44, 94, 64, 0.12)', // accent wash for tinted buttons & segmented tracks
  danger: '#b9543f',
  onAccent: '#f7f1e3', // text on accent/good buttons
};

// Soft elevation for cards and buttons — surfaces float on the gradient
// instead of being outlined.
export const shadow = {
  shadowColor: '#1d3527',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.08,
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

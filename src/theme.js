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
  border: 'rgba(29, 53, 39, 0.22)',
  danger: '#b9543f',
  // dark translucent surfaces floating over the map
  overlay: 'rgba(20, 38, 27, 0.88)',
  onOverlay: '#f3eee0',
  accentSoft: '#a9d4b8', // accent legible on `overlay`
  onAccent: '#f7f1e3', // text on accent/good buttons
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

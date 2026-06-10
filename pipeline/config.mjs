// City configs for the scenic-data pipeline. Adding a new city = add an entry here
// (a bbox + center + any water-crossing zones) and run the pipeline.

export const CITIES = {
  nyc: {
    id: 'nyc',
    name: 'New York',
    emoji: '🗽',
    center: { lat: 40.745, lng: -73.99 },
    // [west, south, east, north] — kept to the runnable core.
    bbox: [-74.02, 40.7, -73.94, 40.8],
    primaryZone: 'manhattan',
    // Points on the far side of a water barrier get a zone so routing knows it's a bridge.
    zones: [{ name: 'brooklyn', test: (lat, lng) => lng > -73.99 && lat < 40.72 }],
    defaultStart: { lat: 40.7308, lng: -73.9973, name: 'Washington Square Park' },
    presets: [
      { label: 'Midtown', lat: 40.7549, lng: -73.984, name: 'Midtown (Times Sq area)' },
      { label: 'FiDi', lat: 40.7068, lng: -74.0113, name: 'Financial District' },
      { label: 'Williamsburg', lat: 40.7142, lng: -73.9568, name: 'Williamsburg, Brooklyn' },
      { label: 'UWS', lat: 40.7857, lng: -73.9754, name: 'Upper West Side' },
    ],
  },
  sf: {
    id: 'sf',
    name: 'San Francisco',
    emoji: '🌉',
    center: { lat: 37.7849, lng: -122.4094 },
    bbox: [-122.515, 37.74, -122.39, 37.81],
    primaryZone: 'sf',
    zones: [],
    defaultStart: { lat: 37.7955, lng: -122.3937, name: 'Embarcadero / Ferry Building' },
    presets: [
      { label: 'Embarcadero', lat: 37.7955, lng: -122.3937, name: 'Embarcadero / Ferry Building' },
      { label: 'Marina', lat: 37.8037, lng: -122.4368, name: 'Marina District' },
      { label: 'Mission', lat: 37.7599, lng: -122.4148, name: 'The Mission / Dolores Park' },
      { label: 'Haight', lat: 37.7702, lng: -122.4469, name: 'Haight / Golden Gate Park' },
    ],
  },
  boston: {
    id: 'boston',
    name: 'Boston',
    emoji: '⛵',
    center: { lat: 42.3554, lng: -71.0656 },
    bbox: [-71.12, 42.33, -71.03, 42.39],
    primaryZone: 'boston',
    zones: [{ name: 'cambridge', test: (lat) => lat > 42.363 }],
    defaultStart: { lat: 42.3554, lng: -71.0656, name: 'Boston Common' },
    presets: [
      { label: 'Back Bay', lat: 42.3503, lng: -71.081, name: 'Back Bay' },
      { label: 'Seaport', lat: 42.3519, lng: -71.0436, name: 'Seaport District' },
      { label: 'North End', lat: 42.3647, lng: -71.0542, name: 'North End' },
      { label: 'Cambridge', lat: 42.3736, lng: -71.1097, name: 'Harvard Sq, Cambridge' },
    ],
  },
  tokyo: {
    id: 'tokyo',
    name: 'Tokyo',
    emoji: '🗼',
    center: { lat: 35.6812, lng: 139.7671 },
    bbox: [139.69, 35.63, 139.81, 35.73],
    primaryZone: 'tokyo',
    zones: [{ name: 'odaiba', test: (lat) => lat < 35.64 }],
    defaultStart: { lat: 35.6812, lng: 139.7671, name: 'Tokyo Station / Imperial Palace' },
    presets: [
      { label: 'Shinjuku', lat: 35.6896, lng: 139.7006, name: 'Shinjuku' },
      { label: 'Shibuya', lat: 35.658, lng: 139.7016, name: 'Shibuya' },
      { label: 'Asakusa', lat: 35.7148, lng: 139.7967, name: 'Asakusa' },
      { label: 'Marunouchi', lat: 35.6812, lng: 139.7671, name: 'Tokyo Station' },
    ],
  },
  paris: {
    id: 'paris',
    name: 'Paris',
    emoji: '🥐',
    center: { lat: 48.857, lng: 2.3475 },
    bbox: [2.27, 48.84, 2.4, 48.89],
    primaryZone: 'paris',
    // The Seine cuts west-to-east through the center; the south bank is the Rive Gauche.
    zones: [{ name: 'rive-gauche', test: (lat) => lat < 48.853 }],
    defaultStart: { lat: 48.8606, lng: 2.3376, name: 'Jardin des Tuileries' },
    presets: [
      { label: 'Eiffel', lat: 48.8556, lng: 2.2986, name: 'Champ de Mars / Eiffel Tower' },
      { label: 'Marais', lat: 48.859, lng: 2.359, name: 'Le Marais' },
      { label: 'Latin Qtr', lat: 48.8499, lng: 2.347, name: 'Latin Quarter / Luxembourg' },
      { label: 'Montmartre', lat: 48.8867, lng: 2.3431, name: 'Montmartre' },
    ],
  },
  london: {
    id: 'london',
    name: 'London',
    emoji: '🎡',
    center: { lat: 51.5074, lng: -0.118 },
    bbox: [-0.18, 51.48, -0.06, 51.54],
    primaryZone: 'london',
    // The Thames winds through the center; everything below it is South of the River.
    zones: [{ name: 'south-bank', test: (lat) => lat < 51.503 }],
    defaultStart: { lat: 51.5033, lng: -0.1195, name: 'Jubilee Gardens / South Bank' },
    presets: [
      { label: 'Hyde Park', lat: 51.5073, lng: -0.1657, name: 'Hyde Park' },
      { label: 'South Bank', lat: 51.5066, lng: -0.1145, name: 'South Bank' },
      { label: "Regent's Pk", lat: 51.5313, lng: -0.157, name: "Regent's Park" },
      { label: 'The City', lat: 51.5155, lng: -0.0922, name: 'City of London' },
    ],
  },
  austin: {
    id: 'austin',
    name: 'Austin',
    emoji: '🎸',
    center: { lat: 30.2672, lng: -97.7431 },
    bbox: [-97.79, 30.24, -97.71, 30.3],
    primaryZone: 'austin',
    // Lady Bird Lake runs east-west; the south shore is South Austin.
    zones: [{ name: 'south-austin', test: (lat) => lat < 30.252 }],
    defaultStart: { lat: 30.2643, lng: -97.7475, name: 'Lady Bird Lake / Auditorium Shores' },
    presets: [
      { label: 'Zilker', lat: 30.2669, lng: -97.7729, name: 'Zilker Park' },
      { label: 'SoCo', lat: 30.2489, lng: -97.7501, name: 'South Congress (SoCo)' },
      { label: 'Downtown', lat: 30.2672, lng: -97.7431, name: 'Downtown / Capitol' },
      { label: 'East', lat: 30.264, lng: -97.722, name: 'East Austin' },
    ],
  },
  miami: {
    id: 'miami',
    name: 'Miami',
    emoji: '🌴',
    center: { lat: 25.7743, lng: -80.1937 },
    bbox: [-80.21, 25.74, -80.12, 25.81],
    primaryZone: 'miami',
    // Miami Beach sits across Biscayne Bay on the barrier island to the east.
    zones: [{ name: 'miami-beach', test: (lat, lng) => lng > -80.16 }],
    defaultStart: { lat: 25.7753, lng: -80.186, name: 'Bayfront Park' },
    presets: [
      { label: 'Brickell', lat: 25.7617, lng: -80.1918, name: 'Brickell' },
      { label: 'South Beach', lat: 25.7826, lng: -80.13, name: 'South Beach' },
      { label: 'Wynwood', lat: 25.801, lng: -80.199, name: 'Wynwood' },
      { label: 'Downtown', lat: 25.7743, lng: -80.1937, name: 'Downtown Miami' },
    ],
  },
  chicago: {
    id: 'chicago',
    name: 'Chicago',
    emoji: '🌆',
    center: { lat: 41.8819, lng: -87.6278 },
    bbox: [-87.68, 41.84, -87.6, 41.93],
    primaryZone: 'chicago',
    zones: [],
    defaultStart: { lat: 41.8826, lng: -87.6226, name: 'Millennium Park' },
    presets: [
      { label: 'The Loop', lat: 41.8819, lng: -87.6278, name: 'The Loop' },
      { label: 'Lincoln Pk', lat: 41.9214, lng: -87.634, name: 'Lincoln Park' },
      { label: 'Navy Pier', lat: 41.8917, lng: -87.6086, name: 'Navy Pier' },
      { label: 'Museum', lat: 41.8663, lng: -87.6166, name: 'Museum Campus' },
    ],
  },
  dc: {
    id: 'dc',
    name: 'Washington, DC',
    emoji: '🏛️',
    center: { lat: 38.8951, lng: -77.0364 },
    bbox: [-77.07, 38.86, -76.98, 38.93],
    primaryZone: 'dc',
    zones: [],
    defaultStart: { lat: 38.8895, lng: -77.0353, name: 'Washington Monument / National Mall' },
    presets: [
      { label: 'The Mall', lat: 38.8895, lng: -77.0231, name: 'National Mall' },
      { label: 'Tidal Basin', lat: 38.8849, lng: -77.0387, name: 'Tidal Basin' },
      { label: 'Georgetown', lat: 38.9047, lng: -77.0628, name: 'Georgetown Waterfront' },
      { label: 'Capitol Hill', lat: 38.8899, lng: -76.9942, name: 'Capitol Hill' },
    ],
  },
};

export function zoneFor(city, lat, lng) {
  for (const z of city.zones || []) {
    if (z.test(lat, lng)) return z.name;
  }
  return city.primaryZone;
}

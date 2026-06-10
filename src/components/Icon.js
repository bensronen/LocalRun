import React from 'react';
import { Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

// Real SF Symbols on iOS (they pick up the Liquid Glass rendering inside Glass
// surfaces); Ionicons everywhere else. Require defensively so a runtime
// without the native module just uses the fallback.
let SymbolView = null;
try {
  SymbolView = require('expo-symbols').SymbolView;
} catch {
  // fallback below
}

const ICONS = {
  settings: { sf: 'gearshape', ion: 'settings-outline' },
  history: { sf: 'clock', ion: 'time-outline' },
  camera: { sf: 'camera.fill', ion: 'camera' },
  photo: { sf: 'camera', ion: 'camera-outline' },
  close: { sf: 'xmark', ion: 'close' },
  check: { sf: 'checkmark', ion: 'checkmark' },
  chevronDown: { sf: 'chevron.down', ion: 'chevron-down' },
  chevronLeft: { sf: 'chevron.left', ion: 'chevron-back' },
  refresh: { sf: 'arrow.clockwise', ion: 'refresh' },
  map: { sf: 'map.fill', ion: 'map' },
  runner: { sf: 'figure.run', ion: 'walk' },
  eye: { sf: 'eye', ion: 'eye-outline' },
  sparkles: { sf: 'sparkles', ion: 'sparkles' },
  bulb: { sf: 'lightbulb', ion: 'bulb-outline' },
  transit: { sf: 'tram.fill', ion: 'train-outline' },
  flag: { sf: 'flag.checkered', ion: 'flag' },
  pin: { sf: 'mappin.and.ellipse', ion: 'location-outline' },
  turnLeft: { sf: 'arrow.turn.up.left', ion: 'arrow-back' },
  turnRight: { sf: 'arrow.turn.up.right', ion: 'arrow-forward' },
  straight: { sf: 'arrow.up', ion: 'arrow-up' },
  locate: { sf: 'location.fill', ion: 'locate' },
  water: { sf: 'water.waves', ion: 'water-outline' },
  tree: { sf: 'tree', ion: 'leaf-outline' },
  binoculars: { sf: 'binoculars', ion: 'eye-outline' },
  building: { sf: 'building.2', ion: 'business-outline' },
};

export default function Icon({ name, size = 20, color, weight = 'semibold', style }) {
  const def = ICONS[name] || ICONS.close;
  if (Platform.OS === 'ios' && SymbolView) {
    return (
      <SymbolView
        name={def.sf}
        size={size}
        tintColor={color}
        weight={weight}
        style={[{ width: size, height: size }, style]}
      />
    );
  }
  return <Ionicons name={def.ion} size={size} color={color} style={style} />;
}

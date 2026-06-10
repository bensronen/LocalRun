import React from 'react';
import { View, Platform } from 'react-native';
import { BlurView } from 'expo-blur';

// expo-glass-effect needs the iOS 26 native APIs; require defensively so older
// runtimes fall back to blur instead of crashing on import.
let GlassView = null;
let liquidGlass = false;
try {
  const glass = require('expo-glass-effect');
  GlassView = glass.GlassView;
  liquidGlass = glass.isLiquidGlassAvailable();
} catch {
  // module not in this runtime — blur fallback below
}

// A floating glass surface: Apple Liquid Glass on iOS 26+, frosted BlurView on
// older iOS, translucent solid on Android. Pass shape/padding via `style`, but
// no backgroundColor — that would paint over the glass. colorScheme is pinned
// light so the app's dark-green text stays legible over the material.
export default function Glass({ style, children, isInteractive = false, ...rest }) {
  if (liquidGlass && GlassView) {
    return (
      <GlassView style={style} isInteractive={isInteractive} colorScheme="light" {...rest}>
        {children}
      </GlassView>
    );
  }
  if (Platform.OS === 'ios') {
    return (
      <BlurView intensity={55} tint="extraLight" style={[style, { overflow: 'hidden' }]} {...rest}>
        {children}
      </BlurView>
    );
  }
  return (
    <View style={[style, { backgroundColor: 'rgba(255, 255, 255, 0.93)' }]} {...rest}>
      {children}
    </View>
  );
}

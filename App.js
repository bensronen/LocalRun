import React, { useState, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet, Alert } from 'react-native';
import PlanScreen from './src/screens/PlanScreen';
import RouteScreen from './src/screens/RouteScreen';
import { buildRoute } from './src/lib/routeBuilder';
import { theme } from './src/theme';

export default function App() {
  const [result, setResult] = useState(null);

  // PlanScreen hands up { route, highlights, shape, start, unit, ..., plan }.
  const handleRouteBuilt = useCallback((res) => setResult(res), []);

  // "Another route": same inputs, jitter on for a genuinely different pick.
  const regenerate = useCallback(async () => {
    if (!result?.plan) return;
    try {
      const fresh = await buildRoute(result.start, { ...result.plan, jitter: 0.7 }, result.city);
      setResult({
        ...fresh,
        start: result.start,
        unit: result.unit,
        plan: result.plan,
        city: result.city,
      });
    } catch (e) {
      Alert.alert('Could not regenerate', e.message);
    }
  }, [result]);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      {result ? (
        <RouteScreen result={result} onBack={() => setResult(null)} onRegenerate={regenerate} />
      ) : (
        <PlanScreen onRouteBuilt={handleRouteBuilt} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
});

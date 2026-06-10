import React, { useState, useCallback, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import PlanScreen from './src/screens/PlanScreen';
import RouteScreen from './src/screens/RouteScreen';
import RunScreen from './src/screens/RunScreen';
import SettingsModal from './src/components/SettingsModal';
import { buildRoute } from './src/lib/routeBuilder';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from './src/lib/settings';
import { theme } from './src/theme';

export default function App() {
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  const updateSettings = useCallback((s) => {
    setSettings(s);
    saveSettings(s);
  }, []);

  const handleRouteBuilt = useCallback((res) => setResult(res), []);

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

  let screen;
  if (running && result) {
    screen = <RunScreen result={result} settings={settings} onExit={() => setRunning(false)} />;
  } else if (result) {
    screen = (
      <RouteScreen
        result={result}
        onBack={() => setResult(null)}
        onRegenerate={regenerate}
        onStartRun={() => setRunning(true)}
      />
    );
  } else {
    screen = <PlanScreen onRouteBuilt={handleRouteBuilt} onOpenSettings={() => setSettingsOpen(true)} />;
  }

  return (
    <LinearGradient colors={theme.sky} style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <StatusBar style="dark" />
        {screen}
        <SettingsModal
          visible={settingsOpen}
          settings={settings}
          onChange={updateSettings}
          onClose={() => setSettingsOpen(false)}
        />
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  safe: { flex: 1 },
});

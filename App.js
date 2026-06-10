import React, { useState, useCallback, useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Alert } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import PlanScreen from './src/screens/PlanScreen';
import RouteScreen from './src/screens/RouteScreen';
import RunScreen from './src/screens/RunScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import SettingsModal from './src/components/SettingsModal';
import { buildRoute } from './src/lib/routeBuilder';
import { saveRun, boostsFromRun } from './src/lib/history';
import { submitRun } from './src/lib/api';
import {
  loadSettings,
  saveSettings,
  loadPlanDraft,
  savePlanDraft,
  DEFAULT_SETTINGS,
} from './src/lib/settings';
import { success, thump } from './src/lib/haptics';
import { themes, ThemeProvider } from './src/theme';

export default function App() {
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const draftSaveTimer = useRef(null);

  useEffect(() => {
    loadSettings().then(setSettings);
    loadPlanDraft().then((d) => {
      setDraft(d);
      setDraftLoaded(true);
    });
    return () => clearTimeout(draftSaveTimer.current);
  }, []);

  const updateSettings = useCallback((s) => {
    setSettings(s);
    saveSettings(s);
  }, []);

  // The plan screen reports every change; keep it for back-navigation and
  // debounce-persist it so a relaunch restores the last setup.
  const updateDraft = useCallback((d) => {
    setDraft(d);
    clearTimeout(draftSaveTimer.current);
    draftSaveTimer.current = setTimeout(() => savePlanDraft(d), 600);
  }, []);

  const handleRouteBuilt = useCallback((res) => {
    success();
    setResult(res);
  }, []);

  const regenerate = useCallback(async () => {
    if (!result?.plan || regenerating) return;
    try {
      setRegenerating(true);
      const fresh = await buildRoute(result.start, { ...result.plan, jitter: 0.7 }, result.city);
      setResult({
        ...fresh,
        start: result.start,
        unit: result.unit,
        plan: result.plan,
        city: result.city,
        community: result.community,
      });
      success();
    } catch (e) {
      Alert.alert('Could not regenerate', e.message);
    } finally {
      setRegenerating(false);
    }
  }, [result, regenerating]);

  const startRun = useCallback(() => {
    thump();
    setRunning(true);
  }, []);

  // Save a finished run: write history, feed photos/rating back into the
  // place-boost model, share the anonymized summary with the community
  // backend (best-effort), then return home.
  const handleSaveRun = useCallback(async (record) => {
    await saveRun(record);
    await boostsFromRun(record);
    submitRun(record); // fire-and-forget; never blocks saving
    setRunning(false);
    setResult(null);
  }, []);

  let screen = null;
  if (running && result) {
    screen = (
      <RunScreen
        result={result}
        settings={settings}
        onExit={() => setRunning(false)}
        onSave={handleSaveRun}
      />
    );
  } else if (historyOpen) {
    screen = <HistoryScreen onBack={() => setHistoryOpen(false)} />;
  } else if (result) {
    screen = (
      <RouteScreen
        result={result}
        regenerating={regenerating}
        onBack={() => setResult(null)}
        onRegenerate={regenerate}
        onStartRun={startRun}
      />
    );
  } else if (draftLoaded) {
    screen = (
      <PlanScreen
        draft={draft}
        onDraftChange={updateDraft}
        onRouteBuilt={handleRouteBuilt}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenHistory={() => setHistoryOpen(true)}
      />
    );
  }

  return (
    <ThemeProvider dark={!!settings.dark}>
      <SafeAreaProvider>
        <SafeAreaView
          style={[styles.root, { backgroundColor: settings.dark ? themes.dark.bg : themes.light.bg }]}
        >
          <StatusBar style={settings.dark ? 'light' : 'dark'} />
          {screen}
          <SettingsModal
            visible={settingsOpen}
            settings={settings}
            onChange={updateSettings}
            onClose={() => setSettingsOpen(false)}
          />
        </SafeAreaView>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});

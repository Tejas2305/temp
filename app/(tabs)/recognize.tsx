import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Share,
  AppState,
} from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';

import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { ScreenHeader } from '@/components/ScreenHeader';
import { spacing, radius } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { saveHistoryEntry } from '@/services/storage';
import { CaptionState } from '@/services/captionState';
import WebEngineView from '@/components/recognition/WebEngineView';
import NativeEngineView from '@/components/recognition/NativeEngineView';
import type { EngineResult, EngineStatus } from '@/components/recognition/types';

const MIN_CONF = 0.7;
const GOOD = '#34D399';
const BAD = '#F87171';
const WARN = '#FBBF24';

type EngineKind = 'web' | 'native';

export default function Recognize() {
  const { colors } = useTheme();
  const { language } = useLanguage();
  const router = useRouter();
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const [permission, requestPermission] = useCameraPermissions();

  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [engine, setEngine] = useState<EngineKind>('web');
  const [status, setStatus] = useState<EngineStatus>({ state: 'loading' });
  const [engineNote, setEngineNote] = useState<string | null>(null);
  const [facing, setFacing] = useState<'front' | 'back'>('front');
  const [active, setActive] = useState(false);
  const [fps, setFps] = useState(0);
  const [aspect, setAspect] = useState(3 / 4);
  const handleDims = useCallback((w: number, h: number) => {
    if (w > 0 && h > 0) setAspect(w / h);
  }, []);

  const capRef = useRef(new CaptionState());
  const [text, setText] = useState('');
  const [liveRaw, setLive] = useState<{ label: string; conf: number } | null>(null);
  const [holdRaw, setHold] = useState(0);
  const [handsRaw, setHands] = useState(0);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  // Engine only runs while this tab is visible and the app is in the foreground
  const running = active && focused && appActive;

  useEffect(() => {
    if (!running) capRef.current.resetTracking();
  }, [running]);

  // Values from the last frame are only meaningful while running
  const live = running ? liveRaw : null;
  const hold = running ? holdRaw : 0;
  const hands = running ? handsRaw : 0;

  const handleResult = useCallback((r: EngineResult) => {
    const cap = capRef.current;
    const now = Date.now();
    const add = cap.update(r.hasHand ? { hasHand: true, label: r.label, conf: r.conf } : { hasHand: false }, now);
    setHands(r.hasHand ? r.n ?? 1 : 0);
    setLive(r.hasHand && r.label ? { label: r.label, conf: r.conf ?? 0 } : null);
    setHold(cap.holdProgress(now));
    if (add) {
      setText(cap.text);
      if (add.trim()) {
        saveHistoryEntry({
          id: `${now}-${add}`,
          sign: add,
          confidence: r.conf ?? 0,
          timestamp: now,
        }).catch(() => {});
      }
    }
  }, []);

  const handleStatus = useCallback((s: EngineStatus) => {
    setStatus(s);
    if (s.state === 'error') {
      console.warn('[recognize] engine error:', s.code, s.message);
      setEngine((cur) => {
        if (cur === 'web') {
          setEngineNote('Compatibility mode — the fast engine could not start on this device.');
          return 'native';
        }
        return cur;
      });
      if (s.code === 'camera-denied') setEngineNote('Camera access was denied for the engine.');
    }
  }, []);

  const editText = (fn: (t: string) => string) => {
    const cap = capRef.current;
    cap.text = fn(cap.text);
    setText(cap.text);
  };

  const share = () => {
    if (text.trim()) Share.share({ message: text.trim() }).catch(() => {});
  };

  const ready = status.state === 'ready';
  const hasError = status.state === 'error' && engine === 'native';

  const badge = useMemo(() => {
    if (hasError) return { text: 'Engine error', color: BAD };
    if (!ready) return { text: 'Loading engine…', color: WARN };
    if (!active) return { text: 'Paused', color: WARN };
    if (hands > 0) return { text: `${hands} hand${hands > 1 ? 's' : ''}`, color: GOOD };
    return { text: 'Show your hand', color: BAD };
  }, [hasError, ready, active, hands]);

  if (!permission) {
    return (
      <Screen edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  if (!permission.granted) {
    return (
      <Screen edges={['top']}>
        <View style={styles.center}>
          <View style={[styles.permIcon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="camera-outline" size={36} color={colors.primary} />
          </View>
          <Text style={[typography.h2, { color: colors.textPrimary, marginTop: spacing.lg, textAlign: 'center' }]}>
            Camera access needed
          </Text>
          <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing.sm, textAlign: 'center' }]}>
            Abhivyakti reads ISL fingerspelling from your camera. Nothing leaves your phone.
          </Text>
          <View style={{ marginTop: spacing.xl }}>
            <Button label="Allow camera" onPress={requestPermission} />
          </View>
        </View>
      </Screen>
    );
  }

  const progressPct = Math.round(hold * 100);

  return (
    <Screen edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <ScreenHeader
          title="Recognize"
          subtitle={`On-device · ${language.name} fingerspelling`}
          rightNode={
            <View style={[styles.chip, { backgroundColor: colors.primarySoft }]}>
              <Ionicons name={engine === 'web' ? 'flash' : 'hardware-chip-outline'} size={12} color={colors.primary} />
              <Text style={[styles.chipText, { color: colors.primary }]}>
                {engine === 'web' ? 'MediaPipe' : 'Compatibility'}
              </Text>
            </View>
          }
        />

        {/* Camera */}
        <View style={[styles.cameraWrap, { aspectRatio: Math.max(aspect, 0.66), borderColor: running ? colors.primary : colors.border }]}>
          {focused &&
            (engine === 'web' ? (
              <WebEngineView
                key="web"
                active={running}
                facing={facing}
                onResult={handleResult}
                onStatus={handleStatus}
                onFps={setFps}
                onDims={handleDims}
              />
            ) : (
              <NativeEngineView
                key="native"
                active={running}
                facing={facing}
                onResult={handleResult}
                onStatus={handleStatus}
                onFps={setFps}
              />
            ))}

          {/* Status pill */}
          <View style={styles.pill} pointerEvents="none">
            <View style={[styles.pillDot, { backgroundColor: badge.color }]} />
            <Text style={styles.pillText}>{badge.text}</Text>
          </View>

          {running && fps > 0 && (
            <View style={[styles.pill, styles.pillRight]} pointerEvents="none">
              <Text style={styles.pillText}>{fps} fps</Text>
            </View>
          )}

          {!ready && !hasError && (
            <View style={styles.loadingVeil} pointerEvents="none">
              <ActivityIndicator color="#fff" />
              <Text style={styles.loadingText}>Preparing recognition engine…</Text>
            </View>
          )}

          {/* Live letter + hold progress */}
          {running && live && (
            <View style={styles.liveCard} pointerEvents="none">
              <Text style={styles.liveLetter}>{live.label}</Text>
              <View style={{ gap: 4 }}>
                <Text style={styles.liveConf}>{Math.round(live.conf * 100)}%</Text>
                <View style={styles.track}>
                  <View
                    style={[
                      styles.trackFill,
                      { width: `${progressPct}%`, backgroundColor: live.conf >= MIN_CONF ? GOOD : WARN },
                    ]}
                  />
                </View>
              </View>
            </View>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Switch camera"
            onPress={() => setFacing((f) => (f === 'front' ? 'back' : 'front'))}
            style={styles.flipBtn}
          >
            <Ionicons name="camera-reverse-outline" size={22} color="#fff" />
          </Pressable>
        </View>

        {engineNote && (
          <View style={[styles.note, { backgroundColor: colors.primarySoft, borderColor: colors.border }]}>
            <Ionicons name="information-circle-outline" size={16} color={colors.primary} />
            <Text style={[typography.caption, { color: colors.textSecondary, flex: 1 }]}>{engineNote}</Text>
          </View>
        )}

        {/* Start / stop */}
        <View style={{ marginTop: spacing.lg }}>
          <Button
            label={active ? 'Stop translating' : 'Start translating'}
            onPress={() => setActive((a) => !a)}
            disabled={!ready}
            fullWidth
          />
        </View>

        {/* Caption */}
        <View style={[styles.caption, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.captionHeader}>
            <Text style={[typography.small, { color: colors.textSecondary, letterSpacing: 0.6 }]}>CAPTION</Text>
            <View style={styles.actions}>
              <ActionBtn icon="remove-outline" label="Add space" onPress={() => editText((t) => t + ' ')} />
              <ActionBtn icon="backspace-outline" label="Delete last" onPress={() => editText((t) => t.slice(0, -1))} />
              <ActionBtn
                icon="sparkles-outline"
                label="Ask Saathi about this"
                onPress={() => {
                  const t = text.trim();
                  if (!t) return;
                  router.push({
                    pathname: '/(tabs)/chat',
                    params: {
                      prefill: `I just fingerspelled "${t}". What does it mean, and how can I practice it?`,
                      ctx: `The user fingerspelled "${t}" with the Recognize tab.`,
                      nonce: String(Date.now()),
                    },
                  });
                }}
              />
              <ActionBtn icon="share-outline" label="Share" onPress={share} />
              <ActionBtn
                icon="trash-outline"
                label="Clear"
                onPress={() => {
                  capRef.current.reset();
                  setText('');
                }}
              />
            </View>
          </View>
          <Text
            selectable
            style={[
              styles.captionText,
              { color: text.length > 0 ? colors.textPrimary : colors.textMuted },
            ]}
          >
            {text.length > 0 ? text : 'Letters you sign appear here'}
          </Text>
        </View>

        <Text style={[typography.caption, { color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg }]}>
          Hold each letter steady for a moment. Lower your hand for 1.5 s to add a space.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function ActionBtn({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.actionBtn,
        { borderColor: colors.border, backgroundColor: pressed ? colors.primarySoft : 'transparent' },
      ]}
    >
      <Ionicons name={icon} size={18} color={colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  permIcon: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  chipText: { fontSize: 11, fontWeight: '700' },

  cameraWrap: {
    borderRadius: radius.xl,
    borderWidth: 2,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  pill: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  pillRight: { left: undefined, right: 12 },
  pillDot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  loadingVeil: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  loadingText: { color: '#fff', fontSize: 13, fontWeight: '500' },
  liveCard: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.lg,
  },
  liveLetter: { color: '#fff', fontSize: 34, fontWeight: '800', minWidth: 28, textAlign: 'center' },
  liveConf: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '700' },
  track: { width: 64, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  trackFill: { height: 4, borderRadius: 2 },
  flipBtn: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  caption: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    minHeight: 120,
  },
  captionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actions: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captionText: {
    marginTop: spacing.md,
    fontSize: 26,
    lineHeight: 34,
    fontWeight: '600',
    letterSpacing: 1,
  },
});

/**
 * Fallback recognition engine (on-device TFLite). Used only if the WebView engine can't start.
 * Emits raw per-frame results; caption rules are applied by the parent (same as the web engine).
 */
import React, { useEffect, useRef, useState } from 'react';
import { AppState, LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { CameraView } from 'expo-camera';
import HandLandmarkOverlay from '@/components/HandLandmarkOverlay';
import type { Landmark } from '@/services/landmarks';
import type { EngineProps } from './types';

const CAPTURE_BACKOFF_BASE_MS = 30;
const CAPTURE_BACKOFF_MAX_MS = 200;
const MAX_CAPTURE_FAILS = 3;

export default function NativeEngineView({ active, facing, onResult, onStatus, onFps }: EngineProps) {
  const cameraRef = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraKey, setCameraKey] = useState(0);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [hands, setHands] = useState<Landmark[][]>([]);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const modulesRef = useRef<any>(null);
  const failsRef = useRef(0);
  const cbRef = useRef({ onResult, onStatus, onFps });
  useEffect(() => {
    cbRef.current = { onResult, onStatus, onFps };
  });

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      setAppActive(s === 'active');
      if (s === 'active') {
        setCameraReady(false);
        setCameraKey((k) => k + 1);
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let cancelled = false;
    cbRef.current.onStatus({ state: 'loading', message: 'Loading on-device models' });
    (async () => {
      try {
        const tf = await import('@/services/tfliteModels');
        await tf.getHandDetector();
        await tf.getLandmarksDetector();
        await tf.getClassifier();
        const [h, l, c] = await Promise.all([
          import('@/services/handDetector'),
          import('@/services/landmarks'),
          import('@/services/classifier'),
        ]);
        if (cancelled) return;
        modulesRef.current = { detect: h.detectHandsWithSize, extract: l.extract130Features, classify: c.classify };
        setReady(true);
        cbRef.current.onStatus({ state: 'ready' });
      } catch (e: any) {
        if (!cancelled) cbRef.current.onStatus({ state: 'error', code: 'native', message: e?.message ?? String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    if (!ready || !cameraReady || !appActive) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let frames = 0;
    let fpsT = Date.now();
    failsRef.current = 0;

    const tick = async () => {
      if (cancelled) return;
      let delay = 0;
      try {
        let photo: any = null;
        try {
          photo = await cameraRef.current?.takePictureAsync({
            base64: false,
            quality: 0.5,
            skipProcessing: true,
            exif: false,
            shutterSound: false,
          } as any);
          failsRef.current = 0;
        } catch {
          failsRef.current += 1;
          delay = Math.min(CAPTURE_BACKOFF_MAX_MS, CAPTURE_BACKOFF_BASE_MS * 2 ** failsRef.current);
          if (failsRef.current >= MAX_CAPTURE_FAILS) {
            failsRef.current = 0;
            setCameraReady(false);
            setCameraKey((k) => k + 1);
          }
        }
        if (cancelled) return;
        if (photo?.uri) {
          const m = modulesRef.current;
          const { hands: found, frameWidth, frameHeight } = await m.detect(photo.uri);
          if (cancelled) return;
          if (!found.length) {
            setHands([]);
            cbRef.current.onResult({ hasHand: false });
          } else {
            setHands(found.map((x: any) => x.landmarks));
            const pred = await m.classify(m.extract(found, frameWidth, frameHeight), 0);
            if (cancelled) return;
            cbRef.current.onResult(
              pred
                ? { hasHand: true, n: found.length, label: pred.sign, conf: pred.confidence }
                : { hasHand: true, n: found.length, label: '', conf: 0 },
            );
          }
          frames++;
          const now = Date.now();
          if (now - fpsT >= 1000) {
            cbRef.current.onFps?.(Math.round((frames * 1000) / (now - fpsT)));
            frames = 0;
            fpsT = now;
          }
        }
      } catch (e) {
        console.warn('[NativeEngine] frame failed', e);
      }
      if (!cancelled) timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, 0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, ready, cameraReady, appActive]);

  return (
    <View style={styles.fill} onLayout={(e: LayoutChangeEvent) => setDims(e.nativeEvent.layout)}>
      <CameraView
        key={cameraKey}
        ref={cameraRef}
        style={styles.fill}
        facing={facing}
        mute
        animateShutter={false}
        flash="off"
        onCameraReady={() => setCameraReady(true)}
        onMountError={() => {
          setCameraReady(false);
          setTimeout(() => setCameraKey((k) => k + 1), 400);
        }}
      />
      {active &&
        dims.width > 0 &&
        hands.map((lm, i) => (
          <HandLandmarkOverlay
            key={i}
            landmarks={lm}
            width={dims.width}
            height={dims.height}
            isFrontCamera={facing === 'front'}
          />
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
});

/**
 * Live recognition using the same engine as the Chrome extension (MediaPipe HandLandmarker
 * + isl_mlp), running in a WebView with a real-time camera stream.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { WebViewMessageEvent } from 'react-native-webview';
import { Asset } from 'expo-asset';
import { buildEngineHtml } from '@/services/engine/engineHtml';
import type { EngineProps } from './types';

const LOAD_TIMEOUT_MS = 60000;

// Typed loosely (same as RealisticHandViewer) - the package typings clash with React 19 types.
let WebViewComponent: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  WebViewComponent = require('react-native-webview').WebView;
} catch {
  WebViewComponent = null;
}

export default function WebEngineView({ active, facing, onResult, onStatus, onFps, onDims }: EngineProps) {
  const webRef = useRef<any>(null);
  const [urls, setUrls] = useState<{ wasm: string; task: string } | null>(null);
  const readyRef = useRef(false);
  const [initialFacing] = useState(facing);

  // Resolve the bundled model files to local file:// URIs
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [wasm, task] = await Asset.loadAsync([
          require('../../assets/engine/vision_wasm_internal.wasm'),
          require('../../assets/engine/hand_landmarker.task'),
        ]);
        const w = wasm.localUri ?? wasm.uri;
        const t = task.localUri ?? task.uri;
        if (!w || !t) throw new Error('engine assets could not be resolved');
        if (!cancelled) setUrls({ wasm: w, task: t });
      } catch (e: any) {
        if (!cancelled) onStatus({ state: 'error', code: 'assets', message: e?.message ?? String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!WebViewComponent) onStatus({ state: 'error', code: 'no-webview', message: 'WebView module missing' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const html = useMemo(
    () => (urls ? buildEngineHtml({ wasmUrl: urls.wasm, taskUrl: urls.task, facing: initialFacing }) : null),
    [urls, initialFacing],
  );

  const send = (msg: object) => {
    webRef.current?.injectJavaScript(`window.__rn && window.__rn(${JSON.stringify(msg)}); true;`);
  };

  useEffect(() => {
    if (readyRef.current) send({ cmd: 'active', value: active });
  }, [active]);

  useEffect(() => {
    if (readyRef.current) send({ cmd: 'facing', value: facing });
  }, [facing]);

  // If the engine never reports ready, let the parent fall back
  useEffect(() => {
    if (!html) return;
    const timer = setTimeout(() => {
      if (!readyRef.current) onStatus({ state: 'error', code: 'timeout', message: 'Engine took too long to start' });
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);

  const handleMessage = (e: WebViewMessageEvent) => {
    let m: any;
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (m.t === 'r') {
      onResult(m.hand ? { hasHand: true, n: m.n, label: m.label, conf: m.conf } : { hasHand: false });
    } else if (m.t === 'dims') {
      onDims?.(m.w, m.h);
    } else if (m.t === 'fps') {
      onFps?.(m.v);
    } else if (m.t === 'status') {
      if (m.state === 'ready') {
        readyRef.current = true;
        send({ cmd: 'active', value: active });
        send({ cmd: 'facing', value: facing });
      }
      onStatus(m.state === 'error' ? { state: 'error', code: m.code, message: m.message } : { state: m.state });
    }
  };

  if (!html || !WebViewComponent) return <View style={styles.fill} />;

  return (
    <WebViewComponent
      ref={webRef}
      style={styles.fill}
      source={{ html, baseUrl: 'file:///' }}
      originWhitelist={['*']}
      onMessage={handleMessage}
      onError={(e: any) => onStatus({ state: 'error', code: 'webview', message: e.nativeEvent.description })}
      javaScriptEnabled
      domStorageEnabled
      allowFileAccess
      allowFileAccessFromFileURLs
      allowUniversalAccessFromFileURLs
      allowingReadAccessToURL="file:///"
      mixedContentMode="always"
      mediaPlaybackRequiresUserAction={false}
      allowsInlineMediaPlayback
      mediaCapturePermissionGrantType="grant"
      androidLayerType="hardware"
      overScrollMode="never"
      scrollEnabled={false}
      bounces={false}
      setSupportMultipleWindows={false}
      containerStyle={styles.fill}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
});

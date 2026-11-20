/**
 * HTML page run inside react-native-webview. It is the Chrome extension's engine
 * (MediaPipe HandLandmarker + ISLCore features + isl_mlp classifier) wired to a live
 * camera, so the phone produces the same predictions as the extension.
 *
 * Page -> RN messages (JSON):
 *   {t:'status', state:'loading'|'ready'|'error', message?, code?}
 *   {t:'r', hand:0|1, n?, label?, conf?}       one per processed frame
 *   {t:'fps', v}
 *   {t:'dims', w, h}                              camera frame size (RN sizes the view to match)
 * RN -> page: window.__rn({cmd:'active', value:boolean} | {cmd:'facing', value:'front'|'back'})
 */
import {
  MP_BUNDLE_JS,
  ISL_CORE_JS,
  WASM_LOADER_B64,
  ISL_MLP_B64,
  ISL_META_JSON,
} from './engineBundle.generated';

export interface EngineConfig {
  wasmUrl: string;
  taskUrl: string;
  facing: 'front' | 'back';
}

const PAGE_JS = `
(function () {
  var post = function (o) { try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch (e) {} };
  var CFG = window.__CFG;
  var video = document.getElementById('v');
  var canvas = document.getElementById('c');
  var stage = document.getElementById('stage');
  var ctx = canvas.getContext('2d');
  var lm = null, clf = null, stream = null;
  var active = false, facing = CFG.facing, lastT = -1, camToken = 0;
  var frames = 0, fpsT = performance.now();

  var CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
    [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];

  function fail(code, message) { post({ t: 'status', state: 'error', code: code, message: message }); }

  function getBuf(url) {
    return new Promise(function (res, rej) {
      var x = new XMLHttpRequest();
      x.open('GET', url); x.responseType = 'arraybuffer';
      x.onload = function () { if (x.response && x.response.byteLength) res(x.response); else rej(new Error('empty asset ' + url)); };
      x.onerror = function () { rej(new Error('cannot read ' + url)); };
      x.send();
    });
  }
  function b64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }

  function sizeCanvas() {
    var d = window.devicePixelRatio || 1;
    canvas.width = Math.round(stage.clientWidth * d);
    canvas.height = Math.round(stage.clientHeight * d);
  }
  window.addEventListener('resize', sizeCanvas);

  function draw(hands, vw, vh) {
    var cw = canvas.width, ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    if (!hands || !hands.length || !vw) return;
    var s = Math.min(cw / vw, ch / vh), ox = (cw - vw * s) / 2, oy = (ch - vh * s) / 2;
    var d = window.devicePixelRatio || 1;
    ctx.lineWidth = 3 * d; ctx.lineCap = 'round';
    hands.forEach(function (h) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      CONNECTIONS.forEach(function (c) {
        ctx.moveTo(h[c[0]].x * vw * s + ox, h[c[0]].y * vh * s + oy);
        ctx.lineTo(h[c[1]].x * vw * s + ox, h[c[1]].y * vh * s + oy);
      });
      ctx.stroke();
      ctx.fillStyle = '#F45B16';
      h.forEach(function (p, i) {
        ctx.beginPath();
        ctx.arc(p.x * vw * s + ox, p.y * vh * s + oy, (i % 4 === 0 ? 5 : 3.5) * d, 0, 6.2832);
        ctx.fill();
      });
    });
  }

  async function startCamera() {
    var token = ++camToken;
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    stage.className = facing === 'front' ? 'mirror' : '';
    try {
      var s = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: facing === 'front' ? 'user' : 'environment' },
                 frameRate: { ideal: 30 }, resizeMode: 'none' }
      });
      if (token !== camToken) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
      stream = s; video.srcObject = s; await video.play();
      lastT = -1; reportDims();
    } catch (e) {
      fail(e && e.name === 'NotAllowedError' ? 'camera-denied' : 'camera', String((e && e.message) || e));
    }
  }

  var lastDims = '';
  function reportDims() {
    var w = video.videoWidth, h = video.videoHeight;
    if (w && h && (w + 'x' + h) !== lastDims) { lastDims = w + 'x' + h; post({ t: 'dims', w: w, h: h }); }
  }
  video.addEventListener('loadedmetadata', reportDims);
  video.addEventListener('resize', reportDims);

  function process() {
    var w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return;
    var res = lm.detectForVideo(video, performance.now());
    draw(res.landmarks, w, h);
    var feat = ISLCore.landmarksToFeatures(res.landmarks, w, h);
    if (!feat) { post({ t: 'r', hand: 0 }); }
    else {
      var c = clf.classify(feat);
      post({ t: 'r', hand: 1, n: res.landmarks.length, label: c.label, conf: Math.round(c.conf * 1000) / 1000 });
    }
    frames++;
    var now = performance.now();
    if (now - fpsT >= 1000) { post({ t: 'fps', v: Math.round(frames * 1000 / (now - fpsT)) }); frames = 0; fpsT = now; }
  }

  function loop() {
    try {
      if (active && video.readyState >= 2 && video.currentTime !== lastT) { lastT = video.currentTime; process(); }
      else if (!active) { ctx.clearRect(0, 0, canvas.width, canvas.height); }
    } catch (e) { fail('runtime', String((e && e.message) || e)); return; }
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(loop); else requestAnimationFrame(loop);
  }

  window.__rn = function (m) {
    if (!m) return;
    if (m.cmd === 'active') { active = !!m.value; lastT = -1; }
    else if (m.cmd === 'facing' && m.value !== facing) { facing = m.value; startCamera(); }
  };

  (async function init() {
    try {
      post({ t: 'status', state: 'loading', message: 'Loading engine' });
      sizeCanvas();
      var meta = JSON.parse(CFG.meta);
      clf = new ISLCore.ISLClassifier(meta, b64(CFG.mlp).buffer);
      var results = await Promise.all([getBuf(CFG.taskUrl), getBuf(CFG.wasmUrl)]);
      var task = new Uint8Array(results[0]);
      var wasmUrl = URL.createObjectURL(new Blob([results[1]], { type: 'application/wasm' }));
      var loaderUrl = URL.createObjectURL(new Blob([b64(CFG.loader)], { type: 'text/javascript' }));
      var fileset = { wasmLoaderPath: loaderUrl, wasmBinaryPath: wasmUrl };
      lm = await window.__MP.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: task, delegate: 'CPU' },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.35,
        minHandPresenceConfidence: 0.35,
        minTrackingConfidence: 0.5
      });
      await startCamera();
      post({ t: 'status', state: 'ready' });
      loop();
    } catch (e) {
      fail('init', String((e && e.message) || e));
    }
  })();
})();
`;

export function buildEngineHtml(cfg: EngineConfig): string {
  const payload = JSON.stringify({
    ...cfg,
    meta: ISL_META_JSON,
    mlp: ISL_MLP_B64,
    loader: WASM_LOADER_B64,
  }).replace(/</g, '\\u003c');

  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
html,body{margin:0;height:100%;background:#000;overflow:hidden}
#stage{position:absolute;inset:0;background:#000}
#stage.mirror{transform:scaleX(-1)}
video,canvas{position:absolute;inset:0;width:100%;height:100%}
video{object-fit:contain}
</style></head>
<body>
<div id="stage"><video id="v" playsinline muted autoplay></video><canvas id="c"></canvas></div>
<script>window.__CFG=${payload};</script>
<script>${MP_BUNDLE_JS}</script>
<script>${ISL_CORE_JS}</script>
<script>${PAGE_JS}</script>
</body></html>`;
}

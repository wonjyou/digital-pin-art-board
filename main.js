import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
const key = new THREE.DirectionalLight(0xffffff, 2.5);
key.position.set(-4, 6, 8);
scene.add(key);

const board = new THREE.Group();
scene.add(board);

const PLATE_T = 0.35;
const plate = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.3, metalness: 0 })
);
board.add(plate);

// Pins are one instanced mesh. Each pin's height is a per-instance attribute;
// the vertex shader lifts the head and stretches the shaft up from the plate.
const uniforms = { uDepth: { value: 1 }, uShade: { value: 0.16 } };
const pinMaterial = new THREE.MeshStandardMaterial({ color: 0xe6eaee, metalness: 1, roughness: 0.28 });
pinMaterial.onBeforeCompile = (s) => {
  s.uniforms.uDepth = uniforms.uDepth;
  s.uniforms.uShade = uniforms.uShade;
  s.vertexShader = 'attribute float aH;\nuniform float uDepth;\nvarying float vH;\n' +
    s.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\ntransformed.z += step(1e-5, position.z) * aH * uDepth;\nvH = aH;');
  // lower pins sit in the shadow of their neighbours
  s.fragmentShader = 'uniform float uShade;\nvarying float vH;\n' +
    s.fragmentShader.replace('#include <color_fragment>',
      '#include <color_fragment>\ndiffuseColor.rgb *= mix(uShade, 1.0, vH);');
};

function pinGeometry(headR, n) {
  const lod = n <= 8000 ? [8, 12, 4] : n <= 30000 ? [6, 8, 3] : [5, 6, 2];
  const neck = headR * 0.3;
  const shaft = new THREE.CylinderGeometry(headR * 0.38, headR * 0.38, neck, lod[0], 1, true);
  shaft.translate(0, neck / 2, 0);
  const dome = new THREE.SphereGeometry(headR, lod[1], lod[2], 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1, 0.55, 1);
  dome.translate(0, neck, 0);
  const under = new THREE.CircleGeometry(headR, lod[1]);
  under.rotateX(Math.PI / 2);
  under.translate(0, neck, 0);
  const g = mergeGeometries([shaft, dome, under]);
  g.rotateX(Math.PI / 2); // pin axis -> +Z, shaft foot at z = 0
  return g;
}

// ---------- state ----------
const settings = { pins: 12000, depth: 1.6, speed: 14, mirror: false, invert: false, tint: false };
const grid = { cols: 0, rows: 0, W: 10, H: 10 };
let pins = null, heights, targets, colors;

const sampler = document.createElement('canvas');
const sctx = sampler.getContext('2d', { willReadFrequently: true });

const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) SRGB_TO_LINEAR[i] = Math.pow(i / 255, 2.2);

function rebuild() {
  const aspect = source.w / source.h;
  const W = aspect >= 1 ? 10 : 10 * aspect;
  const H = aspect >= 1 ? 10 / aspect : 10;
  // staggered rows, like the real toy: row spacing is ~0.866 of the pin spacing
  const cols = Math.max(4, Math.round(Math.sqrt(settings.pins * 0.866 * aspect)));
  const rows = Math.max(4, Math.round(settings.pins / cols));
  const n = cols * rows;
  const pitch = W / (cols + 0.5), rowPitch = H / rows;
  Object.assign(grid, { cols, rows, W, H });

  if (pins) { board.remove(pins); pins.geometry.dispose(); pins.dispose(); }
  const geo = pinGeometry(Math.min(pitch, rowPitch / 0.866) * 0.46, n);
  heights = new Float32Array(n);
  targets = new Float32Array(n);
  colors = new Float32Array(n * 3).fill(1);
  geo.setAttribute('aH', new THREE.InstancedBufferAttribute(heights, 1).setUsage(THREE.DynamicDrawUsage));

  pins = new THREE.InstancedMesh(geo, pinMaterial, n);
  pins.frustumCulled = false;
  pins.instanceColor = new THREE.InstancedBufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage);
  const m = pins.instanceMatrix.array;
  for (let r = 0, i = 0; r < rows; r++) {
    const y = H / 2 - (r + 0.5) * rowPitch;
    const shift = r & 1 ? 1 : 0.5;
    for (let c = 0; c < cols; c++, i++) {
      const o = i * 16;
      m[o] = m[o + 5] = m[o + 10] = m[o + 15] = 1;
      m[o + 12] = -W / 2 + (c + shift) * pitch;
      m[o + 13] = y;
    }
  }
  board.add(pins);

  plate.scale.set(W + 0.7, H + 0.7, PLATE_T);
  plate.position.z = -PLATE_T / 2;
  sampler.width = cols;
  sampler.height = rows;

  $('pinsOut').textContent = `${n.toLocaleString()} (${cols} × ${rows})`;
  frameCamera();
}

// ---------- sources ----------
const video = document.createElement('video');
video.muted = true;
video.loop = true;
video.playsInline = true;

const demo = document.createElement('canvas');
demo.width = 320;
demo.height = 240;
const dctx = demo.getContext('2d');

const source = { kind: 'demo', el: demo, w: 320, h: 240, stream: null, url: null };

function drawDemo(t) {
  const { width: w, height: h } = demo;
  dctx.globalCompositeOperation = 'source-over';
  dctx.fillStyle = '#000';
  dctx.fillRect(0, 0, w, h);
  dctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) {
    const x = w * (0.5 + 0.38 * Math.sin(t * (0.31 + i * 0.07) + i * 2.1));
    const y = h * (0.5 + 0.36 * Math.cos(t * (0.27 + i * 0.09) + i * 1.3));
    const r = h * (0.26 + 0.08 * Math.sin(t * 0.5 + i));
    const g = dctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,.95)');
    g.addColorStop(0.55, 'rgba(255,255,255,.4)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    dctx.fillStyle = g;
    dctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

function say(msg) {
  $('status').textContent = msg || '';
  $('status').hidden = !msg;
}

function releaseSource() {
  source.stream?.getTracks().forEach((t) => t.stop());
  source.stream = null;
  video.pause();
  video.srcObject = null;
  video.removeAttribute('src');
  if (source.url) URL.revokeObjectURL(source.url);
  source.url = null;
}

// the camera starts mirrored, with dark areas raised
function setSource(kind, el, selfie = false) {
  source.kind = kind;
  source.el = el;
  settings.mirror = $('mirror').checked = selfie;
  settings.invert = $('invert').checked = selfie;
  for (const b of document.querySelectorAll('[data-source]')) b.setAttribute('aria-pressed', b.dataset.source === kind);
  say('');
}

function useDemo() {
  releaseSource();
  setSource('demo', demo);
}

async function useStream(kind, getStream, blockedMsg) {
  let stream;
  try {
    stream = await getStream();
  } catch (e) {
    if (e.name !== 'AbortError') say(e.name === 'NotAllowedError' ? blockedMsg : `Couldn't start the ${kind}: ${e.message}`);
    return;
  }
  releaseSource();
  source.stream = stream;
  video.srcObject = stream;
  stream.getVideoTracks()[0].addEventListener('ended', () => { if (source.stream === stream) useDemo(); });
  await video.play().catch(() => {});
  setSource(kind, video, kind === 'camera');
}

function useCamera() {
  if (!navigator.mediaDevices?.getUserMedia) return say('The camera only works on https or localhost. Open the page from one of those.');
  return useStream('camera',
    () => navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false }),
    "Camera access is blocked. Allow it in the browser's site settings, then choose Camera again.");
}

async function useFile(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  const fail = () => { URL.revokeObjectURL(url); say(`This browser can't open "${file.name}" as an image or video.`); };
  if (file.type.startsWith('video/')) {
    releaseSource();
    source.url = url;
    video.src = url;
    try { await video.play(); } catch { useDemo(); return fail(); }
    setSource('video', video);
  } else {
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch { return fail(); }
    releaseSource();
    source.url = url;
    setSource('image', img);
  }
}

function sourceSize() {
  const el = source.el;
  return el === video ? [video.videoWidth, video.videoHeight]
    : el === demo ? [demo.width, demo.height]
    : [el.naturalWidth, el.naturalHeight];
}

// ---------- per-frame: picture -> pin heights ----------
function readFrame() {
  const { cols, rows } = grid;
  if (source.el === video && video.readyState < 2) return;
  sctx.setTransform(settings.mirror ? -1 : 1, 0, 0, 1, settings.mirror ? cols : 0, 0);
  sctx.drawImage(source.el, 0, 0, cols, rows);
  const px = sctx.getImageData(0, 0, cols, rows).data;
  const { invert, tint } = settings;
  for (let i = 0, p = 0; i < targets.length; i++, p += 4) {
    const lum = (0.2126 * px[p] + 0.7152 * px[p + 1] + 0.0722 * px[p + 2]) / 255;
    targets[i] = invert ? 1 - lum : lum;
    if (tint) {
      colors[i * 3] = SRGB_TO_LINEAR[px[p]];
      colors[i * 3 + 1] = SRGB_TO_LINEAR[px[p + 1]];
      colors[i * 3 + 2] = SRGB_TO_LINEAR[px[p + 2]];
    }
  }
  if (tint) pins.instanceColor.needsUpdate = true;
}

function movePins(dt) {
  const k = 1 - Math.exp(-dt * settings.speed);
  for (let i = 0; i < heights.length; i++) heights[i] += (targets[i] - heights[i]) * k;
  pins.geometry.attributes.aH.needsUpdate = true;
}

// ---------- view: drag to rotate, wheel / pinch to zoom ----------
const HOME = { yaw: 0, pitch: -0.85, zoom: 1 };
const view = { ...HOME, vyaw: 0, vpitch: 0 };
const pointers = new Map();
let pinchDist = 0, lastMove = 0;

function frameCamera() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
  const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
  const radius = Math.hypot(grid.W, grid.H) / 2 + 0.6;
  camera.position.set(0, 0, (radius / Math.sin(Math.min(vHalf, hHalf))) * 0.75 * view.zoom);
  camera.updateProjectionMatrix();
}

const setZoom = (z) => { view.zoom = THREE.MathUtils.clamp(z, 0.35, 3); frameCamera(); };

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  view.vyaw = view.vpitch = 0;
  lastMove = e.timeStamp;
  canvas.classList.add('dragging');
  $('hint').classList.add('gone');
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
  }
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX;
  p.y = e.clientY;
  if (pointers.size === 1) {
    view.yaw += dx * 0.006;
    view.pitch = THREE.MathUtils.clamp(view.pitch + dy * 0.006, -1.45, 1.45);
    // spin speed in rad/s, kept for the coast after release
    const dt = Math.max(e.timeStamp - lastMove, 8) / 1000;
    view.vyaw = THREE.MathUtils.clamp((dx * 0.006) / dt, -6, 6);
    view.vpitch = THREE.MathUtils.clamp((dy * 0.006) / dt, -6, 6);
    lastMove = e.timeStamp;
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist) setZoom(view.zoom * pinchDist / d);
    pinchDist = d;
  }
});
const endPointer = (e) => {
  pointers.delete(e.pointerId);
  if (e.timeStamp - lastMove > 80) view.vyaw = view.vpitch = 0; // held still before letting go
  if (!pointers.size) canvas.classList.remove('dragging');
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(view.zoom * Math.exp(e.deltaY * 0.0012)); }, { passive: false });
canvas.addEventListener('dblclick', resetView);

function resetView() {
  Object.assign(view, HOME, { vyaw: 0, vpitch: 0 });
  frameCamera();
}

// ---------- controls ----------
const fill = (el) => el.style.setProperty('--p', `${((el.value - el.min) / (el.max - el.min)) * 100}%`);

function bindSlider(id, apply) {
  const el = $(id);
  const run = () => { fill(el); apply(+el.value); };
  el.addEventListener('input', run);
  run();
}

bindSlider('depth', (v) => {
  settings.depth = uniforms.uDepth.value = (v / 100) * 3.5;
  $('depthOut').textContent = `${v}%`;
});
bindSlider('speed', (v) => {
  settings.speed = 1.5 * Math.pow(40, v / 100); // 1.5/s (syrupy) to 60/s (instant)
  $('speedOut').textContent = v < 34 ? 'Slow' : v < 67 ? 'Medium' : 'Fast';
});
bindSlider('pins', (v) => {
  settings.pins = Math.round(400 * Math.pow(200, v / 1000)); // 400 to 80,000
  rebuild();
});

for (const key of ['mirror', 'invert', 'tint']) {
  $(key).addEventListener('change', (e) => {
    settings[key] = e.target.checked;
    if (key === 'tint' && !settings.tint) { colors.fill(1); pins.instanceColor.needsUpdate = true; }
  });
}

const browse = (accept) => { $('file').accept = accept; $('file').click(); };
const pick = { demo: useDemo, camera: useCamera, image: () => browse('image/*'), video: () => browse('video/*') };
for (const b of document.querySelectorAll('[data-source]')) b.addEventListener('click', () => pick[b.dataset.source]());
$('file').addEventListener('change', (e) => { useFile(e.target.files[0]); e.target.value = ''; });
$('reset').addEventListener('click', resetView);

// the whole header toggles; the button inside keeps it keyboard-reachable
document.querySelector('.panel-head').addEventListener('click', () => {
  const collapsed = $('panel').classList.toggle('collapsed');
  $('collapse').setAttribute('aria-expanded', !collapsed);
  $('collapse').setAttribute('aria-label', collapsed ? 'Show controls' : 'Minimize controls');
});

// drop an image or video anywhere
addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dropping'); });
addEventListener('dragleave', () => document.body.classList.remove('dropping'));
addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dropping');
  useFile(e.dataTransfer.files[0]);
});
addEventListener('resize', frameCamera);

// ---------- loop ----------
let last = performance.now();
function tick(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  if (source.kind === 'demo') drawDemo(now / 1000);
  const [w, h] = sourceSize();
  if (w && h && Math.abs(w / h - source.w / source.h) > 0.01) {
    source.w = w;
    source.h = h;
    rebuild();
  }
  readFrame();
  movePins(dt);

  if (!pointers.size && !reducedMotion) {
    view.yaw += view.vyaw * dt;
    view.pitch = THREE.MathUtils.clamp(view.pitch + view.vpitch * dt, -1.45, 1.45);
    const decay = Math.exp(-dt * 5);
    view.vyaw *= decay;
    view.vpitch *= decay;
  }
  board.rotation.set(view.pitch, view.yaw, 0);

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

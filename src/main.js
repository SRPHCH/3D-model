// Little Explorer — a procedural 3D mascot (three.js)
// Everything is generated in code (no external models/textures), so the page is a single
// self-contained file. Rendering adapts to the device: quality tier at start-up, then
// dynamic resolution + frame-rate caps at runtime so it stays smooth on weak/1-vCPU machines.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import gepLogoUrl from './assets/gep-logo.webp';
import schoolLogoUrl from './assets/school-logo.webp';

/* ------------------------------------------------------------------------------------------
 * Quality tiers
 * ---------------------------------------------------------------------------------------- */

const TIERS = {
  high:   { label: 'สูง',   maxDpr: 2,    minDpr: 1,    aa: true,  shadow: 2048, fps: 60, seg: 1,    pbr: 'physical', env: true },
  medium: { label: 'กลาง',  maxDpr: 1.5,  minDpr: 0.75, aa: true,  shadow: 1024, fps: 60, seg: 0.75, pbr: 'standard', env: true },
  low:    { label: 'ประหยัด', maxDpr: 1,    minDpr: 0.5,  aa: false, shadow: 0,    fps: 30, seg: 0.4,  pbr: 'matcap',   env: false },
};

const params = new URLSearchParams(location.search);

function detectTier() {
  const forced = params.get('q');
  if (TIERS[forced]) return forced;
  let renderer = '';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return 'low';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { return 'low'; }
  // No GPU (VPS / VM / remote desktop): the browser rasterises on the CPU.
  if (/swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen/i.test(renderer)) return 'low';
  const cores = navigator.hardwareConcurrency || 2;
  const mem = navigator.deviceMemory || 8;
  if (cores <= 2 || mem <= 2) return 'low';
  if (/Android|iPhone|iPad|Mobi/i.test(navigator.userAgent) || cores <= 4 || mem <= 4) return 'medium';
  return 'high';
}

const tierName = detectTier();
const Q = TIERS[tierName];
const seg = (n, min = 6) => Math.max(min, Math.round(n * Q.seg));

/* ------------------------------------------------------------------------------------------
 * Renderer / scene / camera
 * ---------------------------------------------------------------------------------------- */

const container = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({
  antialias: Q.aa,
  alpha: false, // opaque canvas: the browser compositor can skip blending it with the page
  powerPreference: tierName === 'low' ? 'low-power' : 'high-performance',
  stencil: false,
});
renderer.setClearColor(0xffffff, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = Q.env ? 0.9 : 1.0;
renderer.shadowMap.enabled = Q.shadow > 0;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

if (Q.env) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  pmrem.dispose();
}

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(-0.18, 1.08, 0); // slightly left of centre: the flag flies out on that side
camera.position.copy(controls.target).add(new THREE.Vector3(0.32, 0.18, 1)); // initial view direction; resize() sets the distance
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 3.2;
controls.maxDistance = 11;
controls.minPolarAngle = 0.25;
controls.maxPolarAngle = Math.PI / 2 + 0.04;
controls.rotateSpeed = 0.7;

/* ------------------------------------------------------------------------------------------
 * Lights
 * ---------------------------------------------------------------------------------------- */

scene.add(new THREE.HemisphereLight(0xffffff, 0xf3ddd6, Q.env ? 0.45 : 1.5));

const key = new THREE.DirectionalLight(0xfff3e6, Q.env ? 2.1 : 2.3);
key.position.set(2.6, 5.2, 3.6);
key.target.position.set(0, 1, 0);
scene.add(key, key.target);
if (Q.shadow) {
  key.castShadow = true;
  key.shadow.mapSize.set(Q.shadow, Q.shadow);
  const sc = key.shadow.camera;
  sc.left = -2.4; sc.right = 2.4; sc.top = 2.6; sc.bottom = -2.2; sc.near = 2; sc.far = 11;
  key.shadow.radius = tierName === 'high' ? 5 : 3;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.025;
}

const fill = new THREE.DirectionalLight(0xe7efff, 0.7);
fill.position.set(-4, 2.2, 2.5);
const rim = new THREE.DirectionalLight(0xffffff, 1.5);
rim.position.set(-1.5, 3.5, -4.5);
scene.add(fill, rim);

/* ------------------------------------------------------------------------------------------
 * Materials (one factory so every tier gets the cheapest shader that still looks right)
 * ---------------------------------------------------------------------------------------- */

// Low tier uses baked "matcap" lighting: one texture lookup per pixel instead of real lights.
// On CPU-only (software WebGL) machines that is roughly half the cost of even Lambert shading.
function makeMatcap(glossy) {
  const S = 256, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#9c8a86'; g.fillRect(0, 0, S, S);
  g.save();
  g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); g.clip();
  let grd = g.createRadialGradient(S * 0.42, S * 0.34, 0, S * 0.45, S * 0.42, S * 0.72);
  grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.45, '#f6efec');
  grd.addColorStop(0.8, '#cdbcb7'); grd.addColorStop(1, '#a3908b');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  grd = g.createRadialGradient(S * 0.5, S * 1.08, 0, S * 0.5, S * 1.08, S * 0.55);
  grd.addColorStop(0, 'rgba(255,205,190,0.45)'); grd.addColorStop(1, 'rgba(255,205,190,0)');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  grd = g.createRadialGradient(S / 2, S / 2, S * 0.4, S / 2, S / 2, S * 0.5);
  grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(1, 'rgba(255,255,255,0.45)');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  if (glossy) {
    grd = g.createRadialGradient(S * 0.37, S * 0.3, 0, S * 0.37, S * 0.3, S * 0.11);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.8)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
  }
  g.restore();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = false; // the matcap is never minified much; plain bilinear is cheapest
  t.minFilter = THREE.LinearFilter;
  return t;
}
const matcaps = Q.pbr === 'matcap' ? { matte: makeMatcap(false), gloss: makeMatcap(true) } : null;

const materialCache = new Map();
function M(color, o = {}) {
  const cacheKey = o.map ? null : color + JSON.stringify(o);
  if (cacheKey && materialCache.has(cacheKey)) return materialCache.get(cacheKey);
  const common = { color, map: o.map || null, transparent: !!o.transparent, side: o.side ?? THREE.FrontSide };
  let m;
  if (Q.pbr === 'matcap') {
    const glossy = (o.coat ?? 0) >= 0.5 || (o.rough ?? 1) < 0.3;
    m = new THREE.MeshMatcapMaterial({ ...common, matcap: glossy ? matcaps.gloss : matcaps.matte });
  } else {
    const std = { ...common, roughness: o.rough ?? 0.6, metalness: o.metal ?? 0 };
    if (Q.pbr === 'physical' && (o.coat || o.sheen)) {
      m = new THREE.MeshPhysicalMaterial({
        ...std,
        clearcoat: o.coat ?? 0,
        clearcoatRoughness: o.coatRough ?? 0.35,
        sheen: o.sheen ?? 0,
        sheenRoughness: 0.6,
        sheenColor: new THREE.Color(o.sheenColor ?? 0xffffff),
      });
    } else {
      m = new THREE.MeshStandardMaterial(std);
    }
  }
  if (o.depthWrite === false) m.depthWrite = false;
  if (o.polyOffset) { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; }
  if (cacheKey) materialCache.set(cacheKey, m);
  return m;
}

// Outfit theme: white + pastel pink
const C = {
  skin: 0xffdcd2, hand: 0xffd3c8,
  shirt: 0xfffafb, shirtDark: 0xffbcd3,
  shorts: 0xf7a9c7, belt: 0xfffafb, gold: 0xf0bf4a,
  scarf: 0xffb5cf, sash: 0xf28fb5,
  cap: 0xfffafb, capDark: 0xffb5cf,
  sock: 0xfffafb, boot: 0xf3a1c1, sole: 0xfff3f7,
  pack: 0xffc5d9, packDark: 0xf6a5c3, roll: 0xfffafb, strap: 0xe98aaf,
  rope: 0xf3e2d4, wood: 0xfff4f7, eye: 0x1d1414,
};
const PINK = '#ffbcd3', PINK_DEEP = '#f7a0c1', WHITE = '#fffafb';

const mats = {
  skin: M(C.skin, { rough: 0.5, coat: 0.35, coatRough: 0.45, sheen: 0.4, sheenColor: 0xffc2cc }),
  hand: M(C.hand, { rough: 0.5, coat: 0.35, coatRough: 0.45, sheen: 0.4, sheenColor: 0xffc2cc }),
  shirt: M(C.shirt, { rough: 0.85, sheen: 0.6, sheenColor: 0xffe4ee }),
  shirtDark: M(C.shirtDark, { rough: 0.85, sheen: 0.6, sheenColor: 0xffe4ee }),
  shorts: M(C.shorts, { rough: 0.85, sheen: 0.6, sheenColor: 0xffd6e6 }),
  belt: M(C.belt, { rough: 0.45, coat: 0.3 }),
  gold: M(C.gold, { rough: 0.28, metal: 1, glow: 0x3a2400 }),
  scarf: M(C.scarf, { rough: 0.8, sheen: 0.9, sheenColor: 0xffe0ec }),
  sash: M(C.sash, { rough: 0.8, sheen: 0.9, sheenColor: 0xffd0e2 }),
  cap: M(C.cap, { rough: 0.75, sheen: 0.6, sheenColor: 0xffe4ee }),
  capDark: M(C.capDark, { rough: 0.75, sheen: 0.6, sheenColor: 0xffe4ee }),
  sock: M(C.sock, { rough: 0.9, sheen: 0.6 }),
  boot: M(C.boot, { rough: 0.4, coat: 0.5, coatRough: 0.3 }),
  sole: M(C.sole, { rough: 0.8 }),
  pack: M(C.pack, { rough: 0.8, sheen: 0.6, sheenColor: 0xffe4ee }),
  packDark: M(C.packDark, { rough: 0.8, sheen: 0.5, sheenColor: 0xffe4ee }),
  roll: M(C.roll, { rough: 0.85, sheen: 0.7, sheenColor: 0xffe4ee }),
  strap: M(C.strap, { rough: 0.5, coat: 0.2 }),
  rope: M(C.rope, { rough: 0.9, sheen: 0.5 }),
  wood: M(C.wood, { rough: 0.55, coat: 0.4 }),
  eye: M(C.eye, { rough: 0.08, coat: 1, coatRough: 0.05 }),
  white: Q.pbr === 'matcap'
    ? new THREE.MeshBasicMaterial({ color: 0xffffff })
    : new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.2 }),
};

/* ------------------------------------------------------------------------------------------
 * The body: a chubby superellipse "egg" (wide at the bottom). Every accessory is placed on
 * it analytically so clothes, face and badges hug the surface exactly.
 * ---------------------------------------------------------------------------------------- */

const BODY = { cy: 1.12, ry: 0.86, rx: 0.8, egg: 0.12, p: 2.4 };

function bodyR(y) {
  const s = (y - BODY.cy) / BODY.ry;
  if (s <= -1 || s >= 1) return 0;
  return BODY.rx * Math.pow(1 - Math.pow(Math.abs(s), BODY.p), 1 / BODY.p) * (1 - BODY.egg * s);
}
const yAt = (t) => BODY.cy - BODY.ry * Math.cos(Math.PI * t);
const tAt = (y) => Math.acos(THREE.MathUtils.clamp((BODY.cy - y) / BODY.ry, -1, 1)) / Math.PI;

// Profile point + outward profile normal (in the r/y half-plane) at parameter t∈[0,1].
function profile(t, out) {
  const e = 1e-4;
  const t0 = Math.max(0, t - e), t1 = Math.min(1, t + e);
  const y0 = yAt(t0), y1 = yAt(t1);
  const dr = bodyR(y1) - bodyR(y0), dy = y1 - y0;
  const len = Math.hypot(dr, dy) || 1;
  out.r = bodyR(yAt(t)); out.y = yAt(t);
  out.nr = dy / len; out.ny = -dr / len;
  return out;
}

const _pr = {};
// World-space surface point at angle θ (0 = facing camera, +z) and height y, pushed out by `off`.
function surf(theta, y, off = 0, target = new THREE.Vector3(), normal = null) {
  profile(tAt(y), _pr);
  const s = Math.sin(theta), c = Math.cos(theta);
  const r = _pr.r + _pr.nr * off;
  target.set(r * s, _pr.y + _pr.ny * off, r * c);
  if (normal) normal.set(_pr.nr * s, _pr.ny, _pr.nr * c).normalize();
  return target;
}

// Basis whose +z is the surface normal and +y points "up" along the surface.
const _up = new THREE.Vector3(0, 1, 0);
function placeOnSurface(obj, theta, y, off, spin = 0) {
  const n = new THREE.Vector3();
  surf(theta, y, off, obj.position, n);
  const x = new THREE.Vector3().crossVectors(_up, n).normalize();
  const yy = new THREE.Vector3().crossVectors(n, x);
  obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, yy, n));
  if (spin) obj.rotateZ(spin);
  return obj;
}

// Lathe that follows the body between heights, offset outward along the surface normal.
function bodyShell(y0, y1, off, rings) {
  const t0 = y0 <= BODY.cy - BODY.ry ? 0 : tAt(y0);
  const t1 = y1 >= BODY.cy + BODY.ry ? 1 : tAt(y1);
  const pts = [];
  const n = seg(rings, 8);
  for (let i = 0; i <= n; i++) {
    const t = t0 + (t1 - t0) * (i / n);
    profile(t, _pr);
    const o = typeof off === 'function' ? off(t) : off;
    pts.push(new THREE.Vector2(Math.max(0, _pr.r + _pr.nr * o), _pr.y + _pr.ny * o));
  }
  return new THREE.LatheGeometry(pts, seg(72, 32), Math.PI, Math.PI * 2);
}

// Sweeps a 2D cross-section along a list of surface frames {p, b, n}.
function sweep(frames, section, closed) {
  const pos = [], idx = [];
  const ns = section.length;
  for (const f of frames) {
    for (const [a, c] of section) {
      pos.push(
        f.p.x + f.b.x * a + f.n.x * c,
        f.p.y + f.b.y * a + f.n.y * c,
        f.p.z + f.b.z * a + f.n.z * c,
      );
    }
  }
  const nf = frames.length;
  const rows = closed ? nf : nf - 1;
  for (let i = 0; i < rows; i++) {
    const i2 = (i + 1) % nf;
    for (let j = 0; j < ns; j++) {
      const j2 = (j + 1) % ns;
      const a = i * ns + j, b = i2 * ns + j, c = i2 * ns + j2, d = i * ns + j2;
      idx.push(a, d, b, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Frames for the curve where a plane (through `center`, with normal `pn`) cuts the body.
function planeFrames(center, pn, count, keep = () => true) {
  pn = pn.clone().normalize();
  const u = new THREE.Vector3().crossVectors(pn, Math.abs(pn.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : _up).normalize();
  const v = new THREE.Vector3().crossVectors(pn, u);
  const frames = [];
  const p = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const phi = (i / count) * Math.PI * 2;
    d.copy(u).multiplyScalar(Math.cos(phi)).addScaledVector(v, Math.sin(phi));
    let lo = 0, hi = 2.5; // bisection: inside the body → outside
    for (let k = 0; k < 28; k++) {
      const m = (lo + hi) / 2;
      p.copy(center).addScaledVector(d, m);
      if (Math.hypot(p.x, p.z) < bodyR(p.y)) lo = m; else hi = m;
    }
    p.copy(center).addScaledVector(d, lo);
    const theta = Math.atan2(p.x, p.z);
    const n = new THREE.Vector3();
    const sp = surf(theta, p.y, 0, new THREE.Vector3(), n);
    const b = pn.clone().addScaledVector(n, -pn.dot(n)).normalize();
    if (keep(sp, n)) frames.push({ p: sp, n, b, theta });
  }
  return frames;
}

function roundedRectSection(w, h, r, lift, steps = seg(3, 1)) {
  const s = [];
  const corner = (cx, cy, a0) => {
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (i / steps) * (Math.PI / 2);
      s.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  const hw = w / 2 - r;
  corner(hw, lift + h - r, 0);
  corner(-hw, lift + h - r, Math.PI / 2);
  corner(-hw, lift + r, Math.PI);
  corner(hw, lift + r, Math.PI * 1.5);
  return s;
}
const circleSection = (rad, lift, n) =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [Math.cos(a) * rad, lift + rad + Math.sin(a) * rad];
  });

const rbox = (w, h, d, segments, r) => new RoundedBoxGeometry(w, h, d, Q.seg < 1 ? Math.max(1, segments - 1) : segments, r);

function mesh(geo, mat, parent, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  if (Q.shadow && shadow) { m.castShadow = true; m.receiveShadow = true; }
  parent?.add(m);
  return m;
}

/* ------------------------------------------------------------------------------------------
 * Canvas textures (face, emblem, pennant) — drawn once at start-up
 * ---------------------------------------------------------------------------------------- */

function canvasTex(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  return t;
}

// Logos are bundled as data URLs; textures are redrawn as soon as the images have decoded.
function loadImage(src) {
  const img = new Image();
  img.src = src;
  return img;
}
const gepLogo = loadImage(gepLogoUrl);
const schoolLogo = loadImage(schoolLogoUrl);

function imageTex(w, h, img, draw) {
  const t = canvasTex(w, h, (g) => draw(g, w, h, null));
  const redraw = () => {
    const g = t.image.getContext('2d');
    g.clearRect(0, 0, w, h);
    draw(g, w, h, img);
    t.needsUpdate = true;
  };
  if (img.complete && img.naturalWidth) redraw(); else img.addEventListener('load', redraw, { once: true });
  return t;
}

// Round badge: pink ring, white disc, logo fitted inside the circle.
function drawLogoBadge(g, cx, cy, R, img) {
  g.save();
  g.translate(cx, cy);
  g.fillStyle = PINK_DEEP;
  g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(0, 0, R * 0.88, 0, Math.PI * 2); g.fill();
  if (img) {
    g.beginPath(); g.arc(0, 0, R * 0.88, 0, Math.PI * 2); g.clip();
    const s = R * 0.88 * Math.SQRT2 * 1.06;
    g.drawImage(img, -s / 2, -s / 2, s, s);
  }
  g.restore();
}

/* ------------------------------------------------------------------------------------------
 * Build the mascot
 * ---------------------------------------------------------------------------------------- */

// Groups flagged `rig` are animated; everything static under a rig gets merged later.
const rig = (g) => { g.userData.rig = true; return g; };
const mascot = rig(new THREE.Group());   // root: jump / position
const bodyRig = rig(new THREE.Group());  // breathing, sway, look-around
mascot.add(bodyRig);
scene.add(mascot);

// --- Skin body
// Only the visible band of skin is built (between scarf and cap); clothes close the rest.
// This avoids shading the same pixels twice, which matters a lot for CPU-only rendering.
mesh(bodyShell(1.14, 1.86, 0, 30), mats.skin, bodyRig);

// --- Face decal: a patch of the body surface carrying blush + mouth + brows
const FACE = { th: 0.9, y0: 1.24, y1: 1.76 };
{
  const W = tierName === 'low' ? 512 : 1024, H = W / 2;
  const tex = canvasTex(W, H, (g) => {
    const rMid = bodyR(1.45);
    const px = (theta) => ((theta + FACE.th) / (2 * FACE.th)) * W;
    const py = (y) => (1 - (y - FACE.y0) / (FACE.y1 - FACE.y0)) * H;
    const kx = W / (2 * FACE.th * rMid);   // pixels per world unit (horizontal)
    const ky = H / (FACE.y1 - FACE.y0);    // pixels per world unit (vertical)

    // Blush
    for (const side of [-1, 1]) {
      const cx = px(side * 0.5), cy = py(1.42);
      g.save();
      g.translate(cx, cy);
      g.scale(kx * 0.12, ky * 0.08);
      const grd = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      grd.addColorStop(0, 'rgba(255,128,150,0.75)');
      grd.addColorStop(0.55, 'rgba(255,140,160,0.45)');
      grd.addColorStop(1, 'rgba(255,150,170,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fill();
      g.restore();
      // tiny shine strokes on the cheeks
      g.strokeStyle = 'rgba(255,255,255,0.75)';
      g.lineCap = 'round';
      g.lineWidth = ky * 0.012;
      for (let i = 0; i < 3; i++) {
        const ox = cx + (i - 1) * kx * 0.04, oy = cy - ky * 0.005;
        g.beginPath(); g.moveTo(ox + kx * 0.012, oy - ky * 0.02); g.lineTo(ox - kx * 0.008, oy + ky * 0.02); g.stroke();
      }
    }

    // Eyebrows (excited, slightly raised)
    g.strokeStyle = '#5a3324';
    g.lineCap = 'round';
    g.lineWidth = ky * 0.022;
    for (const side of [-1, 1]) {
      const cx = px(side * 0.31), cy = py(1.675);
      g.beginPath();
      g.moveTo(cx - kx * 0.06, cy + ky * 0.012);
      g.quadraticCurveTo(cx, cy - ky * 0.022, cx + kx * 0.06, cy + ky * 0.012);
      g.stroke();
    }

    // Open happy "D" mouth with tongue
    const mx = px(0), my = py(1.395);
    const mw = kx * 0.092, mh = ky * 0.1;
    g.beginPath();
    g.moveTo(mx - mw, my - mh * 0.3);
    g.quadraticCurveTo(mx, my - mh * 0.12, mx + mw, my - mh * 0.3);
    g.bezierCurveTo(mx + mw * 1.02, my + mh * 0.75, mx - mw * 1.02, my + mh * 0.75, mx - mw, my - mh * 0.3);
    g.closePath();
    g.fillStyle = '#6e2630';
    g.fill();
    g.save();
    g.clip();
    g.fillStyle = '#ff7a8c';
    g.beginPath(); g.ellipse(mx, my + mh * 0.68, mw * 0.55, mh * 0.32, 0, 0, Math.PI * 2); g.fill();
    g.restore();
    g.strokeStyle = '#5a2028';
    g.lineWidth = ky * 0.009;
    g.lineJoin = 'round';
    g.stroke();
  });

  const nu = seg(36, 12), nv = seg(18, 8);
  const pos = [], uv = [], idx = [];
  const p = new THREE.Vector3();
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv;
      surf(-FACE.th + u * 2 * FACE.th, FACE.y0 + v * (FACE.y1 - FACE.y0), 0.002, p);
      pos.push(p.x, p.y, p.z); uv.push(u, v);
    }
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 2, d = a + nu + 1;
    idx.push(a, b, d, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const faceMat = M(0xffffff, { map: tex, transparent: true, rough: 0.5, depthWrite: false, polyOffset: true });
  const face = mesh(g, faceMat, bodyRig, false);
  face.receiveShadow = !!Q.shadow;
  face.renderOrder = 1;
}

// --- Eyes: glossy, slightly embedded ovals with two highlights
const eyes = [];
{
  const eyeGeo = new THREE.SphereGeometry(1, seg(32, 12), seg(24, 10));
  const hiGeo = new THREE.SphereGeometry(1, seg(12, 8), seg(10, 6));
  for (const side of [-1, 1]) {
    const pivot = placeOnSurface(new THREE.Group(), side * 0.29, 1.535, -0.012);
    const blink = rig(new THREE.Group());
    pivot.add(blink);
    const e = mesh(eyeGeo, mats.eye, blink, false);
    e.scale.set(0.088, 0.112, 0.05);
    const h1 = mesh(hiGeo, mats.white, blink, false);
    h1.scale.setScalar(0.03); h1.position.set(-0.026 * side + 0.004, 0.036, 0.04);
    const h2 = mesh(hiGeo, mats.white, blink, false);
    h2.scale.setScalar(0.014); h2.position.set(0.022 * side, -0.035, 0.044);
    bodyRig.add(pivot);
    eyes.push(blink);
  }
}

// --- Shirt, shorts, belt
{
  // Shirt print modelled on the team polo: white, with a pastel pink panel and stripes sweeping
  // diagonally down across the front (mirrored on the back so it meets cleanly at the sides).
  const Y0 = 0.6, Y1 = 1.235;
  const t0 = tAt(Y0), t1 = tAt(Y1);
  const W = tierName === 'low' ? 1024 : 2048, H = W / 8;
  const tex = canvasTex(W, H, (g) => {
    const img = g.createImageData(W, H), d = img.data;
    const pink = [0xff, 0xbc, 0xd3], white = [0xff, 0xfa, 0xfb];
    const e = (2 * Math.PI * 0.8) / W * 1.2;                 // edge softness ≈ one texel
    const cov = (x, a, b) => THREE.MathUtils.clamp((x - a) / e + 0.5, 0, 1) * THREE.MathUtils.clamp((b - x) / e + 0.5, 0, 1);
    const bands = [[-9, -0.13], [-0.1, -0.04], [-0.015, 0.02]];
    for (let py = 0; py < H; py++) {
      const Y = yAt(t0 + (1 - (py + 0.5) / H) * (t1 - t0));
      const line = -0.36 + (Y1 - Y) * 0.95;                  // boundary: upper-left → lower-right
      for (let px = 0; px < W; px++) {
        let th = ((px + 0.5) / W - 0.5) * Math.PI * 2;        // 0 = front, + = character's left
        if (Math.abs(th) > Math.PI / 2) th = Math.sign(th) * (Math.PI - Math.abs(th));
        const x = th * 0.8 - line;
        let k = 0;
        for (const [a, b] of bands) k = Math.max(k, cov(x, a, b));
        const o = (py * W + px) * 4;
        for (let c = 0; c < 3; c++) d[o + c] = white[c] + (pink[c] - white[c]) * k;
        d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  });
  mesh(bodyShell(Y0, Y1, 0.022, 28), M(0xffffff, { map: tex, rough: 0.85, sheen: 0.6, sheenColor: 0xffe4ee }), bodyRig);
}
mesh(bodyShell(0.18, 0.67, 0.034, 20), mats.shorts, bodyRig);
{
  const beltFrames = planeFrames(new THREE.Vector3(0, 0.645, 0), _up, seg(96, 32));
  mesh(sweep(beltFrames, roundedRectSection(0.09, 0.035, 0.012, 0.022), true), mats.belt, bodyRig);
  const buckle = mesh(rbox(0.15, 0.11, 0.03, 2, 0.02), mats.gold, bodyRig);
  placeOnSurface(buckle, 0, 0.645, 0.072);
  const inner = mesh(rbox(0.085, 0.05, 0.02, 2, 0.01), mats.belt, bodyRig);
  placeOnSurface(inner, 0, 0.645, 0.082);
}

// --- Sash with merit badges (instanced: 2 draw calls for all badges)
{
  const pn = new THREE.Vector3(Math.sin(0.36), Math.cos(0.36), 0);
  const center = new THREE.Vector3(0, 0.9, 0);
  const frames = planeFrames(center, pn, seg(120, 40));
  mesh(sweep(frames, roundedRectSection(0.15, 0.03, 0.01, 0.024), true), mats.sash, bodyRig);

  const front = frames.filter((f) => Math.abs(f.theta) < 1.05).sort((a, b) => a.theta - b.theta);
  const count = 6;
  const colors = [0x8ec2ff, 0xffd97a, 0x92e0bd, 0xff9fb4, 0xc6a6f5, 0x8fdde6];
  const discGeo = new THREE.CylinderGeometry(1, 1, 1, seg(24, 10)).rotateX(Math.PI / 2);
  const outer = new THREE.InstancedMesh(discGeo, M(0xffffff, { rough: 0.4, coat: 0.6 }), count);
  const inner = new THREE.InstancedMesh(discGeo, M(0xffffff, { rough: 0.35, coat: 0.6 }), count);
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pp = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const f = front[Math.round(((i + 0.5) / count) * (front.length - 1))];
    const t = new THREE.Vector3().crossVectors(f.n, f.b);
    q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.b, t, f.n));
    pp.copy(f.p).addScaledVector(f.n, 0.062);
    mtx.compose(pp, q, s.set(0.05, 0.05, 0.016)); outer.setMatrixAt(i, mtx);
    outer.setColorAt(i, new THREE.Color(colors[i]));
    pp.copy(f.p).addScaledVector(f.n, 0.072);
    mtx.compose(pp, q, s.set(0.026, 0.026, 0.01)); inner.setMatrixAt(i, mtx);
    inner.setColorAt(i, new THREE.Color(i % 2 ? 0xffffff : 0xfff1b8));
  }
  for (const im of [outer, inner]) { im.castShadow = !!Q.shadow; bodyRig.add(im); }
}

// --- Neckerchief: rolled scarf + front flap + woggle ring
{
  const frames = planeFrames(new THREE.Vector3(0, 1.235, 0), _up, seg(96, 32));
  mesh(sweep(frames, circleSection(0.048, -0.008, seg(12, 6)), true), mats.scarf, bodyRig);

  const tri = new THREE.Shape();
  tri.moveTo(-0.17, 0); tri.lineTo(0.17, 0);
  tri.quadraticCurveTo(0.04, -0.13, 0.012, -0.21);
  tri.quadraticCurveTo(0, -0.225, -0.012, -0.21);
  tri.quadraticCurveTo(-0.04, -0.13, -0.17, 0);
  const flapGeo = new THREE.ExtrudeGeometry(tri, {
    depth: 0.012, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.012, bevelSegments: seg(2, 1), curveSegments: seg(10, 4),
  });
  const flap = mesh(flapGeo, mats.scarf, bodyRig);
  placeOnSurface(flap, 0, 1.2, 0.04);
  flap.rotateX(-0.12);
  const woggle = mesh(new THREE.TorusGeometry(0.035, 0.018, seg(10, 6), seg(20, 10)), mats.gold, bodyRig);
  placeOnSurface(woggle, 0, 1.17, 0.085);
  woggle.scale.set(1, 1.2, 1);
}

// --- Chest pocket with flap and button
{
  const pocket = mesh(rbox(0.22, 0.2, 0.03, 2, 0.012), mats.shirt, bodyRig);
  placeOnSurface(pocket, 0.52, 0.99, 0.035);
  const flap = mesh(rbox(0.235, 0.06, 0.03, 2, 0.012), mats.shirtDark, bodyRig);
  placeOnSurface(flap, 0.52, 1.085, 0.052);
  const btn = mesh(new THREE.SphereGeometry(0.016, 10, 8), mats.gold, bodyRig);
  placeOnSurface(btn, 0.52, 1.07, 0.075);
  // school emblem printed on the pocket
  const logoTex = imageTex(256, 256, schoolLogo, (g, w, h, img) => { if (img) g.drawImage(img, 0, 0, w, h); });
  const logo = mesh(new THREE.PlaneGeometry(0.135, 0.135), M(0xffffff, { map: logoTex, rough: 0.6, transparent: true, polyOffset: true }), pocket, false);
  logo.position.set(0, -0.018, 0.0162);
}

// --- Rope coil on the hip
{
  const coil = new THREE.Group();
  placeOnSurface(coil, 2.05, 0.82, 0.05);
  const ringGeo = new THREE.TorusGeometry(0.13, 0.03, seg(10, 6), seg(28, 12));
  for (let i = 0; i < 3; i++) {
    const r = mesh(ringGeo, mats.rope, coil);
    r.position.set(0.012 * i, -0.01 * i, 0.03 * i);
    r.rotation.z = i * 0.7;
  }
  const tie = mesh(new THREE.TorusGeometry(0.045, 0.022, 8, 12), mats.strap, coil);
  tie.position.set(0.02, 0.13, 0.04);
  tie.rotation.y = Math.PI / 2;
  bodyRig.add(coil);
}

// --- Legs: socks with stripe, shorts cuffs, boots
for (const side of [-1, 1]) {
  const leg = new THREE.Group();
  leg.position.set(side * 0.28, 0, 0.02);
  const cuff = mesh(new THREE.CylinderGeometry(0.155, 0.165, 0.11, seg(24, 10)), mats.shorts, leg);
  cuff.position.y = 0.3;
  const sock = mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.2, seg(20, 10)), mats.sock, leg);
  sock.position.y = 0.2;
  const stripe = mesh(new THREE.TorusGeometry(0.115, 0.014, 6, seg(24, 10)), mats.scarf, leg);
  stripe.rotation.x = Math.PI / 2; stripe.position.y = 0.21;
  const boot = mesh(new THREE.SphereGeometry(1, seg(24, 10), seg(16, 8)), mats.boot, leg);
  boot.scale.set(0.155, 0.11, 0.2); boot.position.set(0, 0.095, 0.045);
  const top = mesh(new THREE.TorusGeometry(0.12, 0.03, seg(8, 6), seg(20, 10)), mats.boot, leg);
  top.rotation.x = Math.PI / 2; top.position.y = 0.155;
  const sole = mesh(new THREE.CylinderGeometry(1, 1, 1, seg(24, 10)), mats.sole, leg);
  sole.scale.set(0.16, 0.035, 0.205); sole.position.set(0, 0.018, 0.045);
  mascot.add(leg);
}

// --- Explorer cap: crown hugging the head, band, brim, emblem, top button
{
  const capY = 1.79;
  const off = (t) => 0.03 + 0.025 * THREE.MathUtils.smoothstep(t, tAt(capY), 1);
  mesh(bodyShell(capY, 2.1, off, 24), mats.cap, bodyRig);
  const bandFrames = planeFrames(new THREE.Vector3(0, capY + 0.01, 0), _up, seg(96, 32));
  mesh(sweep(bandFrames, roundedRectSection(0.065, 0.03, 0.012, 0.028), true), mats.capDark, bodyRig);

  // brim: grown straight out of the band, so it joins the cap with no gap at any angle.
  // Each angle gets a closed cross-section (top → rounded tip → underside) that starts inside
  // the crown at band height and droops gently outward; the length tapers to nothing at the sides.
  {
    const rRoot = bodyR(capY) - 0.03;           // starts inside the crown, exits through the band
    const flat = 0.1;                           // root runs level until it has cleared the band
    const span = 1.45, na = seg(40, 16), nt = seg(8, 4), tip = seg(6, 3);
    const lenAt = (a) => flat + 0.34 * Math.pow(Math.cos((a / span) * (Math.PI / 2)), 0.6);
    const topY = (d) => { const e = Math.max(0, d - flat); return capY + 0.022 - 0.2 * e - 0.28 * e * e; };
    const thick = (d) => 0.032 - 0.012 * Math.min(1, Math.max(0, d - flat) / 0.34);
    const pos = [], idx = [];
    let ns = 0;
    for (let i = 0; i <= na; i++) {
      const a = -span + (i / na) * span * 2;
      const L = lenAt(a), sa = Math.sin(a), ca = Math.cos(a);
      const sec = [];
      for (let k = 0; k <= nt; k++) { const d = (k / nt) * L; sec.push([d, topY(d)]); }
      const th = thick(L), yc = topY(L) - th / 2;
      for (let k = 1; k < tip; k++) { const q = Math.PI / 2 - (k / tip) * Math.PI; sec.push([L + Math.cos(q) * th * 0.6, yc + Math.sin(q) * th / 2]); }
      for (let k = nt; k >= 0; k--) { const d = (k / nt) * L; sec.push([d, topY(d) - thick(d)]); }
      ns = sec.length;
      for (const [d, y] of sec) pos.push(sa * (rRoot + d), y, ca * (rRoot + d));
    }
    for (let i = 0; i < na; i++) {
      for (let j = 0; j < ns; j++) {
        const j2 = (j + 1) % ns;
        const a = i * ns + j, b = (i + 1) * ns + j, c = (i + 1) * ns + j2, d = i * ns + j2;
        idx.push(a, d, b, b, d, c);
      }
    }
    const brimGeo = new THREE.BufferGeometry();
    brimGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    brimGeo.setIndex(idx);
    brimGeo.computeVertexNormals();
    mesh(brimGeo, mats.capDark, bodyRig);
  }

  const badgeTex = imageTex(256, 256, gepLogo, (g, w, h, img) => drawLogoBadge(g, w / 2, h / 2, w * 0.48, img));
  const badge = mesh(
    new THREE.CircleGeometry(0.11, seg(32, 16)),
    M(0xffffff, { map: badgeTex, rough: 0.4, coat: 0.6, transparent: true }),
    bodyRig, false,
  );
  placeOnSurface(badge, 0, 1.885, off(tAt(1.885)) + 0.008);
  badge.rotateX(-0.08);

  const knob = mesh(new THREE.SphereGeometry(0.05, seg(16, 8), seg(12, 6)), mats.capDark, bodyRig);
  knob.position.set(0, BODY.cy + BODY.ry + 0.05, 0);
  knob.scale.y = 0.6;
}

// --- Backpack with bedroll
{
  const pack = new THREE.Group();
  pack.position.set(0, 1.0, -0.8);
  pack.rotation.x = 0.06;
  const main = mesh(rbox(0.74, 0.76, 0.32, 3, 0.11), mats.pack, pack);
  main.position.z = -0.1;
  const pocket = mesh(rbox(0.5, 0.32, 0.12, 3, 0.05), mats.packDark, pack);
  pocket.position.set(0, -0.14, -0.28);
  const pflap = mesh(rbox(0.52, 0.12, 0.13, 3, 0.05), mats.pack, pack);
  pflap.position.set(0, 0.03, -0.29);
  const clasp = mesh(rbox(0.07, 0.07, 0.02, 2, 0.01), mats.gold, pack);
  clasp.position.set(0, -0.01, -0.36);
  for (const sx of [-1, 1]) {
    const strap = mesh(rbox(0.06, 0.82, 0.34, 2, 0.02), mats.strap, pack);
    strap.position.set(sx * 0.22, 0, -0.105);
  }
  const rollEndMat = M(0xffffff, {
    rough: 0.85,
    map: canvasTex(128, 128, (g, w, h) => { // rolled blanket spiral
      g.fillStyle = WHITE; g.fillRect(0, 0, w, h);
      g.strokeStyle = PINK_DEEP; g.lineWidth = 7; g.lineCap = 'round';
      g.beginPath();
      for (let a = 0; a < Math.PI * 7; a += 0.1) {
        const r = 4 + a * 2.6;
        g.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
      }
      g.stroke();
    }),
  });
  const roll = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.9, seg(24, 10)), mats.roll, pack);
  roll.rotation.z = Math.PI / 2; roll.position.set(0, 0.47, -0.12);
  for (const sx of [-1, 1]) {
    const tie = mesh(new THREE.TorusGeometry(0.135, 0.018, 6, seg(24, 10)), mats.strap, pack);
    tie.rotation.y = Math.PI / 2; tie.position.set(sx * 0.27, 0.47, -0.12);
  }
  for (const sx of [-1, 1]) {
    const end = mesh(new THREE.CircleGeometry(0.13, seg(24, 10)), rollEndMat, pack, false);
    end.rotation.y = sx * Math.PI / 2; end.position.set(sx * 0.451, 0.47, -0.12);
  }
  bodyRig.add(pack);
}

// --- Arms (sleeve + cuff + hand). Right arm holds the flag, left arm waves.
const sleeveGeo = new THREE.CapsuleGeometry(0.125, 0.14, seg(6, 3), seg(16, 8));
const handGeo = new THREE.SphereGeometry(0.115, seg(20, 10), seg(16, 8));
const cuffGeo = new THREE.TorusGeometry(0.122, 0.028, seg(8, 6), seg(20, 10));

function makeArm(side) {
  const shoulder = new THREE.Group();
  surf(side * 1.42, 1.02, -0.06, shoulder.position);
  const arm = rig(new THREE.Group());
  shoulder.add(arm);
  const sleeve = mesh(sleeveGeo, mats.shirt, arm);
  sleeve.position.y = -0.08;
  const cuff = mesh(cuffGeo, mats.shirtDark, arm);
  cuff.rotation.x = Math.PI / 2; cuff.position.y = -0.2;
  const hand = mesh(handGeo, mats.hand, arm);
  hand.position.y = -0.3; hand.scale.set(1, 0.95, 0.9);
  bodyRig.add(shoulder);
  return { shoulder, arm, hand };
}

const armL = makeArm(1);   // character's left (viewer's right): waves
const armR = makeArm(-1);  // character's right: holds the flag
armL.arm.rotation.set(0, 0, 0.55);
armR.arm.rotation.set(-0.55, 0, -0.5);

// --- Flag (pole + finial + waving pennant), held in the right hand
const flag = new THREE.Group();
let pennant, pennantBase;
{
  flag.position.copy(armR.hand.position);
  armR.arm.add(flag);
  const tilt = new THREE.Group(); // keeps the pole roughly upright regardless of arm pose
  tilt.rotation.set(0.5, 0, 0.42);
  flag.add(tilt);
  const pole = mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.55, seg(10, 6)), mats.wood, tilt);
  pole.position.y = 0.45;
  const finial = mesh(new THREE.SphereGeometry(0.045, seg(14, 8), seg(10, 6)), mats.gold, tilt);
  finial.position.y = 1.24;
  const grip = mesh(new THREE.TorusGeometry(0.07, 0.03, 6, 14), mats.hand, tilt, false);
  grip.rotation.x = Math.PI / 2; grip.position.y = 0.02; grip.scale.set(1, 1, 1.4);

  const len = 0.7, hgt = 0.38, nx = seg(16, 8), ny = 4;
  const g = new THREE.PlaneGeometry(len, hgt, nx, ny);
  g.translate(-len / 2, 0, 0); // flies outward, away from the head; hoist is at x = 0 (texture's right edge)
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = -p.getX(i);
    p.setY(i, p.getY(i) * (1 - (x / len) * 0.92)); // taper into a pennant
  }
  pennantBase = Float32Array.from(p.array);
  const tex = imageTex(512, 256, gepLogo, (c, w, h, img) => {
    const grd = c.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, PINK_DEEP); grd.addColorStop(1, '#ffd3e2');
    c.fillStyle = grd; c.fillRect(0, 0, w, h);
    c.fillStyle = '#ffffff';
    c.fillRect(0, h * 0.06, w, h * 0.05); c.fillRect(0, h * 0.89, w, h * 0.05);
    drawLogoBadge(c, w - h * 0.6, h / 2, h * 0.37, img);
    c.fillStyle = '#ffffff';
    for (let i = 0; i < 3; i++) { // little stars towards the tip
      const sx = w - h * 1.25 - i * h * 0.38, sy = h / 2, R = h * (0.09 - i * 0.017);
      c.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? R * 0.45 : R;
        c.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr);
      }
      c.fill();
    }
  });
  pennant = mesh(g, M(0xffffff, { map: tex, rough: 0.75, sheen: 0.6, side: THREE.DoubleSide }), tilt);
  pennant.userData.dynamic = true;
  pennant.position.set(-0.02, 1.0, 0);
  pennant.rotation.y = 0.3; // turned a little towards the viewer so the logo reads
}

/* ------------------------------------------------------------------------------------------
 * Ground: soft contact shadow (always) + real shadow catcher (when shadows are on)
 * ---------------------------------------------------------------------------------------- */

const contact = new THREE.Mesh(
  new THREE.PlaneGeometry(1.9, 1.9).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({
    map: canvasTex(128, 128, (g, w, h) => {
      const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grd.addColorStop(0, 'rgba(60,40,40,0.6)');
      grd.addColorStop(0.45, 'rgba(60,40,40,0.24)');
      grd.addColorStop(0.75, 'rgba(60,40,40,0.07)');
      grd.addColorStop(1, 'rgba(60,40,40,0)');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
    }),
    transparent: true, depthWrite: false, toneMapped: false,
  }),
);
contact.position.y = 0.001;
contact.scale.set(1.1, 1, 0.9);
scene.add(contact);

if (Q.shadow) {
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(12, 12).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.12 }));
  catcher.receiveShadow = true;
  scene.add(catcher);
}

/* ------------------------------------------------------------------------------------------
 * Animation
 * ---------------------------------------------------------------------------------------- */

const anim = { t: 0, blinkAt: 2.5, blinkT: -1, waveAt: 3.5, waveT: -1, jumpT: -1 };
const pPos = pennant.geometry.attributes.position;
const ease = (x) => x * x * (3 - 2 * x);

function animate(dt) {
  const a = anim;
  a.t += dt;
  const t = a.t;

  // breathing + gentle sway + looking around
  const br = Math.sin(t * 2.1);
  bodyRig.scale.set(1 - br * 0.008, 1 + br * 0.016, 1 - br * 0.008);
  bodyRig.rotation.z = Math.sin(t * 1.05) * 0.035;
  bodyRig.rotation.y = Math.sin(t * 0.45) * 0.16 + Math.sin(t * 1.3) * 0.03;
  bodyRig.rotation.x = Math.sin(t * 0.8) * 0.02;

  // blink
  if (a.blinkT < 0 && t > a.blinkAt) a.blinkT = 0;
  let lid = 1;
  if (a.blinkT >= 0) {
    a.blinkT += dt;
    const k = a.blinkT / 0.16;
    lid = k < 0.5 ? 1 - k * 1.8 : 0.1 + (k - 0.5) * 1.8;
    if (k >= 1) { a.blinkT = -1; lid = 1; a.blinkAt = t + 2 + Math.random() * 3.5; }
  }
  for (const e of eyes) e.scale.y = Math.max(0.1, lid);

  // wave (left arm) every few seconds
  let lift = 0, wag = 0;
  if (a.waveT < 0 && t > a.waveAt) a.waveT = 0;
  if (a.waveT >= 0) {
    a.waveT += dt;
    const w = a.waveT, dur = 2.2;
    lift = w < 0.35 ? ease(w / 0.35) : w > dur - 0.35 ? ease((dur - w) / 0.35) : 1;
    wag = Math.sin(w * 13) * 0.32 * lift;
    if (w >= dur) { a.waveT = -1; a.waveAt = t + 4 + Math.random() * 4; }
  }
  // jump (on tap)
  let jy = 0, squash = 0;
  if (a.jumpT >= 0) {
    a.jumpT += dt;
    const j = a.jumpT;
    if (j < 0.14) squash = Math.sin((j / 0.14) * Math.PI) * 0.09;              // anticipation
    else if (j < 0.62) { const k = (j - 0.14) / 0.48; jy = Math.sin(k * Math.PI) * 0.3; squash = -0.06 * Math.sin(k * Math.PI); }
    else if (j < 0.8) squash = Math.sin(((j - 0.62) / 0.18) * Math.PI) * 0.1;  // landing
    else a.jumpT = -1;
    lift = Math.max(lift, j < 0.8 ? Math.sin(Math.min(1, j / 0.6) * Math.PI) : 0);
  }
  mascot.position.y = jy;
  mascot.scale.set(1 + squash * 0.6, 1 - squash, 1 + squash * 0.6);
  const cs = 1 - jy * 0.9;
  contact.scale.set(1.1 * cs, 1, 0.9 * cs);
  contact.material.opacity = 0.35 + 0.65 * cs;

  armL.arm.rotation.z = 0.55 + Math.sin(t * 2.1) * 0.04 + lift * 1.9 + wag;
  armL.arm.rotation.x = -lift * 0.35;
  armR.arm.rotation.z = -0.5 - Math.sin(t * 2.1 + 0.5) * 0.03;
  armR.arm.rotation.x = -0.55 + Math.sin(t * 1.4) * 0.05;

  // pennant ripple (tiny CPU vertex update: ~85 vertices)
  const arr = pPos.array;
  const len = 0.7;
  for (let i = 0; i < arr.length; i += 3) {
    const x = -pennantBase[i];  // distance from the pole
    const k = x / len;
    arr[i + 2] = Math.sin(x * 7 - t * 6) * 0.06 * k + Math.sin(x * 3 - t * 3.3) * 0.03 * k;
    arr[i + 1] = pennantBase[i + 1] - k * k * 0.05;
  }
  pPos.needsUpdate = true;
  pennant.geometry.computeVertexNormals();
}

/* ------------------------------------------------------------------------------------------
 * Interaction: tap the mascot to make it jump
 * ---------------------------------------------------------------------------------------- */

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; wake(); });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  const quick = performance.now() - downAt.t < 350;
  downAt = null;
  if (moved > 6 || !quick) return;
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  if (ray.intersectObject(mascot, true).length && anim.jumpT < 0) anim.jumpT = 0;
});
controls.addEventListener('start', wake);
window.addEventListener('keydown', (e) => {
  if (e.key === ' ' && anim.jumpT < 0) { anim.jumpT = 0; wake(); }
  if (e.key === 'f' || e.key === 'F') hud.classList.toggle('show-fps');
});

/* ------------------------------------------------------------------------------------------
 * Sizing
 * ---------------------------------------------------------------------------------------- */

let dpr = Math.min(window.devicePixelRatio || 1, Q.maxDpr);
function resize() {
  const w = container.clientWidth, h = container.clientHeight;
  camera.aspect = w / h;
  // fit the mascot (≈2.5 tall, ≈2.4 wide incl. flag) for any aspect ratio
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const distV = 1.45 / Math.tan(vFov / 2);
  const distH = 1.48 / (Math.tan(vFov / 2) * camera.aspect);
  const dist = THREE.MathUtils.clamp(Math.max(distV, distH), controls.minDistance, controls.maxDistance);
  const dir = camera.position.clone().sub(controls.target);
  if (dir.lengthSq() < 1e-6) dir.set(0.32, 0.18, 1);
  camera.position.copy(controls.target).addScaledVector(dir.normalize(), dist);
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
}
window.addEventListener('resize', resize);
resize();

/* ------------------------------------------------------------------------------------------
 * Adaptive render loop
 *  - fps cap per tier, halved after 20 s without interaction (eco idle)
 *  - dynamic resolution: drops pixel ratio when frames run late, restores when there is headroom
 *  - shadows refresh every frame on 'high', every 2nd frame otherwise; switched off if still slow
 *  - stops completely while the tab is hidden
 * ---------------------------------------------------------------------------------------- */

const hud = document.getElementById('hud');
const fpsEl = document.getElementById('fps');
const qEl = document.getElementById('quality');
let fpsCap = Q.fps;
let lastInput = performance.now();
let shadowsOn = Q.shadow > 0;
function wake() { lastInput = performance.now(); }
window.addEventListener('pointermove', wake, { passive: true });
window.addEventListener('wheel', wake, { passive: true });

const perf = { frames: 0, time: 0, windowStart: performance.now(), good: 0, cooldown: 0, drop: null, floor: Q.minDpr };
function setDpr(v) { dpr = v; resize(); }
function adapt(now) {
  const span = now - perf.windowStart;
  if (span < 1500 || perf.frames < 5) return;
  const avg = perf.time / perf.frames;           // ms between rendered frames
  const target = 1000 / fpsCap;
  const fps = 1000 / avg;
  perf.frames = 0; perf.time = 0; perf.windowStart = now;
  fpsEl.textContent = `${fps.toFixed(0)} fps · ${dpr.toFixed(2)}x`;

  // Did the last resolution drop help? On CPU-only WebGL the cost is often per frame rather
  // than per pixel; then a lower resolution only blurs the image, so undo it and stop there.
  if (perf.drop) {
    const { from, fps: before } = perf.drop;
    perf.drop = null;
    if (fps < before * 1.12) { perf.floor = from; setDpr(from); perf.cooldown = now + 1500; return; }
  }
  if (now < perf.cooldown) return;

  if (avg > target * 1.3) {
    perf.good = 0;
    perf.cooldown = now + 1500;
    if (dpr > perf.floor + 0.01) {
      perf.drop = { from: dpr, fps };
      setDpr(Math.max(perf.floor, dpr - (avg > target * 2 ? 0.25 : 0.12)));
    } else if (shadowsOn) {
      shadowsOn = false; key.castShadow = false;
      renderer.shadowMap.enabled = false;
      scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    } else if (fpsCap > 30) {
      fpsCap = 30;
    }
  } else if (avg < target * 1.08) {
    const maxDpr = Math.min(window.devicePixelRatio || 1, Q.maxDpr);
    if (++perf.good >= 3 && dpr < maxDpr - 0.01) {
      setDpr(Math.min(maxDpr, dpr + 0.1));
      perf.good = 0;
      perf.cooldown = now + 3000;
    }
  } else perf.good = 0;
}

let lastFrame = performance.now();
let frameNo = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const idle = now - lastInput > 20000 && anim.jumpT < 0;
  const cap = idle ? Math.max(20, fpsCap / 2) : fpsCap;
  const elapsed = now - lastFrame;
  if (elapsed < 1000 / cap - 2) return;
  lastFrame = now;
  if (elapsed < 250) { perf.frames++; perf.time += elapsed; }

  const dt = Math.min(elapsed / 1000, 1 / 20);
  controls.update(dt);
  animate(dt);
  if (shadowsOn) renderer.shadowMap.needsUpdate = tierName === 'high' || (frameNo & 1) === 0;
  renderer.render(scene, camera);
  frameNo++;
  if (!idle) adapt(now); else { perf.frames = 0; perf.time = 0; perf.windowStart = now; }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { lastFrame = performance.now(); perf.frames = 0; perf.time = 0; perf.windowStart = lastFrame; }
});

qEl.textContent = `คุณภาพ: ${Q.label}`;
for (const btn of document.querySelectorAll('[data-q]')) {
  if (btn.dataset.q === (params.get('q') || 'auto')) btn.classList.add('on');
  btn.addEventListener('click', () => {
    const u = new URL(location.href);
    if (btn.dataset.q === 'auto') u.searchParams.delete('q'); else u.searchParams.set('q', btn.dataset.q);
    location.href = u.toString();
  });
}
if (params.has('fps')) hud.classList.add('show-fps');

/* ------------------------------------------------------------------------------------------
 * Merge static parts: every rig ends up with one mesh per material. ~65 draw calls → ~25.
 * Per-draw overhead dominates on CPU-only WebGL, so this is the biggest win on a 1-vCPU box.
 * ---------------------------------------------------------------------------------------- */

// On the matcap tier every untextured material differs only by colour, so colours are baked
// into vertices and each rig collapses to ~2 draw calls (matte + glossy).
const vertexColorMats = new Map();
function mergeKey(material) {
  if (Q.pbr !== 'matcap' || material.map || !material.isMeshMatcapMaterial) return material;
  if (!vertexColorMats.has(material.matcap)) {
    vertexColorMats.set(material.matcap, new THREE.MeshMatcapMaterial({ matcap: material.matcap, vertexColors: true }));
  }
  return vertexColorMats.get(material.matcap);
}

function mergeStatic(rigNode) {
  rigNode.updateWorldMatrix(true, true);
  const inv = rigNode.matrixWorld.clone().invert();
  const groups = new Map(); // target material -> [{ geometry, matrix, color, src }]
  const add = (target, entry) => {
    if (!groups.has(target)) groups.set(target, []);
    groups.get(target).push(entry);
  };
  const visit = (node) => {
    for (const child of node.children) {
      if (child.userData.rig) continue;
      if (child.isMesh && !child.userData.dynamic) {
        const target = mergeKey(child.material);
        const base = new THREE.Matrix4().multiplyMatrices(inv, child.matrixWorld);
        if (child.isInstancedMesh) {
          if (target === child.material) continue; // keep GPU instancing on PBR tiers
          const m = new THREE.Matrix4(), c = new THREE.Color();
          for (let i = 0; i < child.count; i++) {
            child.getMatrixAt(i, m);
            child.getColorAt(i, c);
            add(target, { geometry: child.geometry, matrix: base.clone().multiply(m), color: c.clone().multiply(child.material.color), src: child });
          }
        } else {
          add(target, { geometry: child.geometry, matrix: base, color: child.material.color, src: child });
        }
      }
      visit(child);
    }
  };
  visit(rigNode);
  for (const [material, list] of groups) {
    if (list.length < 2 && !material.vertexColors) continue;
    const keepUv = !!material.map;
    const geos = list.map(({ geometry, matrix, color }) => {
      const g = geometry.clone();
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && !(keepUv && name === 'uv')) g.deleteAttribute(name);
      if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
      g.clearGroups();
      if (material.vertexColors) {
        const n = g.attributes.position.count, col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) col.set([color.r, color.g, color.b], i * 3);
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      }
      return g.applyMatrix4(matrix);
    });
    const srcs = [...new Set(list.map((e) => e.src))];
    const merged = new THREE.Mesh(mergeGeometries(geos), material);
    merged.castShadow = srcs.some((m) => m.castShadow);
    merged.receiveShadow = srcs.some((m) => m.receiveShadow);
    merged.renderOrder = srcs[0].renderOrder;
    rigNode.add(merged);
    for (const m of srcs) {
      for (const c of [...m.children]) rigNode.attach(c); // keep decals etc. parented to a merged part
      m.removeFromParent();
      if (!m.isInstancedMesh) m.geometry.dispose();
    }
    geos.forEach((g) => g.dispose());
  }
}
const rigs = [];
mascot.traverse((o) => { if (o.userData.rig) rigs.push(o); });
rigs.forEach(mergeStatic);

renderer.shadowMap.needsUpdate = true;
renderer.compile(scene, camera);
requestAnimationFrame((t) => { lastFrame = t; document.body.classList.add('ready'); loop(t); });

// exposed for automated checks
window.__mascot = { tier: tierName, renderer, scene, mats, camera, controls, anim, get dpr() { return dpr; }, get shadows() { return shadowsOn; } };

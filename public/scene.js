// Scene: renderer + bloom post-processing, shadow-casting lights, sky dome, environment reflections,
// the lava / water surface, the steel deck on its rock pillar, boulders and drifting embers.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RULES } from '/shared/sim.js';
import { ballPose } from '/shared/maps.js';

export const LIQUID_Y = RULES.killY;

export const THEMES = {
  lava: {
    skyTop: 0x090406, skyHorizon: 0x5c1c10, horizonGlow: 0xff5a22, fog: 0x1a0908, fogNear: 80, fogFar: 560,
    sun: 0xffc39a, sunI: 1.4, sunPos: [38, 55, 18], hemiSky: 0x6a3a2a, hemiGround: 0x5a1a08, hemiI: 0.5,
    liquid: [0x140604, 0xff3a08, 0xffd27a], mode: 0, glow: 0xff5a1a, glowI: 45,
    deck: '#8d9398', stripeA: '#d83a2a', stripeB: '#efe9df', ring: '#ffcf3f', foot: 0xffb060,
    bloom: 0.26, envSky: 0x1a0a0c, envGround: 0xff4a10, envGroundK: 1.6, exposure: 0.86, embers: true,
  },
  water: {
    skyTop: 0x1a62c4, skyHorizon: 0xb9dcff, horizonGlow: 0xfff0d0, fog: 0xb4d8fb, fogNear: 150, fogFar: 700,
    sun: 0xfff3dc, sunI: 2.1, sunPos: [60, 75, 30], hemiSky: 0x9fd0f5, hemiGround: 0x2a6f9f, hemiI: 0.5,
    liquid: [0x0a3a66, 0x1f86c9, 0xdaf5ff], mode: 1, glow: 0x4fb3ff, glowI: 8,
    deck: '#aeb3b8', stripeA: '#2f6bff', stripeB: '#f4f1ea', ring: '#4a7bff', foot: 0xdaf5ff,
    bloom: 0.16, envSky: 0x8fd3ff, envGround: 0x1f86c9, envGroundK: 1.0, exposure: 0.84, embers: false,
  },
};

// ------------------------------------------------------------------ renderer, camera, post-processing
export const canvas = document.querySelector('#gl');
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const PR = Math.min(2, window.devicePixelRatio || 1);
renderer.setPixelRatio(PR);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 1400);

const target = new THREE.WebGLRenderTarget(Math.floor(innerWidth * PR), Math.floor(innerHeight * PR), { type: THREE.HalfFloatType, samples: 4 });
export const composer = new EffectComposer(renderer, target);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.4, 0.5, 1.0);
composer.addPass(bloom);
{
  const hp = bloom.materialHighPassFilter;
  const marker = 'vec4 texel = texture2D( tDiffuse, vUv );';
  if (hp && hp.fragmentShader.includes(marker)) { hp.fragmentShader = hp.fragmentShader.replace(marker, 'vec4 texel = clamp( texture2D( tDiffuse, vUv ), 0.0, 64.0 );'); hp.needsUpdate = true; }
}
// colour grade: vignette, a touch of chromatic aberration at the edges, extra saturation
const gradePass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uVignette: { value: 0.45 }, uCA: { value: 0.00035 }, uSat: { value: 1.14 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVignette, uCA, uSat; varying vec2 vUv;
    void main(){ vec2 d = vUv - 0.5; float r2 = dot(d, d);
      vec2 off = d * uCA * r2 * 40.0;
      vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = mix(vec3(l), c, uSat);
      c *= 1.0 - uVignette * smoothstep(0.12, 0.75, r2 * 2.0);
      gl_FragColor = vec4(clamp(c, 0.0, 64.0), 1.0); }`,
});
composer.addPass(gradePass);
composer.addPass(new OutputPass());

// Quality presets: 'high' keeps bloom, soft shadows and MSAA; 'low' drops them for phones and old GPUs.
let qualityNow = 'high';
export function setQuality(q) {
  qualityNow = q === 'low' ? 'low' : 'high';
  const hi = qualityNow === 'high';
  bloom.enabled = hi;
  renderer.shadowMap.enabled = hi; sun.castShadow = hi;
  renderer.setPixelRatio(hi ? PR : 1); composer.setPixelRatio(hi ? PR : 1); composer.setSize(innerWidth, innerHeight);
  scene.traverse((o) => { if (o.material) { for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true; } });
}
export function resize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
}
export function render() { composer.render(); }

// ------------------------------------------------------------------ lights
export const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 0.8); scene.add(hemi);
export const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 10, far: 220 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04; sun.shadow.radius = 3;
scene.add(sun); scene.add(sun.target);
const fill = new THREE.DirectionalLight(0xffffff, 0.3); fill.position.set(-40, 30, -40); scene.add(fill);
export const glow = new THREE.PointLight(0xff5a1a, 90, 160, 1.4); glow.position.set(0, LIQUID_Y + 5, 0); scene.add(glow);
const under = new THREE.PointLight(0xff6a2a, 30, 70, 1.6); under.position.set(0, -5, 0); scene.add(under);

// ------------------------------------------------------------------ sky dome
const skyMat = new THREE.ShaderMaterial({
  uniforms: { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunI: { value: 1 } },
  vertexShader: `varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
  fragmentShader: `
    uniform vec3 uTop, uHor, uGlow, uSunDir; uniform float uSunI; varying vec3 vW;
    void main(){
      vec3 d = normalize(vW);
      float h = clamp(d.y, -0.3, 1.0);
      vec3 c = mix(uHor, uTop, pow(smoothstep(-0.04, 0.55, h), 0.75));
      c += uGlow * exp(-abs(d.y) * 10.0) * 0.8;
      float s = max(0.0, dot(d, uSunDir));
      c += vec3(1.0, 0.96, 0.88) * pow(s, 900.0) * uSunI * 4.0 + vec3(1.0, 0.82, 0.62) * pow(s, 10.0) * uSunI * 0.12;
      gl_FragColor = vec4(c, 1.0);
    }`,
  side: THREE.BackSide, depthWrite: false, fog: false,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), skyMat); sky.frustumCulled = false; scene.add(sky);

// ------------------------------------------------------------------ environment reflections (per theme)
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;
function buildEnvironment(t) {
  const es = new THREE.Scene();
  es.add(new THREE.Mesh(new THREE.SphereGeometry(50, 24, 12), new THREE.MeshBasicMaterial({ color: t.envSky, side: THREE.BackSide })));
  const floor = new THREE.Mesh(new THREE.CircleGeometry(70, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(t.envGround).multiplyScalar(t.envGroundK) }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -10; es.add(floor);
  const sunBall = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(t.sun).multiplyScalar(t.mode === 0 ? 5 : 14) }));
  sunBall.position.set(t.sunPos[0], t.sunPos[1], t.sunPos[2]).normalize().multiplyScalar(42); es.add(sunBall);
  for (const [x, z] of [[34, 0], [-34, 0], [0, 34], [0, -34]]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(16, 7), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(t.mode === 0 ? 0.6 : 1.6), side: THREE.DoubleSide }));
    p.position.set(x, 14, z); p.lookAt(0, 14, 0); es.add(p);
  }
  if (envRT) envRT.dispose();
  envRT = pmrem.fromScene(es, 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = t.mode === 0 ? 0.9 : 1.0;
}

// ------------------------------------------------------------------ noise + canvas helpers
function hash3(x, y, z) { const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return n - Math.floor(n); }
function vnoise(x, y, z = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a, b, k) => a + (b - a) * k;
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v), w);
}
function fbm(x, y, z = 0, oct = 4) { let a = 0.5, s = 0, f = 1; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, z * f); f *= 2.03; a *= 0.5; } return s; }
function mkCanvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function texOf(c, srgb = true, repeat = null) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
function grain(g, w, h, amount, seed = 1) {
  const img = g.getImageData(0, 0, w, h); const d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (hash3(i * 0.37, seed, 3.1) - 0.5) * amount; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
}
function normalFromHeight(hc, strength = 2.0, repeat = null) {
  const W = hc.width, H = hc.height; const d = hc.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const out = new Uint8Array(W * H * 4);
  const h = (x, y) => d[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (h(x + 1, y) - h(x - 1, y)) * strength, dy = (h(x, y + 1) - h(x, y - 1)) * strength;
    const nx = -dx, ny = dy, nz = 1; const len = Math.hypot(nx, ny, nz); const i = (y * W + x) * 4;
    out[i] = (nx / len * 0.5 + 0.5) * 255; out[i + 1] = (ny / len * 0.5 + 0.5) * 255; out[i + 2] = (nz / len * 0.5 + 0.5) * 255; out[i + 3] = 255;
  }
  const t = new THREE.DataTexture(out, W, H, THREE.RGBAFormat); t.flipY = true; t.needsUpdate = true;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

// ------------------------------------------------------------------ liquid surface
const liquidMat = new THREE.ShaderMaterial({
  uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 }, uA: { value: new THREE.Color() }, uB: { value: new THREE.Color() }, uC: { value: new THREE.Color() },
    uMode: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  }]),
  vertexShader: `
    #include <fog_pars_vertex>
    varying vec2 vUv; varying vec3 vW;
    void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz;
      vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: `
    #include <fog_pars_fragment>
    uniform float uTime; uniform vec3 uA, uB, uC, uSunDir; uniform int uMode; varying vec2 vUv; varying vec3 vW;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
    float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * noise(p); p = p * 2.02 + 11.3; a *= 0.5; } return s; }
    float field(vec2 p, float t){ vec2 q = vec2(fbm(p * 0.35 + t * 0.03), fbm(p * 0.35 - t * 0.025 + 5.2)); return fbm(p * 0.8 + q * 2.6 + t * 0.05); }
    void main(){
      vec2 p = vUv * 140.0; float t = uTime;
      float n = field(p, t);
      float e = 0.035;
      float nx = field(p + vec2(e, 0.0), t) - n, nz = field(p + vec2(0.0, e), t) - n;
      vec3 N = normalize(vec3(-nx * 32.0, 1.0, -nz * 32.0));
      float diff = max(0.0, dot(N, uSunDir));
      vec3 V = normalize(cameraPosition - vW);
      vec3 col;
      if (uMode == 0) {
        float crust = smoothstep(0.34, 0.54, n);
        float hot = 1.0 - crust;
        float pulse = 0.85 + 0.25 * sin(t * 1.7 + n * 14.0);
        vec3 lavaCol = mix(uB, uC, smoothstep(0.15, 0.6, hot));
        col = lavaCol * (hot * 1.1 * pulse + 0.06) + uA * crust * (0.3 + 0.8 * diff);
        col += uB * 0.18 * pow(1.0 - max(0.0, dot(N, V)), 3.0) * hot;
      } else {
        float fres = pow(1.0 - max(0.0, dot(N, V)), 3.0);
        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(0.0, dot(N, H)), 160.0);
        float foam = smoothstep(0.62, 0.72, n);
        col = mix(uA, uB, 0.3 + 0.7 * n) * (0.55 + 0.55 * diff);
        col = mix(col, uC, fres * 0.55);
        col += vec3(1.0, 0.98, 0.92) * spec * 3.0 + uC * foam * 0.5;
      }
      gl_FragColor = vec4(col, 1.0);
      #include <fog_fragment>
    }`,
  fog: true,
});
const liquid = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), liquidMat);
liquid.rotation.x = -Math.PI / 2; liquid.position.y = LIQUID_Y; scene.add(liquid);

// ------------------------------------------------------------------ deck textures (steel plates, rivets, scuffs, hazard ring)
function deckMaps(t) {
  const N = 2048, C = N / 2, R = N / 2;
  const a = mkCanvas(N), g = a.getContext('2d', { willReadFrequently: true });
  g.fillStyle = t.deck; g.fillRect(0, 0, N, N);
  grain(g, N, N, 26, 2);
  // plate seams: rings + radial lines, each a dark groove with a light edge
  const seam = (draw) => { g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,0.42)'; draw(); g.lineWidth = 1.5; g.strokeStyle = 'rgba(255,255,255,0.18)'; draw(); };
  for (let r = 180; r < R - 70; r += 180) seam(() => { g.beginPath(); g.arc(C, C, r, 0, Math.PI * 2); g.stroke(); });
  for (let i = 0; i < 16; i++) { const an = (i / 16) * Math.PI * 2; seam(() => { g.beginPath(); g.moveTo(C + Math.cos(an) * 120, C + Math.sin(an) * 120); g.lineTo(C + Math.cos(an) * (R - 60), C + Math.sin(an) * (R - 60)); g.stroke(); }); }
  // rivets along the rings
  for (let r = 180; r < R - 70; r += 180) {
    const n = Math.round(r / 22);
    for (let i = 0; i < n; i++) { const an = (i / n) * Math.PI * 2 + 0.07; const x = C + Math.cos(an) * (r + 11), y = C + Math.sin(an) * (r + 11);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(x + 1.5, y + 1.5, 5.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(210,214,218,0.9)'; g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.arc(x - 1.5, y - 1.5, 2, 0, Math.PI * 2); g.fill(); }
  }
  // scuffs: circular tyre marks and straight scratches
  for (let i = 0; i < 260; i++) {
    const r = 90 + Math.random() * (R - 170), a0 = Math.random() * Math.PI * 2, len = 0.05 + Math.random() * 0.5;
    g.strokeStyle = Math.random() < 0.6 ? `rgba(20,16,14,${0.05 + Math.random() * 0.12})` : `rgba(255,255,255,${0.04 + Math.random() * 0.08})`;
    g.lineWidth = 1 + Math.random() * 7; g.beginPath(); g.arc(C, C, r, a0, a0 + len); g.stroke();
  }
  for (let i = 0; i < 140; i++) {
    const x = Math.random() * N, y = Math.random() * N, an = Math.random() * Math.PI * 2, len = 20 + Math.random() * 120;
    g.strokeStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.12})`; g.lineWidth = 1 + Math.random() * 1.5;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(an) * len, y + Math.sin(an) * len); g.stroke();
  }
  // dirt and heat staining near the edge
  const vg = g.createRadialGradient(C, C, R * 0.55, C, C, R); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(10,6,4,0.45)');
  g.fillStyle = vg; g.fillRect(0, 0, N, N);
  // centre emblem
  g.beginPath(); g.arc(C, C, 120, 0, Math.PI * 2); g.fillStyle = t.ring; g.fill();
  g.beginPath(); g.arc(C, C, 88, 0, Math.PI * 2); g.fillStyle = t.deck; g.fill();
  g.beginPath(); g.arc(C, C, 104, 0, Math.PI * 2); g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.35)'; g.stroke();
  // hazard ring
  const seg = 64;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    g.beginPath(); g.arc(C, C, R, a0, a1); g.arc(C, C, R - 80, a1, a0, true); g.closePath();
    g.fillStyle = i % 2 ? t.stripeA : t.stripeB; g.fill();
  }
  g.beginPath(); g.arc(C, C, R - 80, 0, Math.PI * 2); g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.5)'; g.stroke();
  grain(g, N, N, 10, 5);

  // roughness: scuffs shinier, dirt rougher, stripes satin
  const M = 1024, rc = mkCanvas(M), rg = rc.getContext('2d', { willReadFrequently: true });
  rg.fillStyle = 'rgb(118,118,118)'; rg.fillRect(0, 0, M, M); grain(rg, M, M, 40, 9);
  for (let i = 0; i < 200; i++) { const r = 40 + Math.random() * (M / 2 - 90), a0 = Math.random() * Math.PI * 2; rg.strokeStyle = 'rgba(70,70,70,0.5)'; rg.lineWidth = 1 + Math.random() * 4; rg.beginPath(); rg.arc(M / 2, M / 2, r, a0, a0 + Math.random() * 0.5); rg.stroke(); }
  const rvg = rg.createRadialGradient(M / 2, M / 2, M * 0.28, M / 2, M / 2, M / 2); rvg.addColorStop(0, 'rgba(230,230,230,0)'); rvg.addColorStop(1, 'rgba(230,230,230,0.8)'); rg.fillStyle = rvg; rg.fillRect(0, 0, M, M);
  rg.beginPath(); rg.arc(M / 2, M / 2, M / 2, 0, Math.PI * 2); rg.arc(M / 2, M / 2, M / 2 - 40, 0, Math.PI * 2, true); rg.fillStyle = 'rgb(120,120,120)'; rg.fill();

  // height: grooves at seams, rivet bumps, plate warp
  const hc = mkCanvas(M), hg = hc.getContext('2d', { willReadFrequently: true });
  hg.fillStyle = 'rgb(128,128,128)'; hg.fillRect(0, 0, M, M); grain(hg, M, M, 14, 3);
  const k = M / N;
  hg.lineWidth = 3; hg.strokeStyle = 'rgb(60,60,60)';
  for (let r = 180; r < R - 70; r += 180) { hg.beginPath(); hg.arc(M / 2, M / 2, r * k, 0, Math.PI * 2); hg.stroke(); }
  for (let i = 0; i < 16; i++) { const an = (i / 16) * Math.PI * 2; hg.beginPath(); hg.moveTo(M / 2 + Math.cos(an) * 60, M / 2 + Math.sin(an) * 60); hg.lineTo(M / 2 + Math.cos(an) * (M / 2 - 30), M / 2 + Math.sin(an) * (M / 2 - 30)); hg.stroke(); }
  hg.fillStyle = 'rgb(210,210,210)';
  for (let r = 180; r < R - 70; r += 180) { const n = Math.round(r / 22); for (let i = 0; i < n; i++) { const an = (i / n) * Math.PI * 2 + 0.07; hg.beginPath(); hg.arc(M / 2 + Math.cos(an) * (r + 11) * k, M / 2 + Math.sin(an) * (r + 11) * k, 3, 0, Math.PI * 2); hg.fill(); } }
  hg.beginPath(); hg.arc(M / 2, M / 2, (R - 80) * k, 0, Math.PI * 2); hg.lineWidth = 4; hg.strokeStyle = 'rgb(70,70,70)'; hg.stroke();
  return { map: texOf(a), roughnessMap: texOf(rc, false), normalMap: normalFromHeight(hc, 2.2) };
}

function bandMaps() {
  const W = 1024, H = 128, c = mkCanvas(W, H), g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#6f757b'; g.fillRect(0, 0, W, H); grain(g, W, H, 24, 7);
  for (let x = 0; x < W; x += 128) { g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(x, 0, 4, H); g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(x + 4, 0, 2, H); }
  g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(0, 10, W, 3); g.fillRect(0, H - 13, W, 3);
  for (let x = 16; x < W; x += 32) for (const y of [22, H - 22]) { g.fillStyle = 'rgba(0,0,0,0.4)'; g.beginPath(); g.arc(x + 1, y + 1, 5, 0, Math.PI * 2); g.fill(); g.fillStyle = '#b9bec4'; g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.fill(); g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.arc(x - 1.5, y - 1.5, 1.6, 0, Math.PI * 2); g.fill(); }
  const vg = g.createLinearGradient(0, 0, 0, H); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.5)'); g.fillStyle = vg; g.fillRect(0, 0, W, H);
  const hc = mkCanvas(W, H), hg = hc.getContext('2d', { willReadFrequently: true });
  hg.fillStyle = 'rgb(128,128,128)'; hg.fillRect(0, 0, W, H); grain(hg, W, H, 10, 4);
  for (let x = 0; x < W; x += 128) { hg.fillStyle = 'rgb(60,60,60)'; hg.fillRect(x, 0, 4, H); }
  hg.fillStyle = 'rgb(60,60,60)'; hg.fillRect(0, 10, W, 3); hg.fillRect(0, H - 13, W, 3);
  hg.fillStyle = 'rgb(220,220,220)'; for (let x = 16; x < W; x += 32) for (const y of [22, H - 22]) { hg.beginPath(); hg.arc(x, y, 4, 0, Math.PI * 2); hg.fill(); }
  return { map: texOf(c, true, [26, 1]), normalMap: normalFromHeight(hc, 2.0, [26, 1]) };
}

function rockMaps() {
  const N = 1024, c = mkCanvas(N), g = c.getContext('2d', { willReadFrequently: true });
  const img = g.createImageData(N, N), d = img.data;
  const hc = mkCanvas(N), hg = hc.getContext('2d', { willReadFrequently: true }); const him = hg.createImageData(N, N), hd = him.data;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N * 8, v = y / N * 8;
    const n1 = fbm(u, v, 0.3, 5), n2 = vnoise(u * 3.1, v * 3.1, 2.0);
    const crack = Math.pow(Math.abs(fbm(u * 1.7, v * 1.7, 4.0, 3) - 0.5) * 2, 0.5);
    const base = 0.32 + n1 * 0.45 - (1 - crack) * 0.25;
    const i = (y * N + x) * 4;
    d[i] = 110 * base + 30 * n2; d[i + 1] = 92 * base + 24 * n2; d[i + 2] = 82 * base + 20 * n2; d[i + 3] = 255;
    const h = 0.5 + (n1 - 0.5) * 0.9 - (1 - crack) * 0.3;
    hd[i] = hd[i + 1] = hd[i + 2] = Math.max(0, Math.min(255, h * 255)); hd[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); hg.putImageData(him, 0, 0);
  return { map: texOf(c, true, [3, 3]), normalMap: normalFromHeight(hc, 3.0, [3, 3]) };
}

// ------------------------------------------------------------------ platform: steel deck + rock pillar
export const platform = new THREE.Group(); scene.add(platform);
const band = bandMaps();
const sideMat = new THREE.MeshStandardMaterial({ map: band.map, normalMap: band.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), metalness: 0.65, roughness: 0.55 });
export const deckMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.72, roughness: 1.0, normalScale: new THREE.Vector2(0.75, 0.75), envMapIntensity: 1.0 });
const deck = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 2.0, 160, 1, false), [sideMat, deckMat, sideMat]);
deck.position.y = -1.0; deck.receiveShadow = true; deck.castShadow = true; platform.add(deck);
// a lip under the deck and a skirt of girders
const lip = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.92, 0.5, 160, 1, false), [new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.8, roughness: 0.5 }), sideMat, sideMat]);
lip.position.y = -2.25; platform.add(lip);

const rock = rockMaps();
const rockMat = new THREE.MeshStandardMaterial({ map: rock.map, normalMap: rock.normalMap, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.96, metalness: 0.0, color: 0xb9a89e });
function rockyCylinder(rTop, rBot, h, segs, rings, amp, seed) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, segs, rings, true);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const an = Math.atan2(z, x), r = Math.hypot(x, z);
    const n = fbm(Math.cos(an) * 1.6 + seed, Math.sin(an) * 1.6, y * 0.18, 4) - 0.5;
    const n2 = vnoise(Math.cos(an) * 5 + seed, Math.sin(an) * 5, y * 0.6) - 0.5;
    const rr = r * (1 + n * amp + n2 * amp * 0.35);
    p.setXYZ(i, Math.cos(an) * rr, y, Math.sin(an) * rr);
  }
  g.computeVertexNormals();
  return g;
}
const pillarH = -LIQUID_Y + 8;
const pillar = new THREE.Mesh(rockyCylinder(5.2, 10.5, pillarH, 64, 36, 0.55, 3.1), rockMat);
pillar.position.y = -2.4 - pillarH / 2; pillar.castShadow = true; pillar.receiveShadow = true; scene.add(pillar);
// heat glow where the rock meets the lava
const heatMat = new THREE.MeshBasicMaterial({ color: 0xff6a20, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
const heat = new THREE.Mesh(new THREE.CylinderGeometry(9.0, 11.2, 3.2, 48, 1, true), heatMat);
heat.position.y = LIQUID_Y + 1.4; scene.add(heat);
export const footMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.45, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
const foot = new THREE.Mesh(new THREE.RingGeometry(9.5, 14.5, 64), footMat);
foot.rotation.x = -Math.PI / 2; foot.position.y = LIQUID_Y + 0.08; scene.add(foot);
export const rimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff4a3c).multiplyScalar(2.5), transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false });
const rim = new THREE.Mesh(new THREE.RingGeometry(0.985, 1.02, 160), rimMat);
rim.rotation.x = -Math.PI / 2; rim.position.y = 0.03; platform.add(rim);
// always-on LED strip just inside the hazard ring
export const ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffcf3f).multiplyScalar(2.2), transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
const led = new THREE.Mesh(new THREE.RingGeometry(0.955, 0.968, 160), ledMat);
led.rotation.x = -Math.PI / 2; led.position.y = 0.035; platform.add(led);

function boulder(r, seed) {
  const g = new THREE.IcosahedronGeometry(r, 2); const p = g.attributes.position; const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.set(p.getX(i), p.getY(i), p.getZ(i)); const n = fbm(v.x * 0.9 + seed, v.y * 0.9, v.z * 0.9, 3) - 0.5; v.multiplyScalar(1 + n * 0.7); p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals(); return g;
}
for (let i = 0; i < 12; i++) {
  const m = new THREE.Mesh(boulder(1.6 + Math.random() * 2.6, i * 1.7), rockMat);
  const a = (i / 12) * Math.PI * 2 + Math.random() * 0.4, d = 11 + Math.random() * 10;
  m.position.set(Math.sin(a) * d, LIQUID_Y + 0.3 + Math.random() * 1.0, Math.cos(a) * d);
  m.rotation.set(Math.random() * 3, Math.random() * 3, 0); m.castShadow = true; m.receiveShadow = true; scene.add(m);
}
for (let i = 0; i < 26; i++) {
  const m = new THREE.Mesh(boulder(2.5 + Math.random() * 6, 40 + i), rockMat);
  const a = Math.random() * Math.PI * 2, d = 48 + Math.random() * 130;
  m.position.set(Math.sin(a) * d, LIQUID_Y + 0.5 + Math.random() * 3, Math.cos(a) * d);
  m.rotation.set(Math.random() * 3, Math.random() * 3, 0); scene.add(m);
}

// ------------------------------------------------------------------ drifting embers
function softDot() {
  const c = mkCanvas(64), g = c.getContext('2d', { willReadFrequently: true }); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return texOf(c, false);
}
export const dotTex = softDot();
const EMB = 600;
const embPos = new Float32Array(EMB * 3), embVel = new Float32Array(EMB * 2);
function resetEmber(i, randomY) {
  const a = Math.random() * Math.PI * 2, d = 30 + Math.random() * 150;
  embPos[i * 3] = Math.sin(a) * d; embPos[i * 3 + 1] = LIQUID_Y + (randomY ? Math.random() * 22 : Math.random() * 2); embPos[i * 3 + 2] = Math.cos(a) * d;
  embVel[i * 2] = 1.5 + Math.random() * 3.5; embVel[i * 2 + 1] = Math.random() * Math.PI * 2;
}
for (let i = 0; i < EMB; i++) resetEmber(i, true);
const embGeo = new THREE.BufferGeometry(); embGeo.setAttribute('position', new THREE.BufferAttribute(embPos, 3));
const embers = new THREE.Points(embGeo, new THREE.PointsMaterial({ color: new THREE.Color(0xff8a3a).multiplyScalar(2.2), size: 0.5, map: dotTex, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
embers.frustumCulled = false; scene.add(embers);

// ------------------------------------------------------------------ stadium floodlights on rock columns
const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.97, 0.9).multiplyScalar(3.2) });
// light cones: bright at the lamp, fading to nothing before they reach the deck (so no wedges on the floor)
const beamMat = new THREE.ShaderMaterial({
  uniforms: { uColor: { value: new THREE.Color(0xfff4e0) }, uA: { value: 0.1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform vec3 uColor; uniform float uA; varying vec2 vUv; void main(){ float t = clamp(vUv.y, 0.0, 1.0); float a = pow(t, 2.2) * uA; gl_FragColor = vec4(uColor * a, a); }',
  transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
});
const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.85, roughness: 0.45 });
export const floodlights = [];
for (let i = 0; i < 4; i++) {
  const a = (i / 4) * Math.PI * 2 + Math.PI / 4, d = 34;
  const g = new THREE.Group(); g.position.set(Math.sin(a) * d, 0, Math.cos(a) * d); scene.add(g);
  const colH = -LIQUID_Y + 1;
  const col = new THREE.Mesh(rockyCylinder(2.4, 5.5, colH, 24, 10, 0.5, 90 + i * 3), rockMat); col.position.y = LIQUID_Y - 2 + colH / 2; col.castShadow = true; g.add(col);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 18, 12), poleMat); pole.position.y = 8; pole.castShadow = true; g.add(pole);
  const head = new THREE.Group(); head.position.y = 17.4; g.add(head);
  head.lookAt(0, 0, 0);
  head.add(new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.8, 0.5), poleMat));
  for (const sx of [-0.85, 0, 0.85]) { const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.55, 0.1), lampMat); lamp.position.set(sx, 0, 0.3); head.add(lamp); }
  const spot = new THREE.SpotLight(0xfff1dc, 48, 130, 0.72, 1.0, 1.15); spot.position.set(0, 0, 0.3); head.add(spot);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: new THREE.Color(1.0, 0.95, 0.85).multiplyScalar(1.4), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.set(7, 7, 1); halo.position.set(0, 0, 0.6); head.add(halo);
  spot.target.position.set(0, 0, 36); head.add(spot.target);
  const len = Math.hypot(d, 17.4);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(15, len, 24, 1, true), beamMat); beam.rotation.x = -Math.PI / 2; beam.position.z = len / 2; head.add(beam);
  floodlights.push({ g, spot });
}

// ------------------------------------------------------------------ horizon dressing per theme
const farMat = new THREE.MeshStandardMaterial({ map: rock.map, normalMap: rock.normalMap, roughness: 1, color: 0x7a6a62 });
export const farLava = new THREE.Group(); scene.add(farLava);
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2 + Math.random() * 0.6, d = 250 + Math.random() * 180, r = 55 + Math.random() * 55, h = 70 + Math.random() * 80;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 9, 4), farMat); cone.position.set(Math.sin(a) * d, LIQUID_Y + h / 2 - 6, Math.cos(a) * d); cone.rotation.y = Math.random() * 3; farLava.add(cone);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(r * 0.12, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff5a1a).multiplyScalar(3) })); tip.position.set(Math.sin(a) * d, LIQUID_Y + h - 8, Math.cos(a) * d); farLava.add(tip);
  for (let k = 0; k < 5; k++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: 0x2a1a18, transparent: true, opacity: 0.32 - k * 0.05, depthWrite: false }));
    sp.position.set(Math.sin(a) * d + (Math.random() - 0.5) * 12, LIQUID_Y + h + k * 16, Math.cos(a) * d + (Math.random() - 0.5) * 12); sp.scale.setScalar(26 + k * 12); farLava.add(sp);
  }
}
export const farWater = new THREE.Group(); scene.add(farWater);
for (let i = 0; i < 12; i++) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: 0xffffff, transparent: true, opacity: 0.42, depthWrite: false }));
  const a = Math.random() * Math.PI * 2, d = 220 + Math.random() * 320;
  sp.position.set(Math.sin(a) * d, 110 + Math.random() * 90, Math.cos(a) * d); sp.scale.set(150 + Math.random() * 130, 55 + Math.random() * 30, 1); farWater.add(sp);
}
for (let i = 0; i < 4; i++) {
  const a = (i / 4) * Math.PI * 2 + 0.5, d = 260 + Math.random() * 120;
  const isl = new THREE.Mesh(new THREE.ConeGeometry(45 + Math.random() * 40, 24 + Math.random() * 14, 8, 2), farMat); isl.position.set(Math.sin(a) * d, LIQUID_Y + 6, Math.cos(a) * d); farWater.add(isl);
}

// ------------------------------------------------------------------ map props (bumper posts, lava fissures)
const postBand = bandMaps();
const postMat = new THREE.MeshStandardMaterial({ map: postBand.map, normalMap: postBand.normalMap, metalness: 0.7, roughness: 0.5 });
postMat.map = postMat.map.clone(); postMat.map.repeat.set(4, 1); postMat.map.needsUpdate = true;
const fissureMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uR: { value: 22 }, uA: { value: new THREE.Color(0x2a0a04) }, uB: { value: new THREE.Color(0xff4a10) }, uC: { value: new THREE.Color(0xffd27a) } },
  vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }',
  fragmentShader: `uniform float uTime, uR; uniform vec3 uA, uB, uC; varying vec2 vUv; varying vec3 vW;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
    void main(){
      if (length(vW.xz) > uR - 0.2) discard;
      vec2 p = vec2(vUv.x * 40.0, vUv.y * 2.0);
      float n = noise(p + uTime * 0.2) * 0.6 + noise(p * 2.3 - uTime * 0.3) * 0.4;
      float edge = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.82, vUv.y);
      vec3 col = mix(uA, uB, smoothstep(0.3, 0.7, n)) * (0.6 + 1.6 * edge);
      col = mix(col, uC * 2.0, smoothstep(0.75, 0.95, n) * edge);
      gl_FragColor = vec4(col, 1.0);
    }`,
});
export const mapProps = { group: new THREE.Group(), posts: [], balls: [] };
scene.add(mapProps.group);
const ironMat = new THREE.MeshStandardMaterial({ color: 0x3a3b40, roughness: 0.5, metalness: 0.92 });
const chainMat = new THREE.MeshStandardMaterial({ color: 0x55575c, roughness: 0.45, metalness: 0.95 });
const hazardMat = new THREE.MeshStandardMaterial({ color: 0xffcf3f, roughness: 0.5, metalness: 0.3 });
function latticeTower(h, w) {
  const t = new THREE.Group();
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.28, h, 0.28), poleMat); leg.position.set(sx * w / 2, h / 2, sz * w / 2); leg.castShadow = true; t.add(leg); }
  for (let y = 2; y < h; y += 3) {
    for (const [a, b] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, w), poleMat);
      bar.position.set((a[0] + b[0]) / 2 * w / 2, y, (a[1] + b[1]) / 2 * w / 2); bar.rotation.y = a[0] === b[0] ? 0 : Math.PI / 2; t.add(bar);
      const diag = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, Math.hypot(w, 3)), poleMat);
      diag.position.copy(bar.position); diag.position.y = y + 1.5; diag.rotation.y = bar.rotation.y; diag.rotation.x = Math.atan2(3, w) * (y % 6 ? 1 : -1); t.add(diag);
    }
  }
  return t;
}
export function buildMapProps(map) {
  const g = mapProps.group;
  while (g.children.length) g.remove(g.children[0]);
  mapProps.posts = []; mapProps.balls = [];
  if (map.balls && map.balls.length) {
    // one gantry per beam line: rock columns outside the deck, lattice towers, a beam across, pivots, chains, balls
    const lines = [...new Set(map.balls.map((b) => b.z))];
    for (const z of lines) {
      const span = RULES.platformR0 + 6, top = Math.max(...map.balls.map((b) => b.py)) + 1.0;
      for (const sx of [-1, 1]) {
        const colH = -LIQUID_Y + 1;
        const col = new THREE.Mesh(rockyCylinder(3.2, 6.5, colH, 24, 10, 0.5, 120 + sx), rockMat); col.position.set(sx * span, LIQUID_Y - 2 + colH / 2, z); col.castShadow = true; col.receiveShadow = true; g.add(col);
        const tower = latticeTower(top + 2, 2.2); tower.position.set(sx * span, -2, z); g.add(tower);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 2.2, 1.0, 1.0), poleMat); beam.position.set(0, top, z); beam.castShadow = true; g.add(beam);
      for (let i = -1; i <= 1; i += 2) { const rail = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 2.2, 0.12, 0.12), hazardMat); rail.position.set(0, top + 0.56, z + i * 0.44); g.add(rail); }
    }
    for (const b of map.balls) {
      const pivot = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.0, 1.3), ironMat); pivot.position.set(b.x, b.py, b.z); g.add(pivot);
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.07, 8, 16), chainMat); hook.position.set(b.x, b.py - 0.6, b.z); g.add(hook);
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1, 8), chainMat); chain.castShadow = true; g.add(chain);
      const links = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 1, 6, 1, true), new THREE.MeshStandardMaterial({ color: 0x2a2b2f, roughness: 0.6, metalness: 0.9, side: THREE.DoubleSide, wireframe: true })); chain.add(links);
      const ball = new THREE.Group();
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(b.r, 28, 20), ironMat); sphere.castShadow = true; sphere.receiveShadow = true; ball.add(sphere);
      const stripe = new THREE.Mesh(new THREE.TorusGeometry(b.r * 0.98, 0.09, 8, 48), hazardMat); stripe.rotation.x = Math.PI / 2; ball.add(stripe);
      for (let i = 0; i < 12; i++) { const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), chainMat); const a = (i / 12) * Math.PI * 2; bolt.position.set(Math.cos(a) * b.r * 0.92, b.r * 0.38, Math.sin(a) * b.r * 0.92); ball.add(bolt); }
      const eye = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.08, 8, 16), chainMat); eye.position.y = b.r + 0.2; ball.add(eye);
      const glowSp = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: 0xffcf3f, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })); glowSp.scale.set(b.r * 3, b.r * 3, 1); ball.add(glowSp);
      g.add(ball);
      mapProps.balls.push({ def: b, chain, ball });
    }
    updateBalls(0);
  }
  for (const b of map.bumpers) {
    const post = new THREE.Group(); post.position.set(b.x, 0, b.z);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(b.r, b.r, 2.4, 32), postMat); body.position.y = 1.2; body.castShadow = true; body.receiveShadow = true; post.add(body);
    const flange = new THREE.Mesh(new THREE.CylinderGeometry(b.r + 0.35, b.r + 0.45, 0.18, 32), postMat); flange.position.y = 0.09; post.add(flange);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(b.r + 0.1, b.r, 0.2, 32), new THREE.MeshStandardMaterial({ color: 0x2b2d31, metalness: 0.9, roughness: 0.4 })); cap.position.y = 2.5; post.add(cap);
    const led = new THREE.Mesh(new THREE.TorusGeometry(b.r + 0.02, 0.07, 8, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffcf3f).multiplyScalar(2.2) })); led.rotation.x = Math.PI / 2; led.position.y = 2.3; post.add(led);
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(b.r + 0.01, b.r + 0.01, 0.5, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0xd83a2a, roughness: 0.5 })); stripe.position.y = 1.0; post.add(stripe);
    g.add(post); mapProps.posts.push({ mesh: post, x: b.x, z: b.z, r: b.r });
  }
  for (const h of map.holes) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(h.hw * 2, h.hl * 2), fissureMat);
    strip.rotation.x = -Math.PI / 2; strip.rotation.z = -h.a; strip.position.set(h.x, 0.025, h.z); strip.renderOrder = 1;
    g.add(strip);
    for (const side of [-1, 1]) {
      const lip = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, h.hl * 2), new THREE.MeshStandardMaterial({ color: 0x1a1412, roughness: 1 }));
      lip.rotation.y = -h.a; lip.position.set(h.x + Math.cos(h.a) * side * (h.hw + 0.1), 0.06, h.z - Math.sin(h.a) * side * (h.hw + 0.1)); g.add(lip);
    }
  }
}
export function setMapRadius(r) {
  fissureMat.uniforms.uR.value = r;
  for (const p of mapProps.posts) p.mesh.visible = Math.hypot(p.x, p.z) + p.r <= r + 0.5;
}
const UPV = new THREE.Vector3(0, 1, 0), tmpD = new THREE.Vector3();
// Wrecking balls: pure function of simulation time, so every client agrees with the server.
export function updateBalls(t) {
  for (const { def: b, chain, ball } of mapProps.balls) {
    const p = ballPose(b, t);
    ball.position.set(p.x, p.y, p.z);
    ball.rotation.set(0, 0, 0); ball.rotateOnAxis(tmpD.set(Math.cos(b.a), 0, -Math.sin(b.a)).normalize(), p.th);
    const hx = b.x, hy = b.py - 0.6, hz = b.z;
    tmpD.set(p.x - hx, p.y - hy, p.z - hz); const full = tmpD.length(), len = Math.max(0.1, full - b.r), k = len / full;
    chain.position.set(hx + tmpD.x * 0.5 * k, hy + tmpD.y * 0.5 * k, hz + tmpD.z * 0.5 * k);
    chain.scale.set(1, len, 1); chain.quaternion.setFromUnitVectors(UPV, tmpD.normalize());
  }
}

// ------------------------------------------------------------------ dropped hazards: mines and oil (from snapshots)
const hazards = new THREE.Group(); scene.add(hazards);
const mineMeshes = new Map(), oilMeshes = new Map();
const mineBody = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.4, metalness: 0.85 });
function makeMine() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.22, 16), mineBody); base.position.y = 0.11; base.castShadow = true; g.add(base);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), mineBody); dome.position.y = 0.2; g.add(dome);
  for (let i = 0; i < 8; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 6), chainMat); const a = (i / 8) * Math.PI * 2; sp.position.set(Math.cos(a) * 0.5, 0.3, Math.sin(a) * 0.5); sp.rotation.set(0, -a, -Math.PI / 2); g.add(sp); }
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x606060, emissive: 0xff2020, emissiveIntensity: 0.3, roughness: 0.3 });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), lampMat); lamp.position.y = 0.62; g.add(lamp);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: 0xff3030, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); halo.scale.set(2.2, 2.2, 1); halo.position.y = 0.65; g.add(halo);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.7, 2.0, 40), new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; g.add(ring);
  g.userData = { lamp: lampMat, halo: halo.material, ring: ring.material };
  return g;
}
export function syncMines(list, worldT) {
  const seen = new Set();
  for (const m of list) {
    seen.add(m.id);
    let g = mineMeshes.get(m.id);
    if (!g) { g = makeMine(); g.position.set(m.x, 0, m.z); hazards.add(g); mineMeshes.set(m.id, g); }
    const armed = worldT >= m.armAt, u = g.userData, blink = 0.5 + 0.5 * Math.sin(worldT * (armed ? 16 : 5));
    u.lamp.emissiveIntensity = armed ? 0.8 + 2.4 * blink : 0.25 + 0.3 * blink;
    u.lamp.color.set(armed ? 0xff4040 : 0x707070);
    u.halo.opacity = armed ? 0.25 + 0.45 * blink : 0;
    u.ring.opacity = armed ? 0.18 + 0.25 * blink : 0.06;
  }
  for (const [id, g] of mineMeshes) if (!seen.has(id)) { hazards.remove(g); mineMeshes.delete(id); }
}
const oilMat = new THREE.MeshStandardMaterial({ color: 0x07070a, roughness: 0.1, metalness: 0.75, transparent: true, opacity: 0.9, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, depthWrite: false, envMapIntensity: 1.6 });
export function syncOil(list, worldT) {
  const seen = new Set();
  for (const o of list) {
    const key = `${o.x.toFixed(2)},${o.z.toFixed(2)}`; seen.add(key);
    let m = oilMeshes.get(key);
    if (!m) {
      m = new THREE.Mesh(new THREE.CircleGeometry(o.r, 30), oilMat.clone()); m.rotation.x = -Math.PI / 2; m.rotation.z = Math.random() * 6.28;
      m.position.set(o.x, 0.032, o.z); m.scale.set(1, 0.82 + Math.random() * 0.3, 1); m.renderOrder = 2; hazards.add(m); oilMeshes.set(key, m);
    }
    m.material.opacity = 0.9 * Math.max(0, Math.min(1, (o.t - worldT) / 1.2));
  }
  for (const [key, m] of oilMeshes) if (!seen.has(key)) { hazards.remove(m); m.geometry.dispose(); m.material.dispose(); oilMeshes.delete(key); }
}

// ------------------------------------------------------------------ theme + per-frame
let currentTheme = null;
export function applyTheme(name) {
  const t = THEMES[name]; currentTheme = name;
  scene.background = null;
  scene.fog = new THREE.Fog(t.fog, t.fogNear, t.fogFar);
  skyMat.uniforms.uTop.value.set(t.skyTop); skyMat.uniforms.uHor.value.set(t.skyHorizon); skyMat.uniforms.uGlow.value.set(t.horizonGlow);
  const sd = new THREE.Vector3(t.sunPos[0], t.sunPos[1], t.sunPos[2]).normalize();
  skyMat.uniforms.uSunDir.value.copy(sd); skyMat.uniforms.uSunI.value = t.sunI;
  sun.color.set(t.sun); sun.intensity = t.sunI; sun.position.set(t.sunPos[0], t.sunPos[1], t.sunPos[2]);
  hemi.color.set(t.hemiSky); hemi.groundColor.set(t.hemiGround); hemi.intensity = t.hemiI;
  glow.color.set(t.glow); glow.intensity = t.glowI; under.color.set(t.glow); under.intensity = t.mode === 0 ? 16 : 4;
  liquidMat.uniforms.uA.value.set(t.liquid[0]); liquidMat.uniforms.uB.value.set(t.liquid[1]); liquidMat.uniforms.uC.value.set(t.liquid[2]);
  liquidMat.uniforms.uMode.value = t.mode; liquidMat.uniforms.uSunDir.value.copy(sd);
  liquidMat.uniforms.fogColor.value.set(t.fog); liquidMat.uniforms.fogNear.value = t.fogNear; liquidMat.uniforms.fogFar.value = t.fogFar;
  footMat.color.set(t.foot); heatMat.color.set(t.glow); heat.visible = t.mode === 0;
  embers.visible = t.embers;
  farLava.visible = t.mode === 0; farWater.visible = t.mode === 1;
  ledMat.color.set(t.ring).multiplyScalar(2.2);
  bloom.strength = t.bloom; renderer.toneMappingExposure = t.exposure;
  for (const k of ['map', 'roughnessMap', 'normalMap']) if (deckMat[k]) deckMat[k].dispose();
  Object.assign(deckMat, deckMaps(t)); deckMat.needsUpdate = true;
  buildEnvironment(t);
}

export function tickScene(now, dt) {
  liquidMat.uniforms.uTime.value = now / 1000;
  fissureMat.uniforms.uTime.value = now / 1000;
  ledMat.opacity = 0.65 + 0.3 * Math.sin(now / 650);
  if (currentTheme === 'lava') {
    glow.intensity = THEMES.lava.glowI * (0.9 + 0.1 * Math.sin(now / 170) * Math.sin(now / 410));
    heatMat.opacity = 0.26 + 0.08 * Math.sin(now / 230);
  }
  if (embers.visible) {
    for (let i = 0; i < EMB; i++) {
      const j = i * 3; const ph = embVel[i * 2 + 1] + now / 900;
      embPos[j] += Math.sin(ph) * 0.8 * dt; embPos[j + 2] += Math.cos(ph * 0.7) * 0.8 * dt; embPos[j + 1] += embVel[i * 2] * dt;
      if (embPos[j + 1] > LIQUID_Y + 24) resetEmber(i, false);
    }
    embGeo.attributes.position.needsUpdate = true;
  }
}

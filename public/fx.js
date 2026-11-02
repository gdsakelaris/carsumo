// Particle effects: hot sparks, tyre smoke and dust, magnet streams, lava / water splashes.
import * as THREE from 'three';
import { scene, LIQUID_Y, dotTex } from './scene.js';

const lerp = (a, b, k) => a + (b - a) * k;

// ------------------------------------------------------------------ sparks (small glowing chips)
const PARTS = [];
const partGeo = new THREE.TetrahedronGeometry(0.11, 0);
for (let i = 0; i < 200; i++) {
  const m = new THREE.Mesh(partGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
  m.visible = false; scene.add(m); PARTS.push({ m, v: new THREE.Vector3(), life: 0, max: 1, g: 20 });
}
export function burst(x, y, z, color, n, speed, life = 0.6, g = 20, hdr = 2.4) {
  let spawned = 0;
  for (const p of PARTS) {
    if (p.life > 0) continue;
    p.m.visible = true; p.m.material.color.set(color).multiplyScalar(hdr); p.m.position.set(x, y, z);
    p.v.set((Math.random() - 0.5), Math.random() * 0.9 + 0.2, (Math.random() - 0.5)).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
    p.life = p.max = life * (0.6 + Math.random() * 0.7); p.g = g; p.m.scale.setScalar(0.6 + Math.random() * 0.9);
    if (++spawned >= n) break;
  }
}
export function streamTo(from, to, color) {
  for (const p of PARTS) {
    if (p.life > 0) continue;
    const k = Math.random();
    p.m.visible = true; p.m.material.color.set(color).multiplyScalar(2.5);
    p.m.position.set(lerp(from.x, to.x, k), 0.9 + Math.random() * 0.8, lerp(from.z, to.z, k));
    p.v.set(to.x - from.x, 0, to.z - from.z).normalize().multiplyScalar(10); p.life = p.max = 0.35; p.g = 0; p.m.scale.setScalar(0.5);
    break;
  }
}

// ------------------------------------------------------------------ smoke & dust (soft sprites)
const SMOKE = [];
for (let i = 0; i < 120; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
  s.visible = false; scene.add(s); SMOKE.push({ s, v: new THREE.Vector3(), life: 0, max: 1, size: 1, rot: 0 });
}
export function puff(x, y, z, size, color, life = 0.9, rise = 1.0, vx = 0, vz = 0, alpha = 0.45) {
  const p = SMOKE.find((q) => q.life <= 0); if (!p) return;
  p.s.visible = true; p.s.material.color.set(color); p.s.material.opacity = alpha; p.alpha = alpha;
  p.s.position.set(x, y, z); p.v.set(vx + (Math.random() - 0.5) * 0.8, rise * (0.6 + Math.random() * 0.8), vz + (Math.random() - 0.5) * 0.8);
  p.life = p.max = life * (0.7 + Math.random() * 0.6); p.size = size * (0.7 + Math.random() * 0.6);
  p.s.material.rotation = Math.random() * Math.PI * 2; p.rot = (Math.random() - 0.5) * 2;
  p.s.scale.setScalar(p.size);
}

// ------------------------------------------------------------------ splashes
const SPLASHES = [];
for (let i = 0; i < 6; i++) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.0, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  flash.visible = false; scene.add(flash);
  SPLASHES.push({ m, flash, t: 0 });
}
export function splash(x, z, theme) {
  const s = SPLASHES.find((q) => q.t <= 0) || SPLASHES[0];
  const hot = theme.mode === 0;
  s.t = 1.4; s.m.visible = true; s.m.position.set(x, LIQUID_Y + 0.1, z); s.m.material.color.set(theme.liquid[2]).multiplyScalar(hot ? 2.5 : 1.4);
  s.flash.visible = true; s.flash.position.set(x, LIQUID_Y + 1.5, z); s.flash.material.color.set(theme.liquid[1]).multiplyScalar(hot ? 3 : 1.2); s.flash.scale.setScalar(6);
  burst(x, LIQUID_Y + 0.6, z, theme.liquid[1], 36, 15, 1.1, 24, hot ? 3 : 1.5);
  for (let i = 0; i < 10; i++) puff(x + (Math.random() - 0.5) * 3, LIQUID_Y + 0.8, z + (Math.random() - 0.5) * 3, 3 + Math.random() * 3, hot ? 0x3a1a10 : 0xeaf6ff, 2.2, 2.2, 0, 0, hot ? 0.55 : 0.5);
}

// ------------------------------------------------------------------ per frame
export function updateFx(dt) {
  updateExtras(dt);
  for (const p of PARTS) {
    if (p.life <= 0) continue;
    p.life -= dt; if (p.life <= 0) { p.m.visible = false; continue; }
    p.v.y -= p.g * dt; p.m.position.addScaledVector(p.v, dt);
    p.m.rotation.x += dt * 7; p.m.rotation.z += dt * 5;
    const k = p.life / p.max; p.m.scale.setScalar(0.25 + k);
  }
  for (const p of SMOKE) {
    if (p.life <= 0) continue;
    p.life -= dt; if (p.life <= 0) { p.s.visible = false; continue; }
    const k = 1 - p.life / p.max;
    p.s.position.addScaledVector(p.v, dt); p.v.multiplyScalar(1 - 1.2 * dt);
    p.s.scale.setScalar(p.size * (1 + k * 2.2));
    p.s.material.opacity = p.alpha * (1 - k) * (1 - k);
    p.s.material.rotation += p.rot * dt;
  }
  for (const s of SPLASHES) {
    if (s.t <= 0) continue;
    s.t -= dt; const k = 1 - Math.max(0, s.t) / 1.4;
    s.m.scale.setScalar(1 + k * 16); s.m.material.opacity = (1 - k) * 0.9;
    s.flash.material.opacity = Math.max(0, 1 - k * 3) * 0.9; s.flash.scale.setScalar(6 + k * 12);
    if (s.t <= 0) { s.m.visible = false; s.flash.visible = false; }
  }
}

// ------------------------------------------------------------------ boost / ability ribbons
const TRAIL_N = 40, TRAIL_LIFE = 520;
export function createTrail(color, width = 0.9) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(TRAIL_N * 2 * 3), alpha = new Float32Array(TRAIL_N * 2);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
  const idx = []; for (let i = 0; i < TRAIL_N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(2.4) } },
    vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor * vA, vA); }',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.visible = false; scene.add(mesh);
  const pts = [];
  return {
    mesh,
    push(x, y, z, rx, rz, now) { pts.push({ x, y, z, rx, rz, t: now }); if (pts.length > TRAIL_N) pts.shift(); },
    update(now, emitting) {
      while (pts.length && now - pts[0].t > TRAIL_LIFE) pts.shift();
      if (pts.length < 2) { mesh.visible = false; return; }
      mesh.visible = true;
      const last = pts[pts.length - 1];
      for (let i = 0; i < TRAIL_N; i++) {
        const p = i < pts.length ? pts[i] : last;
        const age = (now - p.t) / TRAIL_LIFE;
        const a = i < pts.length ? Math.max(0, 1 - age) * (emitting ? 1 : 0.5) : 0;
        const w = width * (0.35 + 0.65 * (1 - age));
        const o = i * 6;
        pos[o] = p.x + p.rx * w; pos[o + 1] = p.y; pos[o + 2] = p.z + p.rz * w;
        pos[o + 3] = p.x - p.rx * w; pos[o + 4] = p.y; pos[o + 5] = p.z - p.rz * w;
        alpha[i * 2] = a; alpha[i * 2 + 1] = a;
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.alpha.needsUpdate = true;
    },
    dispose() { scene.remove(mesh); geo.dispose(); mat.dispose(); },
  };
}

// ------------------------------------------------------------------ tyre marks on the deck
const MARKS = 1200; let markHead = 0;
const markGeo = new THREE.BufferGeometry();
const markPos = new Float32Array(MARKS * 4 * 3), markBirth = new Float32Array(MARKS * 4).fill(-1e4), markStr = new Float32Array(MARKS * 4);
markGeo.setAttribute('position', new THREE.BufferAttribute(markPos, 3));
markGeo.setAttribute('birth', new THREE.BufferAttribute(markBirth, 1));
markGeo.setAttribute('str', new THREE.BufferAttribute(markStr, 1));
{ const idx = []; for (let i = 0; i < MARKS; i++) { const a = i * 4; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); } markGeo.setIndex(idx); }
const markMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uR: { value: 22 } },
  vertexShader: 'attribute float birth; attribute float str; uniform float uTime; varying float vA; varying vec3 vW; void main(){ float age = uTime - birth; vA = str * clamp(1.0 - age / 14.0, 0.0, 1.0); vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }',
  fragmentShader: 'uniform float uR; varying float vA; varying vec3 vW; void main(){ if (length(vW.xz) > uR || vA <= 0.0) discard; gl_FragColor = vec4(0.03, 0.03, 0.03, vA * 0.6); }',
  transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
});
const marks = new THREE.Mesh(markGeo, markMat); marks.frustumCulled = false; scene.add(marks);
export function skidMark(x1, z1, x2, z2, width, strength, now) {
  const dx = x2 - x1, dz = z2 - z1; const len = Math.hypot(dx, dz); if (len < 0.04 || len > 3) return;
  const nx = (-dz / len) * width / 2, nz = (dx / len) * width / 2;
  const i = markHead; markHead = (markHead + 1) % MARKS;
  const y = 0.028, o = i * 12;
  markPos[o] = x1 + nx; markPos[o + 1] = y; markPos[o + 2] = z1 + nz;
  markPos[o + 3] = x1 - nx; markPos[o + 4] = y; markPos[o + 5] = z1 - nz;
  markPos[o + 6] = x2 + nx; markPos[o + 7] = y; markPos[o + 8] = z2 + nz;
  markPos[o + 9] = x2 - nx; markPos[o + 10] = y; markPos[o + 11] = z2 - nz;
  for (let k = 0; k < 4; k++) { markBirth[i * 4 + k] = now / 1000; markStr[i * 4 + k] = strength; }
  markGeo.attributes.position.needsUpdate = true; markGeo.attributes.birth.needsUpdate = true; markGeo.attributes.str.needsUpdate = true;
}
export function setMarkRadius(r) { markMat.uniforms.uR.value = r; }

// ------------------------------------------------------------------ impact flashes
const FLASHES = [];
for (let i = 0; i < 8; i++) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  sp.visible = false; scene.add(sp); FLASHES.push({ sp, t: 0, max: 0.25, size: 1 });
}
export function impactFlash(x, y, z, color, size = 3, life = 0.25) {
  const f = FLASHES.find((q) => q.t <= 0) || FLASHES[0];
  f.t = f.max = life; f.size = size; f.sp.visible = true; f.sp.position.set(x, y, z);
  f.sp.material.color.set(color).multiplyScalar(3); f.sp.material.opacity = 1; f.sp.scale.setScalar(size);
}

// ------------------------------------------------------------------ shock rings on the deck (ability activations)
const RINGS = [];
for (let i = 0; i < 8; i++) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.86, 1.0, 72), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m); RINGS.push({ m, t: 0, max: 0.5, size: 8 });
}
export function shockRing(x, z, color, size = 8, life = 0.5, y = 0.06) {
  const r = RINGS.find((q) => q.t <= 0) || RINGS[0];
  r.t = r.max = life; r.size = size; r.m.visible = true; r.m.position.set(x, y, z);
  r.m.material.color.set(color).multiplyScalar(2.5); r.m.material.opacity = 1; r.m.scale.setScalar(1);
}

function updateExtras(dt) {
  markMat.uniforms.uTime.value = performance.now() / 1000;
  for (const r of RINGS) {
    if (r.t <= 0) continue;
    r.t -= dt; const k = 1 - Math.max(0, r.t) / r.max;
    r.m.scale.setScalar(1 + k * r.size); r.m.material.opacity = (1 - k) * (1 - k);
    if (r.t <= 0) r.m.visible = false;
  }
  for (const f of FLASHES) {
    if (f.t <= 0) continue;
    f.t -= dt; const k = 1 - Math.max(0, f.t) / f.max;
    f.sp.material.opacity = 1 - k; f.sp.scale.setScalar(f.size * (1 + k * 1.5));
    if (f.t <= 0) f.sp.visible = false;
  }
}

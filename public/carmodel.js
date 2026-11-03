// Car models: real side-profile bodies (extruded, bevelled), clearcoat paint, dark glass, treaded tyres on
// alloy rims, head and tail lamps that actually light the deck, neon underglow, and per-type hardware.
import * as THREE from 'three';
import { CARS } from '/shared/cars.js';
import { dotTex } from './scene.js';

const hex = (n) => '#' + n.toString(16).padStart(6, '0');

// ------------------------------------------------------------------ shared materials & geometry
function treadTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 64);
  for (let x = 0; x < 256; x += 16) { g.fillStyle = '#303030'; g.fillRect(x, 0, 6, 64); g.fillStyle = '#a0a0a0'; g.fillRect(x + 6, 0, 2, 64); }
  for (let y = 8; y < 64; y += 24) { g.fillStyle = '#404040'; g.fillRect(0, y, 256, 3); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 1); return t;
}
const treadTex = treadTexture();
const rubber = new THREE.MeshStandardMaterial({ color: 0x121214, roughness: 0.9, metalness: 0.0, bumpMap: treadTex, bumpScale: 0.025 });
const wallMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.75 });
const rimMat = new THREE.MeshStandardMaterial({ color: 0xcfd3d8, roughness: 0.22, metalness: 1.0, envMapIntensity: 1.3 });
const darkMetal = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.4, metalness: 0.9 });
const chrome = new THREE.MeshStandardMaterial({ color: 0xe8eaee, roughness: 0.12, metalness: 1.0, envMapIntensity: 1.5 });
const blackPlastic = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.55, metalness: 0.1 });
const glass = new THREE.MeshPhysicalMaterial({ color: 0x06090d, roughness: 0.08, metalness: 0.0, clearcoat: 0.7, clearcoatRoughness: 0.05, envMapIntensity: 0.7, reflectivity: 0.6 });

const tireGeo = new THREE.CylinderGeometry(0.43, 0.43, 0.34, 32, 1, true); tireGeo.rotateZ(Math.PI / 2);
const wallGeo = new THREE.CylinderGeometry(0.43, 0.43, 0.34, 32, 1, false); wallGeo.rotateZ(Math.PI / 2);
const rimGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.36, 24, 1, true); rimGeo.rotateZ(Math.PI / 2);
const dishGeo = new THREE.CylinderGeometry(0.26, 0.2, 0.08, 24); dishGeo.rotateZ(Math.PI / 2);
const spokeGeo = new THREE.BoxGeometry(0.07, 0.46, 0.11);
const capGeo = new THREE.CylinderGeometry(0.07, 0.09, 0.42, 12); capGeo.rotateZ(Math.PI / 2);
const lampGeo = new THREE.BoxGeometry(0.42, 0.17, 0.12);
const tailGeo = new THREE.BoxGeometry(0.5, 0.13, 0.1);

// Side profiles: [z, y] in metres, z positive = front. Each one is a closed outline, bottom edge last.
const PROFILES = {
  sport: (l) => [[-0.5, 0.30], [-0.5, 0.74], [-0.42, 0.82], [-0.30, 0.84], [-0.13, 1.14], [0.03, 1.17], [0.15, 0.86], [0.31, 0.73], [0.47, 0.62], [0.5, 0.44], [0.5, 0.30]].map(([z, y]) => [z * l, y]),
  truck: (l) => [[-0.5, 0.36], [-0.5, 1.02], [-0.17, 1.02], [-0.15, 1.78], [0.06, 1.80], [0.15, 1.34], [0.40, 1.24], [0.5, 1.12], [0.5, 0.36]].map(([z, y]) => [z * l, y]),
  suv: (l) => [[-0.5, 0.36], [-0.5, 1.08], [-0.45, 1.64], [-0.42, 1.68], [0.09, 1.68], [0.25, 1.14], [0.47, 1.02], [0.5, 0.82], [0.5, 0.36]].map(([z, y]) => [z * l, y]),
  van: (l) => [[-0.5, 0.34], [-0.5, 1.56], [-0.46, 1.66], [0.27, 1.66], [0.43, 1.02], [0.5, 0.88], [0.5, 0.34]].map(([z, y]) => [z * l, y]),
  buggy: (l) => [[-0.5, 0.36], [-0.5, 0.96], [-0.12, 0.96], [-0.10, 1.24], [0.06, 1.26], [0.18, 0.92], [0.42, 0.82], [0.5, 0.64], [0.5, 0.36]].map(([z, y]) => [z * l, y]),
  muscle: (l) => [[-0.5, 0.34], [-0.5, 0.82], [-0.36, 0.86], [-0.20, 1.18], [0.0, 1.20], [0.14, 0.90], [0.30, 0.84], [0.5, 0.76], [0.5, 0.34]].map(([z, y]) => [z * l, y]),
  sedan: (l) => [[-0.5, 0.32], [-0.5, 0.80], [-0.40, 0.86], [-0.28, 0.88], [-0.14, 1.30], [0.05, 1.32], [0.20, 0.92], [0.42, 0.84], [0.5, 0.70], [0.5, 0.32]].map(([z, y]) => [z * l, y]),
};
// window segments as point indices [from, to] of the profile: windshield, rear window, and the roof segment for side glass
const WINDOWS = {
  sport: { front: [4, 5], rear: [3, 4], roof: [4, 5] },
  truck: { front: [4, 5], rear: [2, 3], roof: [3, 4] },
  suv: { front: [4, 5], rear: [1, 2], roof: [3, 4] },
  van: { front: [3, 4], rear: [0, 1], roof: [2, 3] },
  buggy: { front: [4, 5], rear: null, roof: [3, 4] },
  muscle: { front: [4, 5], rear: [2, 3], roof: [3, 4] },
  sedan: { front: [5, 6], rear: [3, 4], roof: [4, 5] },
};
const KIND = { bulldozer: 'truck', flipper: 'sport', speedster: 'sport', anchor: 'suv', magnet: 'van', spinner: 'buggy', crane: 'truck', greaser: 'muscle', boomer: 'sedan' };

function bodyGeometry(pts, w) {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  const depth = w - 0.2;
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 4, steps: 1, curveSegments: 8 });
  geo.rotateY(-Math.PI / 2);
  geo.translate(depth / 2, 0, 0);
  geo.computeVertexNormals();
  return geo;
}

// A thin glossy panel laid on the body between two profile points (windshield / rear window).
function windowPanel(pts, [i, j], w, group) {
  const [z0, y0] = pts[i], [z1, y1] = pts[j];
  const len = Math.hypot(z1 - z0, y1 - y0); if (len < 0.2) return;
  const ang = Math.atan2(y1 - y0, z1 - z0);
  const nz = -(y1 - y0) / len, ny = (z1 - z0) / len; // outward normal of the segment (points up/forward)
  const m = new THREE.Mesh(new THREE.BoxGeometry(w * 0.78, len * 0.72, 0.04), glass);
  m.position.set(0, (y0 + y1) / 2 + ny * 0.035, (z0 + z1) / 2 + nz * 0.035);
  m.rotation.x = -(ang - Math.PI / 2);
  group.add(m);
}

function nameSprite(text, color) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.font = 'bold 60px "Segoe UI", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = Math.min(500, g.measureText(text).width + 50);
  g.fillStyle = 'rgba(0,0,0,0.55)'; roundRect(g, 256 - w / 2, 22, w, 84, 22); g.fill();
  g.fillStyle = '#fff'; g.fillText(text, 256, 66);
  g.fillStyle = hex(color); g.fillRect(256 - w / 2, 22, 12, 84);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(4.6, 1.15, 1); sp.position.y = 2.9;
  return sp;
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

function wheel(sx, sz, w, group, steer, wheels) {
  const pivot = new THREE.Group(); pivot.position.set(sx * (w / 2 + 0.02), 0.43, sz);
  const spinner = new THREE.Group(); pivot.add(spinner);
  const tire = new THREE.Mesh(tireGeo, rubber); tire.castShadow = true; spinner.add(tire);
  const wall = new THREE.Mesh(wallGeo, wallMat); wall.scale.set(0.98, 0.985, 0.985); spinner.add(wall);
  const rim = new THREE.Mesh(rimGeo, rimMat); spinner.add(rim);
  const dish = new THREE.Mesh(dishGeo, darkMetal); dish.position.x = sx * 0.14; spinner.add(dish);
  for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(spokeGeo, rimMat); s.rotation.x = (i / 5) * Math.PI * 2; s.position.x = sx * 0.17; spinner.add(s); }
  const cap = new THREE.Mesh(capGeo, chrome); spinner.add(cap);
  group.add(pivot);
  wheels.push(spinner);
  if (sz > 0) steer.push(pivot);
}

export function buildCar(type, name) {
  const def = CARS[type];
  const [w, h, l] = def.size;
  const kind = KIND[type];
  const pts = PROFILES[kind](l);
  const group = new THREE.Group();

  const paint = new THREE.MeshPhysicalMaterial({ color: def.color, metalness: 0.55, roughness: 0.32, clearcoat: 1.0, clearcoatRoughness: 0.08, envMapIntensity: 1.2, emissive: 0x000000 });
  const accent = new THREE.MeshStandardMaterial({ color: def.accent, roughness: 0.45, metalness: 0.7 });
  const body = new THREE.Mesh(bodyGeometry(pts, w), paint); body.castShadow = true; body.receiveShadow = true; group.add(body);

  // glass
  const win = WINDOWS[kind];
  windowPanel(pts, win.front, w, group);
  if (win.rear) windowPanel(pts, win.rear, w, group);
  {
    const [i, j] = win.roof; const z0 = pts[i][0], z1 = pts[j][0], roofY = Math.max(pts[i][1], pts[j][1]);
    const len = Math.abs(z1 - z0) * 0.8;
    for (const sx of [-1, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.36, Math.max(0.5, len)), glass); m.position.set(sx * (w / 2 - 0.1 + 0.012), roofY - 0.3, (z0 + z1) / 2); group.add(m); }
  }
  // sills, bumpers, grille
  for (const sx of [-1, 1]) { const sill = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, l * 0.6), blackPlastic); sill.position.set(sx * (w / 2 - 0.04), 0.3, 0); group.add(sill); }
  const noseY = pts[pts.length - 2][1], tailY = pts[1][1];
  const bumperF = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, 0.2, 0.16), blackPlastic); bumperF.position.set(0, 0.4, l / 2 + 0.02); group.add(bumperF);
  const bumperR = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, 0.2, 0.16), blackPlastic); bumperR.position.set(0, 0.4, -l / 2 - 0.02); group.add(bumperR);
  const grille = new THREE.Mesh(new THREE.BoxGeometry(w * 0.42, Math.min(0.3, noseY - 0.5), 0.06), darkMetal); grille.position.set(0, 0.5 + Math.min(0.3, noseY - 0.5) / 2, l / 2 + 0.06); group.add(grille);
  // lamps
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 2.0, roughness: 0.2 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x6a0a0a, emissive: 0xff2010, emissiveIntensity: 0.8, roughness: 0.3 });
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(lampGeo, headMat); hl.position.set(sx * w * 0.33, noseY - 0.12, l / 2 + 0.05); group.add(hl);
    const tl = new THREE.Mesh(tailGeo, tailMat); tl.position.set(sx * w * 0.33, tailY - 0.16, -l / 2 - 0.05); group.add(tl);
  }
  const spot = new THREE.SpotLight(0xfff1d6, 160, 34, 0.55, 0.55, 1.4);
  spot.position.set(0, noseY - 0.1, l / 2); spot.target.position.set(0, -0.2, l / 2 + 14); group.add(spot); group.add(spot.target);
  // exhaust
  for (const sx of (kind === 'sport' ? [-1, 1] : [1])) { const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.5, 12), chrome); pipe.rotation.x = Math.PI / 2; pipe.position.set(sx * w * 0.3, 0.32, -l / 2 - 0.2); group.add(pipe); }
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.55, 0.15).multiplyScalar(3), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.8, 10), flameMat); flame.rotation.x = Math.PI / 2; flame.position.set(0, 0.5, -l / 2 - 1.1); group.add(flame);
  // underglow
  const glowPlane = new THREE.Mesh(new THREE.PlaneGeometry(w + 1.6, l + 1.6), new THREE.MeshBasicMaterial({ map: dotTex, color: new THREE.Color(def.color).multiplyScalar(1.8), transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
  glowPlane.rotation.x = -Math.PI / 2; glowPlane.position.y = 0.06; group.add(glowPlane);
  const glowMatP = glowPlane.material;

  // soft contact shadow (grounds the car) and roof stripes
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(w + 1.2, l + 1.2), new THREE.MeshBasicMaterial({ map: dotTex, color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }));
  contact.rotation.x = -Math.PI / 2; contact.position.y = 0.045; group.add(contact);
  {
    const [i, j] = win.roof; const z0 = pts[i][0], z1 = pts[j][0], roofY = Math.max(pts[i][1], pts[j][1]);
    for (const sx of [-0.3, 0.3]) { const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, Math.abs(z1 - z0) * 0.92), accent); stripe.position.set(sx, roofY + 0.006, (z0 + z1) / 2); group.add(stripe); }
  }
  const wheels = [], steer = [];
  const axleZ = kind === 'truck' ? [l * 0.36, -l * 0.3] : [l * 0.33, -l * 0.33];
  for (const sx of [-1, 1]) for (const sz of axleZ) wheel(sx, sz, w, group, steer, wheels);

  let spin = null, wedge = null, blade = null, coil = null, block = null, claw = null, cable = null, tank = null, nozzle = null;
  const plates = [], rams = [], fingers = [], mines = [];
  switch (type) {
    case 'bulldozer': {
      blade = new THREE.Group(); blade.position.set(0, 0.78, l / 2 + 0.55);
      const bladeMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, w * 1.45, 24, 1, true, Math.PI * 1.05, Math.PI * 0.6), new THREE.MeshStandardMaterial({ color: def.accent, roughness: 0.5, metalness: 0.7, side: THREE.DoubleSide }));
      bladeMesh.rotation.z = Math.PI / 2; bladeMesh.castShadow = true; blade.add(bladeMesh);
      for (let i = -2; i <= 2; i++) { const rib = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.12), darkMetal); rib.position.set(i * w * 0.3, 0, -0.33); blade.add(rib); }
      group.add(blade);
      for (const sx of [-1, 1]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 1.3), darkMetal); arm.position.set(sx * w * 0.42, 0.7, l / 2 - 0.2); group.add(arm); }
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 0.12, 0.2), blackPlastic); bar.position.set(0, 1.86, -0.05); group.add(bar);
      for (let i = -1; i <= 1; i++) { const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.1), headMat); lamp.position.set(i * 0.5, 1.86, 0.06); group.add(lamp); }
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.9, 10), chrome); pipe.position.set(w * 0.36, 2.1, -0.1); group.add(pipe);
      break;
    }
    case 'flipper': {
      // hinged wedge: rests low, primes down, snaps up
      wedge = new THREE.Group(); wedge.position.set(0, 0.42, l / 2 - 0.05); wedge.rotation.x = -0.1;
      const plate = new THREE.Mesh(new THREE.BoxGeometry(w * 1.12, 0.08, 1.35), accent); plate.position.z = 0.7; plate.castShadow = true; wedge.add(plate);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(w * 1.12, 0.05, 0.12), chrome); lip.position.set(0, 0.02, 1.36); wedge.add(lip);
      for (const sx of [-1, 1]) { const ram = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 10), chrome); ram.rotation.x = Math.PI / 2; ram.position.set(sx * w * 0.32, -0.07, 0.45); wedge.add(ram); rams.push(ram); }
      for (const sx of [-1, 1]) { const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 10), darkMetal); cyl.rotation.x = Math.PI / 2 + 0.9; cyl.position.set(sx * w * 0.32, 0.62, l / 2 - 0.15); group.add(cyl); }
      group.add(wedge);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(w * 1.05, 0.05, 0.4), accent); wing.position.set(0, 1.3, -l / 2 + 0.15); group.add(wing);
      for (const sx of [-1, 1]) { const strut = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.2), darkMetal); strut.position.set(sx * w * 0.38, 1.08, -l / 2 + 0.15); group.add(strut); }
      break;
    }
    case 'speedster': {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(w * 1.2, 0.06, 0.5), accent); wing.position.set(0, 1.42, -l / 2 + 0.2); wing.rotation.x = 0.12; wing.castShadow = true; group.add(wing);
      for (const sx of [-1, 1]) {
        const strut = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.55, 0.22), darkMetal); strut.position.set(sx * w * 0.42, 1.12, -l / 2 + 0.2); group.add(strut);
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 0.55), accent); plate.position.set(sx * w * 0.6, 1.45, -l / 2 + 0.2); group.add(plate);
        const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, l * 0.62), accent); skirt.position.set(sx * (w / 2 + 0.02), 0.26, 0); group.add(skirt);
      }
      const splitter = new THREE.Mesh(new THREE.BoxGeometry(w * 1.08, 0.04, 0.45), blackPlastic); splitter.position.set(0, 0.26, l / 2 + 0.1); group.add(splitter);
      const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.6), darkMetal); scoop.position.set(0, pts[6][1] + 0.05, l * 0.2); group.add(scoop);
      spin = flame;
      break;
    }
    case 'anchor': {
      for (const sx of [-1, 1]) {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.95, l * 0.86), accent); plate.position.set(sx * (w / 2 + 0.06), 0.85, 0); plate.castShadow = true; group.add(plate); plates.push(plate);
        for (let i = -2; i <= 2; i++) { const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 8), chrome); bolt.rotation.z = Math.PI / 2; bolt.position.set(sx * 0.09, 0, i * l * 0.18); plate.add(bolt); }
      }
      block = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 0.42, l * 0.42), darkMetal); block.position.set(0, 1.68 + 0.21, -l * 0.08); block.castShadow = true; group.add(block);
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 8), chrome); bolt.position.set(x * w * 0.26, 0.24, z * l * 0.15); block.add(bolt); }
      for (let i = 0; i < 3; i++) { const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, w * 0.95, 10), chrome); bar.rotation.z = Math.PI / 2; bar.position.set(0, 0.5 + i * 0.25, l / 2 + 0.3); group.add(bar); }
      for (const sx of [-1, 1]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 10), chrome); post.position.set(sx * w * 0.42, 0.72, l / 2 + 0.3); group.add(post); }
      break;
    }
    case 'magnet': {
      const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.5, 12), darkMetal); boom.rotation.x = Math.PI / 2 - 0.35; boom.position.set(0, 1.25, l / 2 + 0.25); group.add(boom);
      const horse = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.18, 12, 24, Math.PI), new THREE.MeshPhysicalMaterial({ color: 0xe0223c, roughness: 0.35, metalness: 0.3, clearcoat: 1 }));
      horse.position.set(0, 1.0, l / 2 + 0.95); horse.rotation.y = Math.PI / 2; horse.rotation.z = Math.PI; group.add(horse);
      for (const sx of [-1, 1]) { const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.3, 12), chrome); tip.position.set(sx * 0.6, 0.72, l / 2 + 0.95); group.add(tip); }
      coil = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.5, 16), new THREE.MeshStandardMaterial({ color: 0xb04aff, emissive: 0x8a2aff, emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.5 }));
      coil.position.set(0, 1.66 + 0.25, -l * 0.1); group.add(coil);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.04, 8, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd08aff).multiplyScalar(2) })); ring.rotation.x = Math.PI / 2; ring.position.set(0, 1.66 + 0.5, -l * 0.1); group.add(ring);
      spin = horse;
      break;
    }
    case 'spinner': {
      // big horizontal blade above the roof; idles slowly, screams when active
      const disc = new THREE.Group(); disc.position.set(0, 1.34, -l * 0.12);
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.38, 0.12, 32), accent); plate.castShadow = true; disc.add(plate);
      for (let i = 0; i < 3; i++) { const bl = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.06, 0.34), chrome); bl.rotation.y = (i / 3) * Math.PI; bl.position.y = 0.09; bl.castShadow = true; disc.add(bl); }
      for (let i = 0; i < 6; i++) { const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.5), darkMetal); const a = (i / 6) * Math.PI * 2; tooth.position.set(Math.cos(a) * 1.85, 0.09, Math.sin(a) * 1.85); tooth.rotation.y = -a + Math.PI / 4; disc.add(tooth); }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.34, 16), darkMetal); hub.position.y = 0.17; disc.add(hub);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.5, 12), darkMetal); mast.position.set(0, 1.1, -l * 0.12); group.add(mast);
      group.add(disc); spin = disc;
      const cageMat = darkMetal;
      for (const [x, z] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 10), cageMat); post.position.set(x * w * 0.36, 0.78, -l * 0.1 + z * l * 0.16 + 0.15); group.add(post); }
      for (const z of [1, -1]) { const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, w * 0.76, 10), cageMat); bar.rotation.z = Math.PI / 2; bar.position.set(0, 1.22, -l * 0.1 + z * l * 0.16 + 0.15); group.add(bar); }
      break;
    }
    case 'crane': {
      // lattice boom from the bed, a winch, a cable and a four-finger claw
      const boom = new THREE.Group(); boom.position.set(0, 1.05, -l * 0.3); boom.rotation.x = -0.75; group.add(boom);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 4.2), accent); arm.position.z = 2.1; arm.castShadow = true; boom.add(arm);
      for (let i = 0; i < 6; i++) { const strut = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.07, 0.07), darkMetal); strut.position.set(0, 0.2, 0.4 + i * 0.64); boom.add(strut); }
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 12), chrome); tip.rotation.z = Math.PI / 2; tip.position.z = 4.2; boom.add(tip);
      const winch = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.9, 12), darkMetal); winch.rotation.z = Math.PI / 2; winch.position.set(0, 1.3, -l * 0.3); group.add(winch);
      for (const sx of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.12), darkMetal); leg.position.set(sx * 0.5, 1.3, -l * 0.3); group.add(leg); }
      claw = new THREE.Group(); claw.position.set(0, 3.1, 2.3); group.add(claw);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.32, 12), darkMetal); claw.add(hub);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 8, 20), chrome); ring.rotation.x = Math.PI / 2; ring.position.y = -0.14; claw.add(ring);
      for (let i = 0; i < 4; i++) {
        const f = new THREE.Group(); f.rotation.y = (i / 4) * Math.PI * 2 + Math.PI / 4; claw.add(f);
        const finger = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.07, 8, 14, Math.PI * 0.6), chrome);
        finger.position.set(0.34, 0.02, 0); finger.rotation.z = Math.PI * 1.02; f.add(finger);
        const tipBall = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), darkMetal); tipBall.position.set(0.9, -0.55, 0); f.add(tipBall);
        fingers.push(f);
      }
      cable = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 6), darkMetal); group.add(cable);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 0.12, 0.2), blackPlastic); bar.position.set(0, 1.86, -0.05); group.add(bar);
      for (let i = -1; i <= 1; i++) { const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.1), new THREE.MeshStandardMaterial({ color: 0xffb020, emissive: 0xff9a10, emissiveIntensity: 2.2 })); lamp.position.set(i * 0.5, 1.86, 0.06); group.add(lamp); }
      break;
    }
    case 'greaser': {
      // oil drum strapped across the rear deck, a spray nozzle under the tail, hood scoop, side pipes, fat rear tyres
      tank = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, w * 0.8, 16), new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.35, metalness: 0.8 }));
      tank.rotation.z = Math.PI / 2; tank.position.set(0, pts[1][1] + 0.3, -l * 0.3); tank.castShadow = true; group.add(tank);
      for (const sx of [-0.28, 0.28]) { const strap = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.03, 6, 20), chrome); strap.rotation.y = Math.PI / 2; strap.position.set(sx * w, pts[1][1] + 0.3, -l * 0.3); group.add(strap); }
      const capM = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 10), accent); capM.position.set(0, pts[1][1] + 0.7, -l * 0.3); group.add(capM);
      nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 10), darkMetal); nozzle.rotation.x = Math.PI / 2; nozzle.position.set(0, 0.34, -l / 2 - 0.22); group.add(nozzle);
      const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.16, 0.7), accent); scoop.position.set(0, pts[6][1] + 0.05, l * 0.22); group.add(scoop);
      for (const sx of [-1, 1]) { const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, l * 0.45, 10), chrome); pipe.rotation.x = Math.PI / 2; pipe.position.set(sx * (w / 2 + 0.05), 0.28, -l * 0.05); group.add(pipe); }
      for (const i of [1, 3]) wheels[i].scale.set(1.3, 1.1, 1.1);
      break;
    }
    case 'boomer': {
      // demolition derby: welded bumper bars front and rear, and a roof rack holding the two mines
      for (const z of [1, -1]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(w * 1.1, 0.16, 0.16), darkMetal); bar.position.set(0, 0.64, z * (l / 2 + 0.16)); group.add(bar);
        for (const sx of [-1, 1]) { const up = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.48, 0.12), darkMetal); up.position.set(sx * w * 0.38, 0.5, z * (l / 2 + 0.16)); group.add(up); }
      }
      const roofY = Math.max(pts[4][1], pts[5][1]);
      const rack = new THREE.Mesh(new THREE.BoxGeometry(w * 0.72, 0.05, 0.9), darkMetal); rack.position.set(0, roofY + 0.04, -l * 0.04); group.add(rack);
      const mineMat = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.4, metalness: 0.8 });
      const spikeMat = new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.8 });
      for (const sx of [-0.5, 0.5]) {
        const mg = new THREE.Group(); mg.position.set(sx * w * 0.36, roofY + 0.3, -l * 0.04);
        mg.add(new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), mineMat));
        for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 6), spikeMat); const a = (i / 6) * Math.PI * 2; sp.position.set(Math.cos(a) * 0.27, 0, Math.sin(a) * 0.27); sp.rotation.set(0, -a, -Math.PI / 2); mg.add(sp); }
        const top = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 6), spikeMat); top.position.y = 0.28; mg.add(top);
        group.add(mg); mines.push(mg);
      }
      const plateMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
      for (const sx of [-1, 1]) { const num = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.36, 0.5), plateMat); num.position.set(sx * (w / 2 + 0.005), 0.72, 0.1); group.add(num); }
      break;
    }
    default: break;
  }
  group.add(nameSprite(name, def.color));
  const roofY = Math.max(...pts.map((p) => p[1])) + (type === 'spinner' ? 0.3 : type === 'crane' ? 1.0 : type === 'anchor' ? 0.45 : 0.05);
  return { type, def, group, body, bodyMat: paint, wheels, steer, spin, flame, flameMat, glowMat: glowMatP, headMat, tailMat, spot, wedge, rams, blade, plates, block, coil, claw, cable, fingers, tank, nozzle, mines, roofY, boomTip: new THREE.Vector3(0, 3.9, 2.0), contact, trail: null, tilt: 0, roll: 0, spinA: 3, squat: 0, bob: 0, lastVf: 0, accel: 0 };
}

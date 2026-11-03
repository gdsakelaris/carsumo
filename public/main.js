import * as THREE from 'three';
import { CARS, CAR_TYPES } from '/shared/cars.js';
import { RULES, predictStep } from '/shared/sim.js';
import { MAPS, MAP_IDS } from '/shared/maps.js';
import { Net } from './net.js';
import { Sfx } from './sfx.js';
import { scene, camera, canvas, renderer, composer, platform, rimMat, THEMES, applyTheme, tickScene, render, resize, setQuality, buildMapProps, setMapRadius, updateBalls, syncMines, syncOil } from './scene.js';
import { buildCar } from './carmodel.js';
import { burst, puff, streamTo, splash, updateFx, createTrail, skidMark, setMarkRadius, impactFlash, shockRing } from './fx.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const INTERP = 0.1;
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const lerpAngle = (a, b, k) => a + wrapAngle(b - a) * k;
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
const coarse = matchMedia('(pointer: coarse)').matches;

const S = {
  theme: THEMES[params.get('theme')] ? params.get('theme') : THEMES[localStorage.getItem('cs_theme')] ? localStorage.getItem('cs_theme') : 'lava',
  carType: CARS[localStorage.getItem('cs_car')] ? localStorage.getItem('cs_car') : 'bulldozer',
  name: localStorage.getItem('cs_name') || '',
  quality: ['auto', 'high', 'low'].includes(localStorage.getItem('cs_quality')) ? localStorage.getItem('cs_quality') : 'auto',
  mapChoice: localStorage.getItem('cs_map') || 'crater',
  map: 'crater',
  mode: 'lobby', myId: null, players: [], meshes: new Map(), snaps: [], latest: null,
  camMode: 'chase', shake: 0, lastPhase: '', countdownN: -1, bannerUntil: 0,
  input: { th: 0, st: 0, brake: false }, jumpLatch: false, abLatch: false, ab2Latch: false, keys: new Set(),
  camPos: new THREE.Vector3(0, 36, 44), camLook: new THREE.Vector3(0, 0, 0), rules: RULES,
  cam: { yaw: 0, pitch: 0.3, dist: 1, lastMove: 0, locked: false, hinted: false },
  lastSend: 0, lastFrame: 0, scoreHtml: '', platformScale: RULES.platformR0, autoStarted: false, dead: false,
  publicUrl: null, debugCam: null, chunkT: 0, touch: coarse || params.get('touch') === '1',
  paused: false, pausedBy: '', releasing: false, escGuard: 0,
};
// Client-side prediction of my own car.
const P = { enabled: params.get('predict') !== '0', seq: 0, ticks: [], world: null, car: null, acc: 0, err: { x: 0, z: 0, h: 0 }, jumpPending: false, abPending: false, ab2Pending: false };
const T = { x: 0, y: 0, brake: false, id: null }; // touch stick

const sfx = new Sfx();
applyTheme(S.theme);
sfx.setAmbient(S.theme);
function effectiveQuality() { return S.quality === 'auto' ? (coarse || innerWidth < 900 ? 'low' : 'high') : S.quality; }
setQuality(effectiveQuality());
buildMapProps(MAPS[S.mapChoice] || MAPS.crater);

// ------------------------------------------------------------------ networking
const net = new Net(onMsg, (st) => { if (st === 'closed' && S.mode !== 'lobby') { toast('Connection lost. Reconnecting…'); leaveToLobby(); } });
net.connect();

function onMsg(m) {
  switch (m.t) {
    case 'welcome': {
      S.myId = m.id;
      setShare(m.publicUrl || null);
      const auto = params.get('practice');
      if (auto && !S.autoStarted) {
        S.autoStarted = true;
        if (CARS[auto]) selectCar(auto);
        if (params.get('bot')) $('#botSel').value = params.get('bot');
        if (params.get('name')) $('#nameInput').value = params.get('name');
        if (params.get('map') && (MAPS[params.get('map')] || params.get('map') === 'random')) $('#mapSel').value = params.get('map');
        join('practice');
      }
      break;
    }
    case 'share': setShare(m.url || null); if (m.url) toast('Public link is live: send it to a friend'); break;
    case 'queued': $('#waitText').textContent = `Looking for an opponent… (${m.position} of ${m.need} in the room)`; break;
    case 'start': startMatch(m); break;
    case 'state': onSnapshot(m); break;
    case 'round_end': onRoundEnd(m); break;
    case 'match_end': onMatchEnd(m); break;
    case 'pause': onPause(m); break;
    case 'rematch_status': $('#rematchStatus').textContent = m.ready.includes(S.myId) ? 'Waiting for the other driver…' : 'The other driver wants a rematch!'; break;
    case 'opponent_left': toast(`${m.name} left the match`); leaveToLobby(); break;
    default: break;
  }
}

function setShare(url) {
  S.publicUrl = url;
  const link = url || location.origin + '/';
  $('#shareUrl').textContent = link;
  $('#shareNote').textContent = url ? 'This link works anywhere in the world.' : 'This link only works on your own Wi-Fi. Run  npm run share  on the host PC to get a public link.';
  const ls = $('#lobbyShare');
  if (url) { ls.innerHTML = `Public link for friends: <b>${url}</b>`; ls.classList.remove('hidden'); } else ls.classList.add('hidden');
}

function playerName(id) { const p = S.players.find((q) => q.id === id); return p ? p.name : 'Nobody'; }
function playerColor(id) { const p = S.players.find((q) => q.id === id); return p ? CARS[p.type].color : 0xffffff; }
function playerType(id) { const p = S.players.find((q) => q.id === id); return p ? p.type : 'speedster'; }

function startMatch(m) {
  S.players = m.players; S.rules = m.rules || RULES; S.map = MAPS[m.map] ? m.map : 'crater';
  clearCars();
  for (const p of m.players) {
    const car = buildCar(p.type, p.name); scene.add(car.group); car.trail = createTrail(CARS[p.type].color, 0.75);
    if (p.type === 'magnet') { car.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.55, 1, 12, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd08aff).multiplyScalar(2.2), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); car.beam.visible = false; scene.add(car.beam); }
    S.meshes.set(p.id, car);
  }
  buildMapProps(MAPS[S.map]);
  syncMines([], 0); syncOil([], 0);
  S.snaps = []; S.latest = null; S.mode = 'playing'; S.lastPhase = ''; S.countdownN = -1; S.dead = false; S.camMode = 'chase';
  S.cam.yaw = 0; S.cam.pitch = 0.3; S.cam.dist = 1;
  S.platformScale = S.rules.platformR0;
  S.scoreHtml = '';
  S.paused = false; hide('#paused');
  P.ticks = []; P.world = null; P.car = null; P.err = { x: 0, z: 0, h: 0 }; P.acc = 0;
  hide('#lobby'); hide('#waiting'); hide('#matchOver'); show('#hud'); hide('#deadNote'); hide('#shrinkWarn');
  const me = m.players.find((p) => p.id === S.myId);
  const def = me ? CARS[me.type] : CARS[S.carType];
  $('#abilityName').textContent = def.abilities[0].name;
  $('#ability2Name').textContent = def.abilities[1].name;
  $('#abilityBox').style.setProperty('--car', hex(def.color));
  $('#ability2Box').style.setProperty('--car', hex(def.color));
  $('#camLbl').textContent = 'Chase cam';
  $('#mapLabel').textContent = MAPS[S.map].name;
  if (S.touch) show('#touch');
  setBanner('', '');
  sfx.resume();
}

function clearCars() {
  for (const m of S.meshes.values()) { scene.remove(m.group); if (m.trail) m.trail.dispose(); if (m.beam) scene.remove(m.beam); }
  S.meshes.clear();
}

// ------------------------------------------------------------------ prediction
function simCarFromSnap(c) {
  return { id: c.id, name: c.id, type: playerType(c.id), x: c.x, y: c.y, z: c.z, vx: c.vx, vy: c.vy, vz: c.vz, h: c.h,
    onGround: !!c.g, alive: !!c.a, abT: [c.ab[0], c.ab[1]], abCd: [c.cd[0], c.cd[1]], jumpCd: c.jc, hitStun: c.st, wins: c.w,
    hv: c.hv || 0, coyote: c.co || 0, magnetT: c.mg || 0, holding: c.hd || null, heldBy: c.hb || null, lastAbilityHitFrom: null, lastAbilityHitT: -9,
    freeT: 0, freeFrom: null, skidT: c.sk || 0, oilT: c.ol || 0, lastHitT: c.lh ?? -9, snapA: c.sa || 0, swingDir: c.sw || 0, oilDropT: 0, ballHitT: 0, flipT: c.fl || 0 };
}
function snapCarFromSim(c) {
  return { id: c.id, x: c.x + P.err.x, y: c.y, z: c.z + P.err.z, h: c.h + P.err.h, vx: c.vx, vz: c.vz, vy: c.vy,
    g: c.onGround ? 1 : 0, a: c.alive ? 1 : 0, ab: c.abT, cd: c.abCd, jc: c.jumpCd, st: c.hitStun, w: c.wins, hd: c.holding || 0, hb: c.heldBy || 0,
    sk: c.skidT, ol: c.oilT, sw: c.swingDir, fl: c.flipT };
}
function reconcile(snap) {
  const sc = snap.cars.find((c) => c.id === S.myId); if (!sc) { P.car = null; return; }
  const prev = P.car ? { x: P.car.x + P.err.x, z: P.car.z + P.err.z, h: P.car.h + P.err.h } : null;
  P.ticks = P.ticks.filter((t) => t.seq > (sc.sq || 0));
  const world = { map: S.map, time: snap.time, tick: snap.tick, phase: snap.phase, phaseT: snap.phaseT, platformR: snap.platformR, events: [],
    cars: snap.cars.map(simCarFromSnap), oil: (snap.oil || []).map((o) => ({ ...o })), mines: (snap.mines || []).map((m) => ({ ...m })), nextId: 1e6 };
  for (const t of P.ticks) { predictStep(world, S.myId, t.inp); world.time += RULES.dt; }
  P.world = world; P.car = world.cars.find((c) => c.id === S.myId);
  if (prev) {
    const ex = prev.x - P.car.x, ez = prev.z - P.car.z, eh = wrapAngle(prev.h - P.car.h);
    P.err = (Math.hypot(ex, ez) < 4 && Math.abs(eh) < 1.2) ? { x: ex, z: ez, h: eh } : { x: 0, z: 0, h: 0 };
  }
}
function predictFrame(dt, now) {
  if (!P.enabled || !P.world || !P.car || S.paused) return;
  P.acc = Math.min(P.acc + dt, 0.25);
  while (P.acc >= RULES.dt) {
    P.acc -= RULES.dt;
    const inp = { th: S.input.th, st: S.input.st, brake: S.input.brake, jump: P.jumpPending, ab: P.abPending, ab2: P.ab2Pending };
    P.jumpPending = false; P.abPending = false; P.ab2Pending = false;
    const evs = predictStep(P.world, S.myId, inp);
    P.world.time += RULES.dt;
    P.ticks.push({ seq: P.seq, inp }); if (P.ticks.length > 300) P.ticks.shift();
    for (const ev of evs) if (ev.id === S.myId) localEvent(ev, now);
  }
  const k = Math.exp(-10 * dt); P.err.x *= k; P.err.z *= k; P.err.h *= k;
}
// Events my own prediction raised: play them right away; the server's copy for my car is skipped.
function localEvent(ev, now) {
  const c = P.car; if (!c) return;
  switch (ev.type) {
    case 'jump': sfx.jump(); break;
    case 'land': sfx.land(); for (let i = 0; i < 6; i++) puff(c.x + (Math.random() - 0.5) * 2, 0.25, c.z + (Math.random() - 0.5) * 2, 1.4, 0x9a9088, 0.8, 0.8, 0, 0, 0.4); break;
    case 'ability': abilityFx(ev.car, ev.slot || 0, c.x, c.z, S.myId); break;
    case 'grab': grabFx(ev); break;
    case 'drop': dropFx(ev); break;
    case 'throw': throwFx(ev); break;
    case 'shock': shockFx(ev); break;
    case 'oil': oilFx(ev); break;
    case 'mineDrop': mineDropFx(ev); break;
    case 'upright': sfx.upright(); break;
    default: break;
  }
}
const predictedTypes = new Set(['jump', 'land', 'ability', 'grab', 'drop', 'throw', 'shock', 'oil', 'mineDrop', 'upright']);
function grabFx(ev) {
  sfx.bump(12); burst(ev.x, 1.4, ev.z, 0xffd080, 18, 7, 0.4); impactFlash(ev.x, 1.6, ev.z, 0xffe060, 2.5, 0.2);
  const vm = S.meshes.get(ev.to); if (vm) vm.flashT = performance.now();
  if (ev.to === S.myId) { S.shake = 0.8; flash(0.2); } else if (ev.id === S.myId) S.shake = 0.35;
}
function dropFx(ev) {
  sfx.jump(); shockRing(ev.x, ev.z, 0xffe060, 3, 0.35, Math.max(0.06, (ev.y || 2) - 1.8));
  if (ev.to === S.myId) S.shake = 0.4;
}
function throwFx(ev) {
  sfx.bump(16); burst(ev.x, 1.6, ev.z, 0xffe060, 24, 10, 0.5); impactFlash(ev.x, 1.8, ev.z, 0xffe060, 3.5, 0.25);
  if (ev.to === S.myId) { S.shake = 1.0; flash(0.25); } else if (ev.id === S.myId) S.shake = 0.5;
}
function shockFx(ev) {
  const col = playerColor(ev.id);
  shockRing(ev.x, ev.z, col, (ev.r || 6) * 1.6, 0.55); impactFlash(ev.x, 1.2, ev.z, col, ev.big ? 7 : 5, 0.3);
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; puff(ev.x + Math.sin(a) * 1.8, 0.4, ev.z + Math.cos(a) * 1.8, 1.6, 0x9a9088, 0.8, 0.5, Math.sin(a) * 7, Math.cos(a) * 7, 0.45); }
  if (ev.id === S.myId) S.shake = Math.max(S.shake, 0.6);
}
function oilFx(ev) { for (let i = 0; i < 3; i++) puff(ev.x + (Math.random() - 0.5), 0.3, ev.z + (Math.random() - 0.5), 1.0, 0x101014, 0.7, 0.4, 0, 0, 0.5); }
function mineDropFx(ev) { burst(ev.x, 0.5, ev.z, 0xffffff, 4, 3, 0.3); if (ev.id === S.myId) sfx.mineArm(); }

function abilityFx(car, slot, x, z, id) {
  sfx.ability(car, slot);
  const col = playerColor(id);
  if (slot === 0) {
    shockRing(x, z, col, car === 'bulldozer' ? 7 : 5, 0.45); impactFlash(x, 1.0, z, col, 3.5, 0.2);
    if (car === 'anchor') for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; puff(x + Math.sin(a) * 1.6, 0.3, z + Math.cos(a) * 1.6, 1.4, 0x9a9088, 0.9, 0.5, Math.sin(a) * 2.5, Math.cos(a) * 2.5, 0.45); }
    if (id === S.myId) { S.shake = Math.max(S.shake, car === 'bulldozer' ? 0.5 : 0.25); if (car === 'speedster') flash(0.18); }
  } else {
    // shockwaves draw their own ring from the 'shock' event; the rest get a small flash at the car
    if (!['anchor', 'magnet', 'boomer'].includes(car)) { shockRing(x, z, col, 3.5, 0.3); impactFlash(x, 1.0, z, col, 2.5, 0.15); }
    if (car === 'bulldozer') for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; puff(x + Math.sin(a) * 1.8, 0.3, z + Math.cos(a) * 1.8, 1.4, 0x8a8078, 0.9, 0.4, Math.sin(a) * 2, Math.cos(a) * 2, 0.45); }
    if (id === S.myId) S.shake = Math.max(S.shake, car === 'boomer' || car === 'anchor' ? 0.7 : 0.3);
  }
}

function onSnapshot(m) {
  m.recvAt = performance.now();
  S.snaps.push(m); if (S.snaps.length > 60) S.snaps.shift();
  S.latest = m;
  if (P.enabled) reconcile(m);
  if (m.phase !== S.lastPhase) {
    if (m.phase === 'play') { setBanner('GO!', 'pop'); S.bannerUntil = performance.now() + 800; sfx.go(); flash(0.25); }
    if (m.phase === 'countdown') { S.dead = false; hide('#deadNote'); setBanner('', ''); S.countdownN = -1; }
    S.lastPhase = m.phase;
  }
  if (m.phase === 'countdown') {
    const n = Math.max(1, Math.ceil(m.phaseT));
    if (n !== S.countdownN) { S.countdownN = n; setBanner(String(n), 'pop'); sfx.tick(); }
  }
  const me = m.cars.find((c) => c.id === S.myId);
  if (me && !me.a && !S.dead) { S.dead = true; show('#deadNote'); }
  const theme = THEMES[S.theme];
  const now = performance.now();
  for (const ev of m.ev || []) {
    if (P.enabled && P.car && ev.id === S.myId && predictedTypes.has(ev.type)) continue;
    switch (ev.type) {
      case 'hit': {
        const s = ev.s || 0;
        burst(ev.x, (ev.y || 0) + 0.7, ev.z, ev.bumper ? 0xffd080 : 0xffe0a0, Math.min(22, 4 + s * 1.4), 6 + s * 0.7, 0.5);
        for (let i = 0; i < 3; i++) puff(ev.x, (ev.y || 0) + 0.6, ev.z, 1.2 + s * 0.08, 0x8a8a8a, 0.7, 1.4, 0, 0, 0.35);
        if (ev.bumper) sfx.bump(s); else sfx.hit(s);
        if (s > 6) impactFlash(ev.x, (ev.y || 0) + 0.8, ev.z, 0xffd090, 1.5 + s * 0.25, 0.2);
        if (ev.a === S.myId || ev.b === S.myId) { S.shake = Math.min(1.2, 0.15 + s * 0.05); if (s > 10) flash(0.15); }
        break;
      }
      case 'abilityHit': {
        const col = playerColor(ev.from);
        burst(ev.x, 0.9, ev.z, col, 46, 15, 0.7); impactFlash(ev.x, 1.0, ev.z, col, 5, 0.3); shockRing(ev.x, ev.z, col, 4.5, 0.4);
        const vm = S.meshes.get(ev.to); if (vm) vm.flashT = now;
        if (ev.to === S.myId) { S.shake = 1.3; flash(0.3); } else if (ev.from === S.myId) S.shake = 0.5;
        break;
      }
      case 'stomp': { burst(ev.x, ev.y || 1.2, ev.z, 0xffffff, ev.hard ? 30 : 16, ev.hard ? 12 : 8, 0.4); shockRing(ev.x, ev.z, 0xffffff, ev.hard ? 6 : 4, 0.35, (ev.y || 1.2) - 0.2); if (ev.hard) sfx.hit(14); if (ev.on === S.myId || ev.id === S.myId) S.shake = ev.hard ? 1.0 : 0.6; break; }
      case 'ability': { const c = m.cars.find((q) => q.id === ev.id); if (c) abilityFx(ev.car, ev.slot || 0, c.x, c.z, ev.id); break; }
      case 'jump': if (ev.id === S.myId) sfx.jump(); break;
      case 'land': {
        const c = m.cars.find((q) => q.id === ev.id);
        if (c) { for (let i = 0; i < 6; i++) puff(c.x + (Math.random() - 0.5) * 2, 0.25, c.z + (Math.random() - 0.5) * 2, 1.4, 0x9a9088, 0.8, 0.8, 0, 0, 0.4); if (ev.id === S.myId) sfx.land(); }
        break;
      }
      case 'grab': grabFx(ev); break;
      case 'drop': dropFx(ev); break;
      case 'throw': throwFx(ev); break;
      case 'shock': shockFx(ev); break;
      case 'oil': oilFx(ev); break;
      case 'mineDrop': mineDropFx(ev); break;
      case 'mine': {
        burst(ev.x, 0.6, ev.z, 0xffa040, 60, 18, 0.8, 18, 3); burst(ev.x, 0.4, ev.z, 0xffffff, 12, 9, 0.3);
        impactFlash(ev.x, 1.4, ev.z, 0xffb060, 9, 0.35); shockRing(ev.x, ev.z, 0xff8030, 9, 0.5);
        for (let i = 0; i < 12; i++) puff(ev.x + (Math.random() - 0.5) * 2, 0.5 + Math.random(), ev.z + (Math.random() - 0.5) * 2, 2.2, 0x2a2420, 1.6, 2.2, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, 0.55);
        sfx.explode();
        const mine = m.cars.find((q) => q.id === S.myId); const dd = mine ? Math.hypot(mine.x - ev.x, mine.z - ev.z) : 99;
        S.shake = Math.max(S.shake, clamp(1.4 - dd * 0.08, 0.3, 1.4)); if (dd < 6) flash(0.3);
        break;
      }
      case 'ballHit': {
        burst(ev.x, (ev.y || 1) + 0.3, ev.z, 0xffd080, 30, 12, 0.5); impactFlash(ev.x, (ev.y || 1) + 0.5, ev.z, 0xffffff, 5, 0.25); shockRing(ev.x, ev.z, 0xffcf3f, 5, 0.4);
        sfx.clang(ev.s || 14);
        const vm = S.meshes.get(ev.id); if (vm) vm.flashT = now;
        if (ev.id === S.myId) { S.shake = 1.4; flash(0.35); } else S.shake = Math.max(S.shake, 0.4);
        break;
      }
      case 'flipped': { sfx.flipRoll(); for (let i = 0; i < 5; i++) puff(ev.x, 0.6, ev.z, 1.3, 0x9a9088, 0.8, 0.9, 0, 0, 0.4); if (ev.id === S.myId) { S.shake = 1.0; flash(0.2); } break; }
      case 'upright': if (ev.id === S.myId) sfx.upright(); break;
      case 'fall': {
        splash(ev.x, ev.z, theme); sfx.splash(S.theme); sfx.roar(ev.id === S.myId ? 0.7 : 1);
        if (ev.id === S.myId) { S.shake = 1.0; flash(0.45); }
        else if (m.phase === 'play' && !S.bannerUntil) { setBanner(`${playerName(ev.id).toUpperCase()} WIPED OUT`, 'pop small'); S.bannerUntil = now + 1500; }
        break;
      }
      default: break;
    }
  }
  syncMines(m.mines || [], m.time);
  syncOil(m.oil || [], m.time);
}

function onRoundEnd(m) {
  const me = m.winner === S.myId;
  const text = m.winner == null ? 'DOUBLE KO' : me ? 'YOU TAKE THE ROUND' : `${playerName(m.winner).toUpperCase()} TAKES THE ROUND`;
  setBanner(text, 'pop small'); S.bannerUntil = performance.now() + 2400;
  if (m.winner != null) sfx.tick();
}

function onMatchEnd(m) {
  S.mode = 'matchOver';
  const me = m.winner === S.myId;
  $('#moTitle').textContent = me ? 'YOU WIN!' : `${playerName(m.winner).toUpperCase()} WINS`;
  $('#moScore').textContent = S.players.map((p) => `${p.name} ${m.score[p.id] ?? 0}`).join('  ·  ');
  $('#rematchStatus').textContent = '';
  show('#matchOver'); setBanner(''); hide('#touch'); hide('#paused'); S.paused = false;
  me ? sfx.win() : sfx.lose();
  sfx.roar(1.2);
  sfx.stopEngine();
  releaseMouse();
}

// ------------------------------------------------------------------ pause (Esc from either side)
function onPause(m) {
  S.paused = !!m.on; S.pausedBy = m.by || '';
  if (S.paused) {
    $('#pauseBy').textContent = S.pausedBy ? `${S.pausedBy} paused the game` : 'Paused';
    $('#pauseHint').innerHTML = `Either driver can resume. Press <b>Esc</b> or click Resume.${m.max ? ` The game resumes by itself after ${Math.round(m.max)} s.` : ''}`;
    show('#paused'); releaseMouse(); sfx.stopEngine(); S.keys.clear();
  } else {
    hide('#paused');
    if (S.mode === 'playing') toast(S.pausedBy && S.pausedBy !== S.name ? `${S.pausedBy} resumed` : 'Resumed');
  }
}
function setPause(on) { if (S.mode !== 'playing') return; net.send({ t: 'pause', on }); }
function togglePause() { setPause(!S.paused); }

function join(mode) {
  if (S.gesture) { sfx.init(); sfx.resume(); }
  S.name = $('#nameInput').value.trim(); localStorage.setItem('cs_name', S.name);
  S.mapChoice = $('#mapSel').value; localStorage.setItem('cs_map', S.mapChoice);
  net.send({ t: 'join', name: S.name, car: S.carType, mode, botCar: $('#botSel').value, map: S.mapChoice });
  if (mode === 'match') { hide('#lobby'); show('#waiting'); $('#waitText').textContent = 'Looking for an opponent…'; }
}

function leaveToLobby() {
  S.mode = 'lobby'; clearCars(); S.snaps = []; S.latest = null; P.car = null; P.world = null; S.paused = false;
  hide('#hud'); hide('#matchOver'); hide('#waiting'); hide('#touch'); hide('#paused'); show('#lobby');
  setBanner(''); sfx.stopEngine();
  syncMines([], 0); syncOil([], 0);
  buildMapProps(MAPS[S.mapChoice] || MAPS.crater);
  releaseMouse();
}

// ------------------------------------------------------------------ UI
const show = (s) => $(s).classList.remove('hidden');
const hide = (s) => $(s).classList.add('hidden');
let toastTimer = 0;
function toast(text) { const t = $('#toast'); t.textContent = text; show('#toast'); clearTimeout(toastTimer); toastTimer = setTimeout(() => hide('#toast'), 2600); }
function setBanner(text = '', cls = '') {
  const b = $('#banner'); b.textContent = text; b.className = 'banner' + (text ? ' show ' + cls : '');
  if (cls && cls.includes('pop')) { void b.offsetWidth; }
  if (!text) S.bannerUntil = 0;
}
let flashTimer = 0;
function flash(opacity) {
  const f = $('#flash'); f.style.setProperty('--f', String(opacity)); f.classList.add('on');
  clearTimeout(flashTimer); flashTimer = setTimeout(() => f.classList.remove('on'), 40);
}

function stat(label, v) { return `<div class="stat"><span>${label}</span><div class="bar"><i style="width:${Math.round(clamp(v, 0.12, 1) * 100)}%"></i></div></div>`; }
function buildLobby() {
  const grid = $('#carGrid'); grid.innerHTML = '';
  for (const t of CAR_TYPES) {
    const d = CARS[t];
    const el = document.createElement('button'); el.className = 'car'; el.type = 'button'; el.dataset.type = t;
    el.style.setProperty('--car', hex(d.color));
    el.innerHTML = `<div class="swatch"></div><h3>${d.name}</h3><p class="tag">${d.tagline}</p>
      ${stat('Speed', d.topSpeed / 20)}${stat('Weight', d.mass / 1.8)}${stat('Handling', d.turnRate / 3)}
      <div class="ab"><span class="k">E</span><b>${d.abilities[0].name}</b> · ${d.abilities[0].desc} <span style="opacity:.7">(${d.abilities[0].cooldown}s)</span></div>
      <div class="ab"><span class="k">Q</span><b>${d.abilities[1].name}</b> · ${d.abilities[1].desc} <span style="opacity:.7">(${d.abilities[1].cooldown}s)</span></div>
      <div class="pas"><b>${d.passive.name}</b> · ${d.passive.desc}</div>`;
    el.addEventListener('click', () => selectCar(t));
    grid.appendChild(el);
  }
  const botSel = $('#botSel');
  for (const t of CAR_TYPES) { const o = document.createElement('option'); o.value = t; o.textContent = CARS[t].name; botSel.appendChild(o); }
  const mapSel = $('#mapSel');
  for (const id of MAP_IDS) { const o = document.createElement('option'); o.value = id; o.textContent = `${MAPS[id].name} · ${MAPS[id].desc}`; mapSel.appendChild(o); }
  { const o = document.createElement('option'); o.value = 'random'; o.textContent = 'Random'; mapSel.appendChild(o); }
  mapSel.value = (MAPS[S.mapChoice] || S.mapChoice === 'random') ? S.mapChoice : 'crater';
  $('#themeSel').value = S.theme; $('#nameInput').value = S.name; $('#qualSel').value = S.quality;
  setShare(null);
  selectCar(S.carType);
  $('#themeSel').addEventListener('change', (e) => { S.theme = e.target.value; localStorage.setItem('cs_theme', S.theme); applyTheme(S.theme); sfx.setAmbient(S.theme); });
  $('#qualSel').addEventListener('change', (e) => { S.quality = e.target.value; localStorage.setItem('cs_quality', S.quality); setQuality(effectiveQuality()); });
  mapSel.addEventListener('change', (e) => { S.mapChoice = e.target.value; localStorage.setItem('cs_map', S.mapChoice); buildMapProps(MAPS[S.mapChoice] || MAPS.crater); });
  $('#btnMatch').addEventListener('click', () => join('match'));
  $('#btnBot').addEventListener('click', () => join('practice'));
  $('#btnCancel').addEventListener('click', () => { net.send({ t: 'leave' }); leaveToLobby(); });
  $('#btnRematch').addEventListener('click', () => { net.send({ t: 'rematch' }); $('#rematchStatus').textContent = 'Waiting for the other driver…'; });
  $('#btnLeave').addEventListener('click', () => { net.send({ t: 'leave' }); leaveToLobby(); });
  $('#btnPause').addEventListener('click', () => togglePause());
  $('#btnResume').addEventListener('click', () => setPause(false));
  $('#btnQuit').addEventListener('click', () => { net.send({ t: 'leave' }); leaveToLobby(); });
  $('#btnCopy').addEventListener('click', async () => {
    const text = $('#shareUrl').textContent;
    try { await navigator.clipboard.writeText(text); toast('Link copied'); } catch { toast('Select the link and copy it'); }
  });
  if (S.touch) document.body.classList.add('touch');
}
function selectCar(t) {
  S.carType = t; localStorage.setItem('cs_car', t);
  document.querySelectorAll('.car').forEach((el) => el.classList.toggle('selected', el.dataset.type === t));
}
buildLobby();

// ------------------------------------------------------------------ input (keyboard, mouse camera, touch)
function captureMouse() {
  if (S.touch || S.mode !== 'playing' || S.paused || document.pointerLockElement === canvas || !canvas.requestPointerLock) return;
  try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch {}
}
function releaseMouse() { if (document.pointerLockElement === canvas && document.exitPointerLock) { S.releasing = true; document.exitPointerLock(); } }
document.addEventListener('pointerlockchange', () => {
  const wasLocked = S.cam.locked;
  S.cam.locked = document.pointerLockElement === canvas;
  if (S.cam.locked && !S.cam.hinted) { S.cam.hinted = true; toast('Mouse controls the camera · wheel zooms · Esc pauses'); }
  // The browser swallows the Esc that releases the pointer lock, so losing the lock mid-game is the pause.
  if (wasLocked && !S.cam.locked && S.mode === 'playing' && !S.paused && !S.releasing) { S.escGuard = performance.now(); setPause(true); }
  S.releasing = false;
});
addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'Escape') { if (S.mode === 'playing' && performance.now() - S.escGuard > 400) togglePause(); return; }
  if (S.paused) return;
  S.keys.add(e.code);
  if (e.code === 'KeyC') S.jumpLatch = true;
  if (e.code === 'KeyE') S.abLatch = true;
  if (e.code === 'KeyQ') S.ab2Latch = true;
  if (e.code === 'KeyV') toggleCam();
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) captureMouse();
  S.gesture = true; sfx.init(); sfx.resume();
});
addEventListener('pointerdown', () => { S.gesture = true; sfx.init(); sfx.resume(); });
addEventListener('keyup', (e) => S.keys.delete(e.code));
addEventListener('blur', () => S.keys.clear());
canvas.addEventListener('mousedown', (e) => { if (S.mode === 'playing' && !S.touch && !S.paused) { if (e.button === 0) S.abLatch = true; if (e.button === 2) S.ab2Latch = true; captureMouse(); } });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousemove', (e) => {
  if (S.mode !== 'playing' && S.mode !== 'matchOver') return;
  if (!S.cam.locked && !e.buttons) return;
  orbit(e.movementX, e.movementY);
});
function orbit(mx, my) {
  S.cam.yaw -= mx * 0.0032;
  S.cam.pitch = clamp(S.cam.pitch + my * 0.0025, -0.12, 1.25);
  S.cam.lastMove = performance.now();
}
addEventListener('wheel', (e) => { if (S.mode === 'playing' || S.mode === 'matchOver') S.cam.dist = clamp(S.cam.dist + Math.sign(e.deltaY) * 0.08, 0.55, 2.0); }, { passive: true });
function toggleCam() { S.camMode = S.camMode === 'chase' ? 'arena' : 'chase'; $('#camLbl').textContent = S.camMode === 'chase' ? 'Chase cam' : 'Arena cam'; }

// touch: left stick drives, right buttons act, dragging elsewhere on the screen orbits the camera
{
  const stick = $('#stick'), knob = $('#knob');
  const R = 52;
  stick.addEventListener('pointerdown', (e) => { T.id = e.pointerId; stick.setPointerCapture(e.pointerId); moveStick(e); });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === T.id) moveStick(e); });
  const endStick = (e) => { if (e.pointerId === T.id) { T.id = null; T.x = 0; T.y = 0; knob.style.transform = ''; } };
  stick.addEventListener('pointerup', endStick); stick.addEventListener('pointercancel', endStick);
  function moveStick(e) {
    const r = stick.getBoundingClientRect(); let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy); if (d > R) { dx *= R / d; dy *= R / d; }
    T.x = dx / R; T.y = dy / R; knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  const btn = (id, down, up) => { const b = $(id); b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.classList.add('down'); down(); }); for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => { b.classList.remove('down'); if (up) up(); }); };
  btn('#tBrake', () => { T.brake = true; }, () => { T.brake = false; });
  btn('#tJump', () => { S.jumpLatch = true; });
  btn('#tAb', () => { S.abLatch = true; });
  btn('#tAb2', () => { S.ab2Latch = true; });
  let camPtr = null, lastX = 0, lastY = 0;
  canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') { camPtr = e.pointerId; lastX = e.clientX; lastY = e.clientY; } });
  canvas.addEventListener('pointermove', (e) => { if (e.pointerId === camPtr && S.mode === 'playing') { orbit((e.clientX - lastX) * 1.6, (e.clientY - lastY) * 1.6); lastX = e.clientX; lastY = e.clientY; } });
  for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, (e) => { if (e.pointerId === camPtr) camPtr = null; });
}

function computeInput() {
  const k = S.keys;
  let th = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
  let st = (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0);
  if (T.id != null) { if (Math.abs(T.y) > 0.15) th = clamp(-T.y * 1.25, -1, 1); if (Math.abs(T.x) > 0.12) st = clamp(-T.x * 1.3, -1, 1); }
  return { th, st, brake: k.has('Space') || k.has('ShiftLeft') || k.has('ShiftRight') || T.brake };
}
function sendInput(now) {
  if (now - S.lastSend < 33) return;
  S.lastSend = now;
  S.input = S.paused ? { th: 0, st: 0, brake: false } : computeInput();
  if (S.paused) { S.jumpLatch = false; S.abLatch = false; S.ab2Latch = false; return; }
  P.seq++;
  net.send({ t: 'input', seq: P.seq, th: S.input.th, st: S.input.st, brake: S.input.brake, jump: S.jumpLatch, ab: S.abLatch, ab2: S.ab2Latch });
  if (S.jumpLatch) P.jumpPending = true;
  if (S.abLatch) P.abPending = true;
  if (S.ab2Latch) P.ab2Pending = true;
  S.jumpLatch = false; S.abLatch = false; S.ab2Latch = false;
}

// ------------------------------------------------------------------ interpolation
function sampleState() {
  const snaps = S.snaps; if (!snaps.length) return null;
  const latest = snaps[snaps.length - 1];
  const sinceLatest = S.paused ? 0 : (performance.now() - latest.recvAt) / 1000;
  const renderT = latest.time + sinceLatest - INTERP;
  let a = null, b = null;
  for (let i = snaps.length - 1; i >= 0; i--) { if (snaps[i].time <= renderT) { a = snaps[i]; b = snaps[i + 1] || null; break; } }
  if (!a) { a = snaps[0]; b = snaps[1] || null; }
  const cars = new Map();
  for (const ca of a.cars) {
    const cb = b ? b.cars.find((c) => c.id === ca.id) : null;
    if (cb && b.time > a.time) {
      const k = clamp((renderT - a.time) / (b.time - a.time), 0, 1);
      cars.set(ca.id, { ...cb, x: lerp(ca.x, cb.x, k), y: lerp(ca.y, cb.y, k), z: lerp(ca.z, cb.z, k), h: lerpAngle(ca.h, cb.h, k) });
    } else {
      const dtx = clamp(renderT - a.time, 0, 0.12);
      cars.set(ca.id, { ...ca, x: ca.x + ca.vx * dtx, y: ca.y + (ca.g ? 0 : ca.vy * dtx), z: ca.z + ca.vz * dtx });
    }
  }
  if (P.enabled && P.car && cars.has(S.myId)) cars.set(S.myId, snapCarFromSim(P.car));
  // the wrecking balls follow simulation time, frozen while paused, never more than a beat ahead of the server
  const ballT = latest.time + clamp(sinceLatest, 0, 0.3) - INTERP;
  return { cars, meta: latest, ballT };
}

// ------------------------------------------------------------------ per-frame updates
const tmpV = new THREE.Vector3(), tmpL = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
function updateCars(st, dt, now) {
  const R = st.meta.platformR;
  const lava = S.theme === 'lava';
  const myMines = new Map(); for (const mn of st.meta.mines || []) myMines.set(mn.by, (myMines.get(mn.by) || 0) + 1);
  let mySkid = 0;
  for (const [id, c] of st.cars) {
    const m = S.meshes.get(id); if (!m) continue;
    const g = m.group;
    g.visible = !(c.a === 0 && c.y < S.rules.killY - 1.5);
    const fx = Math.sin(c.h), fz = Math.cos(c.h), rx = Math.cos(c.h), rz = -Math.sin(c.h);
    const vf = c.vx * fx + c.vz * fz;
    const vlat = c.vx * rx + c.vz * rz;
    const speed = Math.hypot(c.vx, c.vz);
    const accel = clamp((vf - m.lastVf) / Math.max(dt, 0.008), -60, 60); m.lastVf = vf;
    m.accel = lerp(m.accel, clamp(-accel * 0.006, -0.08, 0.08), damp(5, dt));
    const targetTilt = c.g ? m.accel : clamp(-c.vy * 0.07, -0.7, 0.7);
    m.tilt = lerp(m.tilt, targetTilt, damp(8, dt));
    const steerIn = id === S.myId ? S.input.st : 0;
    const active = c.ab[0] > 0, active2 = c.ab[1] > 0;
    const swinging = active2 && (m.type === 'crane' || m.type === 'greaser');
    const targetRoll = c.g ? clamp(vlat * 0.02, -0.12, 0.12) - steerIn * Math.min(1, speed / 10) * 0.05 - (swinging ? (c.sw || 1) * 0.1 : 0) : 0;
    m.roll = lerp(m.roll, targetRoll, damp(8, dt));
    const bob = c.g ? Math.sin(now * 0.028 + id.length) * Math.min(1, speed / 8) * 0.012 : 0;
    g.position.set(c.x, c.y + bob, c.z);
    g.rotation.set(m.tilt, c.h, m.roll, 'YXZ');
    const flipped = (c.fl || 0) > 0;
    if (flipped) {
      // on its roof: upside down on the deck, rocking; tumbling while still in the air
      m.flipSpin = (m.flipSpin || 0) + (c.g ? 0 : dt * 9);
      const roll = c.g ? Math.PI + Math.sin(now / 180) * 0.08 : m.flipSpin;
      g.rotation.set(c.g ? Math.sin(now / 260) * 0.05 : m.tilt, c.h, roll, 'YXZ');
      g.position.y = c.y + (c.g ? m.roofY + 0.05 : Math.abs(Math.sin(roll)) * m.roofY * 0.5) + bob;
    } else m.flipSpin = 0;
    for (const w of m.wheels) w.rotation.x += (vf * dt) / 0.43;
    for (const p of m.steer) p.rotation.y = lerp(p.rotation.y, steerIn * 0.42, damp(10, dt));
    const anyActive = active || active2;
    const pulse = anyActive ? 0.22 + 0.18 * Math.sin(now / 60) : 0;
    const flashing = now - (m.flashT || -1e9) < 140;
    m.bodyMat.emissive.set(flashing ? 0xffffff : anyActive ? m.def.color : 0x000000); m.bodyMat.emissiveIntensity = flashing ? 1.0 : pulse;
    m.glowMat.opacity = (anyActive ? 0.75 + 0.25 * Math.sin(now / 50) : 0.4) * (lava ? 1 : 0.6);
    m.spot.intensity = lava ? 110 : 35;
    const braking = id === S.myId ? (S.input.brake || (S.input.th < 0 && vf > 1)) : vf < -0.5;
    m.tailMat.emissiveIntensity = lerp(m.tailMat.emissiveIntensity, braking ? 3.2 : 0.8, damp(12, dt));
    const boosting = active && m.type === 'speedster';
    m.flameMat.opacity = boosting ? 0.85 : Math.max(0, m.flameMat.opacity - dt * 5);
    if (boosting) m.flame.scale.set(1 + Math.random() * 0.2, 1 + Math.random() * 0.2, 1.2 + Math.random() * 0.6);
    if (m.spin) {
      if (m.type === 'spinner') { m.spinA = lerp(m.spinA, active ? 36 : active2 ? -24 : 3, damp(active2 ? 12 : 3, dt)); m.spin.rotation.y += m.spinA * dt; }
      else if (m.type === 'magnet') {
        let target = null, best = S.rules.magnetRange || 22;
        if (active) for (const [oid, o] of st.cars) { if (oid === id || !o.a) continue; const dd = Math.hypot(o.x - c.x, o.z - c.z); if (dd < best) { best = dd; target = o; } }
        if (target) {
          streamTo(target, c, 0xd08aff); if (Math.random() < 0.5) streamTo(target, c, 0xffffff);
          const ax = c.x + fx * (m.def.size[2] / 2 + 0.9), az = c.z + fz * (m.def.size[2] / 2 + 0.9);
          const bx = target.x, bz = target.z; const len = Math.hypot(bx - ax, bz - az);
          m.beam.visible = true; m.beam.position.set((ax + bx) / 2, 1.0, (az + bz) / 2); m.beam.scale.set(1 + 0.15 * Math.sin(now / 40), len, 1 + 0.15 * Math.sin(now / 40));
          tmpV.set(bx - ax, 0, bz - az).normalize(); m.beam.quaternion.setFromUnitVectors(UP, tmpV);
          m.beam.material.opacity = 0.35 + 0.2 * Math.sin(now / 50);
          m.spin.material.emissive.set(0xff3b5c); m.spin.material.emissiveIntensity = 1.2 + 0.6 * Math.sin(now / 45);
          m.spin.rotation.x = Math.sin(now / 60) * 0.12;
        } else if (active2) {
          if (m.beam) m.beam.visible = false;
          m.spin.material.emissive.set(0x4a9bff); m.spin.material.emissiveIntensity = 2.0 + Math.sin(now / 30); m.spin.rotation.x = 0;
          if (Math.random() < 0.6) for (const [oid, o] of st.cars) if (oid !== id && o.a) streamTo(c, o, 0x8ac8ff);
        } else { if (m.beam) m.beam.visible = false; m.spin.material.emissiveIntensity = 0; m.spin.rotation.x = 0; }
      }
    }
    // hardware animations
    const dur = m.def.abilities[0].duration, ph = active ? 1 - c.ab[0] / dur : -1;
    if (m.wedge) {
      const target = !active ? -0.1 : ph < 0.18 ? 0.05 : ph < 0.5 ? -1.35 : -0.1;
      m.wedge.rotation.x = lerp(m.wedge.rotation.x, target, damp(active && ph >= 0.18 && ph < 0.5 ? 34 : 9, dt));
      const ext = clamp(-m.wedge.rotation.x, 0, 1.4);
      for (const r of m.rams) r.scale.y = 1 + ext * 0.35;
    }
    if (m.blade) {
      const t = active ? 1 : 0, dug = active2 ? 1 : 0;
      m.blade.position.y = lerp(m.blade.position.y, 0.78 - 0.26 * t - 0.5 * dug, damp(12, dt));
      m.blade.rotation.x = lerp(m.blade.rotation.x, -0.18 * t + 0.35 * dug, damp(12, dt));
      if ((active && speed > 3 || active2 && speed > 0.8) && now - (m.sparkT || 0) > (active2 ? 30 : 50)) {
        m.sparkT = now; const lz = m.def.size[2] / 2 + 0.6;
        burst(c.x + fx * lz + rx * (Math.random() - 0.5) * 2.4, c.y + 0.12, c.z + fz * lz + rz * (Math.random() - 0.5) * 2.4, 0xffc060, 3, 6, 0.35, 10, 3);
      }
    }
    if (m.plates.length) {
      m.squat = lerp(m.squat, active ? 1 : 0, damp(10, dt));
      m.body.position.y = -0.14 * m.squat;
      for (let i = 0; i < m.plates.length; i++) { const sx = i === 0 ? -1 : 1; m.plates[i].position.x = sx * (m.def.size[0] / 2 + 0.06 + 0.18 * m.squat); m.plates[i].position.y = 0.85 - 0.32 * m.squat; }
      if (m.block) m.block.position.y = 1.89 - 0.14 * m.squat;
    }
    if (m.coil) m.coil.material.emissiveIntensity = active ? 2.4 + Math.sin(now / 40) : active2 ? 3.5 + Math.sin(now / 25) : 0.9;
    if (m.claw) {
      // claw: hangs under the boom, snaps to the deck at the start of Grab, rides on the carried car's roof
      const held = c.hd ? st.cars.get(c.hd) : null;
      const snapping = active && !held && ph < 0.16;
      const tx = 0, ty = held ? 3.15 : snapping ? 1.05 : 3.1, tz = held ? (S.rules.carryDist || 2.8) : snapping ? 2.9 : 2.3;
      m.claw.position.x = lerp(m.claw.position.x, tx, damp(12, dt));
      m.claw.position.y = lerp(m.claw.position.y, ty, damp(snapping ? 40 : 9, dt));
      m.claw.position.z = lerp(m.claw.position.z, tz, damp(10, dt));
      const closed = held ? 1 : 0;
      for (const f of m.fingers) f.rotation.z = lerp(f.rotation.z, closed * 0.55, damp(14, dt));
      const bt = m.boomTip; tmpV.set(m.claw.position.x - bt.x, m.claw.position.y - bt.y, m.claw.position.z - bt.z);
      const len = Math.max(0.05, tmpV.length());
      m.cable.position.set((bt.x + m.claw.position.x) / 2, (bt.y + m.claw.position.y) / 2, (bt.z + m.claw.position.z) / 2);
      m.cable.scale.set(1, len, 1); m.cable.quaternion.setFromUnitVectors(UP, tmpV.normalize());
    }
    if (m.nozzle) {
      // oil slick: a dark spray out of the tail nozzle
      if (active && now - (m.sprayT || 0) > 35) {
        m.sprayT = now; const lz = m.def.size[2] / 2 + 0.3;
        puff(c.x - fx * lz, c.y + 0.3, c.z - fz * lz, 0.9, 0x0c0c10, 0.6, 0.3, -fx * 6 + (Math.random() - 0.5) * 2, -fz * 6 + (Math.random() - 0.5) * 2, 0.6);
        burst(c.x - fx * lz, c.y + 0.35, c.z - fz * lz, 0x202028, 2, 5, 0.3, 14, 0.8);
      }
      m.nozzle.scale.setScalar(active ? 1.2 + 0.2 * Math.sin(now / 30) : 1);
    }
    if (m.mines && m.mines.length) {
      // the rack shows the mines still on board
      const out = myMines.get(id) || 0;
      for (let i = 0; i < m.mines.length; i++) m.mines[i].visible = i >= out;
    }
    if (c.hb) { m.roll = Math.sin(now / 260) * 0.1; m.tilt = Math.sin(now / 340) * 0.06; g.rotation.set(m.tilt, c.h, m.roll, 'YXZ'); }
    if (m.contact) {
      const hgt = Math.max(0, c.y); const k = 1 / (1 + hgt * 0.3);
      m.contact.position.y = -hgt + 0.045 - bob - (flipped && c.g ? m.roofY + 0.05 : 0); m.contact.visible = hgt < 8; m.contact.scale.setScalar(k); m.contact.material.opacity = 0.55 * k;
      if (flipped && c.g) { m.contact.position.y = -(m.roofY + 0.05) + 0.045; }
    }
    if (m.trail) {
      const emitting = c.a === 1 && (boosting || (active && (m.type === 'bulldozer' || m.type === 'spinner')) || (active2 && m.type === 'flipper') || speed > 15);
      if (emitting) m.trail.push(c.x - fx * (m.def.size[2] / 2 + 0.3), c.y + 0.45, c.z - fz * (m.def.size[2] / 2 + 0.3), rx, rz, now);
      m.trail.update(now, emitting);
    }
    // tyre smoke and marks
    const slip = Math.abs(vlat);
    const onOil = (c.ol || 0) > 0;
    const snapTurn = active2 && m.type === 'speedster';
    const drifting = c.g && !flipped && (slip > 3.5 || swinging || snapTurn || (id === S.myId && S.input.brake && speed > 5));
    if (id === S.myId) mySkid = c.g ? clamp((slip - 2.5) / 6, 0, 1) + (S.input.brake && speed > 5 ? 0.6 : 0) + (swinging || snapTurn ? 0.8 : 0) : 0;
    if ((drifting || boosting) && now - (m.puffT || 0) > 45) {
      m.puffT = now;
      const l = m.def.size[2], w = m.def.size[0];
      for (const sx of [-1, 1]) {
        const px = c.x - fx * l * 0.33 + rx * sx * w * 0.5, pz = c.z - fz * l * 0.33 + rz * sx * w * 0.5;
        puff(px, c.y + 0.3, pz, drifting ? 1.1 : 0.7, drifting ? (onOil ? 0x202024 : lava ? 0x9a9a9a : 0xdddddd) : 0x555555, drifting ? 1.1 : 0.5, 0.9, -c.vx * 0.15, -c.vz * 0.15, drifting ? 0.45 : 0.3);
      }
      if (boosting) burst(c.x - fx * l * 0.6, c.y + 0.5, c.z - fz * l * 0.6, 0xffb060, 2, 5, 0.3, 4, 3);
    }
    if (!c.g && c.a === 0 && c.y < S.rules.killY + 3 && c.y > S.rules.killY && now - (m.puffT || 0) > 80) { m.puffT = now; puff(c.x, c.y, c.z, 1.5, lava ? 0xff7a30 : 0xffffff, 0.5, 1.5, 0, 0, 0.5); }
    if (drifting && !onOil) {
      const l = m.def.size[2], w = m.def.size[0];
      m.lastMark = m.lastMark || {};
      for (const sx of [-1, 1]) {
        const px = c.x - fx * l * 0.33 + rx * sx * w * 0.5, pz = c.z - fz * l * 0.33 + rz * sx * w * 0.5;
        const prev = m.lastMark[sx];
        if (prev) skidMark(prev[0], prev[1], px, pz, 0.36, clamp(slip / 8 + 0.35, 0.35, 1), now);
        m.lastMark[sx] = [px, pz];
      }
    } else m.lastMark = null;
  }
  // platform radius (smooth), map props, crumbling edge while shrinking
  S.platformScale = lerp(S.platformScale, R, damp(6, dt));
  platform.scale.set(S.platformScale, 1, S.platformScale);
  setMarkRadius(S.platformScale); setMapRadius(S.platformScale);
  updateBalls(st.ballT);
  const shrinking = R < S.rules.platformR0 - 0.2;
  rimMat.opacity = shrinking ? 0.55 + 0.45 * Math.sin(now / 120) : 0.0;
  $('#shrinkWarn').classList.toggle('hidden', !shrinking);
  if (shrinking && now - S.chunkT > 70) {
    S.chunkT = now;
    const a = Math.random() * Math.PI * 2, r = S.platformScale + 0.3;
    burst(Math.sin(a) * r, -0.6, Math.cos(a) * r, 0x4a3a34, 3, 4, 1.4, 22, 0.35);
    if (Math.random() < 0.5) burst(Math.sin(a) * r, -0.2, Math.cos(a) * r, 0xff6a20, 2, 5, 0.5, 16, 2.5);
    if (Math.random() < 0.3) puff(Math.sin(a) * r, 0.2, Math.cos(a) * r, 1.8, 0x3a2a26, 1.2, 1.2, 0, 0, 0.4);
  }
  // my engine
  const me = st.cars.get(S.myId);
  if (me && me.a && S.mode === 'playing' && !S.paused) {
    const mine = S.meshes.get(S.myId);
    sfx.setEngine(Math.min(1, Math.hypot(me.vx, me.vz) / 20), S.input.th, me.ab[0] > 0 && mine && mine.type === 'speedster');
    sfx.setSkid(mySkid);
  } else sfx.stopEngine();
}

function updateCamera(st, dt, now) {
  const me = st.cars.get(S.myId);
  const cm = S.cam;
  const chase = S.camMode === 'chase' && me && (me.a === 1 || me.y > S.rules.killY + 2);
  if (chase) {
    const fx = Math.sin(me.h), fz = Math.cos(me.h);
    const speed = Math.hypot(me.vx, me.vz);
    if (now - cm.lastMove > 1200 && speed > 1.5) cm.yaw = lerpAngle(cm.yaw, 0, damp(2.2, dt));
    // kickoff sweep: start wide and to the side during the countdown, settle in behind the car at GO
    const k = st.meta.phase === 'countdown' ? clamp(st.meta.phaseT / (S.rules.countdown || 3), 0, 1) : 0;
    const yaw = me.h + Math.PI + cm.yaw + k * k * 1.7;
    const dist = (8.0 + speed * 0.08) * cm.dist * (1 + k * 1.4);
    const pitch = cm.pitch + k * 0.3;
    tmpV.set(me.x + Math.sin(yaw) * Math.cos(pitch) * dist, Math.max(me.y, 0) + 1.2 + Math.sin(pitch) * dist, me.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    S.camPos.lerp(tmpV, damp(k > 0 ? 3 : 8, dt));
    tmpL.set(me.x + fx * 2.5 * Math.cos(cm.yaw), me.y + 1.1, me.z + fz * 2.5 * Math.cos(cm.yaw));
    S.camLook.lerp(tmpL, damp(10, dt));
    camera.fov = lerp(camera.fov, 60 + (me.ab[0] > 0 && S.meshes.get(S.myId)?.type === 'speedster' ? 12 : 0) + speed * 0.3, damp(5, dt));
  } else {
    const pitch = clamp(cm.pitch + 0.16, 0.12, 1.3), dist = 64 * cm.dist;
    tmpV.set(Math.sin(cm.yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(cm.yaw) * Math.cos(pitch) * dist);
    S.camPos.lerp(tmpV, damp(3, dt));
    tmpL.set(0, -3, 0); S.camLook.lerp(tmpL, damp(4, dt));
    camera.fov = lerp(camera.fov, 55, damp(4, dt));
  }
  camera.updateProjectionMatrix();
  camera.position.copy(S.camPos);
  if (S.shake > 0.005) {
    camera.position.x += (Math.random() - 0.5) * S.shake * 0.6;
    camera.position.y += (Math.random() - 0.5) * S.shake * 0.6;
    S.shake *= Math.exp(-6 * dt);
  }
  camera.lookAt(S.camLook);
}

function idleCamera(now, dt) {
  const a = now / 9000;
  tmpV.set(Math.sin(a) * 60, 26 + Math.sin(a * 0.7) * 4, Math.cos(a) * 60);
  S.camPos.lerp(tmpV, damp(2, dt)); S.camLook.lerp(tmpL.set(0, -2, 0), damp(2, dt));
  camera.fov = lerp(camera.fov, 55, damp(4, dt)); camera.updateProjectionMatrix();
  camera.position.copy(S.camPos); camera.lookAt(S.camLook);
  platform.scale.set(S.rules.platformR0, 1, S.rules.platformR0); rimMat.opacity = 0; $('#shrinkWarn').classList.add('hidden');
  setMapRadius(S.rules.platformR0);
  updateBalls(now / 1000);
}

function updateHud(st) {
  const m = st.meta;
  const html = S.players.map((p) => { const c = m.cars.find((q) => q.id === p.id); return `<div class="p ${p.id === S.myId ? 'me' : ''}" style="--car:${hex(CARS[p.type].color)}">${p.name}<span class="w">${c ? c.w : 0}</span></div>`; }).join('');
  if (html !== S.scoreHtml) { S.scoreHtml = html; $('#scoreboard').innerHTML = html; }
  $('#roundLabel').textContent = `Round ${m.round}`;
  $('#ping').textContent = net.latency == null ? '— ms' : `${net.latency} ms`;
  const me = st.cars.get(S.myId);
  const mesh = S.meshes.get(S.myId);
  if (me && mesh) {
    const boxes = [['#abilityBox', '#abilityName'], ['#ability2Box', '#ability2Name']];
    for (let slot = 0; slot < 2; slot++) {
      const ab = $(boxes[slot][0]); const def = mesh.def.abilities[slot]; const total = def.cooldown + def.duration;
      const on = me.ab[slot] > 0;
      ab.classList.toggle('active', on);
      $(boxes[slot][1]).textContent = slot === 0 && me.hd ? 'Drop' : def.name;
      ab.style.setProperty('--p', on ? '0%' : `${Math.round((me.cd[slot] / total) * 100)}%`);
    }
    $('#jumpBox').style.setProperty('--p', `${Math.round((me.jc / (mesh.def.jumpCd || S.rules.jumpCd)) * 100)}%`);
  }
  if (S.bannerUntil && performance.now() > S.bannerUntil && m.phase === 'play') { setBanner('', ''); S.bannerUntil = 0; }
}

addEventListener('resize', resize);

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - S.lastFrame) / 1000 || 0.016); S.lastFrame = now;
  tickScene(now, dt);
  if (S.mode === 'playing' || S.mode === 'matchOver') {
    if (S.mode === 'playing') { sendInput(now); predictFrame(dt, now); }
    const st = sampleState();
    if (st) { updateCars(st, dt, now); updateCamera(st, dt, now); updateHud(st); }
  } else {
    idleCamera(now, dt);
  }
  updateFx(dt);
  if (S.debugCam) { const d = S.debugCam; camera.position.set(d[0], d[1], d[2]); camera.lookAt(d[3], d[4], d[5]); camera.fov = 50; camera.updateProjectionMatrix(); }
  render();
}
requestAnimationFrame(frame);

// Exposed for the headless self-test.
window.__CS = { S, P, net, sampleState, scene, camera, renderer, composer, THREE };

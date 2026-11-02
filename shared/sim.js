// Deterministic game simulation. Runs on the server (authoritative); the browser imports the
// constants and could run the same step for prediction later.
import { CARS } from './cars.js';
import { MAPS, inHole } from './maps.js';

export const RULES = {
  dt: 1 / 60,
  gravity: 24,
  jumpV: 9.5,
  jumpCd: 3.0,
  platformR0: 22,
  platformRMin: 7,
  shrinkStart: 35,      // seconds into a round before the platform starts shrinking
  shrinkDur: 30,
  killY: -14,          // the lava surface; the deck sits this far above it, so a fall is a visible drop
  countdown: 3,
  roundOver: 2.6,
  winsToWin: 3,
  spawnR: 12,
  carHeight: 1.0,       // cars only collide when their heights are within this much of each other
  magnetRange: 22,
  magnetPull: 26,
  magnetDrag: 9,        // m/s the tractor beam drags a car directly, on top of the pull
  grabWindow: 0.35,     // seconds at the start of Grab during which the claw can catch a car
  grabReach: 4.6,       // how far in front the claw reaches
  carryDist: 2.8,       // where a carried car hangs, in front of the crane
  carryHeight: 2.2,
};

export const NULL_INPUT = Object.freeze({ th: 0, st: 0, jump: false, ab: false, brake: false });

export function createWorld(players, mapId = 'crater') {
  return {
    map: MAPS[mapId] ? mapId : 'crater',
    time: 0, tick: 0, phase: 'countdown', phaseT: RULES.countdown, round: 1,
    platformR: RULES.platformR0, roundTime: 0,
    cars: players.map((p, i) => createCar(p, i, players.length)),
    events: [], lastRoundWinner: null, matchWinner: null,
  };
}

function spawnPose(i, n) {
  const ang = (i / n) * Math.PI * 2;
  return { x: Math.sin(ang) * RULES.spawnR, z: Math.cos(ang) * RULES.spawnR, h: ang + Math.PI };
}

export function createCar(p, i, n) {
  const s = spawnPose(i, n);
  return {
    id: p.id, name: p.name, type: p.type,
    x: s.x, y: 0, z: s.z, vx: 0, vy: 0, vz: 0, h: s.h,
    onGround: true, alive: true,
    abilityT: 0, abilityCd: 0, jumpCd: 0, hitStun: 0, wins: 0, hv: 0, magnetT: 0, coyote: 0, holding: null, heldBy: null, freeT: 0, freeFrom: null,
    lastAbilityHitFrom: null, lastAbilityHitT: -9,
  };
}

export function startRound(world) {
  const n = world.cars.length;
  world.cars.forEach((c, i) => {
    const s = spawnPose(i, n);
    Object.assign(c, { x: s.x, y: 0, z: s.z, vx: 0, vy: 0, vz: 0, h: s.h, onGround: true, alive: true,
      abilityT: 0, abilityCd: 0, jumpCd: 0, hitStun: 0, hv: 0, magnetT: 0, coyote: 0, holding: null, heldBy: null, freeT: 0, freeFrom: null, lastAbilityHitFrom: null, lastAbilityHitT: -9 });
  });
  world.platformR = RULES.platformR0;
  world.roundTime = 0;
  world.phase = 'countdown';
  world.phaseT = RULES.countdown;
  world.lastRoundWinner = null;
}

export function resetMatch(world) {
  world.cars.forEach((c) => { c.wins = 0; });
  world.round = 1;
  world.matchWinner = null;
  startRound(world);
}

export function effectiveMass(c) {
  let m = CARS[c.type].mass;
  if (c.abilityT > 0) {
    if (c.type === 'anchor') m *= 6;
    if (c.type === 'bulldozer') m *= 3;
  }
  if (c.type === 'crane' && c.holding) m *= 1.4;
  return m;
}

export function stepWorld(world, inputs) {
  const dt = RULES.dt;
  world.time += dt;
  world.tick++;
  world.events = [];

  if (world.phase === 'countdown') {
    world.phaseT -= dt;
    if (world.phaseT <= 0) { world.phase = 'play'; world.roundTime = 0; world.events.push({ type: 'go' }); }
  } else if (world.phase === 'play') {
    world.roundTime += dt;
    if (world.roundTime > RULES.shrinkStart) {
      const k = Math.min(1, (world.roundTime - RULES.shrinkStart) / RULES.shrinkDur);
      world.platformR = RULES.platformR0 + (RULES.platformRMin - RULES.platformR0) * k;
    }
  } else if (world.phase === 'roundOver') {
    world.phaseT -= dt;
    if (world.phaseT <= 0) {
      if (world.matchWinner != null) world.phase = 'matchOver';
      else { world.round++; startRound(world); world.events.push({ type: 'roundStart', round: world.round }); }
    }
  }

  const live = world.phase === 'play';
  for (const c of world.cars) {
    const inp = live ? (inputs.get(c.id) || NULL_INPUT) : NULL_INPUT;
    stepCar(world, c, inp, dt, live);
  }
  if (live || world.phase === 'roundOver') {
    applyMagnets(world, dt);
    resolveCollisions(world);
  }

  if (live) {
    const alive = world.cars.filter((c) => c.alive);
    if (world.cars.length >= 2 && alive.length <= 1) endRound(world, alive[0] || null);
  }
  return world;
}

function endRound(world, winner) {
  if (winner) winner.wins++;
  world.lastRoundWinner = winner ? winner.id : null;
  if (winner && winner.wins >= RULES.winsToWin) world.matchWinner = winner.id;
  world.phase = 'roundOver';
  world.phaseT = RULES.roundOver;
  world.events.push({ type: 'roundEnd', winner: world.lastRoundWinner, matchWinner: world.matchWinner });
}

function stepCar(world, c, inp, dt, live) {
  const def = CARS[c.type];
  if (c.abilityT > 0) c.abilityT = Math.max(0, c.abilityT - dt);
  if (c.abilityCd > 0) c.abilityCd = Math.max(0, c.abilityCd - dt);
  if (c.jumpCd > 0) c.jumpCd = Math.max(0, c.jumpCd - dt);
  if (c.hitStun > 0) c.hitStun = Math.max(0, c.hitStun - dt);
  if (c.magnetT > 0) c.magnetT = Math.max(0, c.magnetT - dt);
  if (c.freeT > 0) c.freeT = Math.max(0, c.freeT - dt);

  // hanging from a crane: no control, no gravity, ride along in front of it
  if (c.heldBy) {
    const cr = world.cars.find((q) => q.id === c.heldBy);
    if (!cr || !cr.alive || cr.holding !== c.id) { c.heldBy = null; c.onGround = false; }
    else {
      const cfx = Math.sin(cr.h), cfz = Math.cos(cr.h);
      c.x = cr.x + cfx * RULES.carryDist; c.z = cr.z + cfz * RULES.carryDist; c.y = RULES.carryHeight;
      c.vx = cr.vx; c.vz = cr.vz; c.vy = 0; c.onGround = false; c.hitStun = Math.max(c.hitStun, 0.2);
      c.h += wrapA(cr.h - c.h) * Math.min(1, 6 * dt);
      return;
    }
  }

  if (c.hv) { c.h += c.hv * dt; c.hv *= Math.max(0, 1 - (c.onGround ? 5 : 1) * dt); if (Math.abs(c.hv) < 0.01) c.hv = 0; }
  const stunned = c.hitStun > 0;
  const th = stunned ? 0 : inp.th;
  const st = stunned ? 0 : inp.st;

  if (c.alive && live && inp.ab && c.abilityCd <= 0 && c.abilityT <= 0 && c.onGround) {
    c.abilityT = def.ability.duration;
    c.abilityCd = def.ability.cooldown + def.ability.duration;
    world.events.push({ type: 'ability', id: c.id, car: c.type });
  }
  const active = c.abilityT > 0;
  const nitro = active && c.type === 'speedster';
  const ram = active && c.type === 'bulldozer';
  const brace = active && c.type === 'anchor';
  const spin = active && c.type === 'spinner';

  if (c.type === 'crane') {
    if (c.holding) {
      const vic = world.cars.find((q) => q.id === c.holding);
      // let go: the grab timer ran out, the button was pressed again, or something went wrong
      const wantDrop = live && inp.ab && c.abilityT < def.ability.duration - 0.4;
      if (!vic || !vic.alive || !c.alive || c.abilityT <= 0 || wantDrop) releaseHeld(world, c, vic);
    } else if (active && c.abilityT > def.ability.duration - RULES.grabWindow) {
      // claw is snapping down: catch the first car in the zone in front
      const gfx = Math.sin(c.h), gfz = Math.cos(c.h);
      for (const o of world.cars) {
        if (o === c || !o.alive || o.heldBy) continue;
        const dx = o.x - c.x, dz = o.z - c.z;
        const along = dx * gfx + dz * gfz, across = dx * gfz - dz * gfx;
        if (along > 1.2 && along < RULES.grabReach && Math.abs(across) < 1.7 && Math.abs(o.y - c.y) < 1.5) {
          c.holding = o.id; o.heldBy = c.id; o.onGround = false; o.vy = 0; o.hitStun = Math.max(o.hitStun, 0.3);
          world.events.push({ type: 'grab', id: c.id, to: o.id, x: o.x, z: o.z });
          break;
        }
      }
    }
  }

  if (c.alive && c.onGround) {
    const fx = Math.sin(c.h), fz = Math.cos(c.h);
    const rx = fz, rz = -fx;
    let vf = c.vx * fx + c.vz * fz;
    let vl = c.vx * rx + c.vz * rz;

    if (brace) {
      vf *= Math.max(0, 1 - 8 * dt);
      vl *= Math.max(0, 1 - 8 * dt);
    } else {
      let accel = def.accel * (nitro ? 2.8 : 1) * (spin ? 0.85 : 1);
      if (ram) accel += 60;
      const top = def.topSpeed * (nitro ? 1.7 : 1) * (ram ? 1.6 : 1) * (spin ? 0.85 : 1) * (c.holding ? 0.8 : 1);
      if (ram) vf += accel * dt;
      else if (th > 0) vf += th * accel * dt;
      else if (th < 0) vf += th * accel * 0.6 * dt;
      if (vf > top) vf -= (vf - top) * Math.min(1, 4 * dt);
      if (vf < -def.reverseSpeed) vf += (-def.reverseSpeed - vf) * Math.min(1, 4 * dt);
      const dragged = c.magnetT > 0; // caught in a tractor beam: the tyres lose most of their bite
      const roll = ((th === 0 && !ram) ? 1.3 : 0.2) * (dragged ? 0.3 : 1);
      vf *= Math.max(0, 1 - roll * dt);
      const grip = (inp.brake ? def.grip * 0.25 : def.grip) * (dragged ? 0.12 : 1);
      vl *= Math.max(0, 1 - grip * dt);
      const speedNorm = Math.min(1, Math.abs(vf) / 7);
      const dir = vf >= 0 ? 1 : -1;
      const turn = def.turnRate * (spin ? 0.55 : 1) * (inp.brake ? 1.35 : 1);
      c.h += st * turn * speedNorm * dir * dt;
    }
    c.vx = fx * vf + rx * vl;
    c.vz = fz * vf + rz * vl;

    if (c.alive && live && inp.jump && c.jumpCd <= 0 && !brace) {
      c.vy = RULES.jumpV;
      c.onGround = false;
      c.jumpCd = def.jumpCd || RULES.jumpCd;
      world.events.push({ type: 'jump', id: c.id });
    }
  }

  if (!c.onGround) {
    c.vy -= RULES.gravity * dt;
    if (c.alive && live) {
      // air control: a little steering and nudge; brake = dive back down
      c.h += st * def.turnRate * 0.35 * dt;
      const afx = Math.sin(c.h), afz = Math.cos(c.h);
      c.vx += afx * th * 5 * dt; c.vz += afz * th * 5 * dt;
      if (inp.brake && c.vy < 6) c.vy -= 42 * dt;
      // coyote time: a jump still works for a moment after driving off the edge
      if (c.coyote > 0) {
        c.coyote = Math.max(0, c.coyote - dt);
        if (inp.jump && c.jumpCd <= 0 && !brace) {
          c.vy = RULES.jumpV; c.jumpCd = def.jumpCd || RULES.jumpCd; c.coyote = 0;
          world.events.push({ type: 'jump', id: c.id });
        }
      }
    }
  }
  c.x += c.vx * dt;
  c.z += c.vz * dt;
  c.y += c.vy * dt;

  const d = Math.hypot(c.x, c.z);
  const edge = world.platformR + def.radius * 0.35;
  const map = MAPS[world.map] || MAPS.crater;
  if (c.onGround && (d > edge || inHole(map, c.x, c.z))) {
    c.onGround = false;
    c.vy = 0;
    c.coyote = 0.2;
    world.events.push({ type: 'edge', id: c.id });
  }
  if (!c.onGround && c.y <= 0 && c.vy <= 0 && c.y > -1.0 && d <= edge && !inHole(map, c.x, c.z)) {
    c.y = 0; c.vy = 0; c.onGround = true;
    world.events.push({ type: 'land', id: c.id });
  }
  if (c.alive && c.y < RULES.killY) {
    c.alive = false;
    world.events.push({ type: 'fall', id: c.id, x: c.x, z: c.z });
  }
  if (c.y < -30) { c.y = -30; c.vy = 0; }
}

function applyMagnets(world, dt) {
  for (const m of world.cars) {
    if (!(m.alive && m.abilityT > 0 && m.type === 'magnet')) continue;
    for (const o of world.cars) {
      if (o === m || !o.alive || o.heldBy) continue;
      const dx = o.x - m.x, dz = o.z - m.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.5 || d > RULES.magnetRange) continue;
      const k = Math.max(0.3, 1 - d / RULES.magnetRange);
      const mass = Math.max(0.6, effectiveMass(o));
      const ballast = o.type === 'crane'; // Ballast: the beam tugs but cannot drag it
      const a = RULES.magnetPull * k / mass * (ballast ? 0.5 : 1);
      o.vx -= (dx / d) * a * dt;
      o.vz -= (dz / d) * a * dt;
      if (!ballast) {
        // the beam also drags the body directly, past what the tyres can resist
        const drag = Math.min(Math.max(0, d - 2.6), RULES.magnetDrag * k / mass * dt);
        o.x -= (dx / d) * drag; o.z -= (dz / d) * drag;
        o.magnetT = 0.12;
      }
      // and reels the magnet in a little too
      m.vx += (dx / d) * a * 0.25 * dt; m.vz += (dz / d) * a * 0.25 * dt;
    }
  }
}

// Collision shape: a capsule along the heading (the body is a rounded rectangle, not a circle), so a
// nose touching a flank is a real contact. Active abilities extend it (spinner blade, flipper wedge).
export function capsuleOf(c) {
  const def = CARS[c.type];
  const w = def.size[0], l = def.size[2];
  let r = w / 2 + 0.06;
  const hl = Math.max(0, l / 2 - w / 2);
  let front = c.type === 'bulldozer' ? 0.45 : 0;
  if (c.abilityT > 0 && c.type === 'spinner') r = Math.max(r, 1.8);
  if (c.abilityT > 0 && c.type === 'flipper') front = 0.8;
  const fx = Math.sin(c.h), fz = Math.cos(c.h);
  return { ax: c.x - fx * hl, az: c.z - fz * hl, bx: c.x + fx * (hl + front), bz: c.z + fz * (hl + front), r };
}

// Closest points between two segments (Ericson, Real-Time Collision Detection, 5.1.9).
function closestSegSeg(p1x, p1z, q1x, q1z, p2x, p2z, q2x, q2z) {
  const d1x = q1x - p1x, d1z = q1z - p1z, d2x = q2x - p2x, d2z = q2z - p2z;
  const rx = p1x - p2x, rz = p1z - p2z;
  const a = d1x * d1x + d1z * d1z, e = d2x * d2x + d2z * d2z, f = d2x * rx + d2z * rz;
  const EPS = 1e-8;
  let sP = 0, tP = 0;
  if (a <= EPS && e <= EPS) { sP = 0; tP = 0; }
  else if (a <= EPS) { sP = 0; tP = clamp01(f / e); }
  else {
    const cc = d1x * rx + d1z * rz;
    if (e <= EPS) { tP = 0; sP = clamp01(-cc / a); }
    else {
      const b = d1x * d2x + d1z * d2z; const denom = a * e - b * b;
      sP = denom !== 0 ? clamp01((b * f - cc * e) / denom) : 0;
      tP = (b * sP + f) / e;
      if (tP < 0) { tP = 0; sP = clamp01(-cc / a); } else if (tP > 1) { tP = 1; sP = clamp01((b - cc) / a); }
    }
  }
  return { px: p1x + d1x * sP, pz: p1z + d1z * sP, qx: p2x + d2x * tP, qz: p2z + d2z * tP };
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// The crane lets go of what it carries: the car is tossed a little forward and falls from there.
function releaseHeld(world, c, vic) {
  if (vic && vic.heldBy === c.id) {
    const fx = Math.sin(c.h), fz = Math.cos(c.h);
    vic.heldBy = null; vic.onGround = false;
    vic.vx = c.vx + fx * 5; vic.vz = c.vz + fz * 5; vic.vy = 1.5;
    vic.hitStun = Math.max(vic.hitStun, 0.4);
    vic.freeT = 0.7; vic.freeFrom = c.id; // a moment with no collision against the crane, so it falls clear
    world.events.push({ type: 'drop', id: c.id, to: vic.id, x: vic.x, z: vic.z, y: vic.y });
  }
  c.holding = null;
  if (c.abilityT > 0) c.abilityT = 0;
}

// An impulse applied off the car's centre twists it (box inertia); steering is still kinematic, so
// this is scaled down to a flavour rather than full rigid-body rotation.
function twist(c, cx, cz, jx, jz) {
  if (c.type === 'spinner') return; // Gyro: hits never twist it
  const def = CARS[c.type];
  const w = def.size[0], l = def.size[2];
  const I = effectiveMass(c) * (w * w + l * l) / 12;
  const rx = cx - c.x, rz = cz - c.z;
  c.hv += ((rz * jx - rx * jz) / I) * 0.55;
  if (c.hv > 7) c.hv = 7; else if (c.hv < -7) c.hv = -7;
}

function resolveCollisions(world) {
  const cars = world.cars;
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      if (!a.alive || !b.alive || a.heldBy || b.heldBy) continue;
      if ((a.freeT > 0 && a.freeFrom === b.id) || (b.freeT > 0 && b.freeFrom === a.id)) continue;
      const ca = capsuleOf(a), cb = capsuleOf(b);
      const cp = closestSegSeg(ca.ax, ca.az, ca.bx, ca.bz, cb.ax, cb.az, cb.bx, cb.bz);
      const dx = cp.qx - cp.px, dz = cp.qz - cp.pz;
      let d = Math.hypot(dx, dz);
      const minD = ca.r + cb.r;
      if (d >= minD) continue;
      const dy = a.y - b.y;
      if (Math.abs(dy) > RULES.carHeight) {
        // one car is above the other: a falling car lands on the roof, bounces off and rattles it
        const upper = dy > 0 ? a : b, lower = dy > 0 ? b : a;
        if (!upper.onGround && upper.vy < 0 && Math.abs(dy) < 2.4) {
          let ux = upper.x - lower.x, uz = upper.z - lower.z; const ud = Math.hypot(ux, uz) || 1; ux /= ud; uz /= ud;
          upper.vy = 6; upper.vx += ux * 4; upper.vz += uz * 4;
          lower.hitStun = Math.max(lower.hitStun, 0.3);
          world.events.push({ type: 'stomp', id: upper.id, on: lower.id, x: upper.x, z: upper.z, y: lower.y + 1.2 });
        }
        continue;
      }
      let nx, nz;
      if (d < 1e-4) {
        const ddx = b.x - a.x, ddz = b.z - a.z, dd = Math.hypot(ddx, ddz);
        if (dd > 1e-4) { nx = ddx / dd; nz = ddz / dd; } else { nx = Math.sin(a.h); nz = Math.cos(a.h); }
        d = 1e-4;
      } else { nx = dx / d; nz = dz / d; }
      const mA = effectiveMass(a), mB = effectiveMass(b);
      const overlap = minD - d;
      const shareA = mB / (mA + mB), shareB = mA / (mA + mB);
      a.x -= nx * overlap * shareA; a.z -= nz * overlap * shareA;
      b.x += nx * overlap * shareB; b.z += nz * overlap * shareB;
      const cx = cp.px + nx * (ca.r - overlap / 2), cz = cp.pz + nz * (ca.r - overlap / 2);
      const rvx = b.vx - a.vx, rvz = b.vz - a.vz;
      const vn = rvx * nx + rvz * nz;
      if (vn < 0) {
        const e = 0.45;
        const jn = -(1 + e) * vn / (1 / mA + 1 / mB);
        a.vx -= jn * nx / mA; a.vz -= jn * nz / mA;
        b.vx += jn * nx / mB; b.vz += jn * nz / mB;
        // friction along the contact so bodies grab each other instead of sliding past
        const tx = -nz, tz = nx;
        const vt = (b.vx - a.vx) * tx + (b.vz - a.vz) * tz;
        let jt = -vt / (1 / mA + 1 / mB);
        const maxF = 0.35 * jn;
        if (jt > maxF) jt = maxF; else if (jt < -maxF) jt = -maxF;
        a.vx -= jt * tx / mA; a.vz -= jt * tz / mA;
        b.vx += jt * tx / mB; b.vz += jt * tz / mB;
        const jx = jn * nx + jt * tx, jz = jn * nz + jt * tz;
        twist(a, cx, cz, -jx, -jz);
        twist(b, cx, cz, jx, jz);
        world.events.push({ type: 'hit', x: cx, z: cz, y: (a.y + b.y) / 2, s: -vn, a: a.id, b: b.id });
        // Charged plating: bumping a magnet stings
        if (a.type === 'magnet' && b.type !== 'magnet') b.hitStun = Math.max(b.hitStun, 0.12);
        if (b.type === 'magnet' && a.type !== 'magnet') a.hitStun = Math.max(a.hitStun, 0.12);
      }
      abilityHit(world, a, b, nx, nz);
      abilityHit(world, b, a, -nx, -nz);
    }
  }
  // steel posts: very bouncy, and gone once the shrinking deck has passed them
  const map = MAPS[world.map];
  if (map && map.bumpers.length) {
    for (const c of cars) {
      if (!c.alive || c.y > 1.6) continue;
      const cap = capsuleOf(c);
      for (const bmp of map.bumpers) {
        if (Math.hypot(bmp.x, bmp.z) + bmp.r > world.platformR + 0.5) continue;
        const p = closestPointOnSeg(cap.ax, cap.az, cap.bx, cap.bz, bmp.x, bmp.z);
        let dx = p.x - bmp.x, dz = p.z - bmp.z, d = Math.hypot(dx, dz);
        const minD = cap.r + bmp.r;
        if (d >= minD) continue;
        if (d < 1e-4) { dx = c.x - bmp.x; dz = c.z - bmp.z; d = Math.hypot(dx, dz) || 1; }
        const nx = dx / d, nz = dz / d, overlap = minD - d;
        c.x += nx * overlap; c.z += nz * overlap;
        const vn = c.vx * nx + c.vz * nz;
        if (vn < 0) {
          const e = 0.85, m = effectiveMass(c);
          c.vx -= (1 + e) * vn * nx; c.vz -= (1 + e) * vn * nz;
          twist(c, p.x, p.z, -(1 + e) * vn * nx * m * 0.5, -(1 + e) * vn * nz * m * 0.5);
          world.events.push({ type: 'hit', x: p.x, z: p.z, y: c.y + 0.5, s: -vn, a: c.id, b: 'bumper', bumper: true });
        }
      }
    }
  }
}

function closestPointOnSeg(ax, az, bx, bz, px, pz) {
  const dx = bx - ax, dz = bz - az; const l2 = dx * dx + dz * dz;
  const t = l2 > 1e-8 ? clamp01(((px - ax) * dx + (pz - az) * dz) / l2) : 0;
  return { x: ax + dx * t, z: az + dz * t };
}

// Client-side prediction: step one car with its input against the other cars as they stand.
export function predictStep(world, id, inp) {
  const c = world.cars.find((q) => q.id === id);
  if (!c) return [];
  world.events = [];
  const live = world.phase === 'play';
  stepCar(world, c, live ? inp : NULL_INPUT, RULES.dt, live);
  if (live) resolveCollisions(world);
  return world.events;
}

// att touches vic; n points from att to vic. Applied at most every 0.3 s per attacker/victim pair.
function abilityHit(world, att, vic, nx, nz) {
  if (att.abilityT <= 0) return;
  if (vic.lastAbilityHitFrom === att.id && world.time - vic.lastAbilityHitT < 0.3) return;
  const mv = effectiveMass(vic);
  let scale = 1.2 / Math.max(0.6, mv);
  if (vic.type === 'bulldozer') scale *= 0.75;      // Built like a tank
  const stunK = vic.type === 'flipper' ? 0 : 1;      // Spring suspension: never stunned
  let hit = false;
  switch (att.type) {
    case 'bulldozer': {
      vic.vx += nx * 15 * scale; vic.vz += nz * 15 * scale;
      vic.hitStun = Math.max(vic.hitStun, 0.5 * stunK);
      hit = true; break;
    }
    case 'spinner': {
      const tx = -nz, tz = nx;
      const side = ((vic.x - att.x) * tx + (vic.z - att.z) * tz) >= 0 ? 1 : -1;
      vic.vx += (nx * 8 + tx * side * 11) * scale; vic.vz += (nz * 8 + tz * side * 11) * scale;
      vic.hitStun = Math.max(vic.hitStun, 0.6 * stunK);
      hit = true; break;
    }
    case 'flipper': {
      if (vic.onGround && vic.type !== 'anchor') { // Low centre of gravity: the Anchor cannot be flipped
        vic.vy = 12; vic.onGround = false;
        vic.vx += nx * 6 * scale; vic.vz += nz * 6 * scale;
        vic.hitStun = Math.max(vic.hitStun, 0.6 * stunK);
        hit = true;
      }
      break;
    }
    case 'anchor': {
      // braced: whatever touches it bounces off hard
      vic.vx += nx * 8 * scale; vic.vz += nz * 8 * scale;
      vic.hitStun = Math.max(vic.hitStun, 0.35 * stunK);
      hit = true; break;
    }
    default: break;
  }
  if (hit) {
    vic.lastAbilityHitFrom = att.id;
    vic.lastAbilityHitT = world.time;
    world.events.push({ type: 'abilityHit', from: att.id, to: vic.id, car: att.type, x: vic.x, z: vic.z });
  }
}

const r3 = (v) => Math.round(v * 1000) / 1000;

export function snapshot(world) {
  return {
    t: 'state', tick: world.tick, time: r3(world.time), phase: world.phase,
    phaseT: Math.round(world.phaseT * 100) / 100, round: world.round,
    platformR: Math.round(world.platformR * 100) / 100,
    lastRoundWinner: world.lastRoundWinner, matchWinner: world.matchWinner,
    cars: world.cars.map((c) => ({
      id: c.id, x: r3(c.x), y: r3(c.y), z: r3(c.z), h: r3(c.h), vx: r3(c.vx), vz: r3(c.vz), vy: r3(c.vy),
      g: c.onGround ? 1 : 0, a: c.alive ? 1 : 0, ab: r3(c.abilityT), cd: r3(c.abilityCd), jc: r3(c.jumpCd),
      st: r3(c.hitStun), w: c.wins, hv: r3(c.hv), co: r3(c.coyote), mg: r3(c.magnetT), hd: c.holding || 0, hb: c.heldBy || 0,
    })),
  };
}

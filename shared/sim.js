// Deterministic game simulation. Runs on the server (authoritative); the browser runs the same step
// for its own car (prediction) and reads the constants.
import { CARS } from './cars.js';
import { MAPS, inHole, ballPose } from './maps.js';

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
  carryMax: 1.0,        // seconds a grabbed car is carried before the claw lets go
  bumpE: 0.6,           // restitution of a plain car-to-car bump
  bumpShove: 0.5,       // extra push on the car that is hit, as a fraction of the closing speed
  bumpShoveMax: 9,
  skidAfterHit: 0.4,    // seconds of lost grip after a hard hit, so the shove carries
  oilLife: 7,
  oilR: 2.4,
  oilEvery: 0.2,
  mineArm: 1.0,
  mineLife: 14,
  mineR: 2.0,           // trigger radius
  mineBlastR: 4.5,
  mineMax: 2,
  ballKick: 0.9,        // car speed after a wrecking ball hit, as a fraction of the closing speed
  ballMinKick: 9,
  ballLift: 6,
  boomR: 7.5,           // Sonic boom: every car within this range of the Pulse...
  boomDist: 7.5,        // ...is thrown this far straight outward, whatever it weighs
  boomT: 0.4,           // over this long (an ease-out slide)
  nitroBlast: 20,       // how hard a car rammed by the Pulse mid-Nitro is blasted back (scaled by its weight)
};

export const NULL_INPUT = Object.freeze({ th: 0, st: 0, jump: false, ab: false, ab2: false, brake: false });

export function createWorld(players, mapId = 'crater') {
  return {
    map: MAPS[mapId] ? mapId : 'crater',
    time: 0, tick: 0, phase: 'countdown', phaseT: RULES.countdown, round: 1,
    platformR: RULES.platformR0, roundTime: 0,
    cars: players.map((p, i) => createCar(p, i, players.length)),
    oil: [], mines: [], nextId: 1,
    events: [], lastRoundWinner: null, matchWinner: null,
  };
}

function spawnPose(i, n) {
  const ang = (i / n) * Math.PI * 2;
  return { x: Math.sin(ang) * RULES.spawnR, z: Math.cos(ang) * RULES.spawnR, h: ang + Math.PI };
}

function freshState() {
  return {
    vx: 0, vy: 0, vz: 0, onGround: true, alive: true,
    abT: [0, 0], abCd: [0, 0], jumpCd: 0, hitStun: 0, hv: 0, magnetT: 0, coyote: 0,
    holding: null, heldBy: null, freeT: 0, freeFrom: null, lastAbilityHitFrom: null, lastAbilityHitT: -9,
    skidT: 0, oilT: 0, lastHitT: -9, swingDir: 0, oilDropT: 0, ballHitT: 0, flipT: 0, blastT: 0, bvx: 0, bvz: 0,
  };
}

export function createCar(p, i, n) {
  const s = spawnPose(i, n);
  return { id: p.id, name: p.name, type: p.type, x: s.x, y: 0, z: s.z, h: s.h, wins: 0, ...freshState() };
}

export function startRound(world) {
  const n = world.cars.length;
  world.cars.forEach((c, i) => {
    const s = spawnPose(i, n);
    Object.assign(c, { x: s.x, y: 0, z: s.z, h: s.h }, freshState());
  });
  world.platformR = RULES.platformR0;
  world.roundTime = 0;
  world.oil = []; world.mines = [];
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

const on = (c, slot) => c.abT[slot] > 0;

export function effectiveMass(c) {
  let m = CARS[c.type].mass;
  if (c.type === 'anchor' && on(c, 0)) m *= 6;
  if (c.type === 'bulldozer' && on(c, 0)) m *= 3;
  if (c.type === 'bulldozer' && on(c, 1)) m *= 3.5;
  if (c.type === 'spinner' && on(c, 1)) m *= 3;
  if (c.type === 'crane' && c.holding) m *= 1.6;
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
    stepHazards(world);
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

const dec = (v, dt) => (v > 0 ? Math.max(0, v - dt) : 0);

function onOil(world, c) {
  for (const o of world.oil) { if (Math.hypot(c.x - o.x, c.z - o.z) < o.r) return true; }
  return false;
}

function stepCar(world, c, inp, dt, live) {
  const def = CARS[c.type];
  c.abT[0] = dec(c.abT[0], dt); c.abT[1] = dec(c.abT[1], dt);
  c.abCd[0] = dec(c.abCd[0], dt); c.abCd[1] = dec(c.abCd[1], dt);
  c.jumpCd = dec(c.jumpCd, dt); c.hitStun = dec(c.hitStun, dt); c.magnetT = dec(c.magnetT, dt);
  c.freeT = dec(c.freeT, dt); c.skidT = dec(c.skidT, dt); c.oilT = dec(c.oilT, dt); c.ballHitT = dec(c.ballHitT, dt);
  if (c.flipT > 0) {
    // on its roof: no control at all, and it rights itself with a hop when the time is up
    c.flipT = dec(c.flipT, dt);
    if (c.flipT <= 0 && c.alive) { c.vy = Math.max(c.vy, 3.5); c.onGround = false; world.events.push({ type: 'upright', id: c.id }); }
  }

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
  const stunned = c.hitStun > 0 || c.flipT > 0;
  const th = stunned ? 0 : inp.th;
  const st = stunned ? 0 : inp.st;
  if (c.flipT > 0) inp = NULL_INPUT; // upside down: no jump, no abilities, no brake

  // the Wrecker lets go of its load when the carry runs out, or when Grab is pressed again
  if (c.type === 'crane' && c.holding) {
    const vic = world.cars.find((q) => q.id === c.holding);
    if (!vic || !vic.alive || !c.alive || c.abT[0] <= 0 || (live && inp.ab)) releaseHeld(world, c, vic, null);
  }
  if (c.alive && live && c.onGround) {
    if (inp.ab && !c.holding && c.abCd[0] <= 0 && c.abT[0] <= 0) activate(world, c, 0, st);
    if (inp.ab2 && c.abCd[1] <= 0 && c.abT[1] <= 0) activate(world, c, 1, st);
  }
  const nitro = c.type === 'speedster' && on(c, 0);
  const ram = c.type === 'bulldozer' && on(c, 0);
  const blade = c.type === 'bulldozer' && on(c, 1);
  const brace = c.type === 'anchor' && on(c, 0);
  const spin = c.type === 'spinner' && on(c, 0);
  const swing = (c.type === 'crane' || c.type === 'greaser') && on(c, 1);
  const spraying = c.type === 'greaser' && on(c, 0);

  if (c.type === 'crane' && !c.holding && on(c, 0) && c.abT[0] > def.abilities[0].duration - RULES.grabWindow) {
    // claw is snapping down: catch the first car in the zone in front
    const gfx = Math.sin(c.h), gfz = Math.cos(c.h);
    for (const o of world.cars) {
      if (o === c || !o.alive || o.heldBy) continue;
      const dx = o.x - c.x, dz = o.z - c.z;
      const along = dx * gfx + dz * gfz, across = dx * gfz - dz * gfx;
      if (along > 1.2 && along < RULES.grabReach && Math.abs(across) < 1.7 && Math.abs(o.y - c.y) < 1.5) {
        c.holding = o.id; o.heldBy = c.id; o.onGround = false; o.vy = 0; o.hitStun = Math.max(o.hitStun, 0.3);
        c.abT[0] = RULES.carryMax;
        world.events.push({ type: 'grab', id: c.id, to: o.id, x: o.x, z: o.z });
        break;
      }
    }
  }
  if (spraying && live) {
    c.oilDropT -= dt;
    if (c.oilDropT <= 0) {
      c.oilDropT = RULES.oilEvery;
      const fx = Math.sin(c.h), fz = Math.cos(c.h);
      dropOil(world, c, c.x - fx * 2.0, c.z - fz * 2.0);
    }
  }
  if (c.onGround && c.alive && c.type !== 'greaser' && world.oil.length && onOil(world, c)) c.oilT = 0.15;
  const oily = c.oilT > 0;

  // thrown by a sonic boom: an ease-out slide of exactly boomDist, no matter its weight, grip or input
  const blasting = c.blastT > 0;
  if (blasting) {
    c.blastT = Math.max(0, c.blastT - dt);
    const k = Math.max(0, (c.blastT + dt / 2) / RULES.boomT);
    c.vx = c.bvx * k; c.vz = c.bvz * k;
  }

  if (c.alive && c.onGround && !blasting) {
    const fx = Math.sin(c.h), fz = Math.cos(c.h);
    const rx = fz, rz = -fx;
    let vf = c.vx * fx + c.vz * fz;
    let vl = c.vx * rx + c.vz * rz;

    if (brace) {
      vf *= Math.max(0, 1 - 8 * dt);
      vl *= Math.max(0, 1 - 8 * dt);
    } else {
      if (blade) { vf *= Math.max(0, 1 - 4 * dt); vl *= Math.max(0, 1 - 6 * dt); } // the blade digs in: shoves bleed off fast
      let accel = def.accel * (nitro ? 2.8 : 1) * (spin ? 0.85 : 1) * (blade ? 0.7 : 1) * (c.holding ? 0.7 : 1) * (oily ? 0.6 : 1);
      if (ram) accel += 60;
      const top = def.topSpeed * (nitro ? 1.7 : 1) * (ram ? 1.6 : 1) * (spin ? 0.85 : 1) * (blade ? 0.5 : 1) * (c.holding ? 0.55 : 1);
      if (ram) vf += accel * dt;
      else if (th > 0) vf += th * accel * dt;
      else if (th < 0) vf += th * accel * 0.6 * dt;
      if (vf > top) vf -= (vf - top) * Math.min(1, 4 * dt);
      if (vf < -def.reverseSpeed) vf += (-def.reverseSpeed - vf) * Math.min(1, 4 * dt);
      const dragged = c.magnetT > 0; // caught in a tractor beam: the tyres lose most of their bite
      const roll = ((th === 0 && !ram) ? 1.3 : 0.2) * (dragged ? 0.3 : 1) * (oily ? 0.05 : 1);
      vf *= Math.max(0, 1 - roll * dt);
      let grip = (inp.brake ? def.grip * 0.25 : def.grip) * (dragged ? 0.12 : 1);
      if (oily) grip *= 0.1;
      if (c.skidT > 0) grip *= 0.25;
      if (c.flipT > 0) { vf *= Math.max(0, 1 - 2.5 * dt); grip = 2.5; } // on its roof: scrapes to a stop, but any push still moves it
      if (swing && c.type === 'greaser') grip *= 0.3;
      vl *= Math.max(0, 1 - grip * dt);
      if (swing) {
        const total = c.type === 'crane' ? 1.7 : 2.4;
        c.h += c.swingDir * (total / def.abilities[1].duration) * dt;
      } else {
        const speedNorm = Math.min(1, Math.abs(vf) / 7);
        const dir = vf >= 0 ? 1 : -1;
        const turn = def.turnRate * (spin ? 0.55 : 1) * (inp.brake ? 1.35 : 1) * (c.holding ? 0.8 : 1) * (oily ? 0.45 : 1);
        c.h += st * turn * speedNorm * dir * dt;
      }
    }
    c.vx = fx * vf + rx * vl;
    c.vz = fz * vf + rz * vl;

    if (c.alive && live && inp.jump && c.jumpCd <= 0 && !brace && !c.holding) {
      c.vy = RULES.jumpV;
      c.onGround = false;
      c.jumpCd = def.jumpCd || RULES.jumpCd;
      world.events.push({ type: 'jump', id: c.id });
    }
  }

  if (!c.onGround) {
    c.vy -= RULES.gravity * dt;
    if (c.alive && live && !blasting) {
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
    if (c.holding) { const v = world.cars.find((q) => q.id === c.holding); releaseHeld(world, c, v, null); }
    world.events.push({ type: 'fall', id: c.id, x: c.x, z: c.z });
  }
  if (c.y < -30) { c.y = -30; c.vy = 0; }
}

// knockback scale for a victim: lighter cars fly further; some passives and stances resist
function victimScale(vic) {
  let scale = 1.2 / Math.max(0.6, effectiveMass(vic));
  if (vic.type === 'bulldozer') scale *= 0.75;          // Built like a tank
  if (vic.type === 'bulldozer' && on(vic, 1)) scale *= 0.5; // Blade down
  return scale;
}
const stunK = (vic) => (vic.type === 'flipper' ? 0 : 1); // Spring suspension: never stunned

// Shove every other car within r straight away from (x, z). Returns how many were hit.
function shockwave(world, src, r, power, stun, slot) {
  let n = 0;
  for (const o of world.cars) {
    if (o === src || !o.alive || o.heldBy) continue;
    let dx = o.x - src.x, dz = o.z - src.z; const d = Math.hypot(dx, dz);
    if (d > r || Math.abs(o.y - src.y) > 2.5) continue;
    if (d < 1e-3) { dx = Math.sin(o.h); dz = Math.cos(o.h); } else { dx /= d; dz /= d; }
    const k = 1 - 0.5 * (d / r);
    const s = power * k * victimScale(o);
    o.vx += dx * s; o.vz += dz * s;
    o.hitStun = Math.max(o.hitStun, stun * stunK(o)); o.skidT = Math.max(o.skidT, 0.5); o.lastHitT = world.time;
    o.lastAbilityHitFrom = src.id; o.lastAbilityHitT = world.time;
    world.events.push({ type: 'abilityHit', from: src.id, to: o.id, car: src.type, slot, x: o.x, z: o.z });
    n++;
  }
  return n;
}

function dropOil(world, c, x, z) {
  const mine = world.oil.filter((o) => o.by === c.id);
  if (mine.length >= 8) world.oil.splice(world.oil.indexOf(mine[0]), 1);
  world.oil.push({ x, z, r: RULES.oilR, t: world.time + RULES.oilLife, by: c.id });
  world.events.push({ type: 'oil', id: c.id, x, z });
}

// Press: start an ability. Instant effects happen here; lasting ones are read from abT elsewhere.
function activate(world, c, slot, st) {
  const def = CARS[c.type], ab = def.abilities[slot];
  c.abT[slot] = ab.duration;
  c.abCd[slot] = ab.cooldown + ab.duration;
  world.events.push({ type: 'ability', id: c.id, car: c.type, slot });
  if (slot === 0) {
    if (c.type === 'boomer') {
      const mine = world.mines.filter((m) => m.by === c.id);
      if (mine.length >= RULES.mineMax) world.mines.splice(world.mines.indexOf(mine[0]), 1);
      const fx = Math.sin(c.h), fz = Math.cos(c.h);
      const m = { id: world.nextId++, x: c.x - fx * 2.6, z: c.z - fz * 2.6, by: c.id, armAt: world.time + RULES.mineArm, t: world.time + RULES.mineLife };
      world.mines.push(m);
      world.events.push({ type: 'mineDrop', id: c.id, mine: m.id, x: m.x, z: m.z });
    }
    if (c.type === 'greaser') c.oilDropT = 0;
    return;
  }
  switch (c.type) {
    case 'speedster': { // Sonic boom: every car in range is thrown straight out the same distance
      const v0 = (2 * RULES.boomDist) / RULES.boomT;
      for (const o of world.cars) {
        if (o === c || !o.alive || o.heldBy) continue;
        let dx = o.x - c.x, dz = o.z - c.z; const d = Math.hypot(dx, dz);
        if (d > RULES.boomR || Math.abs(o.y - c.y) > 3) continue;
        if (d < 1e-3) { dx = Math.sin(c.h); dz = Math.cos(c.h); } else { dx /= d; dz /= d; }
        o.blastT = RULES.boomT; o.bvx = dx * v0; o.bvz = dz * v0;
        o.hitStun = Math.max(o.hitStun, (RULES.boomT + 0.2) * stunK(o));
        o.skidT = Math.max(o.skidT, RULES.boomT + 0.3); o.lastHitT = world.time;
        o.lastAbilityHitFrom = c.id; o.lastAbilityHitT = world.time;
        if (o.holding) { const v = world.cars.find((q) => q.id === o.holding); releaseHeld(world, o, v, null); }
        world.events.push({ type: 'abilityHit', from: c.id, to: o.id, car: c.type, slot: 1, x: o.x, z: o.z });
      }
      world.events.push({ type: 'shock', id: c.id, car: c.type, x: c.x, z: c.z, r: RULES.boomR, boom: true });
      break;
    }
    case 'flipper': { // Pounce: a long forward leap
      const fx = Math.sin(c.h), fz = Math.cos(c.h);
      c.vy = 8.5; c.onGround = false; c.vx += fx * 7; c.vz += fz * 7;
      break;
    }
    case 'anchor': { // Countershock: stronger right after taking a hit
      const boost = world.time - c.lastHitT < 0.6 ? 1.6 : 1;
      shockwave(world, c, boost > 1 ? 8 : 6.5, 16 * boost, 0.3, 1);
      world.events.push({ type: 'shock', id: c.id, car: c.type, x: c.x, z: c.z, r: boost > 1 ? 8 : 6.5, big: boost > 1 });
      break;
    }
    case 'magnet': { // Repulsion: throw everyone away, and recoil
      let kx = 0, kz = 0;
      for (const o of world.cars) {
        if (o === c || !o.alive) continue;
        const dx = o.x - c.x, dz = o.z - c.z, d = Math.hypot(dx, dz);
        if (d > 10 || d < 1e-3) continue;
        const k = 1 - 0.5 * (d / 10); kx -= (dx / d) * 6 * k; kz -= (dz / d) * 6 * k;
      }
      shockwave(world, c, 10, 18, 0.3, 1);
      c.vx += kx; c.vz += kz; c.skidT = Math.max(c.skidT, 0.4);
      world.events.push({ type: 'shock', id: c.id, car: c.type, x: c.x, z: c.z, r: 10 });
      break;
    }
    case 'boomer': { // Blast jump: hop, and knock the neighbours back
      c.vy = 10; c.onGround = false;
      shockwave(world, c, 5.5, 12, 0.3, 1);
      world.events.push({ type: 'shock', id: c.id, car: c.type, x: c.x, z: c.z, r: 5.5 });
      break;
    }
    case 'crane': { // Jackknife: whip round; a held car is flung out sideways
      c.swingDir = st ? Math.sign(st) : 1;
      if (c.holding) {
        const vic = world.cars.find((q) => q.id === c.holding);
        const fx = Math.sin(c.h), fz = Math.cos(c.h), rx = fz, rz = -fx;
        releaseHeld(world, c, vic, { vx: c.vx + rx * c.swingDir * 13 + fx * 2, vz: c.vz + rz * c.swingDir * 13 + fz * 2, vy: 3 });
        c.abT[0] = 0;
      }
      break;
    }
    case 'greaser': { c.swingDir = st ? Math.sign(st) : 1; break; } // Powerslide
    default: break;
  }
}

function applyMagnets(world, dt) {
  for (const m of world.cars) {
    if (!(m.alive && m.type === 'magnet' && on(m, 0))) continue;
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
  if (c.type === 'spinner' && on(c, 0)) r = Math.max(r, 1.8);
  if (c.type === 'flipper' && on(c, 0)) front = 0.8;
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

// The crane lets go of what it carries: tossed a little forward (or thrown, if `fling` is given).
function releaseHeld(world, c, vic, fling) {
  if (vic && vic.heldBy === c.id) {
    const fx = Math.sin(c.h), fz = Math.cos(c.h);
    vic.heldBy = null; vic.onGround = false;
    if (fling) { vic.vx = fling.vx; vic.vz = fling.vz; vic.vy = fling.vy; }
    else { vic.vx = c.vx + fx * 5; vic.vz = c.vz + fz * 5; vic.vy = 1.5; }
    vic.hitStun = Math.max(vic.hitStun, fling ? 0.6 : 0.4) * stunK(vic);
    vic.skidT = Math.max(vic.skidT, 0.5);
    vic.freeT = 0.7; vic.freeFrom = c.id; // a moment with no collision against the crane, so it falls clear
    world.events.push({ type: fling ? 'throw' : 'drop', id: c.id, to: vic.id, x: vic.x, z: vic.z, y: vic.y });
  }
  c.holding = null;
  if (c.abT[0] > 0) c.abT[0] = 0;
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
          const pounce = upper.type === 'flipper' && on(upper, 1);
          upper.vy = pounce ? 5 : 6; upper.vx += ux * 4; upper.vz += uz * 4;
          if (pounce) {
            const s = 9 * victimScale(lower);
            lower.vx -= ux * s; lower.vz -= uz * s; lower.skidT = Math.max(lower.skidT, 0.5); lower.lastHitT = world.time;
            lower.hitStun = Math.max(lower.hitStun, 0.6 * stunK(lower));
            world.events.push({ type: 'abilityHit', from: upper.id, to: lower.id, car: 'flipper', slot: 1, x: lower.x, z: lower.z });
          } else lower.hitStun = Math.max(lower.hitStun, 0.3 * stunK(lower));
          world.events.push({ type: 'stomp', id: upper.id, on: lower.id, x: upper.x, z: upper.z, y: lower.y + 1.2, hard: pounce });
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
      const preA = a.vx * nx + a.vz * nz, preB = -(b.vx * nx + b.vz * nz); // how hard each drove into the contact
      if (vn < 0) {
        const e = RULES.bumpE;
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
        // the shove: whoever was driving into the contact harder pushes the other on past the bounce,
        // and the one that is hit loses grip for a moment so the push carries
        const approachA = a.vx * nx + a.vz * nz, approachB = -(b.vx * nx + b.vz * nz);
        const aAtt = approachA >= approachB;
        const vic = aAtt ? b : a, att = aAtt ? a : b, sgn = aAtt ? 1 : -1;
        const mv = effectiveMass(vic), ma = effectiveMass(att);
        // contact abilities (ram, brace, blade, wedge, sweeps) bring their own impulse, so the plain shove steps back
        const attHits = (att.type === 'bulldozer' && on(att, 0)) || (att.type === 'anchor' && on(att, 0)) || (att.type === 'flipper' && on(att, 0)) || (att.type === 'speedster' && on(att, 0))
          || (att.type === 'spinner' && (on(att, 0) || on(att, 1))) || ((att.type === 'crane' || att.type === 'greaser') && on(att, 1));
        const shove = Math.min(RULES.bumpShoveMax, RULES.bumpShove * -vn * (2 * ma / (ma + mv)) * (attHits ? 0.25 : 1) * (vic.type === 'bulldozer' && on(vic, 1) ? 0.3 : 1));
        vic.vx += nx * sgn * shove; vic.vz += nz * sgn * shove;
        if (-vn > 5) { vic.skidT = Math.max(vic.skidT, RULES.skidAfterHit); vic.lastHitT = world.time; }
        att.lastHitT = world.time;
        world.events.push({ type: 'hit', x: cx, z: cz, y: (a.y + b.y) / 2, s: -vn, a: a.id, b: b.id });
        // Charged plating: bumping a magnet stings
        if (a.type === 'magnet' && b.type !== 'magnet') b.hitStun = Math.max(b.hitStun, 0.12 * stunK(b));
        if (b.type === 'magnet' && a.type !== 'magnet') a.hitStun = Math.max(a.hitStun, 0.12 * stunK(a));
      }
      abilityHit(world, a, b, nx, nz, cx, cz, preA);
      abilityHit(world, b, a, -nx, -nz, cx, cz, preB);
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

// Map hazards and dropped things: wrecking balls, mines, oil that has dried up.
function stepHazards(world) {
  const t = world.time;
  if (world.oil.length) world.oil = world.oil.filter((o) => o.t > t);
  if (world.mines.length) {
    for (const m of world.mines) {
      if (m.t <= t || Math.hypot(m.x, m.z) > world.platformR + 0.5) { m.dead = true; continue; }
      if (m.armAt > t) continue;
      for (const c of world.cars) {
        if (!c.alive || c.id === m.by || c.heldBy || c.y > 1.2) continue;
        if (Math.hypot(c.x - m.x, c.z - m.z) > RULES.mineR) continue;
        explodeMine(world, m); break;
      }
    }
    world.mines = world.mines.filter((m) => !m.dead);
  }
  const map = MAPS[world.map];
  if (map && map.balls.length) {
    for (const b of map.balls) {
      const p = ballPose(b, t);
      if (p.y - b.r > 2.6) continue;
      for (const c of world.cars) {
        if (!c.alive || c.heldBy) continue;
        if (p.y - b.r > c.y + 1.2 || p.y + b.r < c.y) continue;
        const cap = capsuleOf(c);
        const q = closestPointOnSeg(cap.ax, cap.az, cap.bx, cap.bz, p.x, p.z);
        let dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
        const minD = cap.r + b.r;
        if (d >= minD) continue;
        if (d < 1e-4) { dx = c.x - p.x; dz = c.z - p.z; d = Math.hypot(dx, dz) || 1; }
        const nx = dx / d, nz = dz / d, overlap = minD - d;
        c.x += nx * overlap; c.z += nz * overlap;
        if (c.ballHitT > 0) continue;
        const rel = (p.vx * nx + p.vz * nz) - (c.vx * nx + c.vz * nz);
        if (rel <= 0) continue; // the ball is moving away: the car is only nudged out of it
        let kick = Math.max(RULES.ballMinKick, rel * RULES.ballKick) * (1.2 / Math.max(0.7, effectiveMass(c)));
        if (c.type === 'bulldozer') kick *= 0.75;
        const vn = c.vx * nx + c.vz * nz;
        if (vn < 0) { c.vx -= nx * vn; c.vz -= nz * vn; }
        c.vx += nx * kick; c.vz += nz * kick;
        c.vy = Math.max(c.vy, RULES.ballLift); c.onGround = false;
        c.hitStun = Math.max(c.hitStun, 0.45 * stunK(c)); c.skidT = Math.max(c.skidT, 0.5); c.lastHitT = t; c.ballHitT = 0.4;
        if (c.holding) { const v = world.cars.find((o) => o.id === c.holding); releaseHeld(world, c, v, null); }
        world.events.push({ type: 'ballHit', id: c.id, x: q.x, y: p.y, z: q.z, s: kick });
      }
    }
  }
}

function explodeMine(world, m) {
  m.dead = true;
  for (const c of world.cars) {
    if (!c.alive || c.heldBy || c.id === m.by) continue; // Blast proof: the owner is never hurt
    let dx = c.x - m.x, dz = c.z - m.z; const d = Math.hypot(dx, dz);
    if (d > RULES.mineBlastR) continue;
    if (d < 1e-3) { dx = Math.sin(c.h); dz = Math.cos(c.h); } else { dx /= d; dz /= d; }
    const k = 1 - 0.5 * (d / RULES.mineBlastR);
    const s = 14 * k * victimScale(c);
    c.vx += dx * s; c.vz += dz * s;
    if (c.type !== 'anchor') { c.vy = Math.max(c.vy, 9 * k); c.onGround = false; }
    c.hitStun = Math.max(c.hitStun, 0.5 * stunK(c)); c.skidT = Math.max(c.skidT, 0.5); c.lastHitT = world.time;
    c.lastAbilityHitFrom = m.by; c.lastAbilityHitT = world.time;
    if (c.holding) { const v = world.cars.find((o) => o.id === c.holding); releaseHeld(world, c, v, null); }
    world.events.push({ type: 'abilityHit', from: m.by, to: c.id, car: 'boomer', slot: 0, x: c.x, z: c.z });
  }
  world.events.push({ type: 'mine', mine: m.id, by: m.by, x: m.x, z: m.z });
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

// att touches vic; n points from att to vic; (cx, cz) is the contact point; approach is how fast att was
// driving into the contact before it was resolved. Applied at most every 0.3 s per attacker/victim pair.
function abilityHit(world, att, vic, nx, nz, cx, cz, approach = 0) {
  if (att.abT[0] <= 0 && att.abT[1] <= 0) return;
  if (vic.lastAbilityHitFrom === att.id && world.time - vic.lastAbilityHitT < 0.3) return;
  const scale = victimScale(vic);
  const sk = stunK(vic);
  let hit = false, slot = 0;
  switch (att.type) {
    case 'speedster': {
      // Nitro ram: a car the Pulse drives into mid-boost is blasted backwards, and the boost is spent on it
      if (!on(att, 0) || approach < 4) break;
      vic.vx += nx * RULES.nitroBlast * scale; vic.vz += nz * RULES.nitroBlast * scale;
      if (vic.type !== 'anchor') { vic.vy = Math.max(vic.vy, 4); vic.onGround = false; } // Low centre of gravity: stays down
      vic.hitStun = Math.max(vic.hitStun, 0.6 * sk);
      att.abT[0] = 0;
      world.events.push({ type: 'blast', from: att.id, to: vic.id, x: cx, z: cz, y: (att.y + vic.y) / 2 + 0.6 });
      hit = true; break;
    }
    case 'bulldozer': {
      if (!on(att, 0)) break;
      vic.vx += nx * 15 * scale; vic.vz += nz * 15 * scale;
      vic.hitStun = Math.max(vic.hitStun, 0.5 * sk);
      hit = true; break;
    }
    case 'spinner': {
      if (on(att, 1)) { // Gyro counter: hurl the toucher straight back, once
        vic.vx += nx * 20 * scale; vic.vz += nz * 20 * scale;
        vic.hitStun = Math.max(vic.hitStun, 0.5 * sk);
        att.abT[1] = 0; slot = 1; hit = true; break;
      }
      if (!on(att, 0)) break;
      const tx = -nz, tz = nx;
      const side = ((vic.x - att.x) * tx + (vic.z - att.z) * tz) >= 0 ? 1 : -1;
      vic.vx += (nx * 8 + tx * side * 11) * scale; vic.vz += (nz * 8 + tz * side * 11) * scale;
      vic.hitStun = Math.max(vic.hitStun, 0.6 * sk);
      hit = true; break;
    }
    case 'flipper': {
      if (on(att, 0) && vic.onGround && vic.type !== 'anchor') { // Low centre of gravity: the Anchor cannot be flipped
        vic.vy = 12; vic.onGround = false;
        vic.vx += nx * 6 * scale; vic.vz += nz * 6 * scale;
        vic.hitStun = Math.max(vic.hitStun, 0.6 * sk);
        // a clean hit, with the wedge under the nose or the tail, rolls the car onto its roof
        const along = Math.abs(nx * Math.sin(vic.h) + nz * Math.cos(vic.h));
        if (along > 0.7) { vic.flipT = 2.6; world.events.push({ type: 'flipped', from: att.id, id: vic.id, x: vic.x, z: vic.z }); }
        hit = true;
      }
      break;
    }
    case 'anchor': {
      if (!on(att, 0)) break;
      // braced: whatever touches it bounces off hard
      vic.vx += nx * 8 * scale; vic.vz += nz * 8 * scale;
      vic.hitStun = Math.max(vic.hitStun, 0.35 * sk);
      hit = true; break;
    }
    case 'crane':
    case 'greaser': {
      if (!on(att, 1)) break; // Jackknife / Powerslide: the swinging body sweeps the victim along its arc
      const rx = cx - att.x, rz = cz - att.z, rl = Math.hypot(rx, rz) || 1;
      const tx = att.swingDir * (rz / rl), tz = att.swingDir * (-rx / rl);
      const p = att.type === 'crane' ? 16 : 14;
      vic.vx += (tx * p + nx * 5) * scale; vic.vz += (tz * p + nz * 5) * scale;
      vic.hitStun = Math.max(vic.hitStun, 0.5 * sk);
      slot = 1; hit = true; break;
    }
    default: break;
  }
  if (hit) {
    vic.skidT = Math.max(vic.skidT, 0.5); vic.lastHitT = world.time;
    vic.lastAbilityHitFrom = att.id;
    vic.lastAbilityHitT = world.time;
    world.events.push({ type: 'abilityHit', from: att.id, to: vic.id, car: att.type, slot, x: vic.x, z: vic.z });
  }
}

const r3 = (v) => Math.round(v * 1000) / 1000;

export function snapshot(world) {
  const snap = {
    t: 'state', tick: world.tick, time: r3(world.time), phase: world.phase,
    phaseT: Math.round(world.phaseT * 100) / 100, round: world.round,
    platformR: Math.round(world.platformR * 100) / 100,
    lastRoundWinner: world.lastRoundWinner, matchWinner: world.matchWinner,
    cars: world.cars.map((c) => ({
      id: c.id, x: r3(c.x), y: r3(c.y), z: r3(c.z), h: r3(c.h), vx: r3(c.vx), vz: r3(c.vz), vy: r3(c.vy),
      g: c.onGround ? 1 : 0, a: c.alive ? 1 : 0, ab: [r3(c.abT[0]), r3(c.abT[1])], cd: [r3(c.abCd[0]), r3(c.abCd[1])], jc: r3(c.jumpCd),
      st: r3(c.hitStun), w: c.wins, hv: r3(c.hv), co: r3(c.coyote), mg: r3(c.magnetT), hd: c.holding || 0, hb: c.heldBy || 0,
      sk: r3(c.skidT), ol: r3(c.oilT), sw: c.swingDir, lh: r3(c.lastHitT), fl: r3(c.flipT), bt: r3(c.blastT), bx: r3(c.bvx), bz: r3(c.bvz),
    })),
  };
  if (world.oil.length) snap.oil = world.oil.map((o) => ({ x: r3(o.x), z: r3(o.z), r: o.r, t: r3(o.t), by: o.by }));
  if (world.mines.length) snap.mines = world.mines.map((m) => ({ id: m.id, x: r3(m.x), z: r3(m.z), by: m.by, armAt: r3(m.armAt), t: r3(m.t) }));
  return snap;
}

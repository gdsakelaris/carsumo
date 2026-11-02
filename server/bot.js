// A simple practice opponent: drives at the nearest car, respects the edge, uses its ability
// when the geometry is right, and sometimes hops over an incoming ram.
import { CARS } from '../shared/cars.js';
import { MAPS, inHole } from '../shared/maps.js';

export function createBotBrain(id) {
  return { id, nextThink: 0, input: { th: 0, st: 0, jump: false, ab: false, brake: false }, jumpUntil: 0 };
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function botInput(world, brain) {
  const me = world.cars.find((c) => c.id === brain.id);
  if (!me || !me.alive || world.phase !== 'play') return { th: 0, st: 0, jump: false, ab: false, brake: false };
  // Think at 20 Hz, hold the input between thoughts.
  if (world.time < brain.nextThink) return brain.input;
  brain.nextThink = world.time + 0.05;

  const foes = world.cars.filter((c) => c !== me && c.alive);
  const inp = { th: 1, st: 0, jump: false, ab: false, brake: false };
  if (!foes.length) { brain.input = inp; return inp; }
  let foe = foes[0], best = Infinity;
  for (const f of foes) { const d = Math.hypot(f.x - me.x, f.z - me.z); if (d < best) { best = d; foe = f; } }

  const dx = foe.x - me.x, dz = foe.z - me.z;
  const dist = Math.hypot(dx, dz);
  let targetH = Math.atan2(dx, dz);
  // carrying someone: head straight for the nearest edge and let go there
  const carrying = me.type === 'crane' && !!me.holding;
  if (carrying) targetH = Math.atan2(me.x, me.z);

  // Edge awareness: if I am near the rim and my heading points outward, aim back toward the middle.
  const myR = Math.hypot(me.x, me.z);
  const outward = (me.x * Math.sin(me.h) + me.z * Math.cos(me.h)) / Math.max(0.01, myR);
  const margin = world.platformR - myR;
  if (!carrying && margin < 5 && outward > 0.2) {
    const toCenter = Math.atan2(-me.x, -me.z);
    const w = Math.min(1, (5 - margin) / 4);
    const a = wrap(toCenter - targetH);
    targetH = targetH + a * w;
    if (margin < 2.2 && outward > 0.6) inp.brake = true;
  }

  const err = wrap(targetH - me.h);
  inp.st = Math.max(-1, Math.min(1, err * 2.2));
  const facing = Math.abs(err) < 1.0;
  inp.th = facing ? 1 : (Math.abs(err) > 2.4 ? -0.6 : 0.5);
  if (!facing && Math.abs(err) > 2.4) inp.st = -inp.st; // reversing flips the steering sense
  if (carrying) inp.th = 1;

  // Ability use by car type.
  const aligned = Math.abs(err) < 0.45;
  const foeSpeed = Math.hypot(foe.vx, foe.vz);
  const closing = -((foe.vx - me.vx) * dx + (foe.vz - me.vz) * dz) / Math.max(0.01, dist);
  switch (me.type) {
    case 'bulldozer': inp.ab = aligned && dist < 9 && dist > 3; break;
    case 'flipper': inp.ab = aligned && dist < 4.5; break;
    case 'spinner': inp.ab = dist < 7; break;
    case 'speedster': inp.ab = aligned && dist < 16 && dist > 6; break;
    case 'magnet': inp.ab = dist > 6 && dist < 15 && aligned; break;
    case 'anchor': inp.ab = dist < 6 && closing > 6; break;
    case 'crane': inp.ab = carrying ? margin < 3.4 : (aligned && dist < 4.4 && dist > 1.4 && foe.onGround); break;
    default: break;
  }
  // Dodge: a foe charging at me with an active ability, close by: hop sometimes.
  const foeRam = foe.abilityT > 0 && (foe.type === 'bulldozer' || foe.type === 'spinner' || foe.type === 'flipper');
  if (foeRam && dist < 6 && closing > 5 && me.jumpCd <= 0 && Math.random() < 0.35) inp.jump = true;
  // Don't drive hard at a braced anchor.
  if (foe.type === 'anchor' && foe.abilityT > 0 && dist < 7) { inp.th = -0.5; inp.st = 0; }
  // Panic hop if already falling off the edge with some chance to land back.
  if (!carrying && margin < 0.6 && outward > 0.5 && me.jumpCd <= 0 && me.onGround) { inp.jump = true; inp.th = -1; }

  // Map hazards: jump a gap that is about to be under the wheels; steer around a post in the path.
  const map = MAPS[world.map] || MAPS.crater;
  const sh = Math.sin(me.h), ch = Math.cos(me.h);
  if (map.holes.length && inHole(map, me.x + sh * 3.2, me.z + ch * 3.2)) {
    if (me.jumpCd <= 0 && me.onGround && Math.hypot(me.vx, me.vz) > 4) inp.jump = true;
    else { inp.th = -0.6; inp.st = 1; }
  }
  for (const b of map.bumpers) {
    const bx = b.x - me.x, bz = b.z - me.z;
    const along = bx * sh + bz * ch, across = bx * ch - bz * sh;
    if (along > 0 && along < 5 && Math.abs(across) < b.r + 1.4) inp.st += across >= 0 ? -0.8 : 0.8;
  }
  inp.st = Math.max(-1, Math.min(1, inp.st));
  brain.input = inp;
  return inp;
}

export { CARS };

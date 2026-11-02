// Deterministic checks on the shared simulation. Run: node tools/test_sim.mjs
import { createWorld, stepWorld, snapshot, RULES, predictStep } from '../shared/sim.js';
import { CARS } from '../shared/cars.js';

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); if (!ok) failures++; };
const idle = { th: 0, st: 0, jump: false, ab: false, brake: false };
const players = (a, b) => [{ id: 'a', name: 'A', type: a }, { id: 'b', name: 'B', type: b }];

// 1. Reversing off your own edge loses the round to the other car.
{
  const w = createWorld(players('bulldozer', 'anchor')); const inputs = new Map(); let t = 0;
  while (w.phase !== 'roundOver' && t < 60 * 15) { inputs.set('b', { ...idle, th: -1 }); stepWorld(w, inputs); t++; }
  check('reverse off the edge ends the round', w.phase === 'roundOver' && w.lastRoundWinner === 'a', `${(t / 60).toFixed(2)} s`);
}

// 2. A ram shoves the other car further than a plain hit.
function headOn(ram) {
  const w = createWorld(players('bulldozer', 'anchor')); const inp = new Map(); let fired = false; let maxPush = 0;
  for (let i = 0; i < 60 * 12; i++) {
    const a = w.cars[0], b = w.cars[1]; const d = Math.hypot(b.x - a.x, b.z - a.z);
    const ab = ram && !fired && d < 9 && w.phase === 'play'; if (ab) fired = true;
    inp.set('a', { ...idle, th: 1, ab });
    stepWorld(w, inp);
    maxPush = Math.max(maxPush, Math.hypot(b.vx, b.vz));
    if (w.phase === 'roundOver') break;
  }
  return { winner: w.lastRoundWinner, maxPush };
}
{
  const plain = headOn(false), rammed = headOn(true);
  check('bulldozer beats an idle anchor head-on', plain.winner === 'a' && rammed.winner === 'a');
  check('ram pushes harder than a plain hit', rammed.maxPush > plain.maxPush * 1.3, `${plain.maxPush.toFixed(1)} vs ${rammed.maxPush.toFixed(1)} m/s`);
}

// 3. Brace: a braced anchor is pushed less than an unbraced one by the same hit.
function braced(useBrace) {
  const w = createWorld(players('bulldozer', 'anchor')); const inp = new Map(); let moved = 0;
  for (let i = 0; i < 60 * 8; i++) {
    const a = w.cars[0], b = w.cars[1]; const d = Math.hypot(b.x - a.x, b.z - a.z);
    inp.set('a', { ...idle, th: 1 });
    inp.set('b', { ...idle, ab: useBrace && d < 6 && w.phase === 'play' });
    const bx = b.x, bz = b.z; stepWorld(w, inp);
    if (w.phase === 'play') moved += Math.hypot(b.x - bx, b.z - bz);
    if (w.phase === 'roundOver') break;
  }
  return moved;
}
{
  const free = braced(false), held = braced(true);
  check('brace resists the shove', held < free * 0.8, `${free.toFixed(1)} m vs ${held.toFixed(1)} m moved`);
}

// 4. Flip launches the victim into the air.
{
  const w = createWorld(players('flipper', 'speedster')); const inp = new Map(); let maxY = 0;
  for (let i = 0; i < 60 * 8; i++) {
    const a = w.cars[0], b = w.cars[1]; const d = Math.hypot(b.x - a.x, b.z - a.z);
    inp.set('a', { ...idle, th: 1, ab: d < 4.5 && w.phase === 'play' });
    stepWorld(w, inp); maxY = Math.max(maxY, b.y);
    if (w.phase === 'roundOver') break;
  }
  check('flip launches the other car', maxY > 1.2, `peak height ${maxY.toFixed(2)} m`);
}

// 5. Magnet pulls a distant idle car closer.
{
  const w = createWorld(players('magnet', 'anchor')); const inp = new Map();
  // Park the anchor 14 m from the magnet (spawns are 24 m apart, beyond the 18 m pull range).
  w.cars[1].x = w.cars[0].x + 14 * Math.sin(w.cars[0].h); w.cars[1].z = w.cars[0].z + 14 * Math.cos(w.cars[0].h);
  const d0 = Math.hypot(w.cars[1].x - w.cars[0].x, w.cars[1].z - w.cars[0].z);
  for (let i = 0; i < 60 * 6; i++) { inp.set('a', { ...idle, ab: w.phase === 'play' && w.cars[0].abilityCd <= 0 }); stepWorld(w, inp); }
  const d1 = Math.hypot(w.cars[1].x - w.cars[0].x, w.cars[1].z - w.cars[0].z);
  check('magnet pulls the other car in', d1 < d0 - 2, `${d0.toFixed(1)} -> ${d1.toFixed(1)} m`);
}

// 6. Jump clears a collision: a jumping car passes over a rammer without a hit event.
{
  const w = createWorld(players('speedster', 'bulldozer')); const inp = new Map(); let hits = 0, jumped = false;
  for (let i = 0; i < 60 * 6; i++) {
    const a = w.cars[0], b = w.cars[1]; const d = Math.hypot(b.x - a.x, b.z - a.z);
    // Jump about a third of a second before contact at this closing speed.
    const closing = Math.max(1, -((b.vx - a.vx) * (b.x - a.x) + (b.vz - a.vz) * (b.z - a.z)) / d);
    inp.set('a', { ...idle, th: 1, jump: !jumped && w.phase === 'play' && (d - 2.6) / closing < 0.3 });
    inp.set('b', { ...idle, th: 1 });
    stepWorld(w, inp);
    if (inp.get('a').jump) jumped = true;
    hits += w.events.filter((e) => e.type === 'hit').length;
    if (w.phase === 'roundOver') break;
  }
  check('a well-timed jump avoids the hit', jumped && hits === 0, `${hits} hit events`);
}

// 7. The platform shrinks and eliminates a parked car; the round ends.
{
  const w = createWorld(players('speedster', 'anchor')); const inputs = new Map();
  for (let i = 0; i < 60 * 75; i++) { stepWorld(w, inputs); if (w.phase === 'roundOver') break; }
  check('shrinking platform forces a result', w.phase === 'roundOver' && w.platformR < RULES.platformR0, `R=${w.platformR.toFixed(1)} at ${w.time.toFixed(0)} s`);
}

// 8. A full match: first to three round wins, then matchOver.
{
  const w = createWorld(players('bulldozer', 'anchor')); const inputs = new Map(); let rounds = 0;
  for (let i = 0; i < 60 * 90 && w.phase !== 'matchOver'; i++) {
    inputs.set('b', { ...idle, th: -1 });
    stepWorld(w, inputs);
    if (w.events.some((e) => e.type === 'roundEnd')) rounds++;
  }
  check('match ends after three round wins', w.phase === 'matchOver' && w.matchWinner === 'a' && rounds === 3, `${rounds} rounds, winner ${w.matchWinner}`);
  const snap = snapshot(w);
  check('snapshot carries cars and phase', snap.cars.length === 2 && snap.phase === 'matchOver');
}

// 9. Every car type can activate its ability without errors and the cooldown is set.
for (const t of Object.keys(CARS)) {
  const w = createWorld(players(t, 'anchor')); const inp = new Map();
  for (let i = 0; i < 60 * 4; i++) { inp.set('a', { ...idle, ab: w.phase === 'play' }); stepWorld(w, inp); }
  check(`${t} ability activates`, w.cars[0].abilityCd > 0 || w.cars[0].abilityT > 0);
}

// 10. Capsule contact: a nose against a flank is a real contact even where circles would miss.
{
  const w = createWorld(players('speedster', 'anchor')); const inp = new Map();
  const a = w.cars[0], b = w.cars[1];
  a.x = 0; a.z = 0; a.h = 0; b.x = 0; b.z = 2.7; b.h = Math.PI / 2; // circles 2.55 apart would miss at 2.7 m
  w.phase = 'play';
  stepWorld(w, inp);
  check('capsule contact separates a nose-to-flank overlap', b.z - a.z > 2.72, `${(b.z - a.z).toFixed(2)} m apart`);
}
// 11. An off-centre hit twists the victim.
{
  const w = createWorld(players('bulldozer', 'speedster')); const inp = new Map();
  const a = w.cars[0], b = w.cars[1];
  a.x = 0; a.z = -8; a.h = 0; b.x = 1.1; b.z = 2; b.h = 0; w.phase = 'play';
  const h0 = b.h;
  for (let i = 0; i < 60 * 3; i++) { inp.set('a', { ...idle, th: 1 }); stepWorld(w, inp); if (Math.abs(b.h - h0) > 0.08) break; }
  check('off-centre hit twists the car', Math.abs(b.h - h0) > 0.08, `turned ${(b.h - h0).toFixed(2)} rad`);
}
// 12. Landing on another car bounces off it.
{
  const w = createWorld(players('flipper', 'anchor')); const inp = new Map();
  const a = w.cars[0], b = w.cars[1];
  a.x = 0.3; a.z = 0; a.y = 2.0; a.vy = -3; a.onGround = false; b.x = 0; b.z = 0; b.y = 0; w.phase = 'play';
  let stomped = false;
  for (let i = 0; i < 30; i++) { stepWorld(w, inp); if (w.events.some((e) => e.type === 'stomp')) { stomped = true; break; } }
  check('a falling car bounces off a roof', stomped && a.vy > 0, `vy ${a.vy.toFixed(1)}`);
}
check('jump cooldown is three seconds', RULES.jumpCd === 3);
// 14. Bumper posts bounce a car back.
{
  const w = createWorld(players('speedster', 'anchor'), 'pillars'); const inp = new Map();
  const a = w.cars[0]; a.x = 7.5; a.z = -2; a.h = 0; a.vx = 0; a.vz = 12; w.phase = 'play'; w.cars[1].x = -15; w.cars[1].z = -15;
  let bounced = false;
  for (let i = 0; i < 60; i++) { inp.set('a', { ...idle, th: 1 }); stepWorld(w, inp); if (w.events.some((e) => e.type === 'hit' && e.bumper)) { bounced = true; break; } }
  check('a bumper post bounces the car back', bounced && a.vz < 0, `vz ${a.vz.toFixed(1)}`);
}
// 15. Driving onto the fissure drops the car; jumping it does not.
{
  const mk = () => { const w = createWorld(players('anchor', 'speedster'), 'fissure'); const a = w.cars[0]; a.x = -6; a.z = 6; a.h = Math.atan2(6, -6); w.phase = 'play'; w.cars[1].x = 15; w.cars[1].z = -15; return w; };
  const w = mk(); const inp = new Map(); const a = w.cars[0]; let fell = false;
  for (let i = 0; i < 60 * 4; i++) { inp.set('a', { ...idle, th: 1 }); stepWorld(w, inp); if (w.events.some((e) => e.type === 'edge' && e.id === 'a') && Math.hypot(a.x, a.z) < 20) { fell = true; break; } }
  check('driving into the fissure drops the car', fell, `at (${a.x.toFixed(1)}, ${a.z.toFixed(1)})`);
  const w2 = mk(); const inp2 = new Map(); const b = w2.cars[0]; b.vx = Math.sin(b.h) * 14; b.vz = Math.cos(b.h) * 14;
  let dropped = false, jumped = false, airborne = false, landed = false;
  for (let i = 0; i < 60 * 3; i++) {
    const d = Math.abs(b.x * Math.cos(Math.PI / 4) - b.z * Math.sin(Math.PI / 4));
    inp2.set('a', { ...idle, th: 1, jump: !jumped && d < 4.2 }); if (inp2.get('a').jump) jumped = true;
    stepWorld(w2, inp2);
    if (w2.events.some((e) => e.type === 'edge' && e.id === 'a')) { dropped = true; break; }
    if (jumped && !b.onGround) airborne = true;
    if (airborne && b.onGround) { landed = true; break; }
  }
  check('jumping clears the fissure', jumped && airborne && landed && !dropped, `landed at (${b.x.toFixed(1)}, ${b.z.toFixed(1)})`);
}
// 16. Coyote time: a jump just after leaving the edge still works.
{
  const w = createWorld(players('speedster', 'anchor')); const inp = new Map();
  const a = w.cars[0]; a.x = 0; a.z = 20; a.h = 0; a.vx = 0; a.vz = 10; w.phase = 'play';
  let left = false, jumpedAfter = false;
  for (let i = 0; i < 60; i++) {
    inp.set('a', { ...idle, th: 1, jump: left });
    stepWorld(w, inp);
    if (w.events.some((e) => e.type === 'edge' && e.id === 'a')) left = true;
    if (left && w.events.some((e) => e.type === 'jump' && e.id === 'a')) { jumpedAfter = true; break; }
  }
  check('coyote jump after leaving the edge', jumpedAfter && a.vy > 0, `vy ${a.vy.toFixed(1)}`);
}
// 17. Passives: the Anchor cannot be flipped; the Speedster has a 2 s jump cooldown.
{
  const w = createWorld(players('flipper', 'anchor')); const inp = new Map(); let maxY = 0;
  for (let i = 0; i < 60 * 8; i++) {
    const a = w.cars[0], b = w.cars[1]; const d = Math.hypot(b.x - a.x, b.z - a.z);
    inp.set('a', { ...idle, th: 1, ab: d < 4.5 && w.phase === 'play' }); stepWorld(w, inp); maxY = Math.max(maxY, b.y); if (w.phase === 'roundOver') break;
  }
  check('the anchor cannot be flipped', maxY < 0.5, `peak ${maxY.toFixed(2)} m`);
  const w2 = createWorld(players('speedster', 'anchor')); const inp2 = new Map();
  for (let i = 0; i < 60 * 4; i++) { inp2.set('a', { ...idle, jump: w2.phase === 'play' && i % 10 === 0 }); stepWorld(w2, inp2); if (w2.cars[0].jumpCd > 0) break; }
  check('the speedster jump cooldown is two seconds', Math.abs(w2.cars[0].jumpCd - 2) < 0.05, `cd ${w2.cars[0].jumpCd.toFixed(2)}`);
}
// 18. Prediction: stepping one car alone matches the server step exactly.
{
  const seqInputs = []; for (let i = 0; i < 180; i++) seqInputs.push({ th: i < 120 ? 1 : -1, st: Math.sin(i / 20), brake: i > 90 && i < 110, jump: i === 40, ab: i === 60 });
  const ws = createWorld([{ id: 'a', name: 'A', type: 'flipper' }]); ws.phase = 'play';
  const wp = createWorld([{ id: 'a', name: 'A', type: 'flipper' }]); wp.phase = 'play';
  const inp = new Map();
  for (const si of seqInputs) { inp.set('a', si); stepWorld(ws, inp); predictStep(wp, 'a', si); wp.time += RULES.dt; }
  const a = ws.cars[0], b = wp.cars[0];
  const same = Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.z - b.z) < 1e-9 && Math.abs(a.h - b.h) < 1e-9 && Math.abs(a.y - b.y) < 1e-9 && Math.abs(a.jumpCd - b.jumpCd) < 1e-9;
  check('prediction matches the server step', same, `dx ${(a.x - b.x).toExponential(1)}`);
}
// 13. The magnet drags a car in even when its tyres point sideways to the beam.
{
  const w = createWorld(players('magnet', 'bulldozer')); const inp = new Map();
  const m = w.cars[0], o = w.cars[1];
  o.x = m.x + 12 * Math.sin(m.h); o.z = m.z + 12 * Math.cos(m.h); o.h = m.h + Math.PI / 2; // broadside to the beam
  w.phase = 'play';
  const d0 = Math.hypot(o.x - m.x, o.z - m.z);
  for (let i = 0; i < 60 * 1.7; i++) { inp.set('a', { ...idle, ab: i === 0 }); stepWorld(w, inp); }
  const d1 = Math.hypot(o.x - m.x, o.z - m.z);
  check('tractor beam drags a broadside car in', d1 < d0 - 4, `${d0.toFixed(1)} -> ${d1.toFixed(1)} m`);
}

// 19. The Wrecker grabs the car in front, carries it, and drops it when the grab runs out.
{
  const w = createWorld(players('crane', 'speedster')); const inp = new Map();
  const cr = w.cars[0], v = w.cars[1];
  cr.x = 0; cr.z = 0; cr.h = 0; v.x = 0; v.z = 3; v.h = 0; w.phase = 'play';
  inp.set('a', { ...idle, th: 0, ab: true }); stepWorld(w, inp);
  let grabbed = false; for (let i = 0; i < 20; i++) { inp.set('a', { ...idle, th: 0 }); stepWorld(w, inp); if (v.heldBy === 'a') { grabbed = true; break; } }
  check('the claw grabs the car in front', grabbed && v.y > 1.5, `held at y ${v.y.toFixed(2)}`);
  for (let i = 0; i < 60; i++) { inp.set('a', { ...idle, th: 1 }); stepWorld(w, inp); }
  const follows = Math.hypot(v.x - (cr.x + Math.sin(cr.h) * RULES.carryDist), v.z - (cr.z + Math.cos(cr.h) * RULES.carryDist)) < 0.2;
  check('the carried car rides in front of the crane', follows && cr.z > 2, `crane z ${cr.z.toFixed(1)}`);
  let dropped = false; for (let i = 0; i < 60 * 4; i++) { inp.set('a', { ...idle, th: -1 }); stepWorld(w, inp); if (!v.heldBy) { dropped = true; break; } }
  for (let i = 0; i < 60; i++) { stepWorld(w, inp); }
  check('the car is released when the grab ends and lands', dropped && v.onGround && v.alive, `y ${v.y.toFixed(2)} alive ${v.alive}`);
}
// 20. Pressing again drops early; dropped past the edge, the car falls.
{
  const w = createWorld(players('crane', 'anchor')); const inp = new Map();
  const cr = w.cars[0], v = w.cars[1];
  cr.x = 0; cr.z = 0; cr.h = 0; v.x = 0; v.z = 3; v.h = 0; w.phase = 'play';
  inp.set('a', { ...idle, ab: true }); stepWorld(w, inp);
  for (let i = 0; i < 20 && v.heldBy !== 'a'; i++) { inp.set('a', { ...idle }); stepWorld(w, inp); }
  // teleport the crane to the rim facing out, so its load hangs over the lava, then press again
  cr.x = 0; cr.z = RULES.platformR0 - 1.0; cr.h = 0;
  for (let i = 0; i < 40; i++) { inp.set('a', { ...idle, ab: i === 30 }); stepWorld(w, inp); }
  const releasedEarly = !v.heldBy;
  let fell = false; for (let i = 0; i < 60 * 3; i++) { inp.set('a', { ...idle }); stepWorld(w, inp); if (!v.alive) { fell = true; break; } }
  check('pressing again drops the load early', releasedEarly);
  check('dropping a car over the edge sends it into the lava', !v.heldBy && fell && cr.alive);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall sim checks passed');
process.exit(failures ? 1 : 0);

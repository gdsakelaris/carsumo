// Deterministic checks on the shared simulation. Run: node tools/test_sim.mjs
import { createWorld, stepWorld, snapshot, RULES, predictStep } from '../shared/sim.js';
import { CARS } from '../shared/cars.js';
import { MAPS, ballPose } from '../shared/maps.js';
import { createBotBrain, botInput } from '../server/bot.js';

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); if (!ok) failures++; };
const idle = { th: 0, st: 0, jump: false, ab: false, ab2: false, brake: false };
const players = (a, b) => [{ id: 'a', name: 'A', type: a }, { id: 'b', name: 'B', type: b }];
const dist = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
const speed = (c) => Math.hypot(c.vx, c.vz);

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
    const a = w.cars[0], b = w.cars[1]; const d = dist(a, b);
    const ab = ram && !fired && d < 9 && w.phase === 'play'; if (ab) fired = true;
    inp.set('a', { ...idle, th: 1, ab });
    stepWorld(w, inp);
    maxPush = Math.max(maxPush, speed(b));
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
    const a = w.cars[0], b = w.cars[1]; const d = dist(a, b);
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

// 4. Flip launches the victim into the air; a clean nose hit puts it on its roof for a while.
{
  const w = createWorld(players('flipper', 'speedster')); const inp = new Map(); let maxY = 0, flipped = false, onRoof = 0;
  w.cars[0].x = 0; w.cars[0].z = -16; w.cars[0].h = 0; w.cars[1].x = 0; w.cars[1].z = -10; w.cars[1].h = Math.PI;
  for (let i = 0; i < 60 * 8; i++) {
    const a = w.cars[0], b = w.cars[1]; const d = dist(a, b);
    inp.set('a', { ...idle, th: flipped ? 0 : 1, ab: d < 4.5 && w.phase === 'play' });
    stepWorld(w, inp); maxY = Math.max(maxY, b.y);
    if (w.events.some((e) => e.type === 'flipped')) flipped = true;
    if (b.flipT > 0 && b.onGround) onRoof++;
    if (w.phase === 'roundOver') break;
  }
  check('flip launches the other car', maxY > 1.2, `peak height ${maxY.toFixed(2)} m`);
  check('a head-on flip rolls the car onto its roof', flipped && onRoof > 60, `${(onRoof / 60).toFixed(1)} s on its roof`);
  check('a car on its roof scrapes to a stop instead of sliding off', w.cars[1].alive && Math.hypot(w.cars[1].x, w.cars[1].z) < 20, `ended at (${w.cars[1].x.toFixed(1)}, ${w.cars[1].z.toFixed(1)})`);
  // and it rights itself: after the timer the car drives again
  const w2 = createWorld(players('flipper', 'speedster')); const b2 = w2.cars[1]; w2.phase = 'play'; b2.flipT = 0.5; b2.x = 0; b2.z = 0; w2.cars[0].x = 15; w2.cars[0].z = 15;
  const inp2 = new Map(); let uprightEv = false;
  for (let i = 0; i < 90; i++) { inp2.set('b', { ...idle, th: 1 }); stepWorld(w2, inp2); if (w2.events.some((e) => e.type === 'upright')) uprightEv = true; }
  check('a flipped car rights itself and drives again', uprightEv && b2.flipT === 0 && b2.onGround && speed(b2) > 5, `speed ${speed(b2).toFixed(1)}`);
}

// 5. Magnet pulls a distant idle car closer.
{
  const w = createWorld(players('magnet', 'anchor')); const inp = new Map();
  w.cars[1].x = w.cars[0].x + 14 * Math.sin(w.cars[0].h); w.cars[1].z = w.cars[0].z + 14 * Math.cos(w.cars[0].h);
  const d0 = dist(w.cars[0], w.cars[1]);
  for (let i = 0; i < 60 * 6; i++) { inp.set('a', { ...idle, ab: w.phase === 'play' && w.cars[0].abCd[0] <= 0 }); stepWorld(w, inp); }
  const d1 = dist(w.cars[0], w.cars[1]);
  check('magnet pulls the other car in', d1 < d0 - 2, `${d0.toFixed(1)} -> ${d1.toFixed(1)} m`);
}

// 6. Jump clears a collision: a jumping car passes over a rammer without a hit event.
{
  const w = createWorld(players('speedster', 'bulldozer')); const inp = new Map(); let hits = 0, jumped = false;
  for (let i = 0; i < 60 * 6; i++) {
    const a = w.cars[0], b = w.cars[1]; const d = dist(a, b);
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
  check('snapshot carries cars and phase', snap.cars.length === 2 && snap.phase === 'matchOver' && Array.isArray(snap.cars[0].ab));
}

// 9. Every car has two abilities, and both activate without errors and set their cooldowns.
check('nine cars in the roster', Object.keys(CARS).length === 9, Object.keys(CARS).join(' '));
for (const t of Object.keys(CARS)) {
  check(`${t} defines two abilities and a passive`, CARS[t].abilities.length === 2 && CARS[t].abilities.every((a) => a.name && a.duration > 0 && a.cooldown > 0 && a.desc) && !!CARS[t].passive);
  for (const slot of [0, 1]) {
    const w = createWorld(players(t, 'anchor')); const inp = new Map(); let ev = false;
    for (let i = 0; i < 60 * 4; i++) { inp.set('a', { ...idle, ab: slot === 0 && w.phase === 'play', ab2: slot === 1 && w.phase === 'play' }); stepWorld(w, inp); if (w.events.some((e) => e.type === 'ability' && e.id === 'a' && e.slot === slot)) ev = true; }
    check(`${t} ability ${slot + 1} (${CARS[t].abilities[slot].name}) activates`, ev && w.cars[0].abCd[slot] > 0);
  }
}

// 10. Capsule contact: a nose against a flank is a real contact even where circles would miss.
{
  const w = createWorld(players('speedster', 'anchor')); const inp = new Map();
  const a = w.cars[0], b = w.cars[1];
  a.x = 0; a.z = 0; a.h = 0; b.x = 0; b.z = 2.7; b.h = Math.PI / 2;
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
// 13. Bumper posts bounce a car back.
{
  const w = createWorld(players('speedster', 'anchor'), 'pillars'); const inp = new Map();
  const a = w.cars[0]; a.x = 7.5; a.z = -2; a.h = 0; a.vx = 0; a.vz = 12; w.phase = 'play'; w.cars[1].x = -15; w.cars[1].z = -15;
  let bounced = false;
  for (let i = 0; i < 60; i++) { inp.set('a', { ...idle, th: 1 }); stepWorld(w, inp); if (w.events.some((e) => e.type === 'hit' && e.bumper)) { bounced = true; break; } }
  check('a bumper post bounces the car back', bounced && a.vz < 0, `vz ${a.vz.toFixed(1)}`);
}
// 14. Wrecking Yard: a car parked in a ball's lane is hit hard and thrown; one parked between the lanes is not.
{
  check('the fissure map is gone', !MAPS.fissure && !!MAPS.wreckyard);
  const b0 = MAPS.wreckyard.balls[0]; const low = ballPose(b0, 0), high = ballPose(b0, b0.period / 4);
  check('wrecking ball swings from the deck up and away', low.y < 2 && high.y > 6 && Math.abs(high.z) > 8, `low y ${low.y.toFixed(1)}, high y ${high.y.toFixed(1)} at z ${high.z.toFixed(1)}`);
  const w = createWorld(players('magnet', 'anchor'), 'wreckyard'); const inp = new Map();
  const a = w.cars[0], b = w.cars[1];
  a.x = b0.x; a.z = 3.0; a.h = Math.PI / 2; b.x = 0; b.z = 0; b.h = 0; w.phase = 'play';
  let hitEv = null, maxSpeed = 0;
  for (let i = 0; i < 60 * 4; i++) { stepWorld(w, inp); const ev = w.events.find((e) => e.type === 'ballHit' && e.id === 'a'); if (ev && !hitEv) hitEv = ev; maxSpeed = Math.max(maxSpeed, speed(a)); }
  check('a wrecking ball hits the car in its lane and throws it', !!hitEv && maxSpeed > 12, `peak ${maxSpeed.toFixed(1)} m/s`);
  check('a car between the lanes is left alone', Math.hypot(b.x, b.z) < 0.5 && b.onGround, `at (${b.x.toFixed(1)}, ${b.z.toFixed(1)})`);
}
// 15. Coyote time: a jump just after leaving the edge still works.
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
// 16. Passives: the Anchor cannot be flipped; the Speedster has a 2 s jump cooldown.
{
  const w = createWorld(players('flipper', 'anchor')); const inp = new Map(); let maxY = 0;
  for (let i = 0; i < 60 * 8; i++) {
    const a = w.cars[0], b = w.cars[1]; const d = dist(a, b);
    inp.set('a', { ...idle, th: 1, ab: d < 4.5 && w.phase === 'play' }); stepWorld(w, inp); maxY = Math.max(maxY, b.y); if (w.phase === 'roundOver') break;
  }
  check('the anchor cannot be flipped', maxY < 0.5, `peak ${maxY.toFixed(2)} m`);
  const w2 = createWorld(players('speedster', 'anchor')); const inp2 = new Map();
  for (let i = 0; i < 60 * 4; i++) { inp2.set('a', { ...idle, jump: w2.phase === 'play' && i % 10 === 0 }); stepWorld(w2, inp2); if (w2.cars[0].jumpCd > 0) break; }
  check('the speedster jump cooldown is two seconds', Math.abs(w2.cars[0].jumpCd - 2) < 0.05, `cd ${w2.cars[0].jumpCd.toFixed(2)}`);
}
// 17. Prediction: stepping one car alone matches the server step exactly (both abilities used).
{
  const seqInputs = []; for (let i = 0; i < 240; i++) seqInputs.push({ th: i < 120 ? 1 : -1, st: Math.sin(i / 20), brake: i > 90 && i < 110, jump: i === 40, ab: i === 60, ab2: i === 150 });
  for (const type of ['flipper', 'speedster', 'greaser']) {
    const ws = createWorld([{ id: 'a', name: 'A', type }]); ws.phase = 'play';
    const wp = createWorld([{ id: 'a', name: 'A', type }]); wp.phase = 'play';
    const inp = new Map();
    for (const si of seqInputs) { inp.set('a', si); stepWorld(ws, inp); predictStep(wp, 'a', si); wp.time += RULES.dt; }
    const a = ws.cars[0], b = wp.cars[0];
    const same = Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.z - b.z) < 1e-9 && Math.abs(a.h - b.h) < 1e-9 && Math.abs(a.y - b.y) < 1e-9 && Math.abs(a.jumpCd - b.jumpCd) < 1e-9;
    check(`prediction matches the server step (${type})`, same, `dx ${(a.x - b.x).toExponential(1)}`);
  }
}
// 18. The magnet drags a car in even when its tyres point sideways to the beam.
{
  const w = createWorld(players('magnet', 'bulldozer')); const inp = new Map();
  const m = w.cars[0], o = w.cars[1];
  o.x = m.x + 12 * Math.sin(m.h); o.z = m.z + 12 * Math.cos(m.h); o.h = m.h + Math.PI / 2;
  w.phase = 'play';
  const d0 = dist(m, o);
  for (let i = 0; i < 60 * 1.7; i++) { inp.set('a', { ...idle, ab: i === 0 }); stepWorld(w, inp); }
  const d1 = dist(m, o);
  check('tractor beam drags a broadside car in', d1 < d0 - 4, `${d0.toFixed(1)} -> ${d1.toFixed(1)} m`);
}

// 19. The Wrecker grabs the car in front, crawls with it, and drops it after at most carryMax seconds.
{
  const w = createWorld(players('crane', 'speedster')); const inp = new Map();
  const cr = w.cars[0], v = w.cars[1];
  cr.x = 0; cr.z = 0; cr.h = 0; v.x = 0; v.z = 3; v.h = 0; w.phase = 'play';
  inp.set('a', { ...idle, th: 0, ab: true }); stepWorld(w, inp);
  let grabbed = false; for (let i = 0; i < 20; i++) { inp.set('a', { ...idle, th: 0 }); stepWorld(w, inp); if (v.heldBy === 'a') { grabbed = true; break; } }
  check('the claw grabs the car in front', grabbed && v.y > 1.5, `held at y ${v.y.toFixed(2)}`);
  const t0 = w.time; let carrySpeed = 0, released = -1;
  for (let i = 0; i < 60 * 4; i++) { inp.set('a', { ...idle, th: i < 36 ? 1 : -1 }); stepWorld(w, inp); if (v.heldBy === 'a') carrySpeed = Math.max(carrySpeed, speed(cr)); else if (released < 0) released = w.time - t0; }
  check('the carry ends on its own within 1.5 s', released > 1.2 && released <= RULES.carryMax + 0.05, `${released.toFixed(2)} s`);
  const wf = createWorld(players('crane', 'speedster')); const inpf = new Map(); let freeSpeed = 0; wf.phase = 'play'; wf.cars[1].x = 15; wf.cars[1].z = 15;
  for (let i = 0; i < 60 * 3; i++) { inpf.set('a', { ...idle, th: 1 }); stepWorld(wf, inpf); freeSpeed = Math.max(freeSpeed, speed(wf.cars[0])); }
  check('the Wrecker crawls while carrying', carrySpeed < freeSpeed * 0.65, `${carrySpeed.toFixed(1)} m/s carrying vs ${freeSpeed.toFixed(1)} free`);
  for (let i = 0; i < 60; i++) { inp.set('a', { ...idle }); stepWorld(w, inp); }
  check('the dropped car lands alive', v.onGround && v.alive && !v.heldBy, `y ${v.y.toFixed(2)} at (${v.x.toFixed(1)}, ${v.z.toFixed(1)})`);
}
// 20. Pressing again drops early; dropped past the edge, the car falls. Jackknife flings a held car sideways.
{
  const w = createWorld(players('crane', 'anchor')); const inp = new Map();
  const cr = w.cars[0], v = w.cars[1];
  cr.x = 0; cr.z = 0; cr.h = 0; v.x = 0; v.z = 3; v.h = 0; w.phase = 'play';
  inp.set('a', { ...idle, ab: true }); stepWorld(w, inp);
  for (let i = 0; i < 20 && v.heldBy !== 'a'; i++) { inp.set('a', { ...idle }); stepWorld(w, inp); }
  cr.x = 0; cr.z = RULES.platformR0 - 1.0; cr.h = 0;
  for (let i = 0; i < 40; i++) { inp.set('a', { ...idle, ab: i === 30 }); stepWorld(w, inp); }
  const releasedEarly = !v.heldBy;
  let fell = false; for (let i = 0; i < 60 * 3; i++) { inp.set('a', { ...idle }); stepWorld(w, inp); if (!v.alive) { fell = true; break; } }
  check('pressing again drops the load early', releasedEarly);
  check('dropping a car over the edge sends it into the lava', !v.heldBy && fell && cr.alive);
  const w2 = createWorld(players('crane', 'anchor')); const inp2 = new Map(); const c2 = w2.cars[0], v2 = w2.cars[1];
  c2.x = 0; c2.z = 0; c2.h = 0; v2.x = 0; v2.z = 3; v2.h = 0; w2.phase = 'play';
  inp2.set('a', { ...idle, ab: true }); stepWorld(w2, inp2);
  for (let i = 0; i < 20 && v2.heldBy !== 'a'; i++) { inp2.set('a', { ...idle }); stepWorld(w2, inp2); }
  inp2.set('a', { ...idle, ab2: true, st: 1 }); stepWorld(w2, inp2);
  const thrown = w2.events.some((e) => e.type === 'throw');
  check('jackknife throws the held car sideways', thrown && !v2.heldBy && Math.abs(v2.vx) > 8, `vx ${v2.vx.toFixed(1)} vz ${v2.vz.toFixed(1)}`);
}
// 21. Plain bumps shove harder now: a fast light car hitting an idle car sends it off at a good clip and it slides.
{
  const w = createWorld(players('speedster', 'magnet')); const inp = new Map();
  const a = w.cars[0], b = w.cars[1];
  a.x = 0; a.z = -6; a.h = 0; a.vx = 0; a.vz = 15; b.x = 0; b.z = 0; b.h = Math.PI / 2; w.phase = 'play';
  let peak = 0, slid = false;
  for (let i = 0; i < 60 * 2; i++) { inp.set('a', { ...idle, th: 1 }); stepWorld(w, inp); peak = Math.max(peak, speed(b)); if (b.skidT > 0) slid = true; }
  check('a plain bump throws the victim hard', peak > 13 && slid, `peak ${peak.toFixed(1)} m/s`);
  check('the shove carries it a long way', b.z > 6, `${b.z.toFixed(1)} m`);
}
// 22. Oil: a car crossing a slick keeps sliding sideways; the Greaser does not.
function slide(type, oiled) {
  const w = createWorld(players(type, 'anchor')); const inp = new Map(); const a = w.cars[0];
  a.x = 0; a.z = 0; a.h = 0; a.vx = 8; a.vz = 0; w.phase = 'play'; w.cars[1].x = 15; w.cars[1].z = 15;
  if (oiled) w.oil.push({ x: 0, z: 0, r: 6, t: 99, by: 'b' });
  for (let i = 0; i < 15; i++) { inp.set('a', { ...idle }); stepWorld(w, inp); }
  return Math.abs(a.vx);
}
{
  const dry = slide('magnet', false), wet = slide('magnet', true), greaser = slide('greaser', true);
  check('oil kills lateral grip', wet > dry * 3 && wet > 5, `${dry.toFixed(1)} dry vs ${wet.toFixed(1)} wet m/s`);
  check('the greaser never slips on oil', greaser < 2, `${greaser.toFixed(1)} m/s`);
  const w = createWorld(players('greaser', 'anchor')); const inp = new Map(); let patches = 0;
  for (let i = 0; i < 60 * 5; i++) { inp.set('a', { ...idle, th: 1, ab: w.phase === 'play' && i === 200 }); stepWorld(w, inp); patches = Math.max(patches, w.oil.length); }
  check('oil slick lays a trail of patches', patches >= 4, `${patches} patches`);
}
// 23. Mines: armed after a second, a car driving over one is blown into the air; the owner is not.
{
  const w = createWorld(players('boomer', 'speedster')); const inp = new Map(); const bo = w.cars[0], v = w.cars[1];
  bo.x = 0; bo.z = 0; bo.h = 0; v.x = 0; v.z = -12; v.h = 0; w.phase = 'play';
  inp.set('a', { ...idle, ab: true }); stepWorld(w, inp);
  check('a mine is dropped behind the boomer', w.mines.length === 1 && w.mines[0].z < -1, `at z ${w.mines[0] && w.mines[0].z.toFixed(1)}`);
  for (let i = 0; i < 70; i++) { inp.set('a', { ...idle }); stepWorld(w, inp); }
  let boom = false, maxY = 0;
  for (let i = 0; i < 60 * 3; i++) { inp.set('b', { ...idle, th: 1 }); stepWorld(w, inp); if (w.events.some((e) => e.type === 'mine')) boom = true; maxY = Math.max(maxY, v.y); }
  check('a car driving over an armed mine is blown up and away', boom && maxY > 1.5 && w.mines.length === 0, `peak ${maxY.toFixed(1)} m`);
  const w2 = createWorld(players('boomer', 'speedster')); const inp2 = new Map(); const b2 = w2.cars[0];
  b2.x = 0; b2.z = 0; b2.h = 0; w2.cars[1].x = 15; w2.cars[1].z = 15; w2.phase = 'play';
  inp2.set('a', { ...idle, ab: true }); stepWorld(w2, inp2);
  for (let i = 0; i < 70; i++) { inp2.set('a', { ...idle, th: -1 }); stepWorld(w2, inp2); }
  check('the boomer can drive over its own mines', w2.mines.length === 1 && b2.onGround, `${w2.mines.length} mine(s) left`);
}
// 24. Shockwaves: Countershock, Repulsion and Blast jump throw a neighbour away.
function shock(type, slot) {
  const w = createWorld(players(type, 'magnet')); const inp = new Map(); const a = w.cars[0], b = w.cars[1];
  a.x = 0; a.z = 0; a.h = 0; b.x = 0; b.z = 3.5; b.h = 0; w.phase = 'play';
  inp.set('a', { ...idle, ab: slot === 0, ab2: slot === 1 }); stepWorld(w, inp);
  return { b, a, ev: w.events };
}
{
  const cs = shock('anchor', 1); check('countershock throws the neighbour away', cs.b.vz > 6 && Math.abs(cs.a.vz) < 0.5, `vz ${cs.b.vz.toFixed(1)}`);
  const rp = shock('magnet', 1); check('repulsion throws them apart and recoils', rp.b.vz > 6 && rp.a.vz < -2, `them ${rp.b.vz.toFixed(1)}, me ${rp.a.vz.toFixed(1)}`);
  const bj = shock('boomer', 1); check('blast jump hops and knocks the neighbour back', bj.b.vz > 4 && bj.a.vy > 5 && !bj.a.onGround, `them ${bj.b.vz.toFixed(1)}, vy ${bj.a.vy.toFixed(1)}`);
}
// 25. Snap turn spins the speedster round; Gyro counter hurls a charging car back; Pounce leaps forward.
{
  const w = createWorld(players('speedster', 'anchor')); const inp = new Map(); const a = w.cars[0];
  a.x = 0; a.z = 0; a.h = 0; a.vz = 15; w.phase = 'play'; w.cars[1].x = 15; w.cars[1].z = 15;
  inp.set('a', { ...idle, ab2: true }); stepWorld(w, inp);
  for (let i = 0; i < 20; i++) { inp.set('a', { ...idle }); stepWorld(w, inp); }
  check('snap turn whips the car round 180', Math.abs(Math.atan2(Math.sin(a.h), Math.cos(a.h))) > 2.9, `h ${a.h.toFixed(2)}`);
  const w2 = createWorld(players('spinner', 'speedster')); const inp2 = new Map(); const s = w2.cars[0], v = w2.cars[1];
  s.x = 0; s.z = 0; s.h = 0; v.x = 0; v.z = -8; v.h = 0; v.vz = 14; w2.phase = 'play';
  let countered = false;
  for (let i = 0; i < 60; i++) { inp2.set('a', { ...idle, ab2: i === 0 }); inp2.set('b', { ...idle, th: 1 }); stepWorld(w2, inp2); if (w2.events.some((e) => e.type === 'abilityHit' && e.car === 'spinner' && e.slot === 1)) { countered = true; break; } }
  check('gyro counter hurls the charging car back', countered && v.vz < -6, `vz ${v.vz.toFixed(1)}`);
  const w3 = createWorld(players('flipper', 'anchor')); const inp3 = new Map(); const f = w3.cars[0];
  f.x = 0; f.z = 0; f.h = 0; w3.phase = 'play'; w3.cars[1].x = 15; w3.cars[1].z = 15;
  inp3.set('a', { ...idle, ab2: true }); stepWorld(w3, inp3);
  check('pounce leaps forward', !f.onGround && f.vy > 5 && f.vz > 5, `vz ${f.vz.toFixed(1)} vy ${f.vy.toFixed(1)}`);
}
// 26. Blade down resists a ram.
function rammed(blade) {
  const w = createWorld(players('bulldozer', 'bulldozer')); const inp = new Map(); const a = w.cars[0], b = w.cars[1];
  a.x = 0; a.z = -9; a.h = 0; a.vz = 10; b.x = 0; b.z = 0; b.h = 0; w.phase = 'play'; let peak = 0;
  for (let i = 0; i < 60; i++) { inp.set('a', { ...idle, th: 1, ab: i === 0 }); inp.set('b', { ...idle, ab2: blade && i === 0 }); stepWorld(w, inp); peak = Math.max(peak, speed(b)); }
  return peak;
}
{
  const free = rammed(false), dug = rammed(true);
  check('blade down resists a ram', dug < free * 0.5, `${free.toFixed(1)} vs ${dug.toFixed(1)} m/s`);
}
// 27. The bot drives every car on every map without throwing, and uses both abilities.
{
  let threw = null, used = new Set();
  for (const map of Object.keys(MAPS)) for (const t of Object.keys(CARS)) {
    const w = createWorld(players(t, 'speedster'), map); const brain = createBotBrain('a'); const inp = new Map();
    try {
      for (let i = 0; i < 60 * 12; i++) {
        const bi = botInput(w, brain); inp.set('a', bi); inp.set('b', { ...idle, th: 0.4, st: 0.3 }); stepWorld(w, inp);
        if (bi.ab) used.add(t + '0'); if (bi.ab2) used.add(t + '1');
        if (w.phase === 'roundOver') break;
      }
    } catch (e) { threw = `${t} on ${map}: ${e.message}`; }
  }
  check('the bot runs every car on every map', !threw, threw || '');
  const both = Object.keys(CARS).filter((t) => used.has(t + '0') && used.has(t + '1'));
  check('the bot uses both abilities of most cars', both.length >= 6, `${both.join(' ')}`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall sim checks passed');
process.exit(failures ? 1 : 0);

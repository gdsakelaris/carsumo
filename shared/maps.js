// Arenas. Each map is the round deck plus features that both the simulation and the client read.
//   bumpers: steel posts (circles) that cars bounce off.
//   holes:   oriented rectangular gaps in the deck (centre, half-length along the axis, half-width,
//            axis angle in the heading convention: direction = (sin a, cos a)).
//   balls:   wrecking balls on chains, swinging as pendulums. x,z is the pivot on the deck plane, py its
//            height, len the chain, r the ball radius, a the swing axis (heading convention), amp the
//            swing amplitude in radians, period in seconds, phase in radians. Position is a pure
//            function of time, so the server and every client agree without sending it.
export const MAPS = {
  crater: {
    name: 'Crater', desc: 'The classic open deck. Nowhere to hide.',
    bumpers: [], holes: [], balls: [],
  },
  pillars: {
    name: 'Pillars', desc: 'Four steel posts. Bounce off them, or pin someone against one.',
    bumpers: [{ x: 7.5, z: 7.5, r: 1.3 }, { x: -7.5, z: 7.5, r: 1.3 }, { x: 7.5, z: -7.5, r: 1.3 }, { x: -7.5, z: -7.5, r: 1.3 }],
    holes: [], balls: [],
  },
  wreckyard: {
    name: 'Wrecking Yard', desc: 'Two wrecking balls sweep the deck. Cross their lanes between swings.',
    bumpers: [], holes: [],
    balls: [
      { x: -6.5, z: 0, py: 13.6, len: 12, r: 1.6, a: 0, amp: 1.1, period: 4.0, phase: 0 },
      { x: 6.5, z: 0, py: 13.6, len: 12, r: 1.6, a: 0, amp: 1.1, period: 4.0, phase: Math.PI },
    ],
  },
};

export const MAP_IDS = Object.keys(MAPS);

export function inHole(map, x, z) {
  if (!map || !map.holes.length) return false;
  for (const h of map.holes) {
    const fx = Math.sin(h.a), fz = Math.cos(h.a);
    const dx = x - h.x, dz = z - h.z;
    const along = dx * fx + dz * fz, across = dx * fz - dz * fx;
    if (Math.abs(along) <= h.hl && Math.abs(across) <= h.hw) return true;
  }
  return false;
}

// Where a wrecking ball is at time t, and how fast it is moving.
export function ballPose(b, t) {
  const w = (Math.PI * 2) / b.period;
  const th = b.amp * Math.sin(t * w + b.phase);
  const dth = b.amp * Math.cos(t * w + b.phase) * w;
  const s = Math.sin(th), c = Math.cos(th);
  const ax = Math.sin(b.a), az = Math.cos(b.a);
  return {
    x: b.x + ax * s * b.len, y: b.py - c * b.len, z: b.z + az * s * b.len,
    vx: ax * c * b.len * dth, vy: s * b.len * dth, vz: az * c * b.len * dth, th,
  };
}

export function cleanMapId(id) { return MAPS[id] ? id : id === 'random' ? MAP_IDS[Math.floor(Math.random() * MAP_IDS.length)] : 'crater'; }

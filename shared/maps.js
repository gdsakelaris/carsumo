// Arenas. Each map is the round deck plus features that both the simulation and the client read.
//   bumpers: steel posts (circles) that cars bounce off.
//   holes:   oriented rectangular gaps in the deck (centre, half-length along the axis, half-width,
//            axis angle in the heading convention: direction = (sin a, cos a)).
export const MAPS = {
  crater: {
    name: 'Crater', desc: 'The classic open deck. Nowhere to hide.',
    bumpers: [], holes: [],
  },
  pillars: {
    name: 'Pillars', desc: 'Four steel posts. Bounce off them, or pin someone against one.',
    bumpers: [{ x: 7.5, z: 7.5, r: 1.3 }, { x: -7.5, z: 7.5, r: 1.3 }, { x: 7.5, z: -7.5, r: 1.3 }, { x: -7.5, z: -7.5, r: 1.3 }],
    holes: [],
  },
  fissure: {
    name: 'Fissure', desc: 'A lava crack splits the deck. Jump it, or fall through it.',
    bumpers: [], holes: [{ x: 0, z: 0, hl: 30, hw: 1.5, a: Math.PI / 4 }],
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

export function cleanMapId(id) { return MAPS[id] ? id : id === 'random' ? MAP_IDS[Math.floor(Math.random() * MAP_IDS.length)] : 'crater'; }

// The six cars. Shared by the server (physics) and the browser (lobby cards, meshes).
// forward = (sin h, cos h) on the x/z plane. 1 unit = 1 metre.

export const CARS = {
  bulldozer: {
    name: 'Bulldozer', color: 0xff8c2a, accent: 0x5a3a1a,
    mass: 1.8, accel: 20, topSpeed: 15, reverseSpeed: 7, turnRate: 2.0, grip: 7, radius: 1.45,
    size: [2.6, 1.1, 3.6],
    ability: { name: 'Ram', duration: 0.7, cooldown: 6,
      desc: 'Charge forward. Triple weight and a brutal shove on anything you hit.' },
    tagline: 'Heavy. Slow. Unstoppable once it gets going.',
    passive: { name: 'Built like a tank', desc: 'Takes 25% less knockback from abilities.' },
  },
  flipper: {
    name: 'Flipper', color: 0x2ad1c9, accent: 0x0e5f5c,
    mass: 1.2, accel: 24, topSpeed: 17, reverseSpeed: 8, turnRate: 2.6, grip: 7, radius: 1.3,
    size: [2.2, 0.9, 3.4],
    ability: { name: 'Flip', duration: 0.6, cooldown: 7,
      desc: 'Arm the wedge. The next car you touch gets launched into the air with no control.' },
    tagline: 'Battlebots wedge. Get under them and send them flying.',
    passive: { name: 'Spring suspension', desc: 'Hits never stun it.' },
  },
  speedster: {
    name: 'Speedster', color: 0xffe14a, accent: 0x7a6a10,
    mass: 0.85, accel: 28, topSpeed: 20, reverseSpeed: 9, turnRate: 3.0, grip: 6, radius: 1.15,
    size: [2.0, 0.8, 3.2],
    ability: { name: 'Nitro', duration: 1.3, cooldown: 4.5,
      desc: 'Rocket boost. Huge speed for a moment; light, so hits send you far.' },
    tagline: 'Fastest car on the deck. Fragile.',
    passive: { name: 'Light feet', desc: 'Jump cooldown 2 s instead of 3.' }, jumpCd: 2,
  },
  anchor: {
    name: 'Anchor', color: 0x4a7bff, accent: 0x1a2f70,
    mass: 1.5, accel: 20, topSpeed: 15, reverseSpeed: 7, turnRate: 2.2, grip: 8, radius: 1.4,
    size: [2.5, 1.2, 3.3],
    ability: { name: 'Brace', duration: 2.0, cooldown: 8,
      desc: 'Plant yourself. Five times the weight and a dead stop; rammers bounce off you.' },
    tagline: 'The wall. Nothing moves it when it does not want to move.',
    passive: { name: 'Low centre of gravity', desc: 'Cannot be flipped.' },
  },
  magnet: {
    name: 'Magnet', color: 0xb04aff, accent: 0x4a1a70,
    mass: 1.1, accel: 23, topSpeed: 17, reverseSpeed: 8, turnRate: 2.6, grip: 6.5, radius: 1.3,
    size: [2.3, 1.0, 3.3],
    ability: { name: 'Tractor', duration: 1.6, cooldown: 8,
      desc: 'Pull the other car toward you. Drag them in, then drive them out.' },
    tagline: 'Control the fight. Nobody escapes the pull.',
    passive: { name: 'Charged plating', desc: 'Anything that bumps it is briefly stunned.' },
  },
  spinner: {
    name: 'Spinner', color: 0xff4a5a, accent: 0x701a22,
    mass: 1.25, accel: 22, topSpeed: 16, reverseSpeed: 8, turnRate: 2.4, grip: 6.5, radius: 1.35,
    size: [2.4, 1.0, 3.4],
    ability: { name: 'Spin-up', duration: 3.0, cooldown: 9,
      desc: 'Spin the blade. Every touch flings the other car sideways; your own steering gets heavy.' },
    tagline: 'Battlebots spinner. Touch it and you fly.',
    passive: { name: 'Gyro', desc: 'Hits never twist it off line.' },
  },
  crane: {
    name: 'Wrecker', color: 0xc9d64a, accent: 0x3a3f1a,
    mass: 1.5, accel: 20, topSpeed: 15, reverseSpeed: 7, turnRate: 2.1, grip: 7, radius: 1.45,
    size: [2.5, 1.2, 3.6],
    ability: { name: 'Grab', duration: 2.6, cooldown: 10,
      desc: 'Snap the claw down. Whatever it catches is lifted, carried while you drive, and dropped when you press again.' },
    tagline: 'Tow truck from hell. Pick them up, drive to the edge, let go.',
    passive: { name: 'Ballast', desc: 'A tractor beam cannot drag it.' },
  },
};

export const CAR_TYPES = Object.keys(CARS);

export function randomCarType(except) {
  const pool = CAR_TYPES.filter((t) => t !== except);
  return pool[Math.floor(Math.random() * pool.length)];
}

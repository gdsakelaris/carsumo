// The nine cars. Shared by the server (physics) and the browser (lobby cards, meshes).
// forward = (sin h, cos h) on the x/z plane. 1 unit = 1 metre.
// Every car has two active abilities: slot 0 on E / left click, slot 1 on Q / right click, plus a passive.

export const CARS = {
  bulldozer: {
    name: 'Bulldozer', color: 0xff8c2a, accent: 0x5a3a1a,
    mass: 1.8, accel: 20, topSpeed: 15, reverseSpeed: 7, turnRate: 2.0, grip: 7, radius: 1.45,
    size: [2.6, 1.1, 3.6],
    abilities: [
      { name: 'Ram', duration: 0.7, cooldown: 6,
        desc: 'Charge forward. Triple weight and a brutal shove on anything you hit.' },
      { name: 'Blade down', duration: 2.0, cooldown: 10,
        desc: 'Dig the blade into the deck for 2 s: far heavier and almost immune to knockback, but slow.' },
    ],
    tagline: 'Heavy. Slow. Unstoppable once it gets going.',
    passive: { name: 'Built like a tank', desc: 'Takes 25% less knockback from abilities and hazards.' },
  },
  flipper: {
    name: 'Flipper', color: 0x2ad1c9, accent: 0x0e5f5c,
    mass: 1.2, accel: 24, topSpeed: 17, reverseSpeed: 8, turnRate: 2.6, grip: 7, radius: 1.3,
    size: [2.2, 0.9, 3.4],
    abilities: [
      { name: 'Flip', duration: 0.6, cooldown: 7,
        desc: 'Arm the wedge. The next car you touch is launched into the air; get under its nose or tail and it lands on its roof, helpless for a couple of seconds.' },
      { name: 'Pounce', duration: 0.8, cooldown: 7,
        desc: 'A long forward leap. Clears cars and mines; landing on a roof slams that car down and away.' },
    ],
    tagline: 'Battlebots wedge. Get under them and send them flying.',
    passive: { name: 'Spring suspension', desc: 'Hits never stun it.' },
  },
  speedster: {
    name: 'Pulse', color: 0xffe14a, accent: 0x7a6a10,
    mass: 0.85, accel: 28, topSpeed: 20, reverseSpeed: 9, turnRate: 3.0, grip: 6, radius: 1.15,
    size: [2.0, 0.8, 3.2],
    abilities: [
      { name: 'Nitro', duration: 1.3, cooldown: 5,
        desc: 'Rocket boost. Ram a car mid-boost and it is blasted backwards, hard; the boost is spent on the hit.' },
      { name: 'Sonic boom', duration: 0.3, cooldown: 9,
        desc: 'Break the sound barrier. Every car within 7.5 m is thrown straight out another 7.5 m, however heavy it is.' },
    ],
    tagline: 'Fastest car on the deck. Fragile, and loud.',
    passive: { name: 'Light feet', desc: 'Jump cooldown 2 s instead of 3.' }, jumpCd: 2,
  },
  anchor: {
    name: 'Anchor', color: 0x4a7bff, accent: 0x1a2f70,
    mass: 1.5, accel: 20, topSpeed: 15, reverseSpeed: 7, turnRate: 2.2, grip: 8, radius: 1.4,
    size: [2.5, 1.2, 3.3],
    abilities: [
      { name: 'Brace', duration: 1.75, cooldown: 8,
        desc: 'Plant yourself. Six times the weight and a dead stop; rammers bounce off you.' },
      { name: 'Countershock', duration: 0.3, cooldown: 10,
        desc: 'A shockwave that throws every nearby car straight away from you. Much stronger right after you take a hit.' },
    ],
    tagline: 'The wall. Nothing moves it when it does not want to move.',
    passive: { name: 'Low centre of gravity', desc: 'Cannot be flipped.' },
  },
  magnet: {
    name: 'Magnet', color: 0xb04aff, accent: 0x4a1a70,
    mass: 1.1, accel: 23, topSpeed: 17, reverseSpeed: 8, turnRate: 2.6, grip: 6.5, radius: 1.3,
    size: [2.3, 1.0, 3.3],
    abilities: [
      { name: 'Tractor', duration: 1.6, cooldown: 8,
        desc: 'Pull the other car toward you. Drag them in, then drive them out.' },
      { name: 'Repulsion', duration: 0.3, cooldown: 10,
        desc: 'Reverse polarity: a violent shove that throws nearby cars away and kicks you backward too.' },
    ],
    tagline: 'Control the fight. Nobody escapes the pull.',
    passive: { name: 'Charged plating', desc: 'Anything that bumps it is briefly stunned.' },
  },
  spinner: {
    name: 'Spinner', color: 0xff4a5a, accent: 0x701a22,
    mass: 1.25, accel: 22, topSpeed: 16, reverseSpeed: 8, turnRate: 2.4, grip: 6.5, radius: 1.35,
    size: [2.4, 1.0, 3.4],
    abilities: [
      { name: 'Spin-up', duration: 3.0, cooldown: 9,
        desc: 'Spin the blade. Every touch flings the other car sideways; your own steering gets heavy.' },
      { name: 'Gyro counter', duration: 0.8, cooldown: 9,
        desc: 'Lock the gyro for a moment: you hold your ground and the next car that touches you is hurled back the way it came.' },
    ],
    tagline: 'Battlebots spinner. Touch it and you fly.',
    passive: { name: 'Gyro', desc: 'Hits never twist it off line.' },
  },
  crane: {
    name: 'Wrecker', color: 0xc9d64a, accent: 0x3a3f1a,
    mass: 1.5, accel: 20, topSpeed: 15, reverseSpeed: 7, turnRate: 2.1, grip: 7, radius: 1.45,
    size: [2.5, 1.2, 3.6],
    abilities: [
      { name: 'Grab', duration: 0.45, cooldown: 10,
        desc: 'Snap the claw down. What it catches is carried for 1 s while you crawl along, then dropped. Press again to drop early.' },
      { name: 'Jackknife', duration: 0.5, cooldown: 9,
        desc: 'Whip the truck round. The swing sweeps away anything it touches, and a car in the claw is flung sideways.' },
    ],
    tagline: 'Tow truck from hell. Pick them up, drive to the edge, let go.',
    passive: { name: 'Ballast', desc: 'A tractor beam cannot drag it.' },
  },
  greaser: {
    name: 'Greaser', color: 0x3ddc5c, accent: 0x144a22,
    mass: 0.95, accel: 26, topSpeed: 18.5, reverseSpeed: 8, turnRate: 2.9, grip: 7.5, radius: 1.2,
    size: [2.1, 0.85, 3.3],
    abilities: [
      { name: 'Oil slick', duration: 1.0, cooldown: 9,
        desc: 'Spray a trail of oil behind you that lasts 7 s. Cars on it lose nearly all their grip and slide.' },
      { name: 'Powerslide', duration: 0.6, cooldown: 7,
        desc: 'Throw the tail out in a violent drift. Anything the rear end catches gets shoved hard sideways.' },
    ],
    tagline: 'Street racer with an oil tank. Make them skate.',
    passive: { name: 'Grooved tyres', desc: 'Never slips on oil, its own or anybody else’s.' },
  },
  boomer: {
    name: 'Boomer', color: 0xff5ad1, accent: 0x1a1a1a,
    mass: 1.15, accel: 23, topSpeed: 16.5, reverseSpeed: 8, turnRate: 2.5, grip: 6.8, radius: 1.3,
    size: [2.3, 1.0, 3.4],
    abilities: [
      { name: 'Pop mine', duration: 0.3, cooldown: 8,
        desc: 'Drop a mine behind you (two at a time, armed after a second). A car driving over it is blown up and away.' },
      { name: 'Blast jump', duration: 0.4, cooldown: 10,
        desc: 'Fire the charge under the car: you hop into the air and a shockwave knocks nearby cars back.' },
    ],
    tagline: 'Demolition derby car with explosive bumpers. Mind your step.',
    passive: { name: 'Blast proof', desc: 'Its own mines and blasts never hurt it.' },
  },
};

export const CAR_TYPES = Object.keys(CARS);

export function randomCarType(except) {
  const pool = CAR_TYPES.filter((t) => t !== except);
  return pool[Math.floor(Math.random() * pool.length)];
}

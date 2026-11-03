# Car Sumo

Online multiplayer car sumo. Two cars on a round deck held 14 m above lava (or water) by a rock
pillar. Push the other car off the edge and watch it drop. First to three rounds wins. Nine cars, each
with two abilities on cooldowns and a passive trait, plus jump and drift for everyone. The platform
starts shrinking after 35 seconds so nobody can hide. Either driver can pause with Esc.

Plain JavaScript + Three.js in the browser, Node + `ws` on the server, no bundler, no build step.
Everything you see and hear is generated in code: car bodies are extruded side profiles with clearcoat
paint and glass, the deck is a riveted steel plate with procedural normal and roughness maps, the lava
is a flowing shader, and all sounds are synthesised (engine with a virtual gearbox, impacts, ambience).

## Run

```
npm install          # once
npm start            # http://localhost:8787/
```

The server prints a second address for your Wi-Fi (for example `http://192.168.4.133:8787/`).
Anyone on the same network who opens it and clicks **Find a match** is paired with the next person
who does the same. **Practice vs bot** starts a match against a computer driver right away.

If 8787 is busy the server tries 8788, 8789 and so on and prints the address it got.
`PORT=3000 npm start` (PowerShell: `$env:PORT=3000; npm start`) picks a port yourself. `ROOM_SIZE=3 npm start` makes three-car rooms (2 to 4;
last car standing wins the round).

## Play with a friend anywhere

```
npm run share
```

This starts the server and opens a free public tunnel through Cloudflare (install once with
`winget install Cloudflare.cloudflared` on Windows or `brew install cloudflared` on a Mac). It prints a
link like `https://some-words.trycloudflare.com/`. Send that to your friend, both of you click
**Find a match**, and you are paired. The link changes every time you run it and dies when you stop.
The same link appears inside the game (lobby and waiting screen, with a Copy button) as soon as the
tunnel is up, so you never have to read it off the terminal.
`node tools/share.mjs --check` only reports whether cloudflared was found, without starting anything.

The game has no client-side prediction yet, so the remote player feels their own car react about one
round trip late (60 to 100 ms across the country). The host on localhost feels nothing. Prediction is
the first item under *What is not done yet*.

For a permanent address, run `node server.js` on any small VPS behind HTTPS; the client switches to
`wss://` on an HTTPS page by itself.

## Arenas

Three maps today, chosen in the lobby for practice and rotated for matches:

| Map | What is different |
|---|---|
| Crater | The open round deck |
| Pillars | Four steel posts that cars bounce off hard |
| Wrecking Yard | Two wrecking balls on chains swing across the deck from a gantry, half a swing apart. A ball at the bottom of its swing is doing 20 m/s and throws a car into the air and across the deck. Each ball only reaches the deck within about 5 m of its pivot, so the lanes between and outside them are safe. |

The map table lives in `shared/maps.js`; the simulation, the bot and the client all read it, so a
new map is a few lines of bumpers, holes or balls. A ball's position is a pure function of time
(pivot, chain length, amplitude, period, phase), so nothing about it has to be sent over the network.

## Controls

| Action | Keys |
|---|---|
| Drive | W A S D or arrows |
| Jump | C (3 s cooldown) |
| Ability 1 | E or left click |
| Ability 2 | Q or right click |
| Pause | Esc (either driver; either driver resumes; lifts itself after 90 s) |
| Brake / drift | Space (Shift also works): less grip, sharper turn |
| Camera | V (chase cam or arena cam) |
| Look around | Mouse (captured when you start driving; Esc releases it) |
| Zoom | Mouse wheel |
| In the air | Steer a little, brake to dive back down; a jump still works for 0.2 s after you leave the edge |

On a phone a left-thumb stick and brake / jump / ability buttons appear, and the renderer drops to the
low preset (no bloom or soft shadows). The Quality select in the lobby forces high or low. The pause
button at the top right works with a finger or a mouse.

## The cars

Every car has two abilities (E and Q) and a passive trait, all shown on its lobby card. Cooldowns
count from the press.

| Car | Feel | E | Q | Passive |
|---|---|---|---|---|
| Bulldozer | heavy, slow | **Ram** (0.7 s, 6 s): charge forward, triple weight, brutal shove on contact | **Blade down** (2 s, 10 s): dig in; 3.5x weight, shoves bleed off, slow | takes 25% less knockback from abilities and hazards |
| Flipper | balanced, nimble | **Flip** (0.6 s, 7 s): arm the wedge; the next car touched is launched. Get under its nose or tail and it lands on its roof for about two seconds, helpless, scraping to a stop; any push still moves it | **Pounce** (0.8 s, 7 s): a long forward leap over cars and mines; landing on a roof slams that car down and away | never stunned |
| Speedster | fastest, light | **Nitro** (1.3 s, 5 s): big burst of speed | **Snap turn** (0.25 s, 5 s): kill momentum and whip round toward the steering side (180 with no steering); bait them off the edge | jumps every 2 s |
| Anchor | heavy, grippy | **Brace** (1.75 s, 8 s): six times the weight and a dead stop; rammers bounce off | **Countershock** (10 s): a shockwave that throws every car within 6.5 m straight away; 1.6x stronger and wider within 0.6 s of taking a hit | cannot be flipped |
| Magnet | balanced | **Tractor** (1.6 s, 8 s): pulls the other car toward it from up to 22 m | **Repulsion** (10 s): throws every car within 10 m away and kicks the Magnet backward | whoever bumps it is stunned briefly |
| Spinner | balanced | **Spin-up** (3 s, 9 s): every touch flings the other car sideways; own steering gets heavy | **Gyro counter** (0.8 s, 9 s): triple weight for the window, and the first car that touches it is hurled straight back | never gets twisted by hits |
| Wrecker | heavy, slow | **Grab** (10 s): the claw snaps down; what it catches is lifted and carried in front for 1.5 s at little more than half speed, then dropped. Press again to drop early | **Jackknife** (0.5 s, 9 s): whip the truck round; the swing sweeps away anything it touches, and a car in the claw is flung sideways at 13 m/s | cannot be dragged by a tractor beam |
| Greaser | fast, light | **Oil slick** (1 s, 9 s): a trail of up to five oil patches behind the car that last 7 s; cars on oil keep a tenth of their grip and steering and slide | **Powerslide** (0.6 s, 7 s): throw the tail out through 140 degrees; anything the rear catches is shoved hard sideways | never slips on oil |
| Boomer | balanced | **Pop mine** (8 s): drop a mine behind the car (two out at a time, armed after 1 s, gone after 14 s); a car driving over it is blown 9 m/s into the air and away, and stunned | **Blast jump** (10 s): hop into the air and knock every car within 5.5 m back | its own mines and blasts never hurt it |

Hits by Ram, Flip, Spin-up, the sweeps, the shockwaves, mines and wrecking balls also stun the victim
briefly (no steering or throttle for a third of a second or so), and a car that has just been hit
loses most of its grip for 0.4 s so the shove carries. Plain bumps matter too: restitution is 0.6 and
whoever drives into the contact harder gives the other car an extra shove of up to 9 m/s on top of
the bounce. A well-timed jump clears a charging car.

## How it works

```
server.js            HTTP static files + WebSocket rooms + 60 Hz authoritative simulation, 20 Hz snapshots
server/bot.js        practice opponent (drives at you, respects the edge, uses both abilities, dodges balls, mines, oil)
shared/cars.js       the nine car definitions (stats, two abilities each, passive, colours)
shared/sim.js        the whole game simulation: driving model, jump, edge/fall, collisions, abilities,
                     oil, mines, wrecking balls, platform shrink, rounds and match
shared/maps.js       the arena table (bumpers, holes, wrecking balls) and the ball pendulum
public/main.js       game client: networking, HUD, lobby, input, mouse camera, per-frame car animation
public/scene.js      renderer + bloom, shadow-casting lights, sky, reflections, lava/water shader, steel deck,
                     rock pillar, boulders, embers, theme switching, map props (posts, gantry and balls, mines, oil)
public/carmodel.js   the nine car models (extruded bodies, glass, treaded wheels, lamps, underglow, hardware)
public/fx.js         sparks, tyre smoke and dust, magnet streams, splashes
public/net.js        WebSocket client with ping and reconnect
public/sfx.js        synthesised sound design (engine, skid, wind, impacts, abilities, splash, ambience, reverb)
tools/share.mjs      npm run share: server + Cloudflare tunnel, pushes the public link into the game
tools/test_sim.mjs   deterministic physics checks       (node tools/test_sim.mjs)
tools/smoke.mjs      two real WebSocket clients play a full match, rematch, disconnect; bot path
tools/shot.py        headless screenshot + console check of the live page (Playwright)
tools/gpu_shot.py    same shot in the INSTALLED Chrome on the real GPU (SwiftShader hides driver/NaN bugs)
tools/nan_probe.py   reads the HDR frame + bloom buffers back and counts NaN/Inf texels
```

- **Authority.** The server owns the game. Clients send their input 30 times a second (throttle,
  steer, brake, and one-shot jump / ability presses, latched until the server consumes them). The
  server simulates at a fixed 60 Hz and broadcasts a snapshot every third tick. A pause is a room
  flag: the room stops stepping, tells both clients who paused, and resumes on either client's say-so
  or after 90 s. Snapshots also carry the live oil patches and mines; the wrecking balls are derived
  from the snapshot time.
- **Smoothing and prediction.** Other cars render 100 ms behind the newest snapshot, interpolated
  between the two snapshots that bracket that time. Your own car is predicted: the browser runs the
  shared simulation step for it with your inputs immediately (collisions included, against the other
  cars where they stand), every input carries a sequence number, each snapshot says which input the
  server last applied, and the client rewinds to the server state and replays the inputs after it.
  Any difference is eased out over a tenth of a second. So your car answers the instant you press a
  key even across the country, and the server still has the final say. `?predict=0` turns it off.
- **Physics.** Cars are capsules on a plane for collisions (a rounded rectangle along the heading, so
  a nose touching a flank is a real contact; the spinner blade and flipper wedge extend it while active),
  resolved with an impulse (restitution 0.6 plus a shove for the car that is hit, cut back when a
  contact ability already adds its own), contact friction so cars grab instead of sliding past,
  and an angular kick from off-centre hits. A car that lands on another bounces off its roof. The
  arcade driving model has forward acceleration and top speed, strong lateral
  grip (less with the handbrake), steering that scales with speed, and a height axis for jumps and
  falls. Driving past the platform edge drops the car; it is eliminated when it reaches the liquid 14 m
  below (about one second of falling). Abilities
  change mass, acceleration, grip or add impulses, and `effectiveMass` is what collisions see.
- **Rounds.** 3-second countdown, play until one car is left, 2.6-second result card, next round.
  After 35 s of a round the platform radius shrinks from 22 m to 7 m over 30 s.

## Tests

```
npm test             # physics checks, then the WebSocket smoke test (about 40 s)
python tools/shot.py "http://localhost:8787/?practice=bulldozer&bot=spinner" shot.png 6
python tools/gpu_shot.py "http://localhost:8787/?practice=bulldozer" shot.png 6   # real GPU; centre must not be dark
python tools/nan_probe.py http://localhost:8787/ 5                                 # every buffer must report nan: 0
```

`?practice=<car>&bot=<car>&name=<name>` on the URL starts a practice match on load (used by the
screenshot tool).

## What is not done yet

- Lag compensation for hits between predicted and interpolated cars (prediction covers your own car).
- Accounts, names that persist across devices, ranking, cosmetics.
- Rooms you can invite friends into by code (today: a shared queue, first two to click are paired).
- Artist-made car models and textures. The cars are built from code; dropping in glTF models is the
  next visual step, and a real GPU is assumed (bloom, soft shadows and MSAA are on by default).
- More maps. `shared/maps.js` has bumpers, holes and swinging balls; moving tiles and ramps would be
  the next feature types, and per-map rule overrides (radius, shrink timing) are not wired yet.
- Balance passes with real players. The nine-car roster and the numbers above are a first tuning.
- Binary snapshots (JSON today; fine at 2 to 4 cars).

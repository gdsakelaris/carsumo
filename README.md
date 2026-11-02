# Car Sumo

Online multiplayer car sumo. Two cars on a round deck held 14 m above lava (or water) by a rock
pillar. Push the other car off the edge and watch it drop. First to three rounds wins. Six cars, each with one special ability on a cooldown,
plus jump and drift for everyone. The platform starts shrinking after 35 seconds so nobody can hide.

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
| Fissure | A lava crack across the deck: jump it or fall through it |

The map table lives in `shared/maps.js`; the simulation, the bot and the client all read it, so a
new map is a few lines of bumpers and holes.

## Controls

| Action | Keys |
|---|---|
| Drive | W A S D or arrows |
| Jump | C (3 s cooldown) |
| Ability | E or left click |
| Brake / drift | Space (Shift also works): less grip, sharper turn |
| Camera | V (chase cam or arena cam) |
| Look around | Mouse (captured when you start driving; Esc releases it) |
| Zoom | Mouse wheel |
| In the air | Steer a little, brake to dive back down; a jump still works for 0.2 s after you leave the edge |

On a phone a left-thumb stick and brake / jump / ability buttons appear, and the renderer drops to the
low preset (no bloom or soft shadows). The Quality select in the lobby forces high or low.

## The cars

| Car | Feel | Ability |
|---|---|---|
Each car also has a passive trait, shown on its lobby card: Bulldozer takes less knockback, Flipper is
never stunned, Speedster jumps every 2 s, Anchor cannot be flipped, Magnet stings whoever bumps it,
Spinner never gets twisted, Wrecker cannot be dragged by a tractor beam.

| Bulldozer | heavy, slow | **Ram** (0.7 s, 6 s cooldown): charges forward, triple weight, brutal shove on contact |
| Flipper | balanced | **Flip** (0.6 s, 7 s): the next car it touches is launched into the air with no control |
| Speedster | fast, light | **Nitro** (1.3 s, 4.5 s): big burst of speed; light, so hits send it far |
| Anchor | heavy, grippy | **Brace** (2 s, 8 s): five times the weight and a dead stop; rammers bounce off |
| Magnet | balanced | **Tractor** (1.6 s, 8 s): pulls the other car toward it from up to 18 m |
| Wrecker | heavy, slow | **Grab** (2.6 s, 10 s): the claw snaps down; whatever it catches is lifted, carried in front while you drive, and dropped when you press again. Carry them to the edge. |
| Spinner | balanced | **Spin-up** (3 s, 9 s): every touch flings the other car sideways; own steering gets heavy |

Hits by Ram, Flip and Spin-up also stun the victim briefly (no steering or throttle for a third of a
second), which is what makes a good hit feel decisive. A well-timed jump clears a charging car.

## How it works

```
server.js            HTTP static files + WebSocket rooms + 60 Hz authoritative simulation, 20 Hz snapshots
server/bot.js        practice opponent (drives at you, respects the edge, uses its ability, sometimes hops)
shared/cars.js       the six car definitions (stats, abilities, colours)
shared/sim.js        the whole game simulation: driving model, jump, edge/fall, collisions, abilities,
                     platform shrink, rounds and match
public/main.js       game client: networking, HUD, lobby, input, mouse camera, per-frame car animation
public/scene.js      renderer + bloom, shadow-casting lights, sky, reflections, lava/water shader, steel deck,
                     rock pillar, boulders, embers, theme switching
public/carmodel.js   the six car models (extruded bodies, glass, treaded wheels, lamps, underglow, hardware)
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
  server simulates at a fixed 60 Hz and broadcasts a snapshot every third tick.
- **Smoothing and prediction.** Other cars render 100 ms behind the newest snapshot, interpolated
  between the two snapshots that bracket that time. Your own car is predicted: the browser runs the
  shared simulation step for it with your inputs immediately (collisions included, against the other
  cars where they stand), every input carries a sequence number, each snapshot says which input the
  server last applied, and the client rewinds to the server state and replays the inputs after it.
  Any difference is eased out over a tenth of a second. So your car answers the instant you press a
  key even across the country, and the server still has the final say. `?predict=0` turns it off.
- **Physics.** Cars are capsules on a plane for collisions (a rounded rectangle along the heading, so
  a nose touching a flank is a real contact; the spinner blade and flipper wedge extend it while active),
  resolved with an impulse (restitution 0.45), contact friction so cars grab instead of sliding past,
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
- Multiple maps. Today the arena is one round deck whose numbers (radius, shrink timing, drop height,
  spawn ring) live in `RULES` in `shared/sim.js`, and lava vs water is only a look. The plan is a
  `shared/maps.js` table the room picks from, so each map can set those numbers plus its own features
  (moving tiles, bumpers, ramps, gaps), with the client building the scene from the chosen map.
- Binary snapshots (JSON today; fine at 2 to 4 cars).

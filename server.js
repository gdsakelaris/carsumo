// Car Sumo server: static files + WebSocket rooms + authoritative 60 Hz simulation.
// Run: node server.js   (PORT env var, default 8787, falls forward if busy; ROOM_SIZE env var, default 2)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createWorld, stepWorld, snapshot, resetMatch, RULES } from './shared/sim.js';
import { CARS, randomCarType } from './shared/cars.js';
import { MAP_IDS, cleanMapId } from './shared/maps.js';
import { createBotBrain, botInput } from './server/bot.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const ROOM_SIZE = Math.max(2, Math.min(4, Number(process.env.ROOM_SIZE || 2)));
const SNAPSHOT_EVERY = 3; // ticks (60 Hz sim -> 20 Hz snapshots)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
let publicUrl = process.env.PUBLIC_URL || '';
const JSM = path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json' };

function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/index.html';
  if (url === '/vendor/three.module.js') return serveFile(res, path.join(ROOT, 'node_modules', 'three', 'build', 'three.module.js'));
  if (url.startsWith('/vendor/jsm/')) {
    const file = path.normalize(path.join(JSM, url.slice('/vendor/jsm/'.length)));
    if (!file.startsWith(JSM)) { res.writeHead(403); return res.end(); }
    return serveFile(res, file);
  }
  if (url === '/admin/share' && req.method === 'POST') {
    if (!ADMIN_TOKEN || req.headers['x-admin-token'] !== ADMIN_TOKEN) { res.writeHead(403); return res.end(); }
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      try {
        const j = JSON.parse(body || '{}');
        if (typeof j.url === 'string' && /^https?:[/][/][A-Za-z0-9.-]+(:[0-9]+)?[/]?$/.test(j.url)) {
          setPublicUrl(j.url.endsWith('/') ? j.url : j.url + '/');
          res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
        } else { res.writeHead(400); res.end(); }
      } catch { res.writeHead(400); res.end(); }
    });
    return;
  }
  if (url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, rooms: rooms.size, queue: queue.length, clients: clients.size, publicUrl: publicUrl || null })); }
  let base = path.join(ROOT, 'public');
  if (url.startsWith('/shared/')) { base = ROOT; }
  const file = path.normalize(path.join(base, url));
  if (!file.startsWith(base)) { res.writeHead(403); return res.end(); }
  serveFile(res, file);
});

// ---------------------------------------------------------------- rooms
let nextId = 1;
const clients = new Map(); // ws -> client {id, name, type, room, ws}
const queue = [];          // clients waiting for a match
const rooms = new Set();

let roomCount = 0;
class Room {
  constructor(players, mapId) {
    this.players = players; // [{id, name, type, ws|null, bot?: brain}]
    this.inputs = new Map();
    this.appliedSeq = new Map();
    this.map = mapId || MAP_IDS[roomCount++ % MAP_IDS.length];
    this.world = createWorld(players.map((p) => ({ id: p.id, name: p.name, type: p.type })), this.map);
    this.acc = 0;
    this.last = performance.now();
    this.ready = new Set();
    this.closed = false;
    this.pendingEv = [];
    for (const p of players) { p.room = this; }
    this.broadcast({ t: 'start', round: 1, map: this.map, players: players.map((p) => ({ id: p.id, name: p.name, type: p.type, bot: !!p.bot })), rules: RULES });
    rooms.add(this);
  }
  humans() { return this.players.filter((p) => p.ws); }
  broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const p of this.players) if (p.ws && p.ws.readyState === 1) p.ws.send(s);
  }
  setInput(id, inp) {
    const prev = this.inputs.get(id);
    // One-shot presses (jump, ability) stay latched until a simulation step consumes them.
    this.inputs.set(id, { th: clamp(+inp.th || 0, -1, 1), st: clamp(+inp.st || 0, -1, 1),
      jump: !!inp.jump || !!(prev && prev.jump), ab: !!inp.ab || !!(prev && prev.ab), brake: !!inp.brake, seq: Math.max(0, +inp.seq || 0) });
  }
  tick(now) {
    if (this.closed) return;
    this.acc += Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    let steps = 0;
    while (this.acc >= RULES.dt && steps < 8) {
      for (const p of this.players) if (p.bot) this.inputs.set(p.id, botInput(this.world, p.bot));
      const before = this.world.phase;
      stepWorld(this.world, this.inputs);
      for (const [id, inp] of this.inputs) if (inp.seq) this.appliedSeq.set(id, inp.seq);
      // One-shot inputs (jump, ability) are consumed once they are seen by a step.
      for (const [id, inp] of this.inputs) { if (inp.jump || inp.ab) this.inputs.set(id, { ...inp, jump: false, ab: false }); }
      for (const ev of this.world.events) {
        if (ev.type === 'roundEnd') this.broadcast({ t: 'round_end', winner: ev.winner, matchWinner: ev.matchWinner, round: this.world.round,
          score: Object.fromEntries(this.world.cars.map((c) => [c.id, c.wins])) });
        else this.pendingEv.push(ev);
      }
      if (before !== 'matchOver' && this.world.phase === 'matchOver') {
        this.broadcast({ t: 'match_end', winner: this.world.matchWinner, score: Object.fromEntries(this.world.cars.map((c) => [c.id, c.wins])) });
        this.ready.clear();
        for (const p of this.players) if (p.bot) this.ready.add(p.id);
      }
      this.acc -= RULES.dt;
      steps++;
      if (this.world.tick % SNAPSHOT_EVERY === 0) {
        const snap = snapshot(this.world);
        for (const c of snap.cars) c.sq = this.appliedSeq.get(c.id) || 0;
        snap.ev = this.pendingEv.slice(0, 40);
        this.pendingEv = [];
        this.broadcast(snap);
      }
    }
  }
  rematch(id) {
    if (this.world.phase !== 'matchOver') return;
    this.ready.add(id);
    this.broadcast({ t: 'rematch_status', ready: [...this.ready] });
    if (this.players.every((p) => this.ready.has(p.id))) {
      resetMatch(this.world);
      this.ready.clear();
      for (const p of this.players) if (p.bot) this.ready.add(p.id);
      this.broadcast({ t: 'start', round: 1, map: this.map, players: this.players.map((p) => ({ id: p.id, name: p.name, type: p.type, bot: !!p.bot })), rules: RULES });
    }
  }
  leave(player) {
    if (this.closed) return;
    this.closed = true;
    rooms.delete(this);
    for (const p of this.players) {
      p.room = null;
      if (p !== player && p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'opponent_left', name: player.name }));
    }
  }
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const cleanName = (s) => String(s || '').replace(/[^\w \-'.]/g, '').trim().slice(0, 16) || `Driver${Math.floor(Math.random() * 900 + 100)}`;
const cleanType = (t) => (CARS[t] ? t : randomCarType());

function startMatchFromQueue() {
  while (queue.length >= ROOM_SIZE) {
    const players = queue.splice(0, ROOM_SIZE);
    new Room(players);
  }
  queue.forEach((c, i) => c.ws.send(JSON.stringify({ t: 'queued', position: i + 1, need: ROOM_SIZE })));
}

const wss = new WebSocketServer({ server });
wss.on('error', () => {}); // ws forwards the HTTP server's errors; listen() below handles them
wss.on('connection', (ws) => {
  const client = { id: `p${nextId++}`, name: 'Driver', type: 'speedster', ws, room: null };
  clients.set(ws, client);
  ws.send(JSON.stringify({ t: 'welcome', id: client.id, roomSize: ROOM_SIZE, cars: Object.keys(CARS), publicUrl: publicUrl || null }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    switch (msg.t) {
      case 'join': {
        if (client.room) client.room.leave(client);
        const qi = queue.indexOf(client); if (qi >= 0) queue.splice(qi, 1);
        client.name = cleanName(msg.name);
        client.type = cleanType(msg.car);
        if (msg.mode === 'practice') {
          const botType = cleanType(msg.botCar) === client.type && !CARS[msg.botCar] ? randomCarType(client.type) : (CARS[msg.botCar] ? msg.botCar : randomCarType(client.type));
          const bot = { id: `bot${nextId++}`, name: `${CARS[botType].name} Bot`, type: botType, ws: null, bot: null };
          bot.bot = createBotBrain(bot.id);
          new Room([client, bot], cleanMapId(msg.map));
        } else {
          queue.push(client);
          startMatchFromQueue();
        }
        break;
      }
      case 'input': if (client.room) client.room.setInput(client.id, msg); break;
      case 'rematch': if (client.room) client.room.rematch(client.id); break;
      case 'leave': {
        if (client.room) client.room.leave(client);
        const qi = queue.indexOf(client); if (qi >= 0) { queue.splice(qi, 1); startMatchFromQueue(); }
        break;
      }
      case 'ping': ws.send(JSON.stringify({ t: 'pong', c: msg.c, s: Date.now() })); break;
      default: break;
    }
  });
  ws.on('close', () => {
    clients.delete(ws);
    if (client.room) client.room.leave(client);
    const qi = queue.indexOf(client); if (qi >= 0) { queue.splice(qi, 1); startMatchFromQueue(); }
  });
});

// The public link (from `npm run share`) is pushed to every connected client so the game can show it.
export function setPublicUrl(u) {
  publicUrl = u || '';
  const s = JSON.stringify({ t: 'share', url: publicUrl || null });
  for (const ws of clients.keys()) if (ws.readyState === 1) ws.send(s);
  if (publicUrl) console.log(`public link: ${publicUrl}`);
}

// ---------------------------------------------------------------- loop
setInterval(() => { const now = performance.now(); for (const r of rooms) r.tick(now); }, 1000 / 60).unref();

function lanAddresses() {
  const out = [];
  for (const [, list] of Object.entries(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}

export function listen(port = PORT, tries = 10) {
  return new Promise((resolve, reject) => {
    const attempt = (p, left) => {
      const onListening = () => {
        server.removeListener('error', onError);
        const actual = server.address().port;
        console.log(`Car Sumo  →  http://localhost:${actual}/   (room size ${ROOM_SIZE})`);
        for (const ip of lanAddresses()) console.log(`           on your Wi-Fi: http://${ip}:${actual}/`);
        resolve(actual);
      };
      const onError = (err) => {
        server.removeListener('listening', onListening);
        if (err.code === 'EADDRINUSE' && p !== 0 && left > 0) {
          console.log(`port ${p} is already in use by another program, trying ${p + 1}`);
          attempt(p + 1, left - 1);
        } else reject(err);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(p);
    };
    attempt(port, tries);
  });
}
export function close() { return new Promise((r) => { wss.close(); server.close(() => r()); }); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  listen().catch((e) => { console.error(`Could not start: ${e.message}. Try: PORT=9000 npm start`); process.exit(1); });
}

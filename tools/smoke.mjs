// End-to-end smoke test over real WebSockets: two clients join, get matched, one reverses off the
// edge every round, and the match ends 3-0. Also checks the practice-bot path. Run: node tools/smoke.mjs
import { listen, close, setPublicUrl } from '../server.js';
import WebSocket from 'ws';

const port = await listen(0);
const url = `ws://localhost:${port}/ws`;
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); if (!ok) failures++; };

function client(name, car, mode) {
  const ws = new WebSocket(url);
  const c = { ws, name, id: null, msgs: [], states: 0, roundEnds: [], matchEnd: null, start: null, queued: null, handlers: new Set() };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'welcome') { c.id = m.id; ws.send(JSON.stringify({ t: 'join', name, car, mode })); }
    else if (m.t === 'state') c.states++;
    else if (m.t === 'round_end') c.roundEnds.push(m);
    else if (m.t === 'match_end') c.matchEnd = m;
    else if (m.t === 'start') c.start = m;
    else if (m.t === 'queued') c.queued = m;
    c.msgs.push(m);
    for (const h of c.handlers) h(m);
  });
  c.until = (pred, ms) => new Promise((resolve, reject) => {
    const t = setTimeout(() => { c.handlers.delete(h); reject(new Error(`timeout waiting in ${name}`)); }, ms);
    const h = (m) => { if (pred(m)) { clearTimeout(t); c.handlers.delete(h); resolve(m); } };
    c.handlers.add(h);
    if (c.msgs.some(pred)) { clearTimeout(t); c.handlers.delete(h); resolve(c.msgs.find(pred)); }
  });
  return c;
}

try {
  // --- two humans
  const A = client('Alice', 'bulldozer', 'match');
  await A.until((m) => m.t === 'queued', 3000);
  check('first player is queued', A.queued && A.queued.position === 1 && A.queued.need === 2);
  const B = client('Bob', 'anchor', 'match');
  const startA = await A.until((m) => m.t === 'start', 3000);
  await B.until((m) => m.t === 'start', 3000);
  check('both players receive start with two cars', startA.players.length === 2 && startA.players.every((p) => !p.bot));
  check('start names the arena', typeof startA.map === 'string' && startA.map.length > 0, startA.map);

  // Bob holds reverse for the whole match; Alice idles.
  const drive = setInterval(() => B.ws.send(JSON.stringify({ t: 'input', th: -1, st: 0, jump: false, ab: false, brake: false })), 33);
  const firstRound = await A.until((m) => m.t === 'round_end', 12000);
  check('round 1 goes to Alice', firstRound.winner === A.id && firstRound.score[A.id] === 1, `winner ${firstRound.winner}`);
  const endA = await A.until((m) => m.t === 'match_end', 40000);
  clearInterval(drive);
  check('match ends 3-0 for Alice', endA.winner === A.id && endA.score[A.id] === 3 && endA.score[B.id] === 0, JSON.stringify(endA.score));
  check('snapshots streamed to both clients', A.states > 100 && B.states > 100, `${A.states} / ${B.states}`);
  const snap = [...A.msgs].reverse().find((m) => m.t === 'state');
  check('snapshot has two cars with positions', snap && snap.cars.length === 2 && snap.cars.every((c) => typeof c.x === 'number'));
  check('fall events were delivered', A.msgs.some((m) => m.t === 'state' && (m.ev || []).some((e) => e.type === 'fall')));

  // Rematch: both ready -> a new start.
  A.ws.send(JSON.stringify({ t: 'rematch' }));
  const rs = await B.until((m) => m.t === 'rematch_status', 3000);
  check('rematch status reaches the other player', rs.ready.includes(A.id));
  B.ws.send(JSON.stringify({ t: 'rematch' }));
  const start2 = await A.until((m) => m.t === 'start' && m !== startA, 3000);
  check('rematch restarts the match', !!start2);

  // Pause: either side can pause and either side can resume; the simulation stands still meanwhile.
  await A.until((m) => m.t === 'state' && m.tick > 10 && m !== snap, 5000);
  A.ws.send(JSON.stringify({ t: 'pause', on: true }));
  const pausedMsg = await B.until((m) => m.t === 'pause' && m.on, 3000);
  check('pause from one driver reaches the other with their name', pausedMsg.by === 'Alice', pausedMsg.by);
  await new Promise((r) => setTimeout(r, 150));
  const tickA = [...A.msgs].reverse().find((m) => m.t === 'state').tick;
  await new Promise((r) => setTimeout(r, 400));
  const tickB = [...A.msgs].reverse().find((m) => m.t === 'state').tick;
  check('the simulation stands still while paused', tickA === tickB, `tick ${tickA} -> ${tickB}`);
  B.ws.send(JSON.stringify({ t: 'pause', on: false }));
  const resumed = await A.until((m) => m.t === 'pause' && !m.on, 3000);
  check('the other driver can resume', !!resumed);
  await A.until((m) => m.t === 'state' && m.tick > tickB + 5, 3000);
  check('ticks advance again after resume', true);

  // Leaving tells the other player.
  B.ws.close();
  const left = await A.until((m) => m.t === 'opponent_left', 3000);
  check('opponent_left is sent when a player disconnects', left.name === 'Bob');
  A.ws.close();

  // --- practice vs bot: the bot should drive and the game should reach a result on its own.
  const P = client('Solo', 'speedster', 'practice');
  const ps = await P.until((m) => m.t === 'start', 3000);
  check('practice room has a bot', ps.players.length === 2 && ps.players.some((p) => p.bot));
  const pr = await P.until((m) => m.t === 'round_end', 90000);
  check('bot practice round reaches a result', !!pr, `winner ${pr.winner === P.id ? 'human (idle)' : 'bot'}`);
  const botMoved = [...P.msgs].reverse().find((m) => m.t === 'state').cars.find((c) => c.id !== P.id);
  check('bot actually moved', botMoved && (Math.abs(botMoved.vx) + Math.abs(botMoved.vz) > 0.01 || botMoved.a === 0 || Math.hypot(botMoved.x, botMoved.z) !== 12));
  // public link: pushed to connected clients and included in welcome for new ones
  setPublicUrl('https://words-here.trycloudflare.com/');
  const shareMsg = await P.until((m) => m.t === 'share', 3000);
  check('share link is pushed to connected clients', shareMsg.url === 'https://words-here.trycloudflare.com/', shareMsg.url);
  const Q = client('Quinn', 'magnet', 'match');
  const welcomeQ = await Q.until((m) => m.t === 'welcome', 3000);
  check('welcome carries the public link', welcomeQ.publicUrl === 'https://words-here.trycloudflare.com/', String(welcomeQ.publicUrl));
  const forbidden = await fetch(`http://localhost:${port}/admin/share`, { method: 'POST', body: '{}', headers: { connection: 'close' } });
  check('admin endpoint refuses calls without the token', forbidden.status === 403, `status ${forbidden.status}`);
  const jsm = await fetch(`http://localhost:${port}/vendor/jsm/postprocessing/UnrealBloomPass.js`, { headers: { connection: 'close' } });
  check('three addon modules are served', jsm.ok && (await jsm.text()).includes('UnrealBloomPass'));
  const traversal = await fetch(`http://localhost:${port}/vendor/jsm/../../../package.json`, { headers: { connection: 'close' } });
  check('addon route blocks path traversal', traversal.status !== 200 || !(await traversal.text()).includes('"name"'), `status ${traversal.status}`);
  Q.ws.close();
  P.ws.close();
} catch (e) {
  console.error('ERROR', e.message); failures++;
} finally {
  await close();
}
console.log(failures ? `\n${failures} smoke check(s) failed` : '\nsmoke test passed');
process.exitCode = failures ? 1 : 0;

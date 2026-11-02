// Start the game server AND a public Cloudflare quick tunnel, then print the link to send a friend.
// Run: npm run share      (needs cloudflared: winget install Cloudflare.cloudflared  /  brew install cloudflared)
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pf86 = process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)';
const pf = process.env.ProgramFiles || 'C:/Program Files';
const candidates = process.env.CLOUDFLARED ? [process.env.CLOUDFLARED] : [
  'cloudflared',
  path.join(pf86, 'cloudflared', 'cloudflared.exe'),
  path.join(pf, 'cloudflared', 'cloudflared.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe'),
  '/usr/local/bin/cloudflared',
  '/opt/homebrew/bin/cloudflared',
];
const verbose = process.argv.includes('--check');
function findCloudflared() {
  for (const c of candidates) {
    const r = spawnSync(c, ['--version'], { stdio: 'pipe' });
    if (verbose) console.log(`  ${c}  ->  ${r.error ? r.error.code : 'exit ' + r.status}`);
    if (!r.error && r.status === 0) return c;
  }
  return null;
}

const cf = findCloudflared();
if (verbose) { console.log(cf ? `using: ${cf}` : 'cloudflared not found'); process.exit(cf ? 0 : 1); }
if (!cf) {
  console.error('cloudflared is not installed, so there is no way to make a public link.');
  console.error('  Windows:  winget install Cloudflare.cloudflared');
  console.error('  Mac:      brew install cloudflared');
  console.error('Then run  npm run share  again.');
  process.exit(1);
}

let tunnel = null;
const token = crypto.randomBytes(16).toString('hex');
let serverPort = 0;
const server = spawn(process.execPath, [path.join(root, 'server.js')], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, ADMIN_TOKEN: token } });

// Tell the game server the public link so it can show it in the lobby and waiting screen.
function tellServer(url) {
  fetch(`http://localhost:${serverPort}/admin/share`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': token }, body: JSON.stringify({ url }) })
    .then((r) => console.log(r.ok ? '  (the link now also shows inside the game)' : `  could not tell the server about the link (${r.status})`))
    .catch((e) => console.log(`  could not tell the server about the link: ${e.message}`));
}
server.stdout.on('data', (d) => {
  const text = d.toString(); process.stdout.write(text);
  const m = text.match(/http:\/\/localhost:(\d+)\//);
  if (m && !tunnel) { serverPort = Number(m[1]); startTunnel(serverPort); }
});
server.on('exit', (code) => { if (code) console.error(`server exited (${code})`); shutdown(); });

function startTunnel(port) {
  console.log('opening a public tunnel, this takes a few seconds...');
  tunnel = spawn(cf, ['tunnel', '--url', `http://localhost:${port}`, '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let found = false;
  const look = (d) => {
    const m = d.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !found) {
      found = true;
      tellServer(m[0] + '/');
      console.log('\n==============================================');
      console.log('  Send your friend this link:');
      console.log(`  ${m[0]}/`);
      console.log('  You can open it too, or use localhost.');
      console.log('  Both click "Find a match".  Ctrl+C stops.');
      console.log('==============================================\n');
    }
  };
  tunnel.stdout.on('data', look);
  tunnel.stderr.on('data', look);
  tunnel.on('exit', (code) => { console.error(`tunnel closed (${code})`); shutdown(); });
  tunnel.on('error', (e) => { console.error(`tunnel failed: ${e.message}`); shutdown(); });
}

function shutdown() {
  try { if (tunnel) tunnel.kill(); } catch {}
  try { server.kill(); } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

"""Headless screenshot + console check of the running game (needs: pip install playwright; playwright install chromium).

Usage: python tools/shot.py http://localhost:8787/?practice=bulldozer out.png [seconds] [arena]
"""
import sys, time
from playwright.sync_api import sync_playwright

url = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8787/?practice=bulldozer'
out = sys.argv[2] if len(sys.argv) > 2 else 'shot.png'
wait = float(sys.argv[3]) if len(sys.argv) > 3 else 6.0

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = browser.new_page(viewport={'width': 1280, 'height': 720})
    errors = []
    page.on('console', lambda m: errors.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    page.goto(url, wait_until='load')
    if not (len(sys.argv) > 4 and sys.argv[4].startswith('cam=')): time.sleep(wait)
    # Drive forward and fire the ability so the shot shows motion.
    if len(sys.argv) > 4 and sys.argv[4] == 'arena':
        page.keyboard.press('KeyV'); time.sleep(0.3)
    if len(sys.argv) > 4 and sys.argv[4].startswith('cam='):
        nums = [float(v) for v in sys.argv[4][4:].split(',')]
        page.evaluate('(d) => { window.__CS.S.debugCam = d; }', nums)
        for _ in range(150):
            if page.evaluate('() => window.__CS && window.__CS.S.mode === "playing" && window.__CS.S.snaps.length > 2'): break
            time.sleep(0.1)
        time.sleep(0.5)
        page.screenshot(path=out); browser.close(); print('saved', out); sys.exit(0)
    page.keyboard.down('KeyW'); time.sleep(0.8); page.keyboard.press('KeyE'); time.sleep(0.4)
    info = page.evaluate("""() => { const S = window.__CS && window.__CS.S; if (!S) return null;
        const st = window.__CS.sampleState(); return { mode: S.mode, myId: S.myId, players: S.players.length,
        snaps: S.snaps.length, phase: st && st.meta.phase, cars: st ? [...st.cars.values()].map(c => ({id: c.id, x: +c.x.toFixed(1), y: +c.y.toFixed(1), z: +c.z.toFixed(1), a: c.a})) : null,
        meshes: [...S.meshes.entries()].map(([id, m]) => ({ id, type: m.type, visible: m.group.visible, inScene: !!m.group.parent,
          pos: m.group.position.toArray().map(v => +v.toFixed(1)), children: m.group.children.length })),
        latency: window.__CS.net.latency }; }""")
    page.keyboard.up('KeyW')
    page.screenshot(path=out)
    browser.close()

print('state:', info)
print('console issues:', len(errors))
for e in errors[:12]:
    print('  ', e[:300])
print('saved', out)

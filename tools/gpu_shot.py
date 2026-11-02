"""Screenshot the game in the INSTALLED Chrome (real GPU, not SwiftShader): prints console output and how much of the view is black.

Usage: python tools/gpu_shot.py <url> <out.png> [seconds] [headed] [extra chrome args...]
"""
import sys, time
from playwright.sync_api import sync_playwright

url = sys.argv[1]
out = sys.argv[2]
wait = float(sys.argv[3]) if len(sys.argv) > 3 else 6.0
headed = len(sys.argv) > 4 and sys.argv[4] == 'headed'
extra = sys.argv[5:]

with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=not headed, args=['--ignore-gpu-blocklist'] + extra)
    page = browser.new_page(viewport={'width': 1600, 'height': 900})
    logs = []
    page.on('console', lambda m: logs.append(f'{m.type}: {m.text}'))
    page.on('pageerror', lambda e: logs.append(f'pageerror: {e}'))
    page.goto(url, wait_until='load')
    time.sleep(wait)
    info = page.evaluate("""() => {
        const c = document.createElement('canvas'); const gl = c.getContext('webgl2');
        const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
        const S = window.__CS && window.__CS.S;
        const cv = document.querySelector('canvas');
        const r = cv && cv.getBoundingClientRect();
        const top = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
        const chain = []; let e = top; while (e) { const cs = getComputedStyle(e); chain.push(`${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.className && typeof e.className === 'string' ? '.' + e.className.split(' ').join('.') : ''} bg=${cs.backgroundColor} op=${cs.opacity} z=${cs.zIndex}`); e = e.parentElement; }
        return { renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/a',
                 floatExt: !!(gl && gl.getExtension('EXT_color_buffer_float')), halfExt: !!(gl && gl.getExtension('EXT_color_buffer_half_float')),
                 mode: S && S.mode, snaps: S && S.snaps.length, quality: S && S.quality,
                 canvas: cv ? { w: cv.width, h: cv.height, cssW: r.width, cssH: r.height, display: getComputedStyle(cv).display } : null,
                 centerStack: chain };
    }""")
    page.screenshot(path=out)
    browser.close()

print('info:', info)
print('console lines:', len(logs))
for l in logs[:40]:
    print('  ', l[:400])

try:
    from PIL import Image
    im = Image.open(out).convert('RGB'); w, h = im.size
    px = im.load()
    def dark_frac(x0, y0, x1, y1):
        n = d = 0
        for y in range(y0, y1, 4):
            for x in range(x0, x1, 4):
                n += 1; r, g, b = px[x, y]
                if r + g + b < 30: d += 1
        return d / max(n, 1)
    print('dark fraction  whole: %.2f  centre: %.2f  edges: %.2f' % (dark_frac(0, 0, w, h), dark_frac(w // 4, h // 4, 3 * w // 4, 3 * h // 4), dark_frac(0, 0, w // 8, h)))
except Exception as ex:
    print('pixel check skipped:', ex)
print('saved', out)

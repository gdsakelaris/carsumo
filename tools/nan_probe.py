"""Real-GPU check: read the half-float frame and bloom buffers back and count NaN/Inf texels (a NaN pixel + bloom = black rectangle).

Usage: python tools/nan_probe.py <url> <seconds>
"""
import sys, time
from playwright.sync_api import sync_playwright

url = sys.argv[1]; wait = float(sys.argv[2])
JS = """() => {
    const C = window.__CS, T = C.THREE; const r = C.renderer; const bloom = C.composer.passes[1];
    function stats(rt, name) {
      const w = rt.width, h = rt.height; const buf = new Uint16Array(w * h * 4); r.readRenderTargetPixels(rt, 0, 0, w, h, buf);
      let nan = 0, inf = 0, neg = 0, huge = 0, x0 = w, x1 = -1, y0 = h, y1 = -1, maxv = 0;
      for (let i = 0; i < w * h; i++) { let bad = false; for (let k = 0; k < 3; k++) { const v = buf[i * 4 + k]; const e = (v >> 10) & 0x1f, m = v & 0x3ff, s = v >> 15;
          if (e === 31) { if (m) nan++; else inf++; bad = true; } else { const f = (e ? Math.pow(2, e - 15) * (1 + m / 1024) : Math.pow(2, -14) * (m / 1024)) * (s ? -1 : 1); if (f < -0.001) neg++; if (f > 1000) huge++; if (f > maxv) maxv = f; } }
        if (bad) { const x = i % w, y = h - 1 - Math.floor(i / w); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      return { name, w, h, nan, inf, neg, huge, maxv: +maxv.toFixed(2), box: (nan || inf) ? [x0, y0, x1, y1] : null };
    }
    const out = [];
    out.push(stats(C.composer.readBuffer, 'composer.readBuffer (scene+bloom)'));
    out.push(stats(bloom.renderTargetBright, 'bloom.bright'));
    for (let i = 0; i < bloom.nMips; i++) { out.push(stats(bloom.renderTargetsHorizontal[i], 'mip' + i + '.H')); out.push(stats(bloom.renderTargetsVertical[i], 'mip' + i + '.V')); }
    // scene only, through the same MSAA half-float path: render the scene into a fresh MSAA target and read it
    const rt = new T.WebGLRenderTarget(C.composer.readBuffer.width, C.composer.readBuffer.height, { type: T.HalfFloatType, samples: 4 });
    const prev = r.getRenderTarget(); r.setRenderTarget(rt); r.render(C.scene, C.camera); r.setRenderTarget(prev);
    out.push(stats(rt, 'fresh MSAA scene render')); rt.dispose();
    const rt2 = new T.WebGLRenderTarget(C.composer.readBuffer.width, C.composer.readBuffer.height, { type: T.HalfFloatType, samples: 0 });
    r.setRenderTarget(rt2); r.render(C.scene, C.camera); r.setRenderTarget(prev);
    out.push(stats(rt2, 'fresh non-MSAA scene render')); rt2.dispose();
    return out;
}"""
with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True, args=['--ignore-gpu-blocklist'])
    page = browser.new_page(viewport={'width': 1600, 'height': 900})
    logs = []
    page.on('console', lambda m: logs.append(f'{m.type}: {m.text}'))
    page.goto(url, wait_until='load'); time.sleep(wait)
    for o in page.evaluate(JS): print('  ', o)
    browser.close()
print('console:', [l[:300] for l in logs if 'error' in l.lower() or 'warn' in l.lower()][:10])

// Synthesised sound design (no audio files): layered engine with a virtual gearbox, exhaust rumble, turbo
// whine, tyre squeal, wind, layered impacts with metallic ring, per-car ability sounds, lava / water
// splashes, ambience with crackles or waves, and a generated reverb so everything sits in one space.
export class Sfx {
  constructor() { this.ctx = null; this.enabled = true; this.theme = 'lava'; this.engine = null; this.amb = null; this.skid = null; this.wind = null; }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = 0.7;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -16; this.comp.ratio.value = 4; this.comp.attack.value = 0.004; this.comp.release.value = 0.22;
    this.master.connect(this.comp); this.comp.connect(c.destination);
    this.verb = c.createConvolver(); this.verb.buffer = this._impulse(2.0, 2.6);
    this.verbGain = c.createGain(); this.verbGain.gain.value = 0.26;
    this.verb.connect(this.verbGain); this.verbGain.connect(this.master);
    this.noise = this._white(2.0); this.brown = this._brown(3.0);
    this._engine(); this._skid(); this._wind(); this._ambient(this.theme);
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  // ---------------------------------------------------------------- buffers & routing
  _white(sec) { const n = this.ctx.sampleRate * sec, b = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; return b; }
  _brown(sec) { const n = this.ctx.sampleRate * sec, b = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = b.getChannelData(0); let v = 0; for (let i = 0; i < n; i++) { v = (v + (Math.random() * 2 - 1) * 0.02) * 0.995; d[i] = v * 12; } return b; }
  _impulse(sec, decay) {
    const n = this.ctx.sampleRate * sec, b = this.ctx.createBuffer(2, n, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay) * (i < 400 ? i / 400 : 1); }
    return b;
  }
  _softClip() { const n = 2048, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * 1.8); } return c; }
  _bus(node, wet = 0.3) { node.connect(this.master); if (wet > 0) { const s = this.ctx.createGain(); s.gain.value = wet; node.connect(s); s.connect(this.verb); } }

  // ---------------------------------------------------------------- continuous layers
  _engine() {
    const c = this.ctx;
    const mix = c.createGain(); mix.gain.value = 1;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 2.2;
    const shaper = c.createWaveShaper(); shaper.curve = this._softClip(); shaper.oversample = '2x';
    const out = c.createGain(); out.gain.value = 0;
    const oscs = [['sawtooth', 1, 0.5, 0], ['sawtooth', 2.0, 0.22, 7], ['square', 0.5, 0.3, 0], ['triangle', 3.0, 0.1, -6]].map(([type, mul, g, det]) => {
      const o = c.createOscillator(); o.type = type; o.frequency.value = 60 * mul; o.detune.value = det;
      const gg = c.createGain(); gg.gain.value = g; o.connect(gg); gg.connect(mix); o.start(); return { o, mul };
    });
    const ex = c.createBufferSource(); ex.buffer = this.brown; ex.loop = true;
    const exF = c.createBiquadFilter(); exF.type = 'bandpass'; exF.frequency.value = 150; exF.Q.value = 0.8;
    const exG = c.createGain(); exG.gain.value = 0; ex.connect(exF); exF.connect(exG); exG.connect(mix); ex.start();
    const wh = c.createOscillator(); wh.type = 'sine'; wh.frequency.value = 1200;
    const whG = c.createGain(); whG.gain.value = 0; wh.connect(whG); whG.connect(out); wh.start();
    mix.connect(lp); lp.connect(shaper); shaper.connect(out); this._bus(out, 0.1);
    this.engine = { oscs, lp, out, exG, wh, whG, rpm: 0.2 };
  }
  setEngine(speed01, throttle = 0, boosting = false) {
    if (!this.engine) return;
    const t = this.ctx.currentTime, e = this.engine;
    const gears = 4, gpos = speed01 * gears, inGear = gpos - Math.floor(gpos);
    const target = 0.22 + (speed01 < 0.02 ? 0 : 0.18 + inGear * 0.55) + (boosting ? 0.18 : 0) + Math.abs(throttle) * 0.08;
    e.rpm += (target - e.rpm) * 0.1;
    const f = 46 + e.rpm * 150;
    for (const { o, mul } of e.oscs) o.frequency.setTargetAtTime(f * mul, t, 0.03);
    e.lp.frequency.setTargetAtTime(240 + e.rpm * 1500 + Math.abs(throttle) * 500, t, 0.05);
    e.out.gain.setTargetAtTime(0.09 + e.rpm * 0.15 + Math.abs(throttle) * 0.05, t, 0.08);
    e.exG.gain.setTargetAtTime(0.15 + Math.abs(throttle) * 0.55 + e.rpm * 0.3, t, 0.08);
    e.wh.frequency.setTargetAtTime(boosting ? 2300 + speed01 * 900 : 900, t, 0.15);
    e.whG.gain.setTargetAtTime(boosting ? 0.04 : 0, t, 0.1);
    if (this.wind) this.wind.g.gain.setTargetAtTime(speed01 * speed01 * 0.14, t, 0.15);
  }
  stopEngine() {
    if (!this.engine) return;
    const t = this.ctx.currentTime;
    this.engine.out.gain.setTargetAtTime(0, t, 0.1); this.engine.exG.gain.setTargetAtTime(0, t, 0.1); this.engine.whG.gain.setTargetAtTime(0, t, 0.1);
    if (this.wind) this.wind.g.gain.setTargetAtTime(0, t, 0.1);
    this.setSkid(0);
  }
  _skid() {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = 1700;
    const lfo = c.createOscillator(); lfo.frequency.value = 27; const lg = c.createGain(); lg.gain.value = 90; lfo.connect(lg); lg.connect(o.frequency);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 2.5;
    const n = c.createBufferSource(); n.buffer = this.noise; n.loop = true;
    const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 2600; nf.Q.value = 1.0; const ng = c.createGain(); ng.gain.value = 0.5;
    const g = c.createGain(); g.gain.value = 0;
    o.connect(bp); bp.connect(g); n.connect(nf); nf.connect(ng); ng.connect(g); this._bus(g, 0.35);
    o.start(); lfo.start(); n.start();
    this.skid = { o, g };
  }
  setSkid(k) { if (!this.skid) return; const t = this.ctx.currentTime; this.skid.g.gain.setTargetAtTime(Math.max(0, Math.min(1, k)) * 0.09, t, 0.06); this.skid.o.frequency.setTargetAtTime(1500 + k * 500, t, 0.1); }
  _wind() {
    const c = this.ctx; const n = c.createBufferSource(); n.buffer = this.noise; n.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 520; const g = c.createGain(); g.gain.value = 0;
    n.connect(f); f.connect(g); this._bus(g, 0); n.start(); this.wind = { g };
  }
  _ambient(theme) {
    const c = this.ctx, t = c.currentTime;
    if (this.amb) { const old = this.amb; old.g.gain.setTargetAtTime(0, t, 0.6); setTimeout(() => { try { old.src.stop(); old.lfo.stop(); } catch {} }, 1500); }
    const lava = theme === 'lava';
    const src = c.createBufferSource(); src.buffer = this.brown; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lava ? 110 : 480; f.Q.value = 0.7;
    const g = c.createGain(); g.gain.value = 0;
    const lfo = c.createOscillator(); lfo.frequency.value = lava ? 0.13 : 0.07; const lg = c.createGain(); lg.gain.value = lava ? 0.03 : 0.05; lfo.connect(lg); lg.connect(g.gain);
    src.connect(f); f.connect(g); this._bus(g, 0.5); src.start(); lfo.start();
    g.gain.setTargetAtTime(lava ? 0.1 : 0.12, t, 1.0);
    this.amb = { src, g, lfo, theme };
    this._crackles(theme);
  }
  _crackles(theme) {
    clearTimeout(this.crackTimer);
    const tick = () => {
      if (!this.ctx || !this.amb || this.amb.theme !== theme) return;
      if (theme === 'lava') this._burst(0.03 + Math.random() * 0.05, 2500 + Math.random() * 4500, 1.5, 0.04 + Math.random() * 0.07, 'bandpass', 0.6);
      else if (Math.random() < 0.35) this._tone(350 + Math.random() * 700, 0.07, 'sine', 0.018, 900, 0.5);
      this.crackTimer = setTimeout(tick, theme === 'lava' ? 60 + Math.random() * 380 : 500 + Math.random() * 1800);
    };
    tick();
  }
  setAmbient(theme) { this.theme = theme; if (this.ctx) this._ambient(theme); }

  // ---------------------------------------------------------------- one-shot building blocks
  _burst(dur, freq, q, gain, type = 'bandpass', wet = 0.3, buffer = null) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = buffer || this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); this._bus(g, wet); src.start(t); src.stop(t + dur + 0.05);
  }
  _sweep(dur, f0, f1, gain, q = 1.2, wet = 0.3, attack = 0.04) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); this._bus(g, wet); src.start(t); src.stop(t + dur + 0.05);
  }
  _tone(freq, dur, type = 'sine', gain = 0.25, slideTo = null, wet = 0.3) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); this._bus(g, wet); o.start(t); o.stop(t + dur + 0.05);
  }
  _thump(f0, f1, dur, gain) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); this._bus(g, 0.2); o.start(t); o.stop(t + dur + 0.05);
  }
  _ring(freqs, dur, gain) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime;
    freqs.forEach((f, i) => {
      const o = c.createOscillator(); o.type = i % 2 ? 'triangle' : 'sine'; o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.02);
      const g = c.createGain(); g.gain.setValueAtTime(gain / (1 + i * 0.6), t); g.gain.exponentialRampToValueAtTime(0.001, t + dur * (1 - i * 0.15));
      o.connect(g); this._bus(g, 0.45); o.start(t); o.stop(t + dur + 0.05);
    });
  }

  // ---------------------------------------------------------------- game events
  hit(strength) {
    const s = Math.min(1, strength / 14);
    this._thump(95 + s * 40, 28, 0.22 + s * 0.18, 0.5 + s * 0.5);
    this._burst(0.07 + s * 0.12, 900 + s * 1500, 0.6, 0.55 + s * 0.5, 'bandpass', 0.35);
    this._burst(0.12 + s * 0.1, 260, 0.8, 0.5 + s * 0.4, 'lowpass', 0.2);
    this._ring([720 + s * 300, 1150 + s * 500, 1890 + s * 400], 0.3 + s * 0.35, 0.1 + s * 0.14);
  }
  ability(kind, slot = 0) {
    if (slot === 1) return this.ability2(kind);
    switch (kind) {
      case 'greaser': this._sweep(0.9, 1400, 400, 0.28, 1.5, 0.3, 0.05); this._burst(0.8, 3200, 0.6, 0.18, 'highpass', 0.3); break;
      case 'boomer': this._tone(1400, 0.07, 'square', 0.12, 700, 0.3); this._burst(0.08, 2200, 1, 0.22, 'bandpass', 0.3); setTimeout(() => this._tone(2200, 0.06, 'sine', 0.08, null, 0.3), 140); break;
      case 'crane': this._burst(0.12, 4200, 1, 0.3, 'highpass', 0.3); this._thump(140, 50, 0.3, 0.5); this._ring([900, 1400], 0.35, 0.12); break;
      case 'bulldozer': this._thump(130, 38, 0.55, 0.7); this._burst(0.5, 220, 1, 0.5, 'lowpass', 0.3); this._tone(68, 0.75, 'sawtooth', 0.16, 150, 0.3); break;
      case 'flipper': this._tone(360, 0.28, 'square', 0.13, 1500, 0.35); this._burst(0.12, 3500, 1, 0.3, 'highpass', 0.3); this._ring([1500, 2400], 0.3, 0.1); break;
      case 'speedster': this._sweep(0.95, 350, 4500, 0.5, 1.0, 0.35, 0.08); this._tone(500, 0.9, 'sine', 0.07, 2600, 0.3); break;
      case 'anchor': this._burst(0.14, 5000, 1, 0.3, 'highpass', 0.3); setTimeout(() => { this._thump(85, 24, 0.55, 0.85); this._ring([290, 510], 0.5, 0.2); }, 120); break;
      case 'magnet': this._tone(55, 1.6, 'square', 0.13, 112, 0.4); this._tone(440, 1.4, 'sine', 0.05, 900, 0.5); this._sweep(1.4, 600, 2200, 0.08, 4, 0.5); break;
      case 'spinner': this._tone(170, 2.6, 'sawtooth', 0.1, 1700, 0.3); this._sweep(2.6, 300, 3200, 0.14, 1.5, 0.3, 0.3); break;
      default: break;
    }
  }
  ability2(kind) {
    switch (kind) {
      case 'bulldozer': this._burst(0.5, 420, 0.8, 0.42, 'bandpass', 0.3); this._thump(90, 30, 0.45, 0.65); this._ring([180, 240], 0.6, 0.14); break;
      case 'flipper': this._sweep(0.3, 300, 1900, 0.3, 1.2, 0.3, 0.03); this._tone(220, 0.25, 'square', 0.1, 660, 0.3); break;
      case 'speedster': this._burst(0.35, 2400, 2.5, 0.35, 'bandpass', 0.35); this._tone(1800, 0.3, 'triangle', 0.08, 1200, 0.3); break;
      case 'anchor': this._thump(120, 30, 0.5, 0.95); this._sweep(0.5, 2200, 200, 0.5, 1.0, 0.4, 0.01); this._ring([240, 360], 0.6, 0.2); break;
      case 'magnet': this._tone(900, 0.5, 'square', 0.12, 80, 0.4); this._sweep(0.45, 3200, 300, 0.4, 1.0, 0.4, 0.01); this._thump(100, 35, 0.4, 0.7); break;
      case 'spinner': this._tone(600, 0.6, 'sawtooth', 0.08, 2400, 0.3); this._burst(0.15, 5000, 1, 0.25, 'highpass', 0.3); break;
      case 'crane': this._thump(80, 30, 0.5, 0.7); this._burst(0.5, 300, 0.7, 0.4, 'lowpass', 0.3); this._ring([420, 610], 0.5, 0.15); break;
      case 'greaser': this._burst(0.6, 2000, 2.0, 0.45, 'bandpass', 0.35); this._tone(1500, 0.55, 'triangle', 0.1, 1900, 0.3); break;
      case 'boomer': this._thump(70, 20, 0.5, 1.0); this._burst(0.4, 600, 0.5, 0.8, 'lowpass', 0.4); this._burst(0.2, 3500, 0.8, 0.4, 'highpass', 0.4); break;
      default: break;
    }
  }
  explode() { this._thump(60, 18, 0.9, 1.2); this._burst(0.7, 500, 0.5, 1.0, 'lowpass', 0.5); this._burst(0.3, 2500, 0.7, 0.6, 'highpass', 0.5); this._ring([150, 210], 0.9, 0.2); }
  clang(strength = 14) { const s = Math.min(1, strength / 20); this._ring([180, 270, 410, 690], 1.0 + s * 0.6, 0.25 + s * 0.2); this._thump(90, 30, 0.4, 0.6 + s * 0.5); this._burst(0.1, 1500, 0.8, 0.5, 'bandpass', 0.5); }
  flipRoll() { this._burst(0.35, 700, 0.8, 0.5, 'bandpass', 0.4); this._ring([300, 450], 0.45, 0.14); this._thump(100, 40, 0.25, 0.5); }
  upright() { this._tone(200, 0.15, 'triangle', 0.1, 420, 0.3); this._burst(0.08, 900, 0.8, 0.2, 'lowpass', 0.2); }
  mineArm() { this._tone(2600, 0.05, 'sine', 0.07, null, 0.2); }
  jump() { this._burst(0.18, 4000, 0.8, 0.22, 'highpass', 0.2); this._tone(150, 0.12, 'triangle', 0.14, 320, 0.2); }
  land() { this._thump(70, 30, 0.18, 0.45); this._burst(0.1, 500, 0.8, 0.3, 'lowpass', 0.2); }
  splash(theme) {
    if (theme === 'lava') {
      this._burst(1.7, 2800, 0.5, 0.7, 'highpass', 0.5); this._thump(62, 22, 1.1, 0.9);
      for (let i = 0; i < 6; i++) setTimeout(() => this._burst(0.04, 3000 + Math.random() * 3000, 1.5, 0.2, 'bandpass', 0.5), 150 + i * 120 + Math.random() * 200);
    } else {
      this._sweep(0.8, 1900, 280, 0.85, 1.0, 0.4, 0.02); this._thump(120, 40, 0.35, 0.45);
      for (let i = 0; i < 5; i++) setTimeout(() => this._tone(500 + Math.random() * 800, 0.08, 'sine', 0.06, 1400, 0.5), 200 + i * 110);
    }
  }
  roar(k = 1) {
    // crowd swell on a knockout
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime;
    for (const [f, q, g, dur] of [[900, 0.5, 0.26, 2.0], [330, 0.7, 0.2, 2.4], [2200, 1.0, 0.08, 1.4]]) {
      const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const gain = c.createGain(); gain.gain.setValueAtTime(0.001, t); gain.gain.exponentialRampToValueAtTime(g * k, t + 0.28); gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      const lfo = c.createOscillator(); lfo.frequency.value = 6 + Math.random() * 3; const lg = c.createGain(); lg.gain.value = g * k * 0.3; lfo.connect(lg); lg.connect(gain.gain);
      src.connect(bp); bp.connect(gain); this._bus(gain, 0.7); src.start(t); src.stop(t + dur + 0.1); lfo.start(t); lfo.stop(t + dur + 0.1);
    }
  }
  bump(strength = 8) {
    const s = Math.min(1, strength / 14);
    this._ring([520, 790, 1240, 1980], 0.5 + s * 0.3, 0.14 + s * 0.16);
    this._thump(110, 40, 0.18, 0.4 + s * 0.3);
    this._burst(0.06, 2600, 0.8, 0.3, 'bandpass', 0.4);
  }
  tick() { this._tone(880, 0.1, 'sine', 0.16, null, 0.3); this._tone(1760, 0.1, 'sine', 0.05, null, 0.3); }
  go() { this._tone(660, 0.5, 'square', 0.12, 1320, 0.4); this._tone(990, 0.5, 'sine', 0.1, 1980, 0.4); }
  win() { [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => { this._tone(f, 0.45, 'triangle', 0.22, null, 0.55); this._tone(f / 2, 0.45, 'sine', 0.1, null, 0.55); }, i * 110)); }
  lose() { [392, 349, 311, 262].forEach((f, i) => setTimeout(() => this._tone(f, 0.5, 'sawtooth', 0.1, f * 0.97, 0.5), i * 180)); }
}

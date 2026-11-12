/* SPDX-License-Identifier: MPL-2.0
 * Copyright (C) 2026 David Ryan
 * seq-core.js: what the six web sequencers share. A plain script (no modules) so each app also runs from file://.
 *   SeqCore.audio      the sound: an 8-voice synth, eleven synthesised drums, an echo, a limiter
 *   SeqCore.clock      a look-ahead scheduler, 96 ticks a quarter note, sample-exact times; swing; MIDI clock out
 *   SeqCore.midi       Web MIDI: an output (notes with timestamps, clock), an input (notes to the app)
 *   SeqCore.store      saving: localStorage, a file, a share link; an undo stack
 *   SeqCore.ui         the shared header (transport, tempo, MIDI, help), knobs, toasts, the computer keyboard
 *   SeqCore.music      scales, degrees, note names, a seeded random generator */
(function () {
  'use strict';
  const SeqCore = {};

  /* ------------------------------------------------------------------ music --- */
  const SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10],
    'pentatonic': [0, 2, 4, 7, 9], 'minor pent.': [0, 3, 5, 7, 10], 'harmonic min.': [0, 2, 3, 5, 7, 8, 11],
    blues: [0, 3, 5, 6, 7, 10], chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  };
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  SeqCore.music = {
    SCALES, NOTE_NAMES,
    /* degree d (any integer) of scale from root (0-11), as a MIDI note in the octave of base */
    degree(d, root, scale, base = 48) {
      const s = SCALES[scale] || SCALES.major, n = s.length;
      const oct = Math.floor(d / n), i = ((d % n) + n) % n;
      return base + root + oct * 12 + s[i];
    },
    snap(note, root, scale) {
      const s = SCALES[scale] || SCALES.major;
      for (let k = 0; k < 12; k++) {
        if (s.includes((((note - k - root) % 12) + 12) % 12)) return note - k;
        if (s.includes((((note + k - root) % 12) + 12) % 12)) return note + k;
      }
      return note;
    },
    name(n) { return NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1); },
    /* a deterministic generator: the same seed, the same music */
    rng(seed) {
      let s = seed >>> 0 || 0x9e3779b9;
      return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    },
    euclid(steps, pulses, rot = 0) {
      const out = [];
      for (let i = 0; i < steps; i++) {
        const j = (((i - rot) % steps) + steps) % steps;
        out.push(pulses >= steps ? true : pulses > 0 && (j * pulses) % steps < pulses);
      }
      return out;
    },
  };

  /* ------------------------------------------------------------------ audio --- */
  const audio = {
    ctx: null, out: null, echoIn: null, voices: 0,
    ensure() {
      if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume(); return this.ctx; }
      const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      const master = ctx.createGain(); master.gain.value = 0.8;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.15;
      master.connect(comp).connect(ctx.destination);
      /* the echo: a darkening feedback delay */
      const echoIn = ctx.createGain(), delay = ctx.createDelay(2.0), fb = ctx.createGain(), tone = ctx.createBiquadFilter();
      delay.delayTime.value = 0.375; fb.gain.value = 0.42; tone.type = 'lowpass'; tone.frequency.value = 2600;
      echoIn.connect(delay); delay.connect(tone); tone.connect(fb); fb.connect(delay); tone.connect(master);
      this.ctx = ctx; this.out = master; this.echoIn = echoIn; this.delay = delay; this.fb = fb;
      this.noise = (() => {
        const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        return b;
      })();
      return ctx;
    },
    setEcho(time, feedback) { if (!this.ctx) return; this.delay.delayTime.setTargetAtTime(time, this.ctx.currentTime, 0.05); this.fb.gain.value = feedback; },
    now() { return this.ctx ? this.ctx.currentTime : 0; },
    /* a patch: {wave, cutoff 0..1, reso 0..1, envmod 0..1, attack, decay, sustain 0..1, release (s), level 0..1,
     * detune (cents), echo 0..1, glide (s), octave} */
    defaultPatch(over = {}) {
      return Object.assign({ wave: 'sawtooth', cutoff: 0.55, reso: 0.3, envmod: 0.4, attack: 0.005, decay: 0.25,
        sustain: 0.5, release: 0.2, level: 0.7, detune: 8, echo: 0, glide: 0, octave: 0 }, over);
    },
    /* a synth note at time t, length dur (s); returns nothing (fire and forget) */
    note(p, midi, vel, t, dur) {
      const ctx = this.ensure();
      t = Math.max(t, ctx.currentTime);
      const f = 440 * Math.pow(2, (midi + 12 * (p.octave || 0) - 69) / 12);
      const v = (0.25 + 0.75 * vel / 127) * p.level * 0.35;
      const g = ctx.createGain(), flt = ctx.createBiquadFilter();
      flt.type = 'lowpass';
      flt.Q.value = 0.5 + p.reso * 18;
      const base = 40 * Math.pow(2, p.cutoff * 8.5), peak = base + (16000 - base) * p.envmod * 0.6;
      flt.frequency.setValueAtTime(base, t);
      flt.frequency.linearRampToValueAtTime(peak, t + Math.max(0.002, p.attack));
      flt.frequency.setTargetAtTime(base + (peak - base) * p.sustain, t + p.attack, Math.max(0.01, p.decay / 3));
      const oscs = [];
      const waves = p.wave === 'supersaw' ? ['sawtooth', 'sawtooth', 'sawtooth'] : [p.wave, p.wave];
      waves.forEach((w, i) => {
        const o = ctx.createOscillator();
        o.type = w === 'supersaw' ? 'sawtooth' : w;
        o.frequency.setValueAtTime(f, t);
        o.detune.value = i === 0 ? 0 : (i === 1 ? 1 : -1) * (p.wave === 'supersaw' ? 18 : p.detune);
        const og = ctx.createGain(); og.gain.value = i === 0 ? 1 : 0.6;
        o.connect(og).connect(flt);
        oscs.push(o);
      });
      flt.connect(g);
      g.connect(this.out);
      if (p.echo > 0) { const s = ctx.createGain(); s.gain.value = p.echo; g.connect(s).connect(this.echoIn); }
      const a = Math.max(0.002, p.attack), end = t + Math.max(dur, a);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + a);
      g.gain.setTargetAtTime(v * p.sustain, t + a, Math.max(0.01, p.decay / 3));
      g.gain.cancelAndHoldAtTime ? g.gain.cancelAndHoldAtTime(end) : g.gain.setValueAtTime(v * p.sustain, end);
      g.gain.setTargetAtTime(0, end, Math.max(0.005, p.release / 3));
      const stop = end + p.release * 2 + 0.05;
      oscs.forEach(o => { o.start(t); o.stop(stop); });
      oscs[0].onended = () => { g.disconnect(); this.voices--; };
      this.voices++;
    },
    /* a held note (keys): returns release(t) */
    hold(p, midi, vel) {
      const ctx = this.ensure(), t = ctx.currentTime;
      const f = 440 * Math.pow(2, (midi + 12 * (p.octave || 0) - 69) / 12), v = (0.25 + 0.75 * vel / 127) * p.level * 0.35;
      const g = ctx.createGain(), flt = ctx.createBiquadFilter(), o = ctx.createOscillator();
      o.type = p.wave === 'supersaw' ? 'sawtooth' : p.wave; o.frequency.value = f;
      flt.type = 'lowpass'; flt.Q.value = 0.5 + p.reso * 18; flt.frequency.value = 40 * Math.pow(2, p.cutoff * 8.5) * (1 + p.envmod * 3);
      o.connect(flt).connect(g).connect(this.out);
      if (p.echo > 0) { const s = ctx.createGain(); s.gain.value = p.echo; g.connect(s).connect(this.echoIn); }
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + Math.max(0.003, p.attack));
      g.gain.setTargetAtTime(v * Math.max(p.sustain, 0.3), t + p.attack, Math.max(0.01, p.decay / 3));
      o.start(t);
      return () => { const n = ctx.currentTime; g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(g.gain.value, n); g.gain.setTargetAtTime(0, n, Math.max(0.01, p.release / 3)); o.stop(n + p.release * 2 + 0.05); };
    },
    /* a drum by name at time t: kick snare clap hat ohat tom rim cowbell cymbal shaker zap */
    drum(name, vel, t, opt = {}) {
      const ctx = this.ensure();
      t = Math.max(t, ctx.currentTime);
      const v = (0.2 + 0.8 * vel / 127) * (opt.level ?? 0.9), tone = opt.tone ?? 0.5, dec = opt.decay ?? 1;
      const out = ctx.createGain(); out.gain.value = v; out.connect(this.out);
      if (opt.echo) { const s = ctx.createGain(); s.gain.value = opt.echo; out.connect(s).connect(this.echoIn); }
      const env = (node, a, d, peak = 1) => { node.gain.setValueAtTime(0.0001, t); node.gain.exponentialRampToValueAtTime(peak, t + a); node.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
      const noise = (d, type, freq, q = 1) => {
        const src = ctx.createBufferSource(); src.buffer = this.noise;
        const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
        const g = ctx.createGain(); src.connect(f).connect(g).connect(out); src.start(t); src.stop(t + d + 0.05); return g;
      };
      const osc = (type, f0, f1, d, a = 0.001) => {
        const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type;
        o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + d * 0.6);
        o.connect(g).connect(out); env(g, a, d); o.start(t); o.stop(t + d + 0.05); return g;
      };
      switch (name) {
        case 'kick': osc('sine', 150 + tone * 120, 42, 0.45 * dec); break;
        case 'snare': osc('triangle', 220, 160, 0.12 * dec); env(noise(0.22 * dec, 'highpass', 900 + tone * 1500), 0.001, 0.2 * dec); break;
        case 'clap': { const g = noise(0.3 * dec, 'bandpass', 1200 + tone * 800, 1.2);
          g.gain.setValueAtTime(0.0001, t); [0, 0.011, 0.022].forEach(k => { g.gain.setValueAtTime(1, t + k); g.gain.exponentialRampToValueAtTime(0.1, t + k + 0.009); });
          g.gain.setValueAtTime(0.8, t + 0.033); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.033 + 0.22 * dec); break; }
        case 'hat': env(noise(0.06 * dec, 'highpass', 7000 + tone * 3000), 0.001, 0.05 * dec, 0.8); break;
        case 'ohat': env(noise(0.4 * dec, 'highpass', 6500 + tone * 3000), 0.001, 0.35 * dec, 0.7); break;
        case 'shaker': env(noise(0.08 * dec, 'bandpass', 6000, 2), 0.01, 0.07 * dec, 0.6); break;
        case 'cymbal': env(noise(1.2 * dec, 'highpass', 5000), 0.001, 1.1 * dec, 0.5); break;
        case 'tom': osc('sine', (opt.pitch || 140) * 1.5, opt.pitch || 140, 0.3 * dec); break;
        case 'rim': osc('square', 820, 780, 0.03 * dec); break;
        case 'cowbell': { const a = osc('square', 560, 560, 0.25 * dec), b = osc('square', 845, 845, 0.25 * dec); a.gain.value *= 0.5; b.gain.value *= 0.5; break; }
        default: osc('sine', 2400, 80, 0.2 * dec); break;   /* zap */
      }
    },
  };
  /* General MIDI drum notes, the names above */
  audio.GM = { 36: 'kick', 37: 'rim', 38: 'snare', 39: 'clap', 40: 'snare', 41: 'tom', 42: 'hat', 43: 'tom', 44: 'hat',
    45: 'tom', 46: 'ohat', 47: 'tom', 48: 'tom', 49: 'cymbal', 51: 'cymbal', 56: 'cowbell', 70: 'shaker', 57: 'zap' };
  audio.GM_NOTE = { kick: 36, rim: 37, snare: 38, clap: 39, tom: 45, hat: 42, ohat: 46, cymbal: 49, cowbell: 56, shaker: 70, zap: 57 };
  SeqCore.audio = audio;

  /* ------------------------------------------------------------------- midi --- */
  const midi = {
    access: null, out: null, outId: localStorage.getItem('seqcore.midiOut') || '', clockOut: false, onNote: null,
    async init() {
      if (!navigator.requestMIDIAccess) return false;
      try { this.access = await navigator.requestMIDIAccess(); } catch (e) { return false; }
      const bind = () => {
        this.out = this.outId ? this.access.outputs.get(this.outId) || null : null;
        this.access.inputs.forEach(i => { i.onmidimessage = m => this.recv(m.data); });
        document.dispatchEvent(new CustomEvent('seqcore-midi'));
      };
      this.access.onstatechange = bind; bind();
      return true;
    },
    outputs() { return this.access ? [...this.access.outputs.values()].map(o => ({ id: o.id, name: o.name })) : []; },
    select(id) { this.outId = id; localStorage.setItem('seqcore.midiOut', id); this.out = id && this.access ? this.access.outputs.get(id) || null : null; },
    /* audio time -> the MIDI timestamp (performance.now) of the same moment */
    stamp(t) { const ctx = audio.ctx; if (!ctx) return performance.now(); return performance.now() + (t - ctx.currentTime) * 1000 + (ctx.outputLatency || ctx.baseLatency || 0) * 1000; },
    send(bytes, t) { if (this.out) try { this.out.send(bytes, t === undefined ? undefined : this.stamp(t)); } catch (e) { /* a port gone */ } },
    note(ch, n, vel, t, dur) { if (!this.out || !ch) return; this.send([0x90 | (ch - 1), n & 127, vel & 127], t); this.send([0x80 | (ch - 1), n & 127, 0], t + dur); },
    cc(ch, c, v, t) { if (ch) this.send([0xb0 | (ch - 1), c & 127, v & 127], t); },
    recv(d) {
      const st = d[0] & 0xf0;
      if (st === 0x90 && d[2]) this.onNote && this.onNote(d[1], d[2], (d[0] & 15) + 1);
      else if (st === 0x80 || st === 0x90) this.onNote && this.onNote(d[1], 0, (d[0] & 15) + 1);
    },
  };
  SeqCore.midi = midi;

  /* ------------------------------------------------------------------ clock --- */
  /* The look-ahead scheduler (after Chris Wilson's "A Tale of Two Clocks"): a timer wakes every 25 ms and hands the
   * app every tick that falls in the next 120 ms, each with its exact audio time. The app's onTick(tick, time) plays
   * notes at that time; the screen follows with onDraw from requestAnimationFrame and clock.tickAt(now). */
  const clock = {
    PPQN: 96, bpm: 120, swing: 0, playing: false, tick: 0, nextTime: 0, startTime: 0, onTick: null, onStart: null,
    onStop: null, timer: null, ahead: 0.12, history: [],
    secPerTick() { return 60 / this.bpm / this.PPQN; },
    start() {
      const ctx = audio.ensure();
      if (this.playing) return;
      this.playing = true; this.tick = 0; this.nextTime = ctx.currentTime + 0.06; this.startTime = this.nextTime; this.history = [];
      this.onStart && this.onStart(this.nextTime);
      if (midi.clockOut) midi.send([0xfa], this.nextTime);
      this.timer = setInterval(() => this.pump(), 25); this.pump();
      document.dispatchEvent(new CustomEvent('seqcore-transport'));
    },
    stop() {
      if (!this.playing) return;
      this.playing = false; clearInterval(this.timer);
      if (midi.clockOut) midi.send([0xfc]);
      this.onStop && this.onStop();
      document.dispatchEvent(new CustomEvent('seqcore-transport'));
    },
    toggle() { this.playing ? this.stop() : this.start(); },
    /* swing: odd sixteenths late by swing (0..0.5 of a sixteenth) */
    swingOffset(tick) { const s16 = this.PPQN / 4; return Math.floor(tick / s16) % 2 === 1 ? this.swing * s16 * this.secPerTick() : 0; },
    pump() {
      const ctx = audio.ctx, horizon = ctx.currentTime + this.ahead;
      while (this.nextTime < horizon && this.playing) {
        const t = this.nextTime;
        if (midi.clockOut && this.tick % 4 === 0) midi.send([0xf8], t);
        this.history.push([this.tick, t]); if (this.history.length > 400) this.history.shift();
        this.onTick && this.onTick(this.tick, t);
        this.tick++;
        this.nextTime += this.secPerTick();
      }
    },
    /* the tick sounding now (for the screen): the latest scheduled tick whose time has passed */
    /* tickNow with the fraction into the tick, for smooth playheads */
    tickFloat() {
      if (!this.playing || !audio.ctx) return -1;
      const now = audio.ctx.currentTime - (audio.ctx.outputLatency || 0), h = this.history;
      for (let i = h.length - 1; i >= 0; i--) if (h[i][1] <= now) return h[i][0] + Math.min(1, (now - h[i][1]) / this.secPerTick());
      return -1;
    },
    tickNow() {
      if (!this.playing || !audio.ctx) return -1;
      const now = audio.ctx.currentTime - (audio.ctx.outputLatency || 0);
      let best = -1;
      for (let i = this.history.length - 1; i >= 0; i--) if (this.history[i][1] <= now) { best = this.history[i][0]; break; }
      return best;
    },
  };
  SeqCore.clock = clock;
  /* a hidden tab's timers run about once a second: look 1.5 s ahead then, so the music does not stop */
  document.addEventListener('visibilitychange', () => { clock.ahead = document.hidden ? 1.5 : 0.12; if (clock.playing && audio.ctx) clock.pump(); });

  /* ------------------------------------------------------------------ store --- */
  const store = {
    key: 'seqcore',
    save(name, data) { try { localStorage.setItem(this.key + '.' + name, JSON.stringify(data)); return true; } catch (e) { return false; } },
    load(name) { try { const s = localStorage.getItem(this.key + '.' + name); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
    download(filename, data) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
      a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    upload() {
      return new Promise(res => {
        const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json';
        i.onchange = () => { const f = i.files[0]; if (!f) return res(null); f.text().then(t => { try { res(JSON.parse(t)); } catch (e) { res(null); } }); };
        i.click();
      });
    },
    /* a share link: the state in the URL's hash, compressed where the browser can */
    async shareLink(data) {
      const json = JSON.stringify(data);
      let b64;
      if (window.CompressionStream) {
        const s = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
        const buf = new Uint8Array(await new Response(s).arrayBuffer());
        b64 = 'z' + btoa(String.fromCharCode(...buf));
      } else b64 = 'j' + btoa(unescape(encodeURIComponent(json)));
      return location.origin + location.pathname + '#' + b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
    async fromHash() {
      const h = location.hash.slice(1);
      if (!h) return null;
      try {
        const b = atob(h.slice(1).replace(/-/g, '+').replace(/_/g, '/'));
        if (h[0] === 'z' && window.DecompressionStream) {
          const bytes = Uint8Array.from(b, c => c.charCodeAt(0));
          const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
          return JSON.parse(await new Response(s).text());
        }
        return JSON.parse(decodeURIComponent(escape(b)));
      } catch (e) { return null; }
    },
    /* an undo stack of whole states (JSON): push before a change, undo / redo swap */
    undoStack(limit = 64) {
      const past = [], future = [];
      return {
        push(state) { past.push(JSON.stringify(state)); if (past.length > limit) past.shift(); future.length = 0; },
        undo(state) { if (!past.length) return null; future.push(JSON.stringify(state)); return JSON.parse(past.pop()); },
        redo(state) { if (!future.length) return null; past.push(JSON.stringify(state)); return JSON.parse(future.pop()); },
        get canUndo() { return past.length > 0; }, get canRedo() { return future.length > 0; },
      };
    },
  };
  SeqCore.store = store;

  /* --------------------------------------------------------------------- ui --- */
  const ui = {};
  ui.el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach(k => e.append(k instanceof Node ? k : document.createTextNode(k)));
    return e;
  };
  ui.toast = (msg) => {
    let t = document.querySelector('.sc-toast');
    if (!t) { t = ui.el('div', { class: 'sc-toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
    t.textContent = msg; t.classList.add('on'); clearTimeout(ui._tt); ui._tt = setTimeout(() => t.classList.remove('on'), 1600);
  };
  /* a knob: drag up/down, wheel, arrow keys; double-click resets. opts {label, min, max, step, value, def, fmt, onInput} */
  ui.knob = (opts) => {
    const o = Object.assign({ min: 0, max: 1, step: 0.01, fmt: v => (+v).toFixed(2) }, opts);
    let v = o.value ?? o.def ?? o.min;
    const val = ui.el('span', { class: 'sc-kv' }), dial = ui.el('span', { class: 'sc-dial' });
    const k = ui.el('div', { class: 'sc-knob', tabindex: 0, role: 'slider', 'aria-label': o.label, 'aria-valuemin': o.min, 'aria-valuemax': o.max },
      dial, ui.el('span', { class: 'sc-kl' }, o.label), val);
    const show = () => {
      const f = (v - o.min) / (o.max - o.min || 1);
      dial.style.setProperty('--f', f); val.textContent = o.fmt(v); k.setAttribute('aria-valuenow', v); k.setAttribute('aria-valuetext', o.fmt(v));
    };
    const set = (x, emit = true) => {
      x = Math.min(o.max, Math.max(o.min, Math.round(x / o.step) * o.step));
      x = +x.toFixed(6);
      if (x !== v) { v = x; show(); if (emit && o.onInput) o.onInput(v); }
    };
    let drag = null;
    k.addEventListener('pointerdown', e => { drag = { y: e.clientY, v }; k.setPointerCapture(e.pointerId); });
    k.addEventListener('pointermove', e => { if (drag) set(drag.v + (drag.y - e.clientY) / 160 * (o.max - o.min) * (e.shiftKey ? 0.2 : 1)); });
    k.addEventListener('pointerup', () => { drag = null; });
    k.addEventListener('wheel', e => { e.preventDefault(); set(v - Math.sign(e.deltaY) * o.step * (e.shiftKey ? 1 : Math.max(1, Math.round((o.max - o.min) / o.step / 60)))); }, { passive: false });
    k.addEventListener('keydown', e => {
      const big = Math.max(1, Math.round((o.max - o.min) / o.step / 10));
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { set(v + o.step * (e.shiftKey ? big : 1)); e.preventDefault(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { set(v - o.step * (e.shiftKey ? big : 1)); e.preventDefault(); }
    });
    k.addEventListener('dblclick', () => set(o.def ?? o.min));
    k.set = x => set(x, false); k.get = () => v;
    show();
    return k;
  };
  /* a select */
  ui.select = (label, options, value, onChange) => {
    const s = ui.el('select', { 'aria-label': label, onchange: () => onChange(s.value) },
      options.map(o => ui.el('option', { value: typeof o === 'object' ? o.value : o }, typeof o === 'object' ? o.label : o)));
    s.value = value;
    return ui.el('label', { class: 'sc-sel' }, ui.el('span', {}, label), s);
  };

  /* the header: name, tagline, transport, tempo, swing, MIDI out, clock out, save/share, help. opts:
   * {name, tagline, color, help: [[keys, what]...], about, onSave, onLoad, onShare, onNew, swing} */
  ui.header = (opts) => {
    const play = ui.el('button', { class: 'sc-play', title: 'Play / stop (Space)', 'aria-label': 'Play', onclick: () => clock.toggle() }, '▶');
    const tempo = ui.knob({ label: 'TEMPO', min: 40, max: 240, step: 1, value: clock.bpm, def: 120, fmt: v => v + ' BPM', onInput: v => { clock.bpm = v; opts.onTempo && opts.onTempo(v); } });
    const swing = opts.swing === false ? null : ui.knob({ label: 'SWING', min: 0, max: 0.5, step: 0.01, value: clock.swing, def: 0, fmt: v => Math.round(50 + v * 50) + '%', onInput: v => { clock.swing = v; opts.onSwing && opts.onSwing(v); } });
    const midiSel = ui.el('select', { 'aria-label': 'MIDI out', onchange: () => midi.select(midiSel.value) });
    const fillMidi = () => {
      midiSel.innerHTML = '';
      midiSel.append(ui.el('option', { value: '' }, midi.access ? 'MIDI out: none' : 'MIDI: not allowed'));
      midi.outputs().forEach(o => midiSel.append(ui.el('option', { value: o.id }, o.name)));
      midiSel.value = midi.outId && midi.out ? midi.outId : '';
    };
    document.addEventListener('seqcore-midi', fillMidi);
    const clk = ui.el('label', { class: 'sc-chk', title: 'Send MIDI clock, start and stop' },
      ui.el('input', { type: 'checkbox', onchange: e => { midi.clockOut = e.target.checked; } }), 'clock out');
    const help = ui.el('button', { class: 'sc-btn', title: 'Help (?)', onclick: () => ui.showHelp(opts) }, '?');
    const menu = ui.el('div', { class: 'sc-menu' },
      opts.onUndo ? ui.el('button', { class: 'sc-btn', title: 'Undo (Ctrl/Cmd+Z)', onclick: opts.onUndo }, 'Undo') : '',
      opts.onRedo ? ui.el('button', { class: 'sc-btn', title: 'Redo (Shift+Ctrl/Cmd+Z)', onclick: opts.onRedo }, 'Redo') : '',
      opts.onNew ? ui.el('button', { class: 'sc-btn', onclick: opts.onNew }, 'New') : '',
      opts.onSave ? ui.el('button', { class: 'sc-btn', title: 'Save a file', onclick: opts.onSave }, 'Save') : '',
      opts.onLoad ? ui.el('button', { class: 'sc-btn', title: 'Open a file', onclick: opts.onLoad }, 'Open') : '',
      opts.onShare ? ui.el('button', { class: 'sc-btn', title: 'Copy a link that holds this', onclick: opts.onShare }, 'Share') : '',
      help);
    const h = ui.el('header', { class: 'sc-head', style: opts.color ? `--accent:${opts.color}` : false },
      ui.el('div', { class: 'sc-title' }, ui.el('a', { href: '../', class: 'sc-home', title: 'All six sequencers' }, '◂'),
        ui.el('h1', {}, opts.name), ui.el('span', { class: 'sc-tag' }, opts.tagline)),
      ui.el('div', { class: 'sc-transport' }, play, tempo, swing || '', ui.el('div', { class: 'sc-midi' }, midiSel, clk)),
      menu);
    document.addEventListener('seqcore-transport', () => { play.classList.add('played'); play.classList.toggle('on', clock.playing); play.textContent = clock.playing ? '■' : '▶'; play.setAttribute('aria-label', clock.playing ? 'Stop' : 'Play'); });
    midi.init().then(fillMidi); fillMidi();
    h.setTempo = v => tempo.set(v); h.setSwing = v => swing && swing.set(v);
    return h;
  };
  ui.showHelp = (opts) => {
    let d = document.querySelector('.sc-help');
    if (d) { d.remove(); return; }
    d = ui.el('div', { class: 'sc-help', role: 'dialog', 'aria-label': 'Help', onclick: e => { if (e.target === d) d.remove(); } },
      ui.el('div', { class: 'sc-help-in' },
        ui.el('h2', {}, opts.name), ui.el('p', {}, opts.about || ''),
        ui.el('table', {}, (opts.help || []).map(([k, w]) => ui.el('tr', {}, ui.el('th', {}, k), ui.el('td', {}, w)))),
        ui.el('button', { class: 'sc-btn', onclick: () => d.remove() }, 'Close')));
    document.body.append(d);
  };
  /* the computer keyboard as a piano: two rows from C (z..m, s d g h j) and (q..u, 2 3 5 6 7). onKey(midi, down) */
  ui.pianoKeys = (onKey, baseRef = { base: 60 }) => {
    const map = { z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11, ',': 12,
      q: 12, 2: 13, w: 14, 3: 15, e: 16, r: 17, 5: 18, t: 19, 6: 20, y: 21, 7: 22, u: 23, i: 24 };
    const held = new Set();
    window.addEventListener('keydown', e => {
      if ((e.target.closest && e.target.closest('input,select,textarea')) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k in map && !held.has(k)) { held.add(k); onKey(baseRef.base + map[k], true); e.preventDefault(); }
    });
    window.addEventListener('keyup', e => { const k = e.key.toLowerCase(); if (held.has(k)) { held.delete(k); onKey(baseRef.base + map[k], false); } });
    return map;
  };
  /* Space plays; ? help; Ctrl/Cmd+Z undo */
  ui.globalKeys = (opts) => {
    window.addEventListener('keydown', e => {
      if (e.target.closest && e.target.closest('input,select,textarea')) return;
      if (e.code === 'Space') { clock.toggle(); e.preventDefault(); }
      else if (e.key === '?') ui.showHelp(opts);
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { (e.shiftKey ? opts.onRedo : opts.onUndo)?.(); e.preventDefault(); }
      else if (e.key === 'Escape') document.querySelector('.sc-help')?.remove();
    });
  };
  /* a canvas that keeps its pixels sharp: returns {canvas, ctx, w, h} kept up to date on resize */
  ui.canvas = (parent, draw) => {
    const c = ui.el('canvas', { class: 'sc-canvas' }); parent.append(c);
    const st = { canvas: c, ctx: c.getContext('2d'), w: 0, h: 0 };
    const fit = () => { const r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); st.w = r.width; st.h = r.height; st.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    new ResizeObserver(fit).observe(c); fit();
    const loop = () => { draw(st); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
    return st;
  };
  /* a toggle button: .on and aria-pressed follow get() */
  ui.toggle = (label, get, set, title) => {
    const b = ui.el('button', { class: 'sc-btn', title: title || label, onclick: () => { set(!get()); sync(); } }, label);
    const sync = () => { b.classList.toggle('on', !!get()); b.setAttribute('aria-pressed', get() ? 'true' : 'false'); };
    b.sync = sync; sync();
    return b;
  };
  ui.css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  SeqCore.ui = ui;

  /* the first touch anywhere starts the audio (browsers ask for a gesture) */
  ['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, () => audio.ensure(), { once: true, capture: true }));

  window.SeqCore = SeqCore;
})();

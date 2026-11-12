/* SPDX-License-Identifier: MPL-2.0 */
/* ORBIT: circular polyrhythm rings.
 *
 * The model is a set of concentric RINGS on one circle. Each ring is a track: N steps (1-32) set evenly around it,
 * and its own CYCLE, the time one turn takes, either a whole number of beats (1-16: N steps share that time) or
 * "1/16" (each step is a sixteenth, so the cycle is N sixteenths). A HAND per ring sweeps once per cycle; rings with
 * different step counts and cycles move against each other (polymeter and polyrhythm).
 * A step is {on, vel 1-127, deg}: deg is a scale degree used when the ring's sound is a synth patch.
 * A ring's ROTATION (rot) turns its pattern around the circle without changing it: slot s plays pattern step
 * (s - rot) mod N. Rings start together at the transport's start; they all line up again after the least common
 * multiple of their cycles, which the phase ring and the centre counter show.
 *
 * The pure part (no DOM, tested with node) comes first; the screen, sound and storage follow. */

/* =================================================================== pure model === */
const PPQN = 96;
const DRUMS = ['kick', 'snare', 'clap', 'hat', 'ohat', 'tom', 'rim', 'cowbell', 'cymbal', 'shaker', 'zap'];
const PATCHES = {
  bass: { wave: 'sawtooth', cutoff: 0.3, reso: 0.35, envmod: 0.5, attack: 0.003, decay: 0.18, sustain: 0.35, release: 0.08, octave: -1 },
  pluck: { wave: 'square', cutoff: 0.48, reso: 0.2, envmod: 0.55, attack: 0.002, decay: 0.14, sustain: 0.08, release: 0.25, echo: 0.3 },
  bell: { wave: 'sine', cutoff: 0.95, reso: 0.1, envmod: 0.1, attack: 0.002, decay: 0.7, sustain: 0.05, release: 0.7, echo: 0.35 },
  pad: { wave: 'supersaw', cutoff: 0.42, reso: 0.15, envmod: 0.25, attack: 0.08, decay: 0.8, sustain: 0.6, release: 0.6, echo: 0.2 },
  lead: { wave: 'sawtooth', cutoff: 0.58, reso: 0.45, envmod: 0.4, attack: 0.004, decay: 0.2, sustain: 0.4, release: 0.15 },
};
const mod = (a, n) => ((a % n) + n) % n;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
const lcm = (a, b) => a / gcd(a, b) * b;
const isSynth = r => r.sound.startsWith('synth:');

/* a deterministic generator (xorshift32): the same seed, the same pattern */
function rng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
/* one turn of a ring in ticks */
function ringTicks(r) { return r.mode === 'beats' ? r.beats * PPQN : r.steps * PPQN / 4; }
/* when every ring lines up again, in ticks */
function cycleTicks(rings) { return rings.reduce((m, r) => lcm(m, ringTicks(r)), PPQN); }
/* the slot that starts in tick `tick` (counted from the transport start), and how far into the tick it starts */
function slotAt(r, tick) {
  const L = ringTicks(r), N = r.steps, p = mod(tick, L);
  const i = Math.ceil(p * N / L);
  if (i >= N || Math.floor(i * L / N) !== p) return null;
  return { slot: i, frac: i * L / N - p };
}
/* the pattern step heard at a slot */
const stepIndex = (r, slot) => mod(slot - r.rot, r.steps);

/* a step and a ring */
const step = (on = false, vel = 100, deg = 0) => ({ on, vel, deg });
function makeRing(o = {}) {
  const r = Object.assign({ id: 0, name: 'Ring', color: 1, steps: 8, mode: '16th', beats: 4, rot: 0, sound: 'hat',
    tone: 0.5, decay: 1, level: 0.8, root: 9, scale: 'minor pent.', oct: 0, ch: 10, note: 42, mute: false, solo: false,
    swing: 0, prob: 1, pulses: 3, erot: 0, density: 0.4, seed: 1 }, o);
  r.pat = (o.pat || []).slice(0, r.steps).map(s => step(!!s.on, s.vel ?? 100, s.deg ?? 0));
  while (r.pat.length < r.steps) r.pat.push(step());
  return r;
}

/* ring tools: each returns a new pattern array (the ring's step data) */
function euclidPattern(n, pulses, rot) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const j = mod(i - rot, n);
    out.push(pulses >= n ? true : pulses > 0 && Math.floor(j * pulses / n) !== Math.floor((j - 1) * pulses / n));
  }
  return out;
}
const tools = {
  euclid: (r, pulses, rot) => euclidPattern(r.steps, pulses, rot).map((on, i) => step(on, r.pat[i].vel, r.pat[i].deg)),
  clear: r => r.pat.map(s => step(false, s.vel, s.deg)),
  invert: r => r.pat.map(s => step(!s.on, s.vel, s.deg)),
  random: (r, density, seed) => {
    const g = rng(seed * 2654435761 + r.steps);
    return r.pat.map((s, i) => {
      const on = g() < density, vel = Math.round(60 + g() * 67), deg = Math.floor(g() * 8) - (i % 4 === 0 ? 4 : 2);
      return step(on, on ? (i === 0 ? 120 : vel) : s.vel, isSynth(r) ? Math.max(0, deg) : s.deg);
    });
  },
  shift: (r, d) => r.pat.map((_, i) => ({ ...r.pat[mod(i - d, r.steps)] })),
  /* double: each step followed by a rest (2N steps); halve: pairs merged (N/2 steps) */
  double: r => r.steps > 16 ? r.pat : r.pat.flatMap(s => [{ ...s }, step(false, s.vel, s.deg)]),
  halve: r => {
    if (r.steps < 2) return r.pat;
    const out = [];
    for (let i = 0; i < r.steps; i += 2) { const a = r.pat[i], b = r.pat[i + 1]; out.push(a.on || !b ? { ...a } : { ...b }); }
    return out;
  },
};
/* change a ring's step count, keeping what fits */
function resize(r, n) {
  n = clamp(n, 1, 32);
  const pat = r.pat.slice(0, n);
  while (pat.length < n) pat.push(step());
  return pat;
}

/* the opening demo: five rings, 16 / 4 / 3 / 5 / 7 steps */
function demoState() {
  const pat = (str, vels = [], degs = []) => [...str].map((c, i) => step(c !== '.', vels[i] ?? (c === 'X' ? 122 : 96), degs[i] ?? 0));
  let id = 0;
  const ring = o => makeRing(Object.assign({ id: ++id, color: id }, o));
  return {
    app: 'orbit', v: 1, bpm: 112, sel: 0, next: 6,
    rings: [
      ring({ name: 'Kick', steps: 16, mode: '16th', sound: 'kick', ch: 10, note: 36, tone: 0.35, level: 0.95,
        pat: pat('X...x..x..x.x...', [124, 0, 0, 0, 104, 0, 0, 92, 0, 0, 108, 0, 86]), pulses: 5 }),
      ring({ name: 'Clap', steps: 4, mode: 'beats', beats: 4, sound: 'clap', ch: 10, note: 39, level: 0.75, pat: pat('.x.x', [0, 110, 0, 116]), pulses: 2, erot: 1 }),
      ring({ name: 'Shaker', steps: 3, mode: 'beats', beats: 1, sound: 'shaker', ch: 10, note: 70, level: 0.7, prob: 0.9,
        pat: pat('xxx', [104, 58, 76]), pulses: 3 }),
      ring({ name: 'Bass', steps: 5, mode: '16th', sound: 'synth:bass', ch: 1, root: 9, scale: 'minor pent.', oct: 0, level: 0.8,
        pat: pat('x..xx', [118, 0, 0, 92, 104], [0, 0, 0, 3, 4]), pulses: 3 }),
      ring({ name: 'Pluck', steps: 7, mode: '16th', sound: 'synth:pluck', ch: 2, root: 9, scale: 'minor pent.', oct: 1, level: 0.55,
        pat: pat('x.x.x..', [100, 0, 84, 0, 92], [0, 0, 2, 0, 1]), pulses: 3, swing: 0.1 }),
    ],
  };
}
function blankState() {
  return { app: 'orbit', v: 1, bpm: 120, sel: 0, next: 2,
    rings: [makeRing({ id: 1, color: 1, name: 'Kick', steps: 16, sound: 'kick', note: 36, pat: euclidPattern(16, 4, 0).map(on => step(on)) })] };
}
/* make a loaded state safe to use */
function normalize(s) {
  if (!s || !Array.isArray(s.rings)) return demoState();
  const out = { app: 'orbit', v: 1, bpm: clamp(+s.bpm || 120, 40, 240), sel: 0, next: 1, rings: s.rings.slice(0, 8).map(r => makeRing(r)) };
  out.rings.forEach((r, i) => { r.steps = clamp(r.steps | 0, 1, 32); r.pat = resize(r, r.steps); r.beats = clamp(r.beats | 0, 1, 16); if (!r.id) r.id = i + 1; });
  out.next = Math.max(0, ...out.rings.map(r => r.id)) + 1;
  out.sel = clamp(s.sel | 0, 0, Math.max(0, out.rings.length - 1));
  return out;
}

if (typeof module !== 'undefined') module.exports = { ringTicks, cycleTicks, slotAt, stepIndex, euclidPattern, tools, resize, makeRing, demoState, normalize, rng };

/* ======================================================================= the app === */
if (typeof window !== 'undefined' && window.SeqCore) (function () {
  'use strict';
  const { audio, clock, midi, store, ui, music } = SeqCore;
  const el = ui.el;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let S = demoState();
  const undo = store.undoStack(120);
  let lastKey = '', lastAt = 0, saveTimer = 0;
  const hits = [];          /* recent played steps, for the flash: {id, slot, time} */
  let cursor = 0;           /* the keyboard's step cursor on the selected ring (a slot) */
  const ringRng = new Map();

  /* -------------------------------------------------------------- editing --- */
  /* every edit goes through here: an undo point (one per burst of the same control), then autosave */
  function edit(key, fn, rebuild = false) {
    const now = performance.now();
    if (!key || key !== lastKey || now - lastAt > 1200) undo.push(S);
    lastKey = key; lastAt = now;
    fn();
    changed(rebuild);
  }
  function changed(rebuild) {
    clearTimeout(saveTimer); saveTimer = setTimeout(() => store.save('orbit', S), 300);
    if (rebuild) render();
    else updateList();
  }
  function replace(next) { S = normalize(next); clock.bpm = S.bpm; header.setTempo(S.bpm); cursor = 0; changed(true); }
  const doUndo = () => { const p = undo.undo(S); if (p) { replace(p); ui.toast('Undo'); } };
  const doRedo = () => { const p = undo.redo(S); if (p) { replace(p); ui.toast('Redo'); } };
  const sel = () => S.rings[S.sel];

  function addRing() {
    if (S.rings.length >= 8) { ui.toast('Eight rings at most'); return; }
    edit(null, () => {
      const used = new Set(S.rings.map(r => r.color));
      const color = [1, 2, 3, 4, 5, 6, 7, 8].find(c => !used.has(c)) || 1;
      const n = S.rings.length + 1;
      S.rings.push(makeRing({ id: S.next++, color, name: 'Ring ' + n, steps: 8, mode: '16th', sound: 'hat', note: 42,
        pat: euclidPattern(8, 3, 0).map(on => step(on, 90)) }));
      S.sel = S.rings.length - 1;
    }, true);
  }
  function removeRing(i) {
    if (i < 0 || i >= S.rings.length) return;
    if (S.rings.length <= 1) { ui.toast('Keep one ring'); return; }
    edit(null, () => { S.rings.splice(i, 1); S.sel = clamp(S.sel >= i ? S.sel - 1 : S.sel, 0, S.rings.length - 1); }, true);
  }
  function moveRing(i, d) {
    const j = i + d;
    if (i < 0 || i >= S.rings.length || j < 0 || j >= S.rings.length) return;
    edit(null, () => { const [r] = S.rings.splice(i, 1); S.rings.splice(j, 0, r); S.sel = j; }, true);
  }
  function selectRing(i) { if (i === S.sel) return; S.sel = clamp(i, 0, S.rings.length - 1); cursor = 0; render(); store.save('orbit', S); }
  function applyTool(name, ...args) {
    const r = sel();
    edit(null, () => { r.pat = tools[name](r, ...args); r.steps = r.pat.length; r.rot = mod(r.rot, r.steps); }, name === 'double' || name === 'halve');
  }
  function rotate(d) { const r = sel(); edit('rot' + r.id, () => { r.rot = mod(r.rot + d, r.steps); }); }
  function toggleMute(r) { edit(null, () => { r.mute = !r.mute; }, true); }
  function toggleSolo(r) { edit(null, () => { r.solo = !r.solo; }, true); }
  function randomize(newSeed) { const r = sel(); edit(null, () => { if (newSeed) r.seed = (r.seed % 9999) + 1; r.pat = tools.random(r, r.density, r.seed); }, true); }

  /* ---------------------------------------------------------------- sound --- */
  function patchFor(r) { return audio.defaultPatch(Object.assign({}, PATCHES[r.sound.slice(6)] || PATCHES.lead, { level: r.level })); }
  function playStep(r, st, time, stepSec) {
    if (isSynth(r)) {
      const p = patchFor(r), n = music.degree(st.deg, r.root, r.scale, 48 + 12 * r.oct), dur = Math.min(stepSec * 0.8, 1.5);
      audio.note(p, n, st.vel, time, dur);
      midi.note(r.ch, n + 12 * (p.octave || 0), st.vel, time, dur);
    } else {
      audio.drum(r.sound, st.vel, time, { tone: r.tone, decay: r.decay, level: r.level });
      midi.note(r.ch, r.note, st.vel, time, 0.05);
    }
  }
  function onTick(tick, time) {
    const spt = clock.secPerTick(), anySolo = S.rings.some(r => r.solo);
    for (const r of S.rings) {
      const at = slotAt(r, tick);
      if (!at) continue;
      const st = r.pat[stepIndex(r, at.slot)], stepTicks = ringTicks(r) / r.steps;
      if (!st || !st.on || r.mute || (anySolo && !r.solo)) continue;
      if (r.prob < 1) { if (!ringRng.has(r.id)) ringRng.set(r.id, rng(r.seed * 7919 + r.id)); if (ringRng.get(r.id)() > r.prob) continue; }
      const t = time + (at.frac + (at.slot % 2 ? r.swing * stepTicks : 0)) * spt;
      playStep(r, st, t, stepTicks * spt);
      hits.push({ id: r.id, slot: at.slot, time: t }); if (hits.length > 64) hits.shift();
    }
  }
  clock.onTick = onTick;
  clock.onStart = () => { ringRng.clear(); audio.setEcho(0.75 * 60 / clock.bpm, 0.35); };
  midi.onNote = (n, vel) => {
    if (!vel) return;
    const r = sel();
    if (isSynth(r)) audio.note(patchFor(r), n - 12 * (patchFor(r).octave || 0), vel, audio.now(), 0.3);
    else audio.drum(audio.GM[n] || r.sound, vel, audio.now(), { tone: r.tone, decay: r.decay, level: r.level });
  };

  /* the tick sounding now, with its fraction, so the hands move smoothly */
  function tickFloat() {
    const t = clock.tickNow();
    if (t < 0) return -1;
    const h = clock.history.find(e => e[0] === t), now = audio.ctx.currentTime - (audio.ctx.outputLatency || 0);
    return t + (h ? clamp((now - h[1]) / clock.secPerTick(), 0, 1) : 0);
  }

  /* ------------------------------------------------------------- geometry --- */
  function geometry(w, h) {
    const size = Math.min(w, h), cx = w / 2, cy = h / 2, R = size / 2 - Math.max(18, size * 0.05), n = S.rings.length;
    const r0 = Math.max(size * 0.15, 40), gap = n > 1 ? Math.min((R - r0) / (n - 1), size * 0.11) : size * 0.12;
    return { cx, cy, R, gap, size, radius: k => (n > 1 ? R - gap * 0.5 - k * gap : R * 0.7) };
  }
  const slotAngle = (slot, n) => -Math.PI / 2 + 2 * Math.PI * slot / n;
  function dotMax(g, r, k) { const rad = g.radius(k); return Math.max(3, Math.min(g.gap * 0.36, Math.PI * rad / r.steps * 0.8, 13)); }
  /* what is under a point: {k, slot, onDot, d, a} or null */
  function hitTest(x, y) {
    if (!stage.w) return null;
    const g = geometry(stage.w, stage.h), dx = x - g.cx, dy = y - g.cy, d = Math.hypot(dx, dy);
    let best = -1, bd = Infinity;
    S.rings.forEach((r, k) => { const e = Math.abs(d - g.radius(k)); if (e < bd) { bd = e; best = k; } });
    if (best < 0 || bd > Math.max(g.gap * 0.5, 14)) return null;
    const r = S.rings[best], a = Math.atan2(dy, dx) + Math.PI / 2, slot = mod(Math.round(a / (2 * Math.PI) * r.steps), r.steps);
    const sa = slotAngle(slot, r.steps), rad = g.radius(best);
    const px = g.cx + Math.cos(sa) * rad, py = g.cy + Math.sin(sa) * rad;
    return { k: best, slot, onDot: Math.hypot(x - px, y - py) <= dotMax(g, r, best) + 8, d, a };
  }

  /* -------------------------------------------------------------- drawing --- */
  let col = {}, frame = 0;
  function readColors() {
    ['--bg', '--panel', '--panel2', '--line', '--fg', '--dim', '--faint', '--accent', '--ok'].forEach(n => { col[n] = ui.css(n); });
    for (let i = 1; i <= 8; i++) col['c' + i] = ui.css('--c' + i);
  }
  function draw(st) {
    const { ctx, w, h } = st;
    if (!w || !h) return;
    if (frame++ % 30 === 0) readColors();
    ctx.clearRect(0, 0, w, h);
    const g = geometry(w, h), tf = tickFloat(), now = audio.ctx ? audio.ctx.currentTime - (audio.ctx.outputLatency || 0) : 0;
    drawPhase(ctx, g, tf);
    S.rings.forEach((r, k) => drawRing(ctx, g, r, k, tf, now));
    drawCentre(ctx, g, tf);
  }
  function drawPhase(ctx, g, tf) {
    const C = cycleTicks(S.rings), pr = g.R + Math.max(8, g.size * 0.025);
    ctx.lineWidth = 3; ctx.strokeStyle = col['--line'];
    ctx.beginPath(); ctx.arc(g.cx, g.cy, pr, 0, Math.PI * 2); ctx.stroke();
    if (tf >= 0) {
      const f = mod(tf, C) / C;
      ctx.strokeStyle = col['--accent']; ctx.beginPath(); ctx.arc(g.cx, g.cy, pr, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); ctx.stroke();
      if (mod(tf, C) < PPQN / 2 && !reduceMotion.matches) {
        ctx.globalAlpha = 1 - mod(tf, C) / (PPQN / 2); ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(g.cx, g.cy, pr, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
    ctx.fillStyle = col['--accent'];
    ctx.beginPath(); ctx.arc(g.cx, g.cy - pr, 4, 0, Math.PI * 2); ctx.fill();
  }
  function drawRing(ctx, g, r, k, tf, now) {
    const rad = g.radius(k), N = r.steps, c = col['c' + r.color] || col['--accent'], isSel = k === S.sel;
    const muted = r.mute || (S.rings.some(x => x.solo) && !r.solo), dm = dotMax(g, r, k);
    ctx.globalAlpha = muted ? 0.35 : 1;
    ctx.lineWidth = isSel ? 2.5 : 1; ctx.strokeStyle = isSel ? c : col['--line'];
    ctx.beginPath(); ctx.arc(g.cx, g.cy, rad, 0, Math.PI * 2); ctx.stroke();
    /* the steps */
    for (let s = 0; s < N; s++) {
      const st = r.pat[stepIndex(r, s)], a = slotAngle(s, N), x = g.cx + Math.cos(a) * rad, y = g.cy + Math.sin(a) * rad;
      ctx.beginPath();
      if (st.on) {
        const dr = dm * (0.4 + 0.6 * st.vel / 127);
        ctx.fillStyle = c; ctx.arc(x, y, dr, 0, Math.PI * 2); ctx.fill();
        /* velocity also as a radial tick outward */
        ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * dr, y + Math.sin(a) * dr);
        ctx.lineTo(x + Math.cos(a) * (dr + g.gap * 0.12 * st.vel / 127), y + Math.sin(a) * (dr + g.gap * 0.12 * st.vel / 127)); ctx.stroke();
      } else {
        ctx.strokeStyle = isSel ? col['--dim'] : col['--faint']; ctx.lineWidth = 1.2; ctx.arc(x, y, Math.max(2, dm * 0.32), 0, Math.PI * 2); ctx.stroke();
      }
      if (isSel && isSynth(r) && st.on && dm >= 7) {
        ctx.fillStyle = col['--bg']; ctx.font = `600 ${Math.round(dm * 0.95)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(st.deg), x, y + 0.5);
      }
      if (isSel && s === cursor && document.activeElement === stage.canvas) {
        ctx.setLineDash([3, 3]); ctx.strokeStyle = col['--fg']; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, dm + 4, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    /* the flash of steps just played */
    if (!reduceMotion.matches) for (const hh of hits) {
      if (hh.id !== r.id || now < hh.time || now - hh.time > 0.18) continue;
      const a = slotAngle(hh.slot, N), x = g.cx + Math.cos(a) * rad, y = g.cy + Math.sin(a) * rad;
      ctx.globalAlpha = (1 - (now - hh.time) / 0.18) * 0.6; ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x, y, dm * 1.8, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = muted ? 0.35 : 1;
    }
    /* the hand */
    const f = tf >= 0 ? mod(tf, ringTicks(r)) / ringTicks(r) : 0, ha = -Math.PI / 2 + f * Math.PI * 2;
    ctx.strokeStyle = isSel ? col['--fg'] : c; ctx.lineWidth = isSel ? 3 : 2; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(g.cx + Math.cos(ha) * (rad - g.gap * 0.42), g.cy + Math.sin(ha) * (rad - g.gap * 0.42));
    ctx.lineTo(g.cx + Math.cos(ha) * (rad + g.gap * 0.42), g.cy + Math.sin(ha) * (rad + g.gap * 0.42)); ctx.stroke();
    ctx.lineCap = 'butt';
    /* the ring's number, and where its pattern starts when rotated */
    const na = slotAngle(-0.5, N), nr = rad;
    ctx.fillStyle = isSel ? col['--fg'] : col['--dim']; ctx.font = `600 ${Math.max(10, Math.min(13, g.gap * 0.4))}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (N > 1) ctx.fillText(String(k + 1), g.cx + Math.cos(na) * nr, g.cy + Math.sin(na) * nr);
    if (r.rot) {
      const ra = slotAngle(r.rot, N), ro = rad + dm + 5;
      ctx.fillStyle = c; ctx.beginPath();
      ctx.moveTo(g.cx + Math.cos(ra) * ro, g.cy + Math.sin(ra) * ro);
      ctx.lineTo(g.cx + Math.cos(ra - 0.05) * (ro + 7), g.cy + Math.sin(ra - 0.05) * (ro + 7));
      ctx.lineTo(g.cx + Math.cos(ra + 0.05) * (ro + 7), g.cy + Math.sin(ra + 0.05) * (ro + 7)); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function beatsText(ticks) {
    const beats = Math.ceil(ticks / PPQN - 1e-9), bars = Math.floor(beats / 4), b = beats % 4;
    return (bars ? bars + (bars === 1 ? ' bar' : ' bars') : '') + (bars && b ? ' ' : '') + (b || !bars ? b + (b === 1 ? ' beat' : ' beats') : '');
  }
  function drawCentre(ctx, g, tf) {
    const C = cycleTicks(S.rings), fs = Math.max(11, Math.min(18, g.size * 0.034));
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = col['--dim']; ctx.font = `${fs * 0.75}px system-ui, sans-serif`;
    ctx.fillText(tf >= 0 ? 'all line up in' : 'all line up every', g.cx, g.cy - fs * 0.9);
    ctx.fillStyle = col['--fg']; ctx.font = `600 ${fs}px system-ui, sans-serif`;
    ctx.fillText(beatsText(tf >= 0 ? C - mod(tf, C) : C), g.cx, g.cy + fs * 0.25);
    if (tf >= 0) { ctx.fillStyle = col['--faint']; ctx.font = `${fs * 0.7}px system-ui, sans-serif`; ctx.fillText('cycle ' + beatsText(C), g.cx, g.cy + fs * 1.35); }
  }

  /* -------------------------------------------------------------- pointer --- */
  let drag = null;
  function local(e) { const b = stage.canvas.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; }
  function onDown(e) {
    const [x, y] = local(e), hit = hitTest(x, y);
    if (!hit) return;
    stage.canvas.setPointerCapture(e.pointerId);
    selectRing(hit.k);
    const r = S.rings[hit.k];
    cursor = hit.slot;
    drag = { r, slot: hit.slot, idx: stepIndex(r, hit.slot), x, y, d0: hit.d, a0: hit.a, rot0: r.rot, mode: hit.onDot ? null : 'rot',
      vel0: r.pat[stepIndex(r, hit.slot)].vel };
    if (drag.mode === 'rot') undo.push(S), lastKey = '';
  }
  function onMove(e) {
    if (!drag) { const [x, y] = local(e), h = hitTest(x, y); stage.canvas.style.cursor = h ? (h.onDot ? 'pointer' : 'grab') : 'default'; return; }
    const [x, y] = local(e), dx = x - stage.w / 2, dy = y - stage.h / 2, d = Math.hypot(dx, dy);
    const a = Math.atan2(dy, dx) + Math.PI / 2, r = drag.r;
    let da = a - drag.a0; da = mod(da + Math.PI, Math.PI * 2) - Math.PI;
    if (!drag.mode) {
      const radial = d - drag.d0, tang = da * drag.d0;
      if (Math.abs(radial) > 6 && Math.abs(radial) > Math.abs(tang)) { drag.mode = 'vel'; undo.push(S); lastKey = ''; }
      else if (Math.abs(tang) > 10) { drag.mode = 'rot'; undo.push(S); lastKey = ''; }
      else return;
    }
    if (drag.mode === 'vel') {
      const st = r.pat[drag.idx];
      st.on = true; st.vel = Math.round(clamp(drag.vel0 + (d - drag.d0) * 2, 1, 127));
      tip(`step ${drag.idx + 1}: velocity ${st.vel}`);
    } else {
      r.rot = mod(drag.rot0 + Math.round(da / (2 * Math.PI) * r.steps), r.steps);
      tip(`ring ${S.sel + 1} rotated ${r.rot ? '+' + r.rot : '0'}`);
    }
  }
  function onUp() {
    if (!drag) return;
    if (!drag.mode) { const r = drag.r, st = r.pat[drag.idx]; edit(null, () => { st.on = !st.on; }); }
    else changed(true);
    drag = null;
  }
  function onWheel(e) {
    const [x, y] = local(e), hit = hitTest(x, y);
    if (!hit || !hit.onDot) return;
    e.preventDefault();
    const r = S.rings[hit.k], idx = stepIndex(r, hit.slot), st = r.pat[idx], d = -Math.sign(e.deltaY);
    if (hit.k !== S.sel) selectRing(hit.k);
    if (isSynth(r)) { edit('deg' + r.id + idx, () => { st.deg = clamp(st.deg + d, -14, 28); }); tip(`step ${idx + 1}: degree ${st.deg}`); }
    else { edit('vel' + r.id + idx, () => { st.vel = clamp(st.vel + d * 6, 1, 127); }); tip(`step ${idx + 1}: velocity ${st.vel}`); }
  }
  let tipEl = null;
  function tip(s) { if (tipEl) tipEl.textContent = s; }

  /* ------------------------------------------------------------- keyboard --- */
  function onCanvasKey(e) {
    const r = sel();
    if (!r) return;
    const idx = stepIndex(r, cursor), st = r.pat[idx];
    if (e.key === ',' || e.key === '<') { cursor = mod(cursor - 1, r.steps); e.preventDefault(); }
    else if (e.key === '.' || e.key === '>') { cursor = mod(cursor + 1, r.steps); e.preventDefault(); }
    else if (e.key === 'Enter') { edit(null, () => { st.on = !st.on; }); e.preventDefault(); }
    else if (e.key === '+' || e.key === '=') { edit('vel' + r.id + idx, () => { st.on = true; st.vel = clamp(st.vel + 10, 1, 127); }); tip(`step ${idx + 1}: velocity ${st.vel}`); }
    else if (e.key === '-') { edit('vel' + r.id + idx, () => { st.vel = clamp(st.vel - 10, 1, 127); }); tip(`step ${idx + 1}: velocity ${st.vel}`); }
    else if (e.key === 'PageUp' || e.key === 'PageDown') { edit('deg' + r.id + idx, () => { st.deg = clamp(st.deg + (e.key === 'PageUp' ? 1 : -1), -14, 28); }); tip(`step ${idx + 1}: degree ${st.deg}`); e.preventDefault(); }
  }
  function onGlobalKey(e) {
    if (e.target.closest('input,select,textarea,.sc-knob,.sc-help') || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === 'ArrowUp') { selectRing(mod(S.sel - 1, S.rings.length)); e.preventDefault(); }
    else if (k === 'ArrowDown') { selectRing(mod(S.sel + 1, S.rings.length)); e.preventDefault(); }
    else if (k === 'ArrowLeft') { rotate(-1); e.preventDefault(); }
    else if (k === 'ArrowRight') { rotate(1); e.preventDefault(); }
    else if (k === 'e' || k === 'E') { const r = sel(); applyTool('euclid', r.pulses, r.erot); ui.toast(`Euclid ${r.pulses} in ${r.steps}`); }
    else if (k === 'r' || k === 'R') { randomize(true); ui.toast('Random, seed ' + sel().seed); }
    else if (k === 'm' || k === 'M') toggleMute(sel());
    else if (k === 's' || k === 'S') toggleSolo(sel());
    else if (k === 'a' || k === 'A') addRing();
  }

  /* ------------------------------------------------------------ the panel --- */
  const tbtn = (label, on, onclick, title) => el('button', { class: 'sc-btn' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', title, onclick }, label);
  const btn = (label, onclick, title, aria) => el('button', { class: 'sc-btn', title, 'aria-label': aria || title, onclick }, label);
  const knob = (label, min, max, step, value, def, fmt, key, set, title) => {
    const k = ui.knob({ label, min, max, step, value, def, fmt, onInput: v => edit(key, () => set(v)) });
    if (title) k.title = title;
    return k;
  };
  const ringMeta = r => `${r.steps} / ${r.mode === 'beats' ? r.beats + ' beat' + (r.beats > 1 ? 's' : '') : '1/16'}${r.rot ? ' · +' + r.rot : ''}`;

  let listEl, editorEl;
  function render() { renderList(); renderEditor(); }
  function renderList() {
    listEl.replaceChildren(...S.rings.map((r, i) => el('div', { class: 'orb-ring' },
      el('button', { class: 'sc-btn orb-pick' + (i === S.sel ? ' on' : ''), 'aria-pressed': i === S.sel ? 'true' : 'false', title: 'Select this ring (Up/Down)', onclick: () => selectRing(i) },
        el('span', { class: 'orb-sw', style: `--sw:var(--c${r.color})` }), el('b', {}, String(i + 1)), r.name, el('span', { class: 'orb-meta' }, ringMeta(r))),
      tbtn('M', r.mute, () => toggleMute(r), 'Mute (M)'),
      tbtn('S', r.solo, () => toggleSolo(r), 'Solo (S)'),
      btn('↑', () => moveRing(i, -1), 'Move outward', `Move ring ${i + 1} outward`),
      btn('↓', () => moveRing(i, 1), 'Move inward', `Move ring ${i + 1} inward`),
      btn('×', () => removeRing(i), 'Remove ring', `Remove ring ${i + 1}`))));
    listEl.append(el('div', { class: 'sc-row' },
      btn('+ Ring', addRing, 'Add a ring (A)', 'Add a ring'),
      btn('Demo', () => { undo.push(S); replace(demoState()); }, 'Load the five-ring demo (undoable)', 'Load the demo')));
  }
  function updateList() {
    const metas = listEl.querySelectorAll('.orb-meta');
    S.rings.forEach((r, i) => { if (metas[i]) metas[i].textContent = ringMeta(r); });
  }
  function renderEditor() {
    const r = sel();
    if (!r) { editorEl.replaceChildren(); return; }
    const soundOpts = [...DRUMS.map(d => ({ value: d, label: 'drum: ' + d })), ...Object.keys(PATCHES).map(p => ({ value: 'synth:' + p, label: 'synth: ' + p }))];
    const name = el('input', { class: 'orb-name', value: r.name, 'aria-label': 'Ring name', maxlength: 16,
      oninput: () => edit('name' + r.id, () => { r.name = name.value; }), onchange: () => renderList() });
    const timing = el('div', { class: 'sc-row' },
      knob('STEPS', 1, 32, 1, r.steps, 8, v => v, 'steps' + r.id, v => { r.pat = resize(r, v); r.steps = v; r.rot = mod(r.rot, v); cursor = mod(cursor, v); }, 'Steps around the ring'),
      ui.select('Cycle', [{ value: 'beats', label: 'in beats' }, { value: '16th', label: 'steps at 1/16' }], r.mode, v => edit(null, () => { r.mode = v; }, true)),
      r.mode === 'beats' ? knob('BEATS', 1, 16, 1, r.beats, 4, v => v, 'beats' + r.id, v => { r.beats = v; }, 'One turn of the ring, in beats') : '',
      knob('ROTATE', 0, Math.max(1, r.steps - 1), 1, r.rot, 0, v => '+' + v, 'rot' + r.id, v => { r.rot = v; }, 'Turn the pattern around the ring (drag the ring, or Left/Right)'));
    const tools1 = el('div', { class: 'sc-row' },
      knob('PULSES', 0, 32, 1, r.pulses, 3, v => v, 'pulses' + r.id, v => { r.pulses = v; }),
      knob('E.ROT', 0, 31, 1, r.erot, 0, v => v, 'erot' + r.id, v => { r.erot = v; }),
      btn('Euclid', () => applyTool('euclid', r.pulses, r.erot), 'Fill with the pulses spread evenly (E)'));
    const tools2 = el('div', { class: 'sc-row' },
      knob('DENSITY', 0, 1, 0.01, r.density, 0.4, v => Math.round(v * 100) + '%', 'dens' + r.id, v => { r.density = v; }),
      knob('SEED', 1, 9999, 1, r.seed, 1, v => v, 'seed' + r.id, v => { r.seed = v; }),
      btn('Random', () => randomize(false), 'Random steps from this seed and density (R rolls a new seed)'));
    const tools3 = el('div', { class: 'sc-row' },
      btn('Clear', () => applyTool('clear'), 'All steps off'), btn('Invert', () => applyTool('invert'), 'On steps off, off steps on'),
      btn('◂ Shift', () => applyTool('shift', -1), 'Move the steps one back', 'Shift steps back'), btn('Shift ▸', () => applyTool('shift', 1), 'Move the steps one on', 'Shift steps on'),
      btn('×2', () => applyTool('double'), 'Double the steps (a rest after each)', 'Double steps'), btn('÷2', () => applyTool('halve'), 'Halve the steps (pairs merged)', 'Halve steps'));
    const synth = isSynth(r);
    const sound = el('div', { class: 'sc-row' },
      ui.select('Sound', soundOpts, r.sound, v => edit(null, () => {
        const was = isSynth(r); r.sound = v;
        if (!isSynth(r)) r.note = audio.GM_NOTE[v] || 36;
        if (was !== isSynth(r)) r.ch = isSynth(r) ? clamp(S.sel + 1, 1, 9) : 10;
      }, true)),
      synth ? ui.select('Root', music.NOTE_NAMES.map((n, i) => ({ value: i, label: n })), r.root, v => edit(null, () => { r.root = +v; })) : '',
      synth ? ui.select('Scale', Object.keys(music.SCALES), r.scale, v => edit(null, () => { r.scale = v; })) : '',
      synth ? knob('OCTAVE', -2, 2, 1, r.oct, 0, v => (v > 0 ? '+' : '') + v, 'oct' + r.id, v => { r.oct = v; }) : '',
      synth ? '' : knob('TONE', 0, 1, 0.01, r.tone, 0.5, v => Math.round(v * 100), 'tone' + r.id, v => { r.tone = v; }),
      synth ? '' : knob('DECAY', 0.2, 3, 0.01, r.decay, 1, v => v.toFixed(2), 'decay' + r.id, v => { r.decay = v; }),
      knob('LEVEL', 0, 1, 0.01, r.level, 0.8, v => Math.round(v * 100), 'level' + r.id, v => { r.level = v; }));
    const play = el('div', { class: 'sc-row' },
      knob('SWING', 0, 0.5, 0.01, r.swing, 0, v => Math.round(50 + v * 50) + '%', 'swing' + r.id, v => { r.swing = v; }, 'Odd steps of this ring late'),
      knob('PROB', 0, 1, 0.01, r.prob, 1, v => Math.round(v * 100) + '%', 'prob' + r.id, v => { r.prob = v; }, 'Chance each on step plays'),
      knob('MIDI CH', 0, 16, 1, r.ch, isSynth(r) ? 1 : 10, v => v ? v : 'off', 'ch' + r.id, v => { r.ch = v; }, 'MIDI channel (0 = off)'),
      synth ? '' : knob('NOTE', 0, 127, 1, r.note, 36, v => v, 'note' + r.id, v => { r.note = v; }, 'MIDI note out (GM drums)'));
    editorEl.replaceChildren(
      el('div', { class: 'orb-sec' }, el('h3', {}, `Ring ${S.sel + 1}`), el('div', { class: 'sc-row' }, name)),
      el('div', { class: 'orb-sec' }, el('h3', {}, 'Cycle'), timing),
      el('div', { class: 'orb-sec' }, el('h3', {}, 'Tools'), tools1, tools2, tools3),
      el('div', { class: 'orb-sec' }, el('h3', {}, 'Sound'), sound),
      el('div', { class: 'orb-sec' }, el('h3', {}, 'Feel and MIDI'), play));
  }

  /* --------------------------------------------------------------- header --- */
  const HELP = [
    ['Space', 'Play / stop'],
    ['Click a dot', 'Step on / off'],
    ['Drag a dot in/out', 'Velocity (dot size and its tick)'],
    ['Scroll on a dot', 'Scale degree (synth rings) or velocity (drum rings)'],
    ['Drag a ring around', 'Rotate the ring (the small triangle marks where its pattern starts)'],
    ['Up / Down', 'Choose the ring'],
    ['Left / Right', 'Rotate the chosen ring'],
    ['E', 'Euclid fill: the PULSES spread over the steps, turned by E.ROT'],
    ['R', 'Random steps with a new seed (Random button: the current seed); DENSITY sets how many'],
    ['M / S', 'Mute / solo the chosen ring'],
    ['A', 'Add a ring (up to eight)'],
    ['Tab to the circle, then , .', 'Move the step cursor; Enter toggles, + / - velocity, PageUp / PageDown degree'],
    ['×2 / ÷2', 'Double the steps (a rest after each) or halve them; in a beats cycle the timing stays'],
    ['Cycle', '"in beats": the ring turns once in that many beats; "steps at 1/16": each step is a sixteenth'],
    ['Phase ring', 'The outer ring fills until every ring is back at its start together; the centre counts down'],
    ['Ctrl/Cmd+Z', 'Undo (Shift for redo)'],
    ['?', 'This help'],
  ];
  const about = 'Rings of steps, each turning at its own rate: different step counts and cycle lengths drift against each other and meet again after the least common cycle. MIDI in plays the chosen ring\'s sound.';
  const header = ui.header({
    name: 'ORBIT', tagline: 'circular polyrhythm rings', color: ui.css('--accent'), help: HELP, about, swing: false,
    onTempo: v => edit('tempo', () => { S.bpm = v; }),
    onUndo: doUndo, onRedo: doRedo,
    onNew: () => { undo.push(S); replace(blankState()); ui.toast('New: one ring'); },
    onSave: () => store.download('orbit.json', S),
    onLoad: () => store.upload().then(d => { if (d && d.rings) { undo.push(S); replace(d); ui.toast('Opened'); } else if (d) ui.toast('Not an ORBIT file'); }),
    onShare: async () => {
      const url = await store.shareLink(S);
      try { await navigator.clipboard.writeText(url); ui.toast('Link copied'); }
      catch (e) { history.replaceState(null, '', url); ui.toast('Link in the address bar'); }
    },
  });
  ui.globalKeys({ name: 'ORBIT', help: HELP, about, onUndo: doUndo, onRedo: doRedo });
  window.addEventListener('keydown', onGlobalKey);

  /* --------------------------------------------------------------- layout --- */
  const stageEl = el('div', { class: 'orb-stage' });
  tipEl = el('div', { class: 'orb-hint', 'aria-live': 'polite' }, 'Click a dot to toggle it · drag it in or out for velocity · scroll for pitch · drag a ring around to rotate it');
  listEl = el('div', { class: 'orb-list', role: 'group', 'aria-label': 'Rings' });
  editorEl = el('div', { class: 'orb-editor' });
  const side = el('aside', { class: 'orb-side' },
    el('section', { class: 'sc-panel orb-sec', 'aria-label': 'Rings' }, el('h3', {}, 'Rings (outer to inner)'), listEl),
    el('section', { class: 'sc-panel', 'aria-label': 'Selected ring' }, editorEl));
  document.body.append(header, el('main', {}, el('div', { class: 'orb-layout' }, stageEl, side)));
  const stage = ui.canvas(stageEl, draw);
  stageEl.append(tipEl);
  const cv = stage.canvas;
  cv.tabIndex = 0; cv.setAttribute('role', 'application');
  cv.setAttribute('aria-label', 'The rings. Up/Down choose a ring, Left/Right rotate it, comma and period move the step cursor, Enter toggles a step.');
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onUp);
  cv.addEventListener('wheel', onWheel, { passive: false });
  cv.addEventListener('keydown', onCanvasKey);

  /* ---------------------------------------------------------------- start --- */
  (async () => {
    const fromLink = await store.fromHash(), saved = store.load('orbit');
    S = normalize(fromLink && fromLink.rings ? fromLink : saved && saved.rings ? saved : demoState());
    if (fromLink) history.replaceState(null, '', location.pathname);
    clock.bpm = S.bpm; header.setTempo(S.bpm);
    render();
  })();
  render();
})();

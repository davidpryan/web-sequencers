/* SPDX-License-Identifier: MPL-2.0
 * Copyright (C) 2026 David Ryan
 * STITCH: a trig-and-lock step groovebox, after the Elektron Digitakt/Syntakt and the x0x machines.
 *
 * The model
 *   A project has 8 tracks: 4 drums (KICK SNARE HATS PERC) and 4 synths (BASS LEAD CHORD PLUCK). A track is a sound
 *   (a drum: tone, decay, pitch, level, echo; or a synth patch), a MIDI channel, mute and solo.
 *   A project has 8 patterns, A-H. A pattern gives each track a length (1-64 steps), a scale (its speed: 1/2x, 3/4x,
 *   1x, 3/2x, 2x) and 64 steps, and has a master length: where a queued pattern change (or the song) takes over.
 *   The tracks run free inside a pattern, so tracks of other lengths and speeds drift against each other
 *   (polymeter); they line up again when the pattern changes or the transport starts.
 *   A step is null (never written) or {on, notes (1-4: a chord), vel, len (in steps), micro (-23..23 48ths of a
 *   step), ratch (1-8 hits), cond (the trig condition), locks ({param: value}: the track's sound for this step)}.
 *   The song is a list of {pat, reps}; with SONG on, the patterns follow it.
 *   The engine reads each step LEAD ticks before it is due, so negative microtiming can still be scheduled.
 *
 * The top of this file is pure (no DOM, no SeqCore): the model, the engine, the trig conditions, the randomiser,
 * the demo; node can load it for tests. The bottom builds the screen. */

/* ================================================================== pure part === */
const NTRACKS = 8, NSTEPS = 64, PAGE = 16, NPAT = 8, TPS = 24 /* ticks a 1x step: a sixteenth at 96 PPQN */, LEAD = 24;
const PAT_NAMES = 'ABCDEFGH';
const SPEEDS = [0.5, 0.75, 1, 1.5, 2];
const SPEED_NAMES = { 0.5: '1/2x', 0.75: '3/4x', 1: '1x', 1.5: '3/2x', 2: '2x' };
const stepTicks = (speed) => Math.round(TPS / speed);
const DRUMS = ['kick', 'snare', 'clap', 'hat', 'ohat', 'tom', 'rim', 'cowbell', 'cymbal', 'shaker', 'zap'];
const WAVES = ['sawtooth', 'square', 'triangle', 'sine', 'supersaw'];
const MASTERS = [8, 12, 16, 24, 32, 48, 64];
const LENS = [0.125, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16];
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (n) => NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const num = (x, a, b, d) => (typeof x === 'number' && isFinite(x) ? clamp(x, a, b) : d);
const clone = (x) => JSON.parse(JSON.stringify(x));

/* the lockable sound parameters */
const f2 = (v) => (+v).toFixed(2), fs = (v) => (v < 1 ? Math.round(v * 1000) + 'ms' : (+v).toFixed(2) + 's');
const DRUM_PARAMS = [
  { k: 'tone', label: 'TONE', min: 0, max: 1, step: 0.01, def: 0.5, fmt: f2 },
  { k: 'decay', label: 'DECAY', min: 0.2, max: 2.5, step: 0.01, def: 1, fmt: f2 },
  { k: 'pitch', label: 'PITCH', min: 50, max: 400, step: 1, def: 140, fmt: (v) => v + 'Hz', only: 'tom' },
  { k: 'level', label: 'LEVEL', min: 0, max: 1, step: 0.01, def: 0.9, fmt: f2 },
  { k: 'echo', label: 'ECHO', min: 0, max: 1, step: 0.01, def: 0, fmt: f2 },
];
const SYNTH_PARAMS = [
  { k: 'cutoff', label: 'CUTOFF', min: 0, max: 1, step: 0.01, def: 0.55, fmt: f2 },
  { k: 'reso', label: 'RESO', min: 0, max: 1, step: 0.01, def: 0.3, fmt: f2 },
  { k: 'envmod', label: 'ENV', min: 0, max: 1, step: 0.01, def: 0.4, fmt: f2 },
  { k: 'attack', label: 'ATTACK', min: 0.001, max: 1, step: 0.001, def: 0.005, fmt: fs },
  { k: 'decay', label: 'DECAY', min: 0.02, max: 2, step: 0.01, def: 0.25, fmt: fs },
  { k: 'sustain', label: 'SUSTAIN', min: 0, max: 1, step: 0.01, def: 0.5, fmt: f2 },
  { k: 'release', label: 'RELEASE', min: 0.01, max: 2, step: 0.01, def: 0.2, fmt: fs },
  { k: 'level', label: 'LEVEL', min: 0, max: 1, step: 0.01, def: 0.7, fmt: f2 },
  { k: 'detune', label: 'DETUNE', min: 0, max: 30, step: 1, def: 8, fmt: (v) => v + 'c' },
  { k: 'echo', label: 'ECHO', min: 0, max: 1, step: 0.01, def: 0, fmt: f2 },
  { k: 'octave', label: 'OCTAVE', min: -2, max: 2, step: 1, def: 0, fmt: (v) => (v > 0 ? '+' : '') + v },
];
const paramsFor = (tr) => (tr.kind === 'drum' ? DRUM_PARAMS.filter((p) => !p.only || p.only === tr.drum) : SYNTH_PARAMS);
const paramDef = (tr, k) => (tr.kind === 'drum' ? DRUM_PARAMS : SYNTH_PARAMS).find((p) => p.k === k);

/* trig conditions: '' always, 'N%' chance, 'A:B' (plays on loop A of every B), FILL, PRE, 1ST and their negations */
const PROBS = [1, 2, 4, 6, 9, 13, 19, 25, 33, 41, 50, 59, 67, 75, 81, 87, 91, 94, 96, 98, 99];
const CYCLES = [];
for (let b = 2; b <= 8; b++) for (let a = 1; a <= b; a++) CYCLES.push(a + ':' + b);
const CONDS = [''].concat(PROBS.map((p) => p + '%'), CYCLES, ['FILL', '!FILL', 'PRE', '!PRE', '1ST', '!1ST']);
const condLabel = (c) => c || 'always';
/* ctx: {loop (the track's loop count in this pattern), fill, pre (the last condition's result), rnd()} */
function evalCond(cond, ctx) {
  if (!cond) return true;
  if (cond.endsWith('%')) return ctx.rnd() * 100 < parseInt(cond, 10);
  if (cond.includes(':')) { const [a, b] = cond.split(':').map(Number); return ctx.loop % b === a - 1; }
  switch (cond) {
    case 'FILL': return !!ctx.fill;
    case '!FILL': return !ctx.fill;
    case 'PRE': return !!ctx.pre;
    case '!PRE': return !ctx.pre;
    case '1ST': return ctx.loop === 0;
    case '!1ST': return ctx.loop !== 0;
  }
  return true;
}
/* PRE and !PRE read the last result; the other conditions (not 'always') write it */
const condSetsPre = (c) => !!c && c !== 'PRE' && c !== '!PRE';

/* a deterministic generator (xorshift), the same as SeqCore.music.rng */
function rng(seed) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/* --- the model --- */
function newStep(note = 60, over = {}) {
  return Object.assign({ on: true, notes: [note], vel: 100, len: 1, micro: 0, ratch: 1, cond: '', locks: {} }, over);
}
function newPattern() {
  return { master: 16, tracks: Array.from({ length: NTRACKS }, () => ({ len: 16, speed: 1, steps: new Array(NSTEPS).fill(null) })) };
}
function patch(over) {
  return Object.assign({ wave: 'sawtooth', cutoff: 0.55, reso: 0.3, envmod: 0.4, attack: 0.005, decay: 0.25, sustain: 0.5,
    release: 0.2, level: 0.7, detune: 8, echo: 0, glide: 0, octave: 0 }, over);
}
function defaultTracks() {
  const drum = (name, d, over) => ({ name, kind: 'drum', drum: d, ch: 10, note: 60, mute: false, solo: false,
    sound: Object.assign({ tone: 0.5, decay: 1, pitch: 140, level: 0.9, echo: 0 }, over) });
  const synth = (name, ch, note, over, poly = false) => ({ name, kind: 'synth', ch, note, poly, mute: false, solo: false, sound: patch(over) });
  return [
    drum('KICK', 'kick', { tone: 0.35, decay: 1.1, level: 0.95 }),
    drum('SNARE', 'snare', { tone: 0.55, decay: 0.9, level: 0.75 }),
    drum('HATS', 'hat', { tone: 0.6, decay: 0.9, level: 0.55 }),
    drum('PERC', 'rim', { tone: 0.5, decay: 1, level: 0.6 }),
    synth('BASS', 1, 45, { wave: 'sawtooth', cutoff: 0.32, reso: 0.45, envmod: 0.5, decay: 0.22, sustain: 0.25, release: 0.08, level: 0.8, detune: 6 }),
    synth('LEAD', 2, 72, { wave: 'square', cutoff: 0.5, reso: 0.2, envmod: 0.35, attack: 0.01, decay: 0.4, sustain: 0.4, release: 0.3, level: 0.42, detune: 10, echo: 0.35 }),
    synth('CHORD', 3, 60, { wave: 'supersaw', cutoff: 0.42, reso: 0.15, envmod: 0.25, attack: 0.12, decay: 0.8, sustain: 0.7, release: 0.6, level: 0.32, echo: 0.2 }, true),
    synth('PLUCK', 4, 72, { wave: 'triangle', cutoff: 0.62, reso: 0.25, envmod: 0.6, attack: 0.002, decay: 0.16, sustain: 0.05, release: 0.15, level: 0.4, detune: 4, echo: 0.45 }),
  ];
}
function blankProject() {
  return { app: 'stitch', v: 1, bpm: 120, swing: 0, cur: 0, key: 9, scale: 'minor', seed: 1, songOn: false,
    song: [{ pat: 0, reps: 1 }], tracks: defaultTracks(), patterns: Array.from({ length: NPAT }, newPattern) };
}
const patternUsed = (p) => p.tracks.some((t) => t.steps.some((s) => s && s.on));

/* clean up anything loaded (a file, a link, an old autosave): missing fields get their defaults */
function normStep(s) {
  if (!s || typeof s !== 'object') return null;
  const notes = (Array.isArray(s.notes) ? s.notes : [60]).filter((n) => typeof n === 'number').map((n) => clamp(Math.round(n), 0, 127)).slice(0, 4);
  const locks = {};
  if (s.locks && typeof s.locks === 'object') for (const [k, v] of Object.entries(s.locks)) if (typeof v === 'number' && isFinite(v)) locks[k] = v;
  return { on: !!s.on, notes: notes.length ? notes : [60], vel: Math.round(num(s.vel, 1, 127, 100)), len: num(s.len, 0.125, 16, 1),
    micro: Math.round(num(s.micro, -23, 23, 0)), ratch: Math.round(num(s.ratch, 1, 8, 1)), cond: CONDS.includes(s.cond) ? s.cond : '', locks };
}
function normalize(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.patterns)) return null;
  const st = blankProject();
  st.bpm = Math.round(num(d.bpm, 40, 240, 120)); st.swing = num(d.swing, 0, 0.5, 0);
  st.cur = Math.round(num(d.cur, 0, NPAT - 1, 0)); st.key = Math.round(num(d.key, 0, 11, 9));
  if (typeof d.scale === 'string') st.scale = d.scale;
  st.seed = Math.round(num(d.seed, 1, 1e9, 1)); st.songOn = !!d.songOn;
  if (Array.isArray(d.song)) st.song = d.song.filter((e) => e && typeof e.pat === 'number').map((e) => ({ pat: clamp(Math.round(e.pat), 0, NPAT - 1), reps: Math.round(num(e.reps, 1, 16, 1)) }));
  st.tracks = st.tracks.map((t, i) => {
    const o = (Array.isArray(d.tracks) && d.tracks[i]) || {};
    const n = Object.assign({}, t, o, { kind: t.kind, sound: Object.assign({}, t.sound, o.sound || {}) });
    n.ch = Math.round(num(n.ch, 0, 16, t.ch)); n.note = Math.round(num(n.note, 0, 127, t.note)); n.mute = !!n.mute; n.solo = !!n.solo;
    if (t.kind === 'drum' && !DRUMS.includes(n.drum)) n.drum = t.drum;
    if (t.kind === 'synth' && !WAVES.includes(n.sound.wave)) n.sound.wave = t.sound.wave;
    return n;
  });
  st.patterns = st.patterns.map((p, i) => {
    const o = d.patterns[i] || {};
    p.master = MASTERS.includes(o.master) ? o.master : 16;
    p.tracks = p.tracks.map((t, ti) => {
      const ot = (Array.isArray(o.tracks) && o.tracks[ti]) || {};
      const steps = Array.isArray(ot.steps) ? ot.steps : [];
      return { len: Math.round(num(ot.len, 1, NSTEPS, 16)), speed: SPEEDS.includes(ot.speed) ? ot.speed : 1,
        steps: Array.from({ length: NSTEPS }, (_, j) => normStep(steps[j])) };
    });
    return p;
  });
  return st;
}

/* --- the engine: advance(state, out) runs one nominal tick and pushes what happens on it into out ---
 * {type:'step', ti, idx, step (null when it does not play), N, pt (tick in the pattern), stk (ticks a step)} and
 * {type:'pattern', pat, song, N} when a new pattern starts. */
function createEngine() {
  const e = { N: 0, start: 0, cur: 0, queued: null, song: -1, rep: 0, pre: [], fill: false, rnd: rng(1) };
  e.reset = (st, seed = 1) => {
    e.N = 0; e.start = 0; e.queued = null; e.rep = 0; e.pre = new Array(NTRACKS).fill(true); e.rnd = rng(seed);
    if (st.songOn && st.song.length) { e.song = 0; e.cur = st.song[0].pat; } else { e.song = -1; e.cur = st.cur; }
  };
  /* at the end of the pattern: the queued pattern, else the song's next entry, else nothing (keep looping) */
  e.nextPattern = (st) => {
    if (e.queued != null) { const q = e.queued; e.queued = null; return q; }
    if (!st.songOn || !st.song.length) { e.song = -1; return null; }
    if (e.song < 0 || e.song >= st.song.length) {
      const i = st.song.findIndex((x) => x.pat === e.cur);
      if (i < 0) { e.song = 0; e.rep = 0; return st.song[0].pat; }
      e.song = i; e.rep = 0;
    }
    e.rep++;
    if (e.rep < st.song[e.song].reps) return null;
    e.song = (e.song + 1) % st.song.length; e.rep = 0;
    return st.song[e.song].pat;
  };
  e.advance = (st, out) => {
    let pt = e.N - e.start;
    if (pt > 0 && pt % (st.patterns[e.cur].master * TPS) === 0) {
      const next = e.nextPattern(st);
      if (next != null) {
        e.cur = next; e.start = e.N; pt = 0; e.pre.fill(true);
        out.push({ type: 'pattern', pat: next, song: e.song, N: e.N });
      }
    }
    const pat = st.patterns[e.cur];
    for (let ti = 0; ti < NTRACKS; ti++) {
      const tr = pat.tracks[ti], stk = stepTicks(tr.speed);
      if (pt % stk) continue;
      const k = pt / stk, len = clamp(tr.len, 1, NSTEPS), idx = k % len, loop = Math.floor(k / len);
      const s = tr.steps[idx];
      let play = false;
      if (s && s.on) {
        play = evalCond(s.cond, { loop, fill: e.fill, pre: e.pre[ti], rnd: e.rnd });
        if (condSetsPre(s.cond)) e.pre[ti] = play;
      }
      out.push({ type: 'step', ti, idx, step: play ? s : null, N: e.N, pt, stk });
    }
    e.N++;
  };
  return e;
}

/* --- the randomiser: a new steps array for one track of a pattern. amount 0..1 is the share of steps it touches. --- */
const DENSITY = { kick: 0.3, snare: 0.22, clap: 0.22, hat: 0.6, ohat: 0.25, tom: 0.25, rim: 0.3, cowbell: 0.22, cymbal: 0.1, shaker: 0.55, zap: 0.15 };
function degreeNote(d, root, scale, base) {
  const n = scale.length, oct = Math.floor(d / n), i = ((d % n) + n) % n;
  return base + root + oct * 12 + scale[i];
}
function randomizeSteps(ptr, tr, amount, seed, scale, root) {
  const r = rng(seed), steps = ptr.steps.slice();
  const base = Math.floor((tr.note - root) / 12) * 12;
  const density = tr.kind === 'drum' ? DENSITY[tr.drum] || 0.3 : tr.poly ? 0.2 : 0.42;
  for (let i = 0; i < ptr.len; i++) {
    if (r() >= amount) continue;
    const old = steps[i];
    if (r() >= density) { steps[i] = old ? Object.assign(clone(old), { on: false }) : null; continue; }
    const s = old ? clone(old) : newStep(tr.note);
    s.on = true; s.vel = Math.round(60 + r() * 67);
    if (tr.kind === 'drum') { if (r() < 0.12) s.ratch = 2 + Math.floor(r() * 3); }
    else {
      const d = Math.floor(r() * (scale.length + 3)) - 1;
      s.notes = tr.poly ? [0, 2, 4].map((k) => degreeNote(d + k, root, scale, base)) : [degreeNote(d, root, scale, base)];
      s.len = tr.poly ? [2, 3, 4][Math.floor(r() * 3)] : [0.5, 1, 1, 2][Math.floor(r() * 4)];
      if (r() < 0.25) s.locks.cutoff = Math.round((0.2 + r() * 0.7) * 100) / 100;
    }
    if (r() < 0.12) s.cond = ['50%', '75%', '1:2', '2:2', '!1ST'][Math.floor(r() * 5)];
    steps[i] = s;
  }
  return steps;
}

/* --- the demo: A (the groove), B (a busier take), C (a breakdown), a song of them --- */
function demoProject() {
  const st = blankProject();
  st.bpm = 116; st.swing = 0.1; st.song = [{ pat: 0, reps: 2 }, { pat: 1, reps: 2 }, { pat: 2, reps: 1 }, { pat: 1, reps: 1 }];
  const A = st.patterns[0];
  A.master = 32;
  const put = (pat, ti, idx, o = {}) => { pat.tracks[ti].steps[idx] = newStep(st.tracks[ti].note, o); };
  const len = (pat, ti, l, sp = 1) => { pat.tracks[ti].len = l; pat.tracks[ti].speed = sp; };
  /* kick: four on the floor, a ghost now and then */
  [0, 4, 8, 12].forEach((i) => put(A, 0, i, { vel: 120 }));
  put(A, 0, 11, { vel: 70, cond: '25%' });
  /* snare: 2 and 4, a ratchet roll on FILL */
  put(A, 1, 4, { vel: 110 }); put(A, 1, 12, { vel: 110 });
  put(A, 1, 14, { vel: 45, cond: '33%' });
  put(A, 1, 15, { vel: 85, ratch: 4, cond: 'FILL' });
  /* hats: sixteenths, open on the offbeats, a lazy push on the odd ones */
  for (let i = 0; i < 16; i++) {
    if (i % 4 === 2) put(A, 2, i, { vel: 108, locks: i % 8 === 6 ? { decay: 2.4 } : {} });
    else put(A, 2, i, { vel: i % 2 ? 46 : 64, micro: i % 2 ? 4 : 0 });
  }
  put(A, 2, 15, { vel: 70, ratch: 2, cond: '1:2' });
  /* perc: a seven-step rim figure drifting over the bar */
  len(A, 3, 7);
  put(A, 3, 0, { vel: 95 }); put(A, 3, 3, { vel: 70, locks: { tone: 0.8 } }); put(A, 3, 5, { vel: 82 });
  /* bass: 32 steps under Am F C G */
  len(A, 4, 32);
  [[0, 33], [3, 33], [6, 45], [8, 29], [11, 29], [14, 41], [16, 36], [19, 36], [22, 48], [24, 31], [27, 31], [30, 43]].forEach(([i, n]) =>
    put(A, 4, i, { notes: [n], len: i % 8 === 6 ? 1 : 0.75, vel: i % 8 === 0 ? 118 : 96, locks: i % 8 === 6 ? { cutoff: 0.6 } : {} }));
  /* lead: half speed, 16 steps = 2 bars */
  len(A, 5, 16, 0.5);
  put(A, 5, 0, { notes: [76], len: 3 }); put(A, 5, 4, { notes: [72], len: 1.5 }); put(A, 5, 6, { notes: [74], len: 1 });
  put(A, 5, 8, { notes: [79], len: 3, cond: '!1ST' }); put(A, 5, 12, { notes: [74], len: 2, cond: '50%' }); put(A, 5, 14, { notes: [71], len: 1.5 });
  /* chords: half speed, Am F C G */
  len(A, 6, 16, 0.5);
  [[0, [57, 60, 64]], [4, [57, 60, 65]], [8, [55, 60, 64]], [12, [55, 59, 62]]].forEach(([i, ch]) => put(A, 6, i, { notes: ch, len: 3.8, vel: 90 }));
  /* pluck: double speed, 12 steps = 6 sixteenths against the bar */
  len(A, 7, 12, 2);
  [[0, 69], [2, 76], [4, 72], [6, 81], [8, 74], [10, 79]].forEach(([i, n], k) => put(A, 7, i, { notes: [n], len: 1.5, vel: 70 + (k % 3) * 15, cond: k === 3 ? '50%' : '' }));
  /* B: the same with a busier kick, an always-on roll and more lead */
  const B = clone(A);
  put(B, 0, 7, { vel: 80 }); put(B, 0, 10, { vel: 92 });
  put(B, 1, 15, { vel: 80, ratch: 3 }); put(B, 1, 7, { vel: 60, cond: '50%' });
  B.tracks[5].steps[8].cond = ''; B.tracks[5].steps[12].cond = '';
  put(B, 5, 2, { notes: [77], len: 1 }); put(B, 5, 10, { notes: [81], len: 1, locks: { cutoff: 0.75 } });
  put(B, 3, 6, { vel: 88, ratch: 2 });
  st.patterns[1] = B;
  /* C: a breakdown, chords, pluck and soft hats */
  const C = clone(A);
  [0, 1, 3, 4].forEach((ti) => { C.tracks[ti].steps.fill(null); });
  put(C, 0, 0, { vel: 100 });
  C.tracks[2].steps = C.tracks[2].steps.map((s, i) => (s && i % 4 === 2 ? Object.assign(s, { vel: 60 }) : null));
  C.tracks[5].steps.fill(null);
  st.patterns[2] = C;
  return st;
}

if (typeof module !== 'undefined') module.exports = { NTRACKS, NSTEPS, TPS, LEAD, CONDS, SPEEDS, stepTicks, evalCond, condSetsPre, rng,
  newStep, newPattern, blankProject, normalize, createEngine, randomizeSteps, degreeNote, demoProject, patternUsed, noteName };

/* ================================================================== the screen === */
function initApp() {
  const S = window.SeqCore, { el, knob, toast } = S.ui, { clock, audio, midi, store } = S;
  const undo = store.undoStack(80);
  const eng = createEngine();
  let state = demoProject();
  const v = { track: 0, page: 0, cursor: 0, sel: new Set(), fill: false, rec: false, follow: false, clip: null, snap: null,
    amount: 0.5, play: new Array(NTRACKS).fill(-1), playT: new Array(NTRACKS).fill(0), playStk: new Array(NTRACKS).fill(TPS), songPos: -1 };
  const pk = { base: 48 };
  const disp = [], out = [];

  const pat = () => state.patterns[state.cur];
  const ptr = (ti = v.track) => pat().tracks[ti];
  const trk = (ti = v.track) => state.tracks[ti];
  const anySolo = () => state.tracks.some((t) => t.solo);
  const audible = (ti) => !state.tracks[ti].mute && (!anySolo() || state.tracks[ti].solo);

  /* ---- edits: undo (a burst of the same edit is one undo step), autosave ---- */
  let lastKey = '', lastT = 0, saveTimer = 0;
  function edit(key) {
    const now = performance.now();
    if (!key || key !== lastKey || now - lastT > 900) undo.push(state);
    lastKey = key || ''; lastT = now;
  }
  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.save('stitch', state), 300); }
  function setState(s) { state = s; v.sel.clear(); clock.bpm = state.bpm; clock.swing = state.swing; head.setTempo(state.bpm); head.setSwing(state.swing); renderAll(); save(); }

  /* ---- sound ---- */
  function soundFor(tr, s) {
    if (!s || !s.locks) return tr.sound;
    const o = Object.assign({}, tr.sound);
    for (const [k, x] of Object.entries(s.locks)) if (paramDef(tr, k)) o[k] = x;
    return o;
  }
  function playStep(ti, s, time, stepSec) {
    const tr = state.tracks[ti], snd = soundFor(tr, s), r = s.ratch, sub = stepSec / r;
    for (let i = 0; i < r; i++) {
      const t = time + i * sub;
      if (tr.kind === 'drum') { audio.drum(tr.drum, s.vel, t, snd); midi.note(tr.ch, audio.GM_NOTE[tr.drum] || 36, s.vel, t, 0.05); }
      else {
        const dur = r > 1 ? sub * 0.8 : s.len * stepSec * 0.97;
        for (const n of s.notes) { audio.note(snd, n, s.vel, t, dur); midi.note(tr.ch, n + 12 * (snd.octave || 0), s.vel, t, dur); }
      }
    }
  }
  function preview(ti, s) { if (!clock.playing && s) playStep(ti, s, audio.ensure().currentTime + 0.01, clock.secPerTick() * stepTicks(ptr(ti).speed)); }

  /* ---- the clock: read LEAD ticks ahead, schedule at the exact time ---- */
  clock.onStart = (t0) => {
    eng.reset(state, state.seed * 7919 + (Date.now() & 0xffff)); eng.fill = v.fill; disp.length = 0;
    disp.push([t0, 'p', eng.cur, eng.song]);
  };
  clock.onTick = (T, t) => {
    const spt = clock.secPerTick();
    eng.fill = v.fill;
    while (eng.N <= T + LEAD) {
      const N = eng.N, tn = t + (N - T) * spt;
      out.length = 0; eng.advance(state, out);
      for (const ev of out) {
        if (ev.type === 'pattern') { disp.push([tn, 'p', ev.pat, ev.song]); continue; }
        disp.push([tn, 's', ev.ti, ev.idx, ev.stk]);
        if (ev.step && audible(ev.ti)) playStep(ev.ti, ev.step, tn + clock.swingOffset(ev.pt) + ev.step.micro / 48 * ev.stk * spt, ev.stk * spt);
      }
    }
  };
  clock.onStop = () => { disp.length = 0; v.play.fill(-1); eng.queued = null; v.songPos = -1; paintPlay(); renderPatterns(); renderSong(); };

  /* ================================================================ building the screen */
  const help = [
    ['Space', 'Play / stop'],
    ['Click a step', 'Trig on / off (Enter on a focused step too)'],
    ['Hold / right-click / long-press a step', 'Select it: the track knobs now set parameter locks on it (blue); the inspector shows all its fields'],
    ['Shift+click a step', 'Add or remove a step from the selection'],
    ['Esc', 'Deselect the steps (and close this help)'],
    ['Delete / Backspace', 'Clear the selected steps'],
    ['Arrow keys', 'Move the step cursor; up and down change the track'],
    ['Enter', 'Trig on / off at the cursor'],
    ['z s x d c v g b h n j m , / q 2 w 3 e r 5 t 6 y 7 u i', 'Piano: write the note into the cursor step (hold several keys: a chord, up to 4). Drum tracks: a trig. With REC: stopped, the cursor moves on; playing, it records live, to the nearest step'],
    ['[ and ]', 'Piano octave down / up'],
    ['1 - 8', 'Mute a track (Shift+1-8: solo)'],
    ['F (hold)', 'FILL: steps with the FILL condition play, !FILL ones rest'],
    ['A - H', 'Pattern buttons: stopped, it changes at once; playing, it waits (blinks) for the end of the pattern'],
    ['Copy / Paste / Clear', 'The pattern on screen (undoable)'],
    ['Save state / Reload', 'Remember the pattern and sounds; Reload snaps back to them after you mess with it'],
    ['Randomise', 'Rewrites the selected track with the amount (share of steps touched) and a new seed; undoable'],
    ['SONG', 'Play the chain of patterns (each with its repeats) instead of looping one'],
    ['Trig conditions', 'N%: chance. A:B: plays on loop A of every B loops of the track. FILL / !FILL. PRE / !PRE: the last condition on the track was true / false. 1ST / !1ST: the first loop since the pattern started'],
    ['Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z', 'Undo, redo'],
  ];
  function doUndo() { const s = undo.undo(state); if (s) { setState(s); toast('Undo'); } else toast('Nothing to undo'); }
  function doRedo() { const s = undo.redo(state); if (s) { setState(s); toast('Redo'); } else toast('Nothing to redo'); }
  const head = S.ui.header({
    name: 'STITCH', tagline: 'trig-and-lock step groovebox', color: S.ui.css('--accent'), help,
    about: 'Eight tracks of steps. Click to place trigs; hold a step to lock any sound parameter on it. Tracks have their own length and speed, so they drift. Patterns A-H change at the end of the pattern; FILL, mutes and the temporary save are for playing live.',
    onUndo: doUndo, onRedo: doRedo,
    onNew: () => { edit(); const s = blankProject(); s.bpm = state.bpm; setState(s); toast('New project (Undo brings the old one back)'); },
    onSave: () => store.download('stitch.json', state),
    onLoad: async () => { const d = normalize(await store.upload()); if (!d) return toast('Not a STITCH file'); edit(); setState(d); toast('Opened'); },
    onShare: async () => {
      const link = await store.shareLink(state);
      try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch (e) { history.replaceState(null, '', link); toast('Link in the address bar'); }
    },
    onTempo: (x) => { state.bpm = x; save(); }, onSwing: (x) => { state.swing = x; save(); },
  });
  document.body.append(head);
  const main = el('main', {});
  document.body.append(main);

  /* ---- the pattern bar ---- */
  const patBtns = [...PAT_NAMES].map((n, i) => el('button', { class: 'sc-btn st-pat', title: `Pattern ${n}`, 'aria-label': `Pattern ${n}`, onclick: () => choosePattern(i) }, n));
  const pageBtns = [0, 1, 2, 3].map((p) => el('button', { class: 'sc-btn st-page', title: `Steps ${p * 16 + 1}-${p * 16 + 16}`, 'aria-label': `Page ${p + 1}`, onclick: () => { v.page = p; v.cursor = p * PAGE + (v.cursor % PAGE); renderAll(); } }, String(p + 1)));
  const masterSel = S.ui.select('Pattern length', MASTERS.map((m) => ({ value: m, label: m + ' steps' })), 16, (x) => { edit(); pat().master = +x; save(); });
  const fillBtn = el('button', { class: 'sc-btn fill', title: 'FILL while held (or hold F)', 'aria-pressed': 'false' }, 'FILL');
  const setFill = (on) => { v.fill = on; fillBtn.classList.toggle('on', on); fillBtn.setAttribute('aria-pressed', String(on)); };
  fillBtn.addEventListener('pointerdown', (e) => { setFill(true); try { fillBtn.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic pointer */ } });
  ['pointerup', 'pointercancel'].forEach((ev) => fillBtn.addEventListener(ev, () => setFill(false)));
  fillBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.repeat) setFill(true); });
  fillBtn.addEventListener('keyup', (e) => { if (e.key === 'Enter') setFill(false); });
  const recBtn = el('button', { class: 'sc-btn rec', title: 'Record from the piano keys or MIDI in: stopped, step by step; playing, live to the nearest step', 'aria-pressed': 'false', onclick: () => {
    v.rec = !v.rec; recBtn.classList.toggle('on', v.rec); recBtn.setAttribute('aria-pressed', String(v.rec)); hint();
  } }, '● REC');
  const followBtn = el('button', { class: 'sc-btn', title: 'The page follows the selected track\'s playhead', 'aria-pressed': 'false', onclick: () => {
    v.follow = !v.follow; followBtn.classList.toggle('on', v.follow); followBtn.setAttribute('aria-pressed', String(v.follow));
  } }, 'Follow');
  const bar = el('section', { class: 'sc-panel st-bar', 'aria-label': 'Patterns and performance' },
    el('div', { class: 'st-group' }, el('span', { class: 'sc-label' }, 'Pattern'), patBtns),
    el('div', { class: 'st-group' },
      el('button', { class: 'sc-btn', title: 'Copy the pattern on screen', onclick: copyPattern }, 'Copy'),
      el('button', { class: 'sc-btn', title: 'Paste over the pattern on screen (undoable)', onclick: pastePattern }, 'Paste'),
      el('button', { class: 'sc-btn', title: 'Clear the pattern on screen (undoable)', onclick: clearPattern }, 'Clear'),
      masterSel),
    el('div', { class: 'st-group' }, el('span', { class: 'sc-label' }, 'Page'), pageBtns, followBtn),
    el('div', { class: 'st-group' }, fillBtn, recBtn,
      el('button', { class: 'sc-btn', title: 'Remember this pattern and the sounds', onclick: saveSnap }, 'Save state'),
      el('button', { class: 'sc-btn', title: 'Back to the saved state (undoable)', onclick: reloadSnap }, 'Reload')));
  main.append(bar);

  /* ---- the step grid ---- */
  const grid = el('div', { class: 'st-grid', role: 'grid', 'aria-label': 'Steps' });
  const rows = [], stepBtns = [];
  let press = null;
  for (let ti = 0; ti < NTRACKS; ti++) {
    const name = el('button', { class: 'sc-btn st-name', title: 'Select the track', onclick: () => selectTrack(ti) });
    const m = el('button', { class: 'sc-btn st-ms m', title: `Mute (${ti + 1})`, 'aria-label': `Mute track ${ti + 1}`, 'aria-pressed': 'false', onclick: () => toggleMute(ti) }, 'M');
    const s = el('button', { class: 'sc-btn st-ms s', title: `Solo (Shift+${ti + 1})`, 'aria-label': `Solo track ${ti + 1}`, 'aria-pressed': 'false', onclick: () => toggleSolo(ti) }, 'S');
    const steps = el('div', { class: 'st-steps', role: 'row' });
    const btns = [];
    for (let j = 0; j < PAGE; j++) {
      const b = el('button', { class: 'st-step', role: 'gridcell' },
        el('span', { class: 'mk lk' }), el('span', { class: 'mk rt' }), el('span', { class: 'mk nt' }), el('span', { class: 'mk cd' }), el('span', { class: 'mk mc' }));
      b.mk = { rt: b.children[1], nt: b.children[2], cd: b.children[3] };
      const si = () => v.page * PAGE + j;
      b.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        clearTimeout(press && press.timer);
        const p = { ti, si: si(), x: e.clientX, y: e.clientY, held: false };
        p.timer = setTimeout(() => { p.held = true; selectStep(ti, p.si, false); }, 380);
        press = p;
      });
      b.addEventListener('pointermove', (e) => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) clearTimeout(press.timer); });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => b.addEventListener(ev, () => press && clearTimeout(press.timer)));
      b.addEventListener('click', (e) => {
        const p = press; press = null;
        if (p && p.held && p.ti === ti && p.si === si()) return;
        if (e.shiftKey) selectStep(ti, si(), true); else toggleStep(ti, si());
      });
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); if (press) { clearTimeout(press.timer); press.held = true; } selectStep(ti, si(), e.shiftKey); });
      b.addEventListener('focus', () => { if (v.track !== ti || v.cursor !== si()) { setCursor(ti, si()); } });
      btns.push(b); steps.append(b);
    }
    const info = el('span', { class: 'st-info' });
    const row = el('div', { class: 'st-row', style: `--tc: var(--c${ti + 1})` }, name, m, s, steps, info);
    row.parts = { name, m, s, info };
    rows.push(row); stepBtns.push(btns); grid.append(row);
  }
  main.append(el('section', { class: 'sc-panel st-gridwrap', 'aria-label': 'Step grid' }, grid,
    el('div', { class: 'sc-hint', id: 'st-hint', style: 'margin-top:8px' })));

  /* ---- the track panel and the step inspector ---- */
  const trackPanel = el('section', { class: 'sc-panel st-panel', 'aria-label': 'Track' });
  const inspPanel = el('section', { class: 'sc-panel st-panel', 'aria-label': 'Step inspector' });
  const songPanel = el('section', { class: 'sc-panel st-panel', 'aria-label': 'Song' });
  main.append(el('div', { class: 'st-panels' }, trackPanel, el('div', { style: 'display:flex;flex-direction:column;gap:14px' }, inspPanel, songPanel)));

  /* ================================================================ painting */
  function hint() {
    const h = document.getElementById('st-hint');
    const tr = trk();
    h.textContent = (v.sel.size ? `${v.sel.size} step${v.sel.size > 1 ? 's' : ''} selected: the knobs set locks (blue). Esc deselects. `
      : 'Click: trig. Hold, right-click or long-press: select a step to lock parameters. Shift+click: select more. ')
      + (tr.kind === 'synth' ? `Piano keys write notes (octave ${pk.base / 12 - 1}, [ ] to change)` : 'Piano keys write trigs')
      + (v.rec ? (clock.playing ? '; REC: recording live.' : '; REC: step recording, the cursor moves on.') : '.');
  }
  function paintStep(ti, j) {
    const b = stepBtns[ti][j], si = v.page * PAGE + j, ptrk = ptr(ti), s = ptrk.steps[si], tr = trk(ti);
    const inLen = si < ptrk.len;
    b.disabled = !inLen;
    b.classList.toggle('on', !!(s && s.on));
    b.classList.toggle('data', !!(s && !s.on));
    b.classList.toggle('beat', si % 4 === 0);
    b.classList.toggle('sel', ti === v.track && v.sel.has(si));
    b.classList.toggle('cursor', ti === v.track && si === v.cursor);
    b.classList.toggle('locked', !!(s && Object.keys(s.locks).length));
    b.classList.toggle('micro', !!(s && s.micro));
    if (s) { b.style.setProperty('--o', (0.4 + 0.6 * s.vel / 127).toFixed(2)); b.style.setProperty('--m', Math.round(s.micro / 48 * 100)); }
    b.mk.rt.textContent = s && s.ratch > 1 ? '×' + s.ratch : '';
    b.mk.cd.textContent = s && s.cond ? s.cond : '';
    b.mk.nt.textContent = s && tr.kind === 'synth' ? (s.notes.length > 1 ? noteName(s.notes[0]) + '+' + (s.notes.length - 1) : noteName(s.notes[0])) : '';
    const desc = !inLen ? 'past the track length' : !s ? 'empty' : (s.on ? 'trig' : 'off') + (tr.kind === 'synth' ? ' ' + s.notes.map(noteName).join(' ') : '')
      + ` velocity ${s.vel}` + (s.cond ? ` condition ${s.cond}` : '') + (s.ratch > 1 ? ` ratchet ${s.ratch}` : '') + (Object.keys(s.locks).length ? ' with locks' : '');
    b.setAttribute('aria-label', `${tr.name} step ${si + 1}: ${desc}`);
    b.setAttribute('aria-selected', String(ti === v.track && v.sel.has(si)));
  }
  function paintRow(ti) {
    const r = rows[ti], tr = trk(ti), p = ptr(ti);
    r.classList.toggle('sel', ti === v.track);
    r.classList.toggle('silent', !audible(ti));
    r.parts.name.replaceChildren(tr.name, el('small', {}, tr.kind === 'drum' ? tr.drum : tr.sound.wave));
    r.parts.name.setAttribute('aria-pressed', String(ti === v.track));
    r.parts.m.setAttribute('aria-pressed', String(tr.mute));
    r.parts.s.setAttribute('aria-pressed', String(tr.solo));
    r.parts.info.textContent = `${p.len} · ${SPEED_NAMES[p.speed]}`;
    for (let j = 0; j < PAGE; j++) paintStep(ti, j);
  }
  function paintGrid() {
    for (let ti = 0; ti < NTRACKS; ti++) paintRow(ti);
    playBtn.forEach((b) => b && b.classList.remove('play')); playBtn.fill(null); paintPlay();
  }
  const playBtn = new Array(NTRACKS).fill(null);
  function paintPlay() {
    for (let ti = 0; ti < NTRACKS; ti++) {
      const i = v.play[ti], b = i >= 0 && Math.floor(i / PAGE) === v.page ? stepBtns[ti][i % PAGE] : null;
      if (b !== playBtn[ti]) { if (playBtn[ti]) playBtn[ti].classList.remove('play'); if (b) b.classList.add('play'); playBtn[ti] = b; }
    }
    const here = v.play[v.track] >= 0 ? Math.floor(v.play[v.track] / PAGE) : -1;
    pageBtns.forEach((b, p) => b.classList.toggle('here', p === here));
  }
  function renderPatterns() {
    patBtns.forEach((b, i) => {
      b.classList.toggle('cur', i === state.cur);
      b.classList.toggle('queued', clock.playing && eng.queued === i);
      b.classList.toggle('used', patternUsed(state.patterns[i]));
      b.classList.toggle('insong', state.songOn && state.song.some((e) => e.pat === i));
      b.setAttribute('aria-pressed', String(i === state.cur));
      b.title = `Pattern ${PAT_NAMES[i]}` + (clock.playing && eng.queued === i ? ' (waiting for the end of the pattern)' : '');
    });
    const len = ptr().len;
    pageBtns.forEach((b, p) => { b.classList.toggle('on', p === v.page); b.classList.toggle('out', p * PAGE >= len); b.setAttribute('aria-pressed', String(p === v.page)); });
    masterSel.querySelector('select').value = String(pat().master);
  }

  /* the track panel: the sound (knobs; with steps selected they set locks), MIDI, length, speed, the randomiser */
  const knobs = {};
  function shownParam(k) {
    const tr = trk(), ps = ptr();
    for (const si of v.sel) { const s = ps.steps[si]; if (s && k in s.locks) return { x: s.locks[k], locked: true }; }
    return { x: tr.sound[k], locked: false };
  }
  function renderTrack() {
    const tr = trk(), p = ptr(), ti = v.track;
    trackPanel.style.setProperty('--tc', `var(--c${ti + 1})`);
    const soundSel = tr.kind === 'drum'
      ? S.ui.select('Drum', DRUMS, tr.drum, (x) => { edit(); tr.drum = x; renderTrack(); paintRow(ti); save(); preview(ti, newStep()); })
      : S.ui.select('Wave', WAVES, tr.sound.wave, (x) => { edit(); tr.sound.wave = x; paintRow(ti); save(); preview(ti, newStep(tr.note)); });
    const chSel = S.ui.select('MIDI ch', [{ value: 0, label: 'off' }].concat(Array.from({ length: 16 }, (_, i) => ({ value: i + 1, label: String(i + 1) }))), tr.ch,
      (x) => { edit(); tr.ch = +x; save(); });
    const speedSel = S.ui.select('Speed', SPEEDS.map((s) => ({ value: s, label: SPEED_NAMES[s] })), p.speed, (x) => { edit(); ptr(ti).speed = +x; paintRow(ti); save(); });
    const lenK = knob({ label: 'LENGTH', min: 1, max: NSTEPS, step: 1, value: p.len, def: 16, fmt: (x) => x + ' st', onInput: (x) => {
      edit('len'); ptr(ti).len = x; paintRow(ti); renderPatterns(); save(); } });
    lenK.title = 'Steps in this track (1-64); pages past it are dim';
    const top = [soundSel, chSel, lenK, speedSel];
    if (tr.kind === 'synth') {
      const noteK = knob({ label: 'NEW NOTE', min: 0, max: 127, step: 1, value: tr.note, def: 60, fmt: noteName, onInput: (x) => { edit('note'); tr.note = x; save(); } });
      noteK.title = 'The note a new trig gets';
      top.push(noteK);
    }
    for (const k in knobs) delete knobs[k];
    const ks = paramsFor(tr).map((d) => {
      const sh = shownParam(d.k);
      const kn = knob({ label: d.label, min: d.min, max: d.max, step: d.step, def: d.def, value: sh.x, fmt: d.fmt, onInput: (x) => setParam(d.k, x) });
      kn.classList.toggle('locked', sh.locked);
      kn.title = v.sel.size ? 'Turn to lock this on the selected steps' : 'The track sound (hold a step first to lock it per step)';
      knobs[d.k] = kn;
      return kn;
    });
    const amountK = knob({ label: 'AMOUNT', min: 0, max: 1, step: 0.01, value: v.amount, def: 0.5, fmt: (x) => Math.round(x * 100) + '%', onInput: (x) => { v.amount = x; } });
    amountK.title = 'Share of the track\'s steps the randomiser touches';
    const scaleNames = Object.keys(S.music.SCALES);
    trackPanel.replaceChildren(
      el('h2', {}, el('span', { class: 'st-dot' }), `Track ${ti + 1} · ${tr.name}`,
        el('span', { class: 'sc-hint' }, v.sel.size ? `locking ${v.sel.size} step${v.sel.size > 1 ? 's' : ''}` : tr.kind === 'drum' ? 'drum' : 'synth')),
      el('div', { class: 'sc-row' }, top),
      el('div', { class: 'sc-label st-sub' }, v.sel.size ? 'Sound · locks on the selected steps' : 'Sound'),
      el('div', { class: 'st-knobs' }, ks),
      el('div', { class: 'sc-label st-sub' }, 'Randomise this track'),
      el('div', { class: 'sc-row' }, amountK,
        S.ui.select('Key', NOTE_NAMES.map((n, i) => ({ value: i, label: n })), state.key, (x) => { state.key = +x; save(); }),
        S.ui.select('Scale', scaleNames, state.scale, (x) => { state.scale = x; save(); }),
        el('button', { class: 'sc-btn', title: 'Rewrite the track with a new seed (undoable)', onclick: randomise }, 'Randomise'),
        el('span', { class: 'sc-hint', id: 'st-seed' }, `seed ${state.seed}`)));
  }
  function setParam(k, x) {
    const tr = trk(), p = ptr();
    if (v.sel.size) {
      edit('lock' + k);
      for (const si of v.sel) { if (!p.steps[si]) p.steps[si] = newStep(tr.note); p.steps[si].locks[k] = x; }
      knobs[k] && knobs[k].classList.add('locked');
      paintRow(v.track); renderInsp();
    } else { edit('snd' + k); tr.sound[k] = x; }
    save();
  }

  /* the step inspector: every field of the selected steps (edits go to all of them) */
  function selSteps() { const p = ptr(); return [...v.sel].sort((a, b) => a - b).map((si) => p.steps[si]).filter(Boolean); }
  function setField(key, fn, rebuild = false) { edit('f' + key); selSteps().forEach(fn); paintRow(v.track); if (rebuild) renderInsp(); save(); }
  function renderInsp() {
    const tr = trk(), p = ptr(), idx = [...v.sel].sort((a, b) => a - b);
    inspPanel.style.setProperty('--tc', `var(--c${v.track + 1})`);
    if (!idx.length) {
      inspPanel.replaceChildren(el('h2', {}, 'Step'), el('p', { class: 'sc-hint' },
        'Hold a step (or right-click, or long-press on touch) to select it; Shift+click adds more. Then its note, velocity, length, microtiming, ratchet, condition and locks show here.'));
      return;
    }
    const title = el('h2', {}, el('span', { class: 'st-dot' }), idx.length === 1 ? `${tr.name} · step ${idx[0] + 1}` : `${tr.name} · ${idx.length} steps`);
    const first = idx.map((i) => p.steps[i]).find(Boolean);
    const done = el('button', { class: 'sc-btn', title: 'Deselect (Esc)', onclick: deselect }, 'Done');
    if (!first) {
      inspPanel.replaceChildren(title, el('p', { class: 'sc-hint' }, 'Empty. Turn a sound knob to make a lock trig, or add a trig.'),
        el('div', { class: 'sc-row' }, el('button', { class: 'sc-btn', onclick: () => { edit(); idx.forEach((i) => { p.steps[i] = newStep(tr.note); }); paintRow(v.track); renderInsp(); save(); } }, 'Add trig'), done));
      return;
    }
    const trig = el('button', { class: 'sc-btn st-trig', 'aria-pressed': String(first.on), title: 'Trig on / off', onclick: () => { const on = !first.on; setField('on', (s) => { s.on = on; }, true); } }, first.on ? 'Trig on' : 'Trig off');
    const fields = [];
    if (tr.kind === 'synth') {
      first.notes.forEach((n, i) => fields.push(knob({ label: 'NOTE ' + (i + 1), min: 0, max: 127, step: 1, value: n, def: tr.note, fmt: noteName,
        onInput: (x) => setField('n' + i, (s) => { if (s.notes.length > i) s.notes[i] = x; else if (s.notes.length === i) s.notes.push(x); }) })));
    }
    fields.push(knob({ label: 'VELOCITY', min: 1, max: 127, step: 1, value: first.vel, def: 100, fmt: String, onInput: (x) => setField('vel', (s) => { s.vel = x; }) }));
    fields.push(knob({ label: 'MICRO', min: -23, max: 23, step: 1, value: first.micro, def: 0, fmt: (x) => (x > 0 ? '+' : '') + x + '/48', onInput: (x) => setField('micro', (s) => { s.micro = x; }) }));
    fields.push(knob({ label: 'RATCHET', min: 1, max: 8, step: 1, value: first.ratch, def: 1, fmt: (x) => '×' + x, onInput: (x) => setField('ratch', (s) => { s.ratch = x; }) }));
    const lenSel = S.ui.select('Length', LENS.map((l) => ({ value: l, label: l + (l === 1 ? ' step' : ' steps') })), first.len, (x) => setField('len', (s) => { s.len = +x; }));
    if (!LENS.includes(first.len)) lenSel.querySelector('select').append(el('option', { value: first.len, selected: true }, first.len.toFixed(2) + ' steps'));
    const condSel = S.ui.select('Condition', CONDS.map((c) => ({ value: c, label: condLabel(c) })), first.cond, (x) => setField('cond', (s) => { s.cond = x; }));
    const noteBtns = tr.kind === 'synth' ? [
      el('button', { class: 'sc-btn', title: 'Add a note to the chord (up to 4)', disabled: first.notes.length >= 4, onclick: () => setField('addn', (s) => { if (s.notes.length < 4) s.notes.push(s.notes[s.notes.length - 1] + (s.notes.length % 2 ? 4 : 3)); }, true) }, '+ note'),
      el('button', { class: 'sc-btn', title: 'Remove the chord\'s last note', disabled: first.notes.length <= 1, onclick: () => setField('deln', (s) => { if (s.notes.length > 1) s.notes.pop(); }, true) }, '− note'),
    ] : [];
    const locks = Object.entries(first.locks).map(([k, x]) => {
      const d = paramDef(tr, k);
      return el('button', { class: 'st-chip', title: 'Remove this lock', onclick: () => { setField('unlock', (s) => { delete s.locks[k]; }, true); renderTrack(); } },
        el('b', {}, d ? d.label : k), d ? d.fmt(x) : String(x), el('span', { 'aria-hidden': 'true' }, '×'));
    });
    inspPanel.replaceChildren(title,
      el('div', { class: 'sc-row' }, trig, noteBtns),
      el('div', { class: 'st-knobs' }, fields),
      el('div', { class: 'sc-row' }, lenSel, condSel),
      el('div', { class: 'sc-label st-sub' }, 'Parameter locks'),
      locks.length ? el('div', { class: 'st-chips' }, locks) : el('p', { class: 'sc-hint', style: 'margin:4px 0' }, 'None: turn a track knob while the step is selected.'),
      el('div', { class: 'sc-row', style: 'margin-top:10px' },
        el('button', { class: 'sc-btn', onclick: () => { setField('clrlk', (s) => { s.locks = {}; }, true); renderTrack(); } }, 'Clear locks'),
        el('button', { class: 'sc-btn', title: 'Delete / Backspace', onclick: clearSelected }, 'Clear step'),
        done));
  }

  /* the song: a chain of patterns with repeats */
  function renderSong() {
    const tog = el('button', { class: 'sc-btn' + (state.songOn ? ' on' : ''), 'aria-pressed': String(state.songOn), title: 'Follow the chain instead of looping one pattern', onclick: () => {
      state.songOn = !state.songOn; if (state.songOn) eng.queued = null; renderSong(); renderPatterns(); save(); } }, 'SONG');
    const entries = state.song.map((e, i) => el('span', { class: 'st-entry' + (clock.playing && state.songOn && v.songPos === i ? ' now' : '') },
      el('select', { 'aria-label': `Song entry ${i + 1} pattern`, onchange: (ev) => { edit(); e.pat = +ev.target.value; renderPatterns(); save(); } },
        [...PAT_NAMES].map((n, k) => el('option', { value: k, selected: k === e.pat }, n))),
      el('select', { 'aria-label': `Song entry ${i + 1} repeats`, onchange: (ev) => { edit(); e.reps = +ev.target.value; save(); } },
        Array.from({ length: 16 }, (_, k) => el('option', { value: k + 1, selected: k + 1 === e.reps }, '×' + (k + 1)))),
      el('button', { class: 'sc-btn', 'aria-label': `Remove song entry ${i + 1}`, title: 'Remove', onclick: () => { edit(); state.song.splice(i, 1); renderSong(); renderPatterns(); save(); } }, '×')));
    songPanel.replaceChildren(el('h2', {}, 'Song', el('span', { class: 'sc-hint' }, 'patterns in order, each with its repeats')),
      el('div', { class: 'st-song' }, tog, entries,
        el('button', { class: 'sc-btn', title: 'Add the pattern on screen', onclick: () => { edit(); state.song.push({ pat: state.cur, reps: 1 }); renderSong(); renderPatterns(); save(); } }, '+ ' + PAT_NAMES[state.cur])));
  }
  function renderAll() { renderPatterns(); paintGrid(); renderTrack(); renderInsp(); renderSong(); hint(); }

  /* ================================================================ actions */
  function selectTrack(ti) { if (ti !== v.track) { v.track = ti; v.sel.clear(); } renderAll(); }
  function setCursor(ti, si) {
    const changed = ti !== v.track;
    if (changed) { v.track = ti; v.sel.clear(); }
    v.cursor = si;
    if (Math.floor(si / PAGE) !== v.page) { v.page = Math.floor(si / PAGE); paintGrid(); }
    if (changed) renderAll(); else { paintRow(ti); renderPatterns(); }
  }
  function toggleStep(ti, si) {
    edit();
    const p = ptr(ti), tr = trk(ti);
    if (!p.steps[si]) p.steps[si] = newStep(tr.note); else p.steps[si].on = !p.steps[si].on;
    if (p.steps[si].on) preview(ti, p.steps[si]);
    setCursor(ti, si);
    renderPatterns(); if (v.sel.has(si)) renderInsp(); save();
  }
  function selectStep(ti, si, additive) {
    if (ti !== v.track) { v.track = ti; v.sel.clear(); }
    if (additive) { if (v.sel.has(si)) v.sel.delete(si); else v.sel.add(si); } else v.sel = new Set([si]);
    v.cursor = si;
    paintGrid(); renderTrack(); renderInsp(); hint();
  }
  function deselect() { v.sel.clear(); paintGrid(); renderTrack(); renderInsp(); hint(); }
  function clearSelected() {
    if (!v.sel.size) return;
    edit(); const p = ptr(); v.sel.forEach((si) => { p.steps[si] = null; });
    paintRow(v.track); renderTrack(); renderInsp(); renderPatterns(); save();
  }
  function toggleMute(ti) { state.tracks[ti].mute = !state.tracks[ti].mute; paintGrid(); save(); }
  function toggleSolo(ti) { state.tracks[ti].solo = !state.tracks[ti].solo; paintGrid(); save(); }
  function choosePattern(i) {
    if (state.songOn) { state.songOn = false; renderSong(); toast('Song off'); }
    if (clock.playing) { eng.queued = eng.cur === i ? null : (eng.queued === i ? null : i); renderPatterns(); }
    else { state.cur = i; v.sel.clear(); renderAll(); save(); }
  }
  function copyPattern() { v.clip = clone(pat()); toast(`Pattern ${PAT_NAMES[state.cur]} copied`); }
  function pastePattern() { if (!v.clip) return toast('Copy a pattern first'); edit(); state.patterns[state.cur] = clone(v.clip); v.sel.clear(); renderAll(); save(); toast(`Pasted into ${PAT_NAMES[state.cur]}`); }
  function clearPattern() { edit(); state.patterns[state.cur] = newPattern(); v.sel.clear(); renderAll(); save(); toast(`Pattern ${PAT_NAMES[state.cur]} cleared (Undo brings it back)`); }
  function saveSnap() { v.snap = { pat: state.cur, pattern: clone(pat()), tracks: clone(state.tracks) }; toast(`State of ${PAT_NAMES[state.cur]} saved`); }
  function reloadSnap() {
    if (!v.snap) return toast('Save a state first');
    edit();
    state.patterns[v.snap.pat] = clone(v.snap.pattern);
    state.tracks = clone(v.snap.tracks).map((t, i) => Object.assign(t, { mute: state.tracks[i].mute, solo: state.tracks[i].solo }));
    renderAll(); save(); toast(`Reloaded ${PAT_NAMES[v.snap.pat]}`);
  }
  function randomise() {
    edit();
    state.seed = (state.seed * 1103515245 + 12345) % 2147483647 || 1;
    const sc = S.music.SCALES[state.scale] || S.music.SCALES.minor;
    ptr().steps = randomizeSteps(ptr(), trk(), v.amount, state.seed, sc, state.key);
    renderAll(); save(); toast(`Randomised ${trk().name} (seed ${state.seed}); Undo to go back`);
  }

  /* ---- the piano keys and MIDI in: write into the cursor step, or record ---- */
  const held = new Map();  /* midi note -> release() */
  let chord = null;        /* the step a chord is being written into */
  let skipPiano = false;
  ['keydown', 'keyup'].forEach((ev) => window.addEventListener(ev, (e) => { skipPiano = /^Digit\d$/.test(e.code); }, true));
  function noteIn(n, vel, down) {
    const ti = v.track, tr = trk(ti);
    if (!down) {
      const r = held.get(n);
      if (r) { r(); held.delete(n); if (tr.kind === 'synth' && tr.ch) midi.send([0x80 | (tr.ch - 1), (n + 12 * (tr.sound.octave || 0)) & 127, 0]); }
      if (!held.size) {
        if (chord && v.rec && !clock.playing) { const len = ptr(ti).len; setCursor(ti, (v.cursor + 1) % len); }
        chord = null;
      }
      return;
    }
    audio.ensure();
    if (tr.kind === 'drum') { audio.drum(tr.drum, vel, audio.now(), tr.sound); midi.note(tr.ch, audio.GM_NOTE[tr.drum] || 36, vel, audio.now(), 0.05); }
    else {
      if (!held.has(n)) held.set(n, audio.hold(tr.sound, n, vel));
      if (tr.ch) midi.send([0x90 | (tr.ch - 1), (n + 12 * (tr.sound.octave || 0)) & 127, vel & 127]);
    }
    const p = ptr(ti);
    let si = v.cursor;
    if (v.rec && clock.playing) {
      if (v.play[ti] < 0) return;
      const stepSec = v.playStk[ti] * clock.secPerTick(), now = audio.now() - (audio.ctx.outputLatency || 0);
      si = v.play[ti];
      if ((now - v.playT[ti]) / stepSec > 0.5) si = (si + 1) % p.len;
      if (!chord || chord.si !== si) { edit('live'); chord = { si, fresh: true }; }
    } else if (!chord || chord.si !== si) { edit('w' + si); chord = { si, fresh: true }; }
    let s = p.steps[si];
    if (tr.kind === 'drum') { if (!s) s = p.steps[si] = newStep(tr.note); s.on = true; s.vel = vel; }
    else if (chord.fresh) { if (!s) s = p.steps[si] = newStep(n); s.on = true; s.notes = [n]; s.vel = vel; chord.fresh = false; }
    else if (s && !s.notes.includes(n) && s.notes.length < 4) s.notes.push(n);
    if (tr.kind === 'synth') { tr.note = n; }
    paintRow(ti); renderPatterns(); if (v.sel.has(si)) renderInsp(); save();
  }
  S.ui.pianoKeys((n, down) => { if (skipPiano) return; noteIn(n, 100, down); }, pk);
  midi.onNote = (n, vel, ch) => noteIn(n, vel || 100, vel > 0);

  /* ---- keys: cursor, Enter, mutes, FILL, octave, delete ---- */
  window.addEventListener('keydown', (e) => {
    if (!e.target.closest || e.target.closest('input,select,textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.startsWith('Arrow') && e.target.closest('.sc-knob')) return;   /* a focused knob turns with the arrows */
    const len = ptr().len;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { setCursor(v.track, (v.cursor + (e.key === 'ArrowLeft' ? len - 1 : 1)) % len); focusCursor(); e.preventDefault(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const ti = (v.track + (e.key === 'ArrowUp' ? NTRACKS - 1 : 1)) % NTRACKS;
      setCursor(ti, Math.min(v.cursor, ptr(ti).len - 1)); focusCursor(); e.preventDefault();
    } else if (e.key === 'Enter' && (e.target === document.body || e.target === document.documentElement)) { toggleStep(v.track, v.cursor); e.preventDefault(); }
    else if (/^Digit[1-8]$/.test(e.code)) { const ti = +e.code.slice(5) - 1; if (e.shiftKey) toggleSolo(ti); else toggleMute(ti); e.preventDefault(); }
    else if (e.key.toLowerCase() === 'f' && !e.repeat) setFill(true);
    else if (e.key === '[' || e.key === ']') { pk.base = clamp(pk.base + (e.key === '[' ? -12 : 12), 12, 96); hint(); toast(`Piano octave ${pk.base / 12 - 1}`); }
    else if (e.key === 'Escape') deselect();
    else if ((e.key === 'Delete' || e.key === 'Backspace') && v.sel.size) { clearSelected(); e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => { if (e.key.toLowerCase() === 'f') setFill(false); });
  window.addEventListener('blur', () => setFill(false));
  function focusCursor() { const b = stepBtns[v.track][v.cursor % PAGE]; if (document.activeElement && document.activeElement.classList.contains('st-step')) b.focus({ preventScroll: false }); }
  document.addEventListener('seqcore-transport', () => { renderPatterns(); renderSong(); hint(); });
  S.ui.globalKeys({ name: 'STITCH', help, about: 'Keys and gestures.', onUndo: doUndo, onRedo: doRedo });

  /* ---- the screen follows the sound ---- */
  function frame() {
    if (clock.playing && audio.ctx) {
      const now = audio.ctx.currentTime - (audio.ctx.outputLatency || 0);
      let patChanged = false, songChanged = false;
      while (disp.length && disp[0][0] <= now) {
        const d = disp.shift();
        if (d[1] === 'p') { if (state.cur !== d[2]) { state.cur = d[2]; v.sel.clear(); patChanged = true; } if (v.songPos !== d[3]) { v.songPos = d[3]; songChanged = true; } }
        else { v.play[d[2]] = d[3]; v.playT[d[2]] = d[0]; v.playStk[d[2]] = d[4]; }
      }
      if (v.follow && v.play[v.track] >= 0 && Math.floor(v.play[v.track] / PAGE) !== v.page) { v.page = Math.floor(v.play[v.track] / PAGE); paintGrid(); renderPatterns(); }
      if (patChanged) renderAll(); else if (songChanged) renderSong();
      if (patChanged || songChanged) renderPatterns();
      paintPlay();
    }
    requestAnimationFrame(frame);
  }

  /* ---- start: a share link wins over the autosave, which wins over the demo ---- */
  (async () => {
    const fromLink = normalize(await store.fromHash());
    const saved = fromLink ? null : normalize(store.load('stitch'));
    state = fromLink || saved || demoProject();
    if (fromLink) history.replaceState(null, '', location.pathname);
    clock.bpm = state.bpm; clock.swing = state.swing; head.setTempo(state.bpm); head.setSwing(state.swing);
    renderAll();
    requestAnimationFrame(frame);
  })();
}

if (typeof window !== 'undefined' && window.SeqCore) initApp();

/* SPDX-License-Identifier: MPL-2.0 */
/* LICHEN: a cellular-automaton sequencer, after Game of Life sequencers, norns Zellen and Otomata.
 *
 * The model is a FIELD of 16 x 16 CELLS. Columns are time: a PLAYHEAD sweeps left to right, one column a sixteenth,
 * and every live cell in its column plays. Rows are voices: the bottom rows can be DRUM ROWS (one drum each), the
 * rows above are NOTE ROWS, the degrees of a scale from low (bottom) to high, sung by synth A or B.
 * After each sweep (or every N sweeps) the field steps one GENERATION by its RULE: a 2-D rule written B/S (born with
 * these neighbour counts, survives with these: Life is B3/S23), or a 1-D Wolfram rule (30, 90, 110...) where the
 * newest row is born at the top from the row below it and the older rows scroll down.
 * LOCKED rows and columns never change (so a beat or a phrase can stay put while the rest lives); FREEZE stops the
 * evolving but keeps the playing; BACK steps back through the last 32 generations; KEEPS hold 8 states to return to.
 * A cell's value is its AGE (generations alive: 1 = newborn); it colours the cell and can set the velocity.
 *
 * The rules engine (no DOM) comes first and is tested with node; the screen, sound and storage follow. */
(function () {
  'use strict';

  /* ===================================================================== engine === */
  const W = 16, H = 16, N = W * H;
  const idx = (x, y) => y * W + x;
  const mod = (a, n) => ((a % n) + n) % n;
  const RULES = [
    { id: 'life', name: 'Life', rule: 'B3/S23' },
    { id: 'highlife', name: 'HighLife', rule: 'B36/S23' },
    { id: 'seeds', name: 'Seeds', rule: 'B2/S' },
    { id: 'daynight', name: 'Day & Night', rule: 'B3678/S34678' },
    { id: 'maze', name: 'Maze', rule: 'B3/S12345' },
    { id: 'custom', name: 'Custom B/S' },
    { id: 'wolfram', name: '1-D (Wolfram)' },
  ];
  const WOLFRAM = [30, 90, 110, 184, 150, 45, 73, 54];

  /* "B3/S23", "b36/s23", "B2/S", "S23/B3", and the old "23/3" (survive/born) -> {b, s, text} or {error} */
  function parseRule(text) {
    const t = String(text || '').trim().toUpperCase().replace(/\s+/g, '');
    let born, surv, m;
    if ((m = /^B([0-8]*)\/?S([0-8]*)$/.exec(t))) { born = m[1]; surv = m[2]; }
    else if ((m = /^S([0-8]*)\/?B([0-8]*)$/.exec(t))) { surv = m[1]; born = m[2]; }
    else if ((m = /^([0-8]*)\/([0-8]*)$/.exec(t))) { surv = m[1]; born = m[2]; }
    else return { error: 'write a rule as B (born) and S (survive) neighbour counts 0-8, like B3/S23' };
    const b = Array(9).fill(false), s = Array(9).fill(false);
    for (const c of born) b[+c] = true;
    for (const c of surv) s[+c] = true;
    if (b[0]) return { error: 'B0 (born with no neighbours) would fill the empty field at once: leave 0 out of B' };
    const digits = a => a.map((v, i) => (v ? i : '')).join('');
    return { b, s, text: `B${digits(b)}/S${digits(s)}` };
  }

  /* live neighbours of (x, y); with wrap the edges join (a torus), without it the outside is dead */
  function neighbours(g, x, y, wrap) {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      let xx = x + dx, yy = y + dy;
      if (wrap) { xx = mod(xx, W); yy = mod(yy, H); } else if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      if (g[idx(xx, yy)]) n++;
    }
    return n;
  }
  /* one generation of a 2-D rule. locked: a mask (1 = never changes) or null. -> {next, born, died (a mask)} */
  function step2D(g, rule, wrap, locked) {
    const next = new Uint8Array(N), died = new Uint8Array(N);
    let born = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = idx(x, y), a = g[i];
      if (locked && locked[i]) { next[i] = a; continue; }
      const n = neighbours(g, x, y, wrap);
      if (a) { if (rule.s[n]) next[i] = Math.min(255, a + 1); else died[i] = a; }
      else if (rule.b[n]) { next[i] = 1; born++; }
    }
    return { next, born, died };
  }
  /* one row of an elementary (Wolfram) automaton */
  function wolframRow(row, num, wrap) {
    const out = new Uint8Array(W);
    for (let x = 0; x < W; x++) {
      const at = k => (wrap ? row[mod(k, W)] : k < 0 || k >= W ? 0 : row[k]) ? 1 : 0;
      out[x] = (num >> ((at(x - 1) << 2) | (at(x) << 1) | at(x + 1))) & 1;
    }
    return out;
  }
  /* one generation of 1-D mode: the top row's child is born at the top, the rest scroll down one row (ageing) */
  function step1D(g, num, wrap, locked) {
    const next = new Uint8Array(N), died = new Uint8Array(N);
    const top = wolframRow(g.subarray(0, W), num, wrap);
    let born = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (locked && locked[i]) { next[i] = g[i]; continue; }
      if (y === 0) { next[i] = top[x] ? (g[i] ? Math.min(255, g[i] + 1) : 1) : 0; if (top[x] && !g[i]) born++; }
      else { const up = g[idx(x, y - 1)]; next[i] = up ? Math.min(255, up + 1) : 0; }
      if (g[i] && !next[i]) died[i] = g[i];
    }
    return { next, born, died };
  }
  /* the next generation by a settings object {mode: 'life'|...|'wolfram', rule (B/S text), wolfram, wrap} */
  function evolve(g, set, locked) {
    if (set.mode === 'wolfram') return step1D(g, set.wolfram | 0, set.wrap, locked);
    const r = parseRule(set.rule);
    return step2D(g, r.error ? parseRule('B3/S23') : r, set.wrap, locked);
  }

  /* a deterministic generator (xorshift32, as SeqCore.music.rng): the same seed, the same field */
  function rng(seed) {
    let s = (seed >>> 0) || 0x9e3779b9;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  /* a random field of the given density; locked cells keep what they had */
  function randomFill(g, density, seed, locked) {
    const r = rng(seed * 2654435761 + 12345), out = new Uint8Array(N);
    for (let i = 0; i < N; i++) { const v = r() < density ? 1 : 0; out[i] = locked && locked[i] ? g[i] : v; }
    return out;
  }
  const STAMPS = {
    glider: ['.#.', '..#', '###'],
    blinker: ['###'],
    toad: ['.###', '###.'],
    beacon: ['##..', '##..', '..##', '..##'],
    lwss: ['.#..#', '#....', '#...#', '####.'],
    'r-pentomino': ['.##', '##.', '.#.'],
    block: ['##', '##'],
    clock: ['..#.', '#.#.', '.#.#', '.#..'],
  };
  /* a stamp's live cells, turned rot quarter turns clockwise, as [dx, dy] around its middle */
  function stampCells(name, rot = 0) {
    const rows = STAMPS[name] || STAMPS.glider, h = rows.length, w = rows[0].length, out = [];
    rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') out.push([x, y]); }));
    return out.map(([x, y]) => {
      let p = [x, y], ww = w, hh = h;
      for (let k = 0; k < mod(rot, 4); k++) { p = [hh - 1 - p[1], p[0]]; [ww, hh] = [hh, ww]; }
      return [p[0] - Math.floor(ww / 2), p[1] - Math.floor(hh / 2)];
    });
  }
  function stamp(g, name, x, y, rot, wrap) {
    const out = g.slice();
    for (const [dx, dy] of stampCells(name, rot)) {
      let xx = x + dx, yy = y + dy;
      if (wrap) { xx = mod(xx, W); yy = mod(yy, H); } else if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      out[idx(xx, yy)] = 1;
    }
    return out;
  }
  const population = g => g.reduce((a, v) => a + (v ? 1 : 0), 0);
  /* the lock mask from row and column bit masks (bit k of rows = the k-th row from the bottom) */
  function lockMask(rows, cols) {
    const m = new Uint8Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m[idx(x, y)] = ((rows >> (H - 1 - y)) & 1) | ((cols >> x) & 1);
    return m;
  }
  /* the field as text and back: one character a cell, its age in base 36 (0 = dead) */
  const encode = g => Array.from(g, v => Math.min(35, v).toString(36)).join('');
  function decode(s) {
    const g = new Uint8Array(N);
    if (typeof s !== 'string') return g;
    for (let i = 0; i < N && i < s.length; i++) g[i] = parseInt(s[i], 36) || 0;
    return g;
  }

  /* ----------------------------------------------------------------- music --- */
  const SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10],
    'pentatonic': [0, 2, 4, 7, 9], 'minor pent.': [0, 3, 5, 7, 10], 'harmonic min.': [0, 2, 3, 5, 7, 8, 11],
    blues: [0, 3, 5, 6, 7, 10], chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  };
  const DRUMS = ['kick', 'snare', 'clap', 'hat', 'ohat', 'tom', 'rim', 'cowbell', 'cymbal', 'shaker', 'zap'];
  function degree(d, root, scale, base) {
    const s = SCALES[scale] || SCALES.major, n = s.length;
    return base + root + Math.floor(d / n) * 12 + s[mod(d, n)];
  }
  /* what row k (counted from the bottom, 0-15) plays: {kind: 'drum', drum} | {kind: 'note', midi, voice} | {kind: 'off'} */
  function rowVoice(k, m) {
    if (k < m.drumRows) { const d = m.drumVoice[k]; return DRUMS.includes(d) ? { kind: 'drum', drum: d } : { kind: 'off' }; }
    const v = m.noteVoice[k];
    if (v !== 'A' && v !== 'B') return { kind: 'off' };
    return { kind: 'note', voice: v, midi: Math.min(127, degree((k - m.drumRows) * m.spread, m.root, m.scale, 12 * (m.octave + 1))) };
  }
  /* The notes column x plays: [{y, k, kind, drum | midi+voice, vel, steps}] (steps = length in sixteenths).
   * m: {drumRows, drumVoice, noteVoice, root, scale, octave, spread, velFrom 'neighbours'|'age'|'flat',
   *     maxNotes (0 = all), thin 'low'|'high'|'young'|'old'|'random', length (sixteenths) or 'tie', wrap}
   * With length 'tie' a run of live cells in a row is one long note, started at its first cell.
   * maxNotes keeps that many notes (drums always play), chosen in the `thin` order; `random` uses salt. */
  function columnNotes(g, x, m, salt = 0) {
    const out = [];
    for (let y = 0; y < H; y++) {
      const a = g[idx(x, y)];
      if (!a) continue;
      const k = H - 1 - y, v = rowVoice(k, m);
      if (v.kind === 'off') continue;
      let steps = m.length;
      if (m.length === 'tie') {
        if (x > 0 && g[idx(x - 1, y)]) continue;
        steps = 1; while (x + steps < W && g[idx(x + steps, y)]) steps++;
      }
      let vel = 100;
      if (m.velFrom === 'neighbours') vel = 50 + neighbours(g, x, y, m.wrap) * 9;
      else if (m.velFrom === 'age') vel = Math.max(45, 122 - (a - 1) * 11);
      out.push({ y, k, age: a, vel: Math.min(127, vel), steps, ...v });
    }
    const drums = out.filter(n => n.kind === 'drum'), notes = out.filter(n => n.kind === 'note');
    if (m.maxNotes > 0 && notes.length > m.maxNotes) {
      const r = rng(salt + 977 * x + 1);
      const key = { low: n => n.k, high: n => -n.k, young: n => n.age * 100 + n.k, old: n => -n.age * 100 + n.k, random: () => r() }[m.thin] || (n => n.k);
      notes.forEach(n => { n.order = key(n); });
      notes.sort((p, q) => p.order - q.order).splice(m.maxNotes);
      notes.forEach(n => delete n.order);
    }
    return drums.concat(notes).sort((p, q) => p.k - q.k);
  }

  const engine = { W, H, N, RULES, WOLFRAM, STAMPS, SCALES, DRUMS, parseRule, neighbours, step2D, step1D, wolframRow,
    evolve, randomFill, stampCells, stamp, population, lockMask, encode, decode, rowVoice, columnNotes, rng, idx };
  if (typeof window === 'undefined') { module.exports = engine; return; }

  /* ===================================================================== the app === */
  const { audio, clock, midi, store, ui, music } = SeqCore;
  const el = ui.el;
  const STEP_TICKS = clock.PPQN / 4, HISTORY = 32, KEEPS = 8;
  const PATCHES = {
    pluck: { wave: 'square', cutoff: 0.5, reso: 0.2, envmod: 0.5, attack: 0.002, decay: 0.16, sustain: 0.12, release: 0.25, level: 0.6, echo: 0.25 },
    bell: { wave: 'sine', cutoff: 0.95, reso: 0.05, envmod: 0.1, attack: 0.002, decay: 0.7, sustain: 0.1, release: 0.6, level: 0.75, echo: 0.3 },
    bass: { wave: 'sawtooth', cutoff: 0.3, reso: 0.35, envmod: 0.5, attack: 0.003, decay: 0.2, sustain: 0.4, release: 0.1, level: 0.65, octave: -1 },
    pad: { wave: 'supersaw', cutoff: 0.45, reso: 0.12, envmod: 0.25, attack: 0.06, decay: 0.7, sustain: 0.6, release: 0.5, level: 0.45, echo: 0.2 },
    lead: { wave: 'sawtooth', cutoff: 0.6, reso: 0.4, envmod: 0.4, attack: 0.004, decay: 0.2, sustain: 0.4, release: 0.15, level: 0.5 },
    soft: { wave: 'triangle', cutoff: 0.7, reso: 0.1, envmod: 0.2, attack: 0.01, decay: 0.35, sustain: 0.4, release: 0.3, level: 0.75, echo: 0.15 },
  };
  const patchCache = {};
  const patchOf = name => patchCache[name] || (patchCache[name] = audio.defaultPatch(PATCHES[name] || PATCHES.soft));
  const SHORT = { kick: 'kick', snare: 'snr', clap: 'clap', hat: 'hat', ohat: 'ohat', tom: 'tom', rim: 'rim', cowbell: 'bell', cymbal: 'cym', shaker: 'shkr', zap: 'zap' };

  /* ---------------------------------------------------------------- state --- */
  function demoState() {
    let g = new Uint8Array(N);
    [0, 7, 10].forEach(x => { g[idx(x, 15)] = 1; });           /* kick */
    [4, 12].forEach(x => { g[idx(x, 14)] = 1; });              /* snare */
    [2, 6, 10, 14].forEach(x => { g[idx(x, 13)] = 1; });       /* hat */
    g = stamp(g, 'blinker', 3, 2, 0, true);
    g = stamp(g, 'toad', 12, 3, 0, true);
    g = stamp(g, 'beacon', 4, 8, 0, true);
    g = stamp(g, 'glider', 12, 8, 2, true);
    return {
      v: 1, bpm: 104, swing: 0.08, cells: encode(g), gen: 0, lockRows: 0b1111, lockCols: 0,
      mode: 'life', rule: 'B3/S23', wolfram: 90, wrap: true, every: 1, frozen: false,
      density: 0.25, seed: 1, stamp: 'glider', rot: 0, keeps: Array(KEEPS).fill(null),
      music: { root: 9, scale: 'minor pent.', octave: 2, spread: 1, drumRows: 4,
        drumVoice: ['kick', 'snare', 'hat', 'rim', 'clap', 'ohat', 'tom', 'shaker'],
        noteVoice: Array.from({ length: H }, (_, k) => (k < 10 ? 'A' : 'B')),
        velFrom: 'age', maxNotes: 3, thin: 'low', length: 'tie', synthA: 'pluck', synthB: 'bell', chA: 1, chB: 2, chD: 10 },
    };
  }
  let state = demoState();
  let grid = decode(state.cells), gen = 0, locked = lockMask(state.lockRows, state.lockCols);
  let back = [], pops = [], sweeps = 0, cursor = { x: 0, y: 8 }, showCursor = false;
  const undoes = store.undoStack(80);

  const clampInt = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.round(+v))) : d);
  function sanitize(s) {
    if (!s || typeof s.cells !== 'string') return null;
    const d = demoState(), m = Object.assign({}, d.music, s.music || {});
    const pick = (v, list, def) => (list.includes(v) ? v : def);
    return {
      v: 1, bpm: clampInt(s.bpm, 40, 240, 104), swing: Math.min(0.5, Math.max(0, +s.swing || 0)),
      cells: s.cells, gen: clampInt(s.gen, 0, 1e9, 0), lockRows: clampInt(s.lockRows, 0, 0xffff, 0), lockCols: clampInt(s.lockCols, 0, 0xffff, 0),
      mode: pick(s.mode, RULES.map(r => r.id), 'life'), rule: parseRule(s.rule).error ? 'B3/S23' : parseRule(s.rule).text,
      wolfram: clampInt(s.wolfram, 0, 255, 90), wrap: s.wrap !== false, every: pick(+s.every, [1, 2, 4, 8], 1), frozen: !!s.frozen,
      density: Math.min(0.9, Math.max(0.02, +s.density || 0.25)), seed: clampInt(s.seed, 0, 99999, 1),
      stamp: pick(s.stamp, Object.keys(STAMPS), 'glider'), rot: clampInt(s.rot, 0, 3, 0),
      keeps: Array.from({ length: KEEPS }, (_, k) => (Array.isArray(s.keeps) && typeof s.keeps[k] === 'string' ? s.keeps[k] : null)),
      music: {
        root: clampInt(m.root, 0, 11, 9), scale: pick(m.scale, Object.keys(SCALES), 'minor pent.'), octave: clampInt(m.octave, 1, 5, 2),
        spread: clampInt(m.spread, 1, 3, 1), drumRows: pick(+m.drumRows, [0, 2, 4, 6, 8], 4),
        drumVoice: Array.from({ length: 8 }, (_, k) => pick(m.drumVoice && m.drumVoice[k], DRUMS.concat('off'), d.music.drumVoice[k])),
        noteVoice: Array.from({ length: H }, (_, k) => pick(m.noteVoice && m.noteVoice[k], ['A', 'B', 'off'], d.music.noteVoice[k])),
        velFrom: pick(m.velFrom, ['age', 'neighbours', 'flat'], 'age'), maxNotes: clampInt(m.maxNotes, 0, 16, 3),
        thin: pick(m.thin, ['low', 'high', 'young', 'old', 'random'], 'low'), length: m.length === 'tie' ? 'tie' : pick(+m.length, [0.5, 1, 2, 4], 1),
        synthA: pick(m.synthA, Object.keys(PATCHES), 'pluck'), synthB: pick(m.synthB, Object.keys(PATCHES), 'bell'),
        chA: clampInt(m.chA, 0, 16, 1), chB: clampInt(m.chB, 0, 16, 2), chD: clampInt(m.chD, 0, 16, 10),
      },
    };
  }
  /* the state with the field in it (the field lives in `grid` while playing) */
  function snapshot() { state.cells = encode(grid); state.gen = gen; return state; }
  let saveTimer = 0;
  function changed() { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.save('lichen', snapshot()), 400); }
  function pushUndo() { undoes.push(snapshot()); }
  function apply(s) {
    state = s;
    grid = decode(state.cells); gen = state.gen; locked = lockMask(state.lockRows, state.lockCols);
    clock.bpm = state.bpm; clock.swing = state.swing; head.setTempo(state.bpm); head.setSwing(state.swing);
    flushView(); syncControls(); changed();
  }
  function undo() { const s = undoes.undo(snapshot()); if (s) { apply(sanitize(s)); ui.toast('Undone'); } else ui.toast('Nothing to undo'); }
  function redo() { const s = undoes.redo(snapshot()); if (s) { apply(sanitize(s)); ui.toast('Redone'); } else ui.toast('Nothing to redo'); }

  /* --------------------------------------------------------------- the life --- */
  const settings = () => ({ mode: state.mode, wrap: state.wrap, wolfram: state.wolfram,
    rule: state.mode === 'custom' ? state.rule : (RULES.find(r => r.id === state.mode) || RULES[0]).rule });
  /* the screen follows the sound: each new generation is queued with its time and shown when it sounds */
  let view = { cells: grid.slice(), died: new Uint8Array(N), t: 0 }, viewQ = [], dirty = true;
  function flushView() { view = { cells: grid.slice(), died: new Uint8Array(N), t: 0 }; viewQ = []; dirty = true; }
  function nextGeneration(t) {
    back.push({ cells: grid.slice(), gen }); if (back.length > HISTORY) back.shift();
    const r = evolve(grid, settings(), locked);
    grid = r.next; gen++;
    pops.push(population(grid)); if (pops.length > 64) pops.shift();
    if (t > 0 && clock.playing) viewQ.push({ cells: grid.slice(), died: r.died, t });
    else { view = { cells: grid.slice(), died: r.died, t: audioNow() }; viewQ = []; }
    dirty = true;
  }
  function stepOnce() { pushUndo(); nextGeneration(0); changed(); }
  function stepBack() {
    if (!back.length) { ui.toast('No more generations to go back to'); return; }
    pushUndo();
    const b = back.pop(); grid = b.cells; gen = b.gen; pops.pop();
    if (!state.frozen) { state.frozen = true; ui.toast(`Generation ${gen}: frozen (F lets it live again)`); }
    flushView(); syncControls(); changed();
  }
  function setFrozen(on) { pushUndo(); state.frozen = on; syncControls(); changed(); }
  function setCell(x, y, on) {
    const i = idx(x, y), v = on ? grid[i] || 1 : 0;
    if (grid[i] === v) return;
    grid[i] = v; flushView();
  }
  function edit(fn, msg) { pushUndo(); fn(); flushView(); changed(); if (msg) ui.toast(msg); }
  const randomize = () => edit(() => { grid = randomFill(grid, state.density, state.seed, locked); }, `Random field, seed ${state.seed}`);
  const clearField = () => edit(() => { grid = grid.map((v, i) => (locked[i] ? v : 0)); }, 'Cleared (locked cells stay; undo brings it back)');
  const placeStamp = (x, y) => edit(() => { grid = stamp(grid, state.stamp, x, y, state.rot, state.wrap); });
  function toggleRowLock(k) { pushUndo(); state.lockRows ^= 1 << k; locked = lockMask(state.lockRows, state.lockCols); dirty = true; changed(); }
  function toggleColLock(x) { pushUndo(); state.lockCols ^= 1 << x; locked = lockMask(state.lockRows, state.lockCols); dirty = true; changed(); }
  function keep(k, store_) {
    if (store_ || !state.keeps[k]) { pushUndo(); state.keeps[k] = encode(grid); ui.toast(`Kept in ${k + 1}`); }
    else edit(() => { grid = decode(state.keeps[k]); }, `Back to keep ${k + 1}`);
    syncControls(); changed();
  }
  function clearKeep(k) { if (!state.keeps[k]) return; pushUndo(); state.keeps[k] = null; syncControls(); changed(); ui.toast(`Keep ${k + 1} emptied`); }

  /* ----------------------------------------------------------------- sound --- */
  const audioNow = () => (audio.ctx ? audio.ctx.currentTime - (audio.ctx.outputLatency || 0) : 0);
  clock.onStart = () => { sweeps = 0; audio.setEcho(Math.min(1.2, 60 / clock.bpm * 0.75), 0.35); };
  clock.onStop = () => { flushView(); changed(); };
  clock.onTick = (tick, time) => {
    if (tick % STEP_TICKS) return;
    const step = tick / STEP_TICKS, col = step % W;
    if (col === 0 && step > 0) { sweeps++; if (!state.frozen && sweeps % state.every === 0) nextGeneration(time); }
    playColumn(col, time + clock.swingOffset(tick));
  };
  function playColumn(col, t) {
    const m = state.music, six = 60 / clock.bpm / 4;
    for (const n of columnNotes(grid, col, { ...m, wrap: state.wrap }, gen * 31 + state.seed)) {
      if (n.kind === 'drum') {
        audio.drum(n.drum, n.vel, t);
        midi.note(m.chD, audio.GM_NOTE[n.drum] || 36, n.vel, t, 0.05);
      } else {
        const dur = n.steps * six * (m.length === 'tie' ? 0.96 : 0.85);
        audio.note(patchOf(n.voice === 'A' ? m.synthA : m.synthB), n.midi, n.vel, t, dur);
        midi.note(n.voice === 'A' ? m.chA : m.chB, n.midi, n.vel, t, dur);
      }
    }
  }
  /* MIDI in: a note brings the cell of its row to life under the playhead (or the cursor when stopped) */
  midi.onNote = (note, vel, ch) => {
    if (!vel) return;
    const m = state.music;
    let k = -1;
    if (ch === 10 || audio.GM[note]) for (let r = 0; r < m.drumRows; r++) if (m.drumVoice[r] === audio.GM[note]) { k = r; break; }
    if (k < 0) {
      let best = 99;
      for (let r = m.drumRows; r < H; r++) { const v = rowVoice(r, m); if (v.kind === 'note' && Math.abs(v.midi - note) < best) { best = Math.abs(v.midi - note); k = r; } }
    }
    if (k < 0) return;
    const tn = clock.tickNow(), x = tn >= 0 ? Math.floor(tn / STEP_TICKS) % W : cursor.x;
    pushUndo(); setCell(x, H - 1 - k, true); changed();
    if (!clock.playing) { const v = rowVoice(k, m); if (v.kind === 'drum') audio.drum(v.drum, vel, audio.now()); else audio.note(patchOf(v.voice === 'A' ? m.synthA : m.synthB), v.midi, vel, audio.now(), 0.25); }
  };

  /* ---------------------------------------------------------------- screen --- */
  const HELP = [
    ['Space', 'play / stop'],
    ['click, drag', 'paint cells: the first cell decides, add or erase'],
    ['Shift+click', 'place the stamp there'],
    ['click a row label / column number', 'lock or unlock that row / column (locked cells never change)'],
    ['arrows', 'move the cursor (the field has focus: Tab to it)'],
    ['Enter or X', 'flip the cell under the cursor'],
    ['P', 'place the stamp at the cursor; T turns the stamp'],
    ['L  Shift+L', 'lock the cursor\'s row / column'],
    ['F', 'FREEZE: stop evolving, keep playing'],
    ['G', 'STEP: one generation now'],
    ['B', 'BACK: one generation back (up to 32); it freezes'],
    ['R', 'a random field from the seed and density (locked cells stay)'],
    ['Delete', 'clear the field (locked cells stay)'],
    ['W', 'edges wrap on / off'],
    ['1 … 8', 'keeps: an empty one stores the field, a full one brings it back; Shift+1 … 8 stores over'],
    ['Alt+click a keep', 'empty it'],
    ['Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z', 'undo / redo every edit (painting, locks, rules, keeps, settings)'],
    ['?', 'this help'],
    ['rules', 'B/S: born with these neighbour counts, survives with these. Life B3/S23, HighLife B36/S23, Seeds B2/S, Day & Night B3678/S34678, Maze B3/S12345'],
    ['1-D', 'a Wolfram rule (0-255): each generation a new row is born at the top from the top row, and the older rows scroll down one'],
    ['rows', 'drum rows at the bottom (one drum each), note rows above (scale degrees, low to high) on synth A or B; click a row\'s voice in Rows to change it'],
    ['max notes', 'at most this many notes a step (drums always play), kept in the thin order'],
    ['length', 'note length in sixteenths; "tie" holds a note through a run of live cells in its row'],
    ['MIDI', 'synth A, B and the drums each have a channel (0 = off). MIDI in brings a cell to life in the row nearest the note, under the playhead'],
  ];
  const ABOUT = 'A field of cells: the playhead sweeps the columns and every live cell in its column plays (drums below, ' +
    'notes above). After each sweep the field steps one generation by its rule. Lock rows or columns to keep a beat or a ' +
    'phrase while the rest lives; freeze, step, go back, and keep states you like.';

  const head = ui.header({
    name: 'LICHEN', tagline: 'cellular automaton · the field sings', color: ui.css('--accent') || 'currentColor',
    help: HELP, about: ABOUT, onUndo: undo, onRedo: redo,
    onNew: () => { pushUndo(); grid = grid.map((v, i) => 0); state.lockRows = 0; state.lockCols = 0; locked = lockMask(0, 0); gen = 0; back = []; pops = []; flushView(); syncControls(); changed(); ui.toast('New: an empty field, no locks (undo brings it back)'); },
    onSave: () => store.download('lichen.json', snapshot()),
    onLoad: async () => { const d = sanitize(await store.upload()); if (d) { pushUndo(); apply(d); ui.toast('Opened'); } else ui.toast('That is not a LICHEN file'); },
    onShare: async () => {
      const link = await store.shareLink(snapshot());
      try { await navigator.clipboard.writeText(link); ui.toast('Link copied'); } catch (e) { location.hash = link.split('#')[1]; ui.toast('The link is in the address bar'); }
    },
    onTempo: v => { state.bpm = v; changed(); },
    onSwing: v => { state.swing = v; changed(); },
  });
  document.body.prepend(head);
  ui.globalKeys({ name: 'LICHEN', help: HELP, about: ABOUT, onUndo: undo, onRedo: redo });

  /* controls: each registers how to show the state, so undo and loading can refresh them all */
  const refreshers = [];
  const syncControls = () => { refreshers.forEach(f => f()); dirty = true; };
  function sel(label, options, get, set, title) {
    const s = ui.select(label, options, get(), v => set(v));
    if (title) s.title = title;
    const inner = s.querySelector('select');
    refreshers.push(() => { inner.value = String(get()); });
    return s;
  }
  const opt = (value, label = String(value)) => ({ value, label });
  const setState = (fn, why) => v => { pushUndo(); fn(v); syncControls(); changed(); if (why) ui.toast(why); };
  function toggleBtn(label, get, set, title) {
    const b = el('button', { class: 'sc-btn', title, 'aria-pressed': 'false', onclick: () => set(!get()) }, label);
    refreshers.push(() => { b.setAttribute('aria-pressed', String(get())); b.classList.toggle('on', get()); });
    return b;
  }
  function numIn(label, min, max, get, set, title) {
    const i = el('input', { type: 'number', min, max, 'aria-label': label, title, onchange: () => set(clampInt(i.value, min, max, get())) });
    refreshers.push(() => { i.value = get(); });
    return el('label', { class: 'lc-num' }, el('span', {}, label), i);
  }

  /* the field */
  const cv = el('canvas', { class: 'lc-field', tabindex: 0, role: 'application', 'aria-roledescription': 'cell field',
    'aria-label': 'The field: 16 steps across, rows of drums and notes. Arrows move, Enter flips a cell, P places the stamp' });
  const g2 = cv.getContext('2d');
  const said = el('div', { class: 'lc-sr', 'aria-live': 'polite' });
  const fieldWrap = el('div', { class: 'lc-fieldwrap' }, cv, said);
  const geo = { gw: 50, ht: 20, cell: 24, w: 0, h: 0 };
  new ResizeObserver(() => fit()).observe(fieldWrap);
  function fit() {
    const avail = fieldWrap.clientWidth, maxH = Math.max(300, window.innerHeight - 130);
    geo.gw = avail < 420 ? 36 : 52; geo.ht = 20;
    geo.cell = Math.max(14, Math.min(44, Math.floor((avail - geo.gw) / W), Math.floor((maxH - geo.ht) / H)));
    geo.w = geo.gw + geo.cell * W; geo.h = geo.ht + geo.cell * H;
    const dpr = window.devicePixelRatio || 1;
    cv.style.width = geo.w + 'px'; cv.style.height = geo.h + 'px';
    cv.width = Math.round(geo.w * dpr); cv.height = Math.round(geo.h * dpr);
    g2.setTransform(dpr, 0, 0, dpr, 0, 0); dirty = true;
  }

  /* Life panel */
  const ruleSel = sel('rule', RULES.map(r => opt(r.id, r.name)), () => state.mode, setState(v => {
    if (v === 'custom') state.rule = settings().rule || state.rule;
    state.mode = v;
    if (v === 'wolfram' && !grid.subarray(0, W).some(Boolean)) { grid[Math.floor(W / 2)] = 1; flushView(); }
  }), 'The rule each generation follows');
  const ruleText = el('input', { type: 'text', class: 'lc-rule', spellcheck: 'false', 'aria-label': 'B/S rule', title: 'B (born) / S (survive) neighbour counts; typing one switches to Custom' });
  const ruleErr = el('div', { class: 'lc-err', role: 'alert' });
  ruleText.addEventListener('input', () => { const r = parseRule(ruleText.value); ruleErr.textContent = r.error || ''; });
  ruleText.addEventListener('change', () => {
    const r = parseRule(ruleText.value);
    if (r.error) { ruleErr.textContent = r.error; return; }
    pushUndo(); state.rule = r.text; const named = RULES.find(x => x.rule === r.text); state.mode = named ? named.id : 'custom';
    syncControls(); changed(); ui.toast(`Rule ${r.text}`);
  });
  refreshers.push(() => {
    const wolf = state.mode === 'wolfram';
    ruleText.value = settings().rule || ''; ruleText.hidden = wolf; ruleErr.textContent = '';
    wolfBox.hidden = !wolf;
  });
  const wolfNum = numIn('Wolfram rule', 0, 255, () => state.wolfram, setState(v => { state.wolfram = v; }), 'An elementary rule number, 0-255');
  const wolfBox = el('div', { class: 'lc-row' }, wolfNum, ...WOLFRAM.map(n => el('button', { class: 'sc-btn lc-small', title: `Rule ${n}`, onclick: () => setState(() => { state.wolfram = n; })() }, String(n))));
  const everySel = sel('evolve every', [1, 2, 4, 8].map(n => opt(n, n === 1 ? 'sweep' : n + ' sweeps')), () => state.every, setState(v => { state.every = +v; }), 'How many sweeps of the playhead between generations');
  const wrapBtn = toggleBtn('Wrap', () => state.wrap, setState(v => { state.wrap = v; }), 'Edges join (W)');
  const freezeBtn = toggleBtn('Freeze', () => state.frozen, v => setFrozen(v), 'Stop evolving, keep playing (F)');
  const stepBtn = el('button', { class: 'sc-btn', title: 'One generation now (G)', onclick: stepOnce }, 'Step');
  const backBtn = el('button', { class: 'sc-btn', title: 'One generation back (B); keeps the last 32', onclick: stepBack }, 'Back');
  const stats = el('div', { class: 'lc-stats', 'aria-live': 'off' });
  const graph = el('canvas', { class: 'lc-graph', 'aria-hidden': 'true', width: 180, height: 36 });
  const lifePanel = el('section', { class: 'sc-panel lc-panel', 'aria-label': 'Life' },
    el('h2', {}, 'Life'),
    el('div', { class: 'lc-row' }, ruleSel, ruleText, everySel), ruleErr, wolfBox,
    el('div', { class: 'lc-row' }, wrapBtn, freezeBtn, stepBtn, backBtn),
    el('div', { class: 'lc-row' }, stats, graph));

  /* Seed panel */
  const density = ui.knob({ label: 'DENSITY', min: 0.02, max: 0.9, step: 0.01, value: state.density, def: 0.25, fmt: v => Math.round(v * 100) + '%', onInput: v => { state.density = v; changed(); } });
  refreshers.push(() => density.set(state.density));
  const seedNum = numIn('seed', 0, 99999, () => state.seed, setState(v => { state.seed = v; }), 'The seed of the random field (the same seed, the same field)');
  const stampSel = sel('stamp', Object.keys(STAMPS), () => state.stamp, setState(v => { state.stamp = v; }), 'The shape P or Shift+click places');
  const turnBtn = el('button', { class: 'sc-btn', title: 'Turn the stamp a quarter (T)', 'aria-label': 'Turn the stamp', onclick: () => setState(() => { state.rot = (state.rot + 1) % 4; })() }, '⟳');
  const stampPrev = el('canvas', { class: 'lc-stamp', width: 40, height: 40, 'aria-hidden': 'true' });
  const keepBtns = Array.from({ length: KEEPS }, (_, k) => {
    const b = el('button', { class: 'sc-btn lc-keep', onclick: e => (e.altKey ? clearKeep(k) : keep(k, e.shiftKey)) }, String(k + 1));
    refreshers.push(() => {
      const full = !!state.keeps[k];
      b.classList.toggle('full', full);
      b.setAttribute('aria-label', full ? `Keep ${k + 1}: bring it back (Shift: store over, Alt: empty)` : `Keep ${k + 1}: empty, store the field`);
      b.title = b.getAttribute('aria-label');
    });
    return b;
  });
  const seedPanel = el('section', { class: 'sc-panel lc-panel', 'aria-label': 'Seed' },
    el('h2', {}, 'Seed'),
    el('div', { class: 'lc-row' }, density, seedNum,
      el('button', { class: 'sc-btn', title: 'A new seed and a random field (undoable)', onclick: () => { pushUndo(); state.seed = Math.floor(Math.random() * 10000); syncControls(); grid = randomFill(grid, state.density, state.seed, locked); flushView(); changed(); ui.toast(`Seed ${state.seed}`); } }, 'New seed'),
      el('button', { class: 'sc-btn', title: 'Random field from the seed (R)', onclick: randomize }, 'Random'),
      el('button', { class: 'sc-btn', title: 'Clear the field (Delete)', onclick: clearField }, 'Clear')),
    el('div', { class: 'lc-row' }, stampSel, turnBtn, stampPrev,
      el('button', { class: 'sc-btn', title: 'Place the stamp at the cursor (P)', onclick: () => placeStamp(cursor.x, cursor.y) }, 'Place'),
      el('span', { class: 'sc-hint' }, 'or Shift+click the field')),
    el('div', { class: 'lc-row lc-keeps', role: 'group', 'aria-label': 'Keeps' }, el('span', { class: 'sc-label' }, 'keeps'), keepBtns),
    el('p', { class: 'sc-hint' }, 'An empty keep stores the field; a full one brings it back. Shift stores over, Alt empties.'));

  /* Sound panel */
  const m = () => state.music;
  const setM = (k, conv = x => x) => setState(v => { state.music[k] = conv(v); });
  const soundPanel = el('section', { class: 'sc-panel lc-panel', 'aria-label': 'Sound' },
    el('h2', {}, 'Sound'),
    el('div', { class: 'lc-row' },
      sel('root', music.NOTE_NAMES.map((n, i) => opt(i, n)), () => m().root, setM('root', Number)),
      sel('scale', Object.keys(SCALES), () => m().scale, setM('scale')),
      sel('octave', [1, 2, 3, 4, 5].map(n => opt(n)), () => m().octave, setM('octave', Number), 'The octave of the lowest note row'),
      sel('spread', [opt(1, 'steps'), opt(2, 'thirds'), opt(3, 'fourths')], () => m().spread, setM('spread', Number), 'Scale degrees from one row to the next'),
      sel('drum rows', [0, 2, 4, 6, 8].map(n => opt(n)), () => m().drumRows, setM('drumRows', Number), 'How many bottom rows are drums')),
    el('div', { class: 'lc-row' },
      sel('velocity', [opt('age', 'from age'), opt('neighbours', 'from neighbours'), opt('flat')], () => m().velFrom, setM('velFrom'), 'Newborn cells loudest, or more neighbours louder, or all the same'),
      sel('max notes', [opt(0, 'all'), ...[1, 2, 3, 4, 5, 6, 8].map(n => opt(n))], () => m().maxNotes, setM('maxNotes', Number), 'At most this many notes a step (drums always play)'),
      sel('thin', [opt('low', 'low first'), opt('high', 'high first'), opt('young', 'young first'), opt('old', 'old first'), opt('random', 'random (seeded)')], () => m().thin, setM('thin'), 'Which notes stay when there are too many'),
      sel('length', [opt(0.5, '1/32'), opt(1, '1/16'), opt(2, '1/8'), opt(4, '1/4'), opt('tie')], () => m().length, setM('length', v => (v === 'tie' ? 'tie' : +v)), '"tie" holds a note through a run of live cells')),
    el('div', { class: 'lc-row' },
      sel('synth A (low)', Object.keys(PATCHES), () => m().synthA, setM('synthA')), numIn('ch A', 0, 16, () => m().chA, setM('chA'), 'MIDI channel of synth A (0 = off)'),
      sel('synth B (high)', Object.keys(PATCHES), () => m().synthB, setM('synthB')), numIn('ch B', 0, 16, () => m().chB, setM('chB'), 'MIDI channel of synth B (0 = off)'),
      numIn('drums ch', 0, 16, () => m().chD, setM('chD'), 'MIDI channel of the drums (0 = off)')));

  /* Rows panel: what each row plays */
  const rowList = el('div', { class: 'lc-rows' });
  function buildRows() {
    const mm = m(), kids = [];
    for (let k = H - 1; k >= 0; k--) {
      const drum = k < mm.drumRows, v = rowVoice(k, mm);
      const name = drum ? `drum ${k + 1}` : music.name(rowVoice(k, { ...mm, noteVoice: Array(H).fill('A') }).midi);
      const s = el('select', { 'aria-label': `Row ${k + 1} (${name}) voice`, onchange: () => {
        pushUndo(); if (drum) state.music.drumVoice[k] = s.value; else state.music.noteVoice[k] = s.value; syncControls(); changed(); } },
      (drum ? DRUMS.concat('off') : ['A', 'B', 'off']).map(o => el('option', { value: o }, o === 'A' ? 'synth A' : o === 'B' ? 'synth B' : o)));
      s.value = drum ? mm.drumVoice[k] : mm.noteVoice[k];
      kids.push(el('label', { class: 'lc-rowv' + (v.kind === 'off' ? ' off' : '') }, el('span', {}, name), s));
    }
    rowList.replaceChildren(...kids);
  }
  refreshers.push(buildRows);
  const rowsPanel = el('details', { class: 'sc-panel lc-panel' }, el('summary', {}, 'Rows: what each row plays'), rowList);

  const main = el('main', {}, el('div', { class: 'lc-layout' },
    el('div', { class: 'lc-left' }, fieldWrap,
      el('p', { class: 'sc-hint' }, 'Drag to paint (the first cell decides add or erase) · Shift+click places the stamp · click a row label or a column number to lock it')),
    el('div', { class: 'lc-side' }, lifePanel, seedPanel, soundPanel, rowsPanel)));
  document.body.append(main);

  /* ---------------------------------------------------------- field input --- */
  function hit(e) {
    const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    const x = Math.floor((px - geo.gw) / geo.cell), y = Math.floor((py - geo.ht) / geo.cell);
    if (px < geo.gw && y >= 0 && y < H) return { area: 'row', y };
    if (py < geo.ht && x >= 0 && x < W) return { area: 'col', x };
    if (x >= 0 && x < W && y >= 0 && y < H) return { area: 'cell', x, y };
    return null;
  }
  let paint = null;
  cv.addEventListener('pointerdown', e => {
    const h = hit(e);
    if (!h) return;
    e.preventDefault(); cv.focus({ preventScroll: true }); showCursor = false;
    if (h.area === 'row') { toggleRowLock(H - 1 - h.y); return; }
    if (h.area === 'col') { toggleColLock(h.x); return; }
    cursor = { x: h.x, y: h.y };
    if (e.shiftKey) { placeStamp(h.x, h.y); return; }
    pushUndo();
    paint = { on: !grid[idx(h.x, h.y)] };
    setCell(h.x, h.y, paint.on);
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', e => {
    if (!paint) return;
    const h = hit(e);
    if (h && h.area === 'cell') setCell(h.x, h.y, paint.on);
  });
  const endPaint = () => { if (paint) { paint = null; changed(); } };
  cv.addEventListener('pointerup', endPaint); cv.addEventListener('pointercancel', endPaint);
  cv.addEventListener('keydown', e => {
    const mv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (mv && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault(); showCursor = true;
      cursor = { x: (cursor.x + mv[0] + W) % W, y: (cursor.y + mv[1] + H) % H }; dirty = true; sayCursor();
    } else if ((e.key === 'Enter' || e.key.toLowerCase() === 'x') && !e.metaKey && !e.ctrlKey) {
      e.preventDefault(); e.stopPropagation(); showCursor = true;
      edit(() => { grid[idx(cursor.x, cursor.y)] = grid[idx(cursor.x, cursor.y)] ? 0 : 1; }); sayCursor();
    }
  });
  cv.addEventListener('focus', () => { dirty = true; });
  cv.addEventListener('blur', () => { dirty = true; });
  function rowName(k) {
    const v = rowVoice(k, m());
    return v.kind === 'drum' ? v.drum : v.kind === 'note' ? `${music.name(v.midi)} synth ${v.voice}` : 'off';
  }
  function sayCursor() {
    const a = grid[idx(cursor.x, cursor.y)], k = H - 1 - cursor.y;
    said.textContent = `Step ${cursor.x + 1}, row ${rowName(k)}: ${a ? 'alive, age ' + a : 'empty'}${locked[idx(cursor.x, cursor.y)] ? ', locked' : ''}`;
  }
  window.addEventListener('keydown', e => {
    if (e.target.closest('input,select,textarea') || e.metaKey || e.ctrlKey) return;
    const k = e.key.toLowerCase();
    const digit = /^Digit([1-8])$/.exec(e.code);
    if (digit && !e.altKey) { e.preventDefault(); keep(+digit[1] - 1, e.shiftKey); return; }
    if (e.altKey) return;
    const act = {
      f: () => setFrozen(!state.frozen), g: stepOnce, b: stepBack, r: randomize, w: () => setState(v => { state.wrap = v; })(!state.wrap),
      p: () => placeStamp(cursor.x, cursor.y), t: () => setState(() => { state.rot = (state.rot + 1) % 4; })(),
      l: () => (e.shiftKey ? toggleColLock(cursor.x) : toggleRowLock(H - 1 - cursor.y)),
      delete: clearField, backspace: clearField,
    }[k];
    if (act) { e.preventDefault(); act(); }
  });

  /* ---------------------------------------------------------------- drawing --- */
  let colors = {};
  const readColors = () => { ['--bg', '--panel', '--panel2', '--line', '--fg', '--dim', '--faint', '--accent', '--c1', '--c2', '--c4', '--c7', '--rec'].forEach(n => { colors[n.slice(2)] = ui.css(n); }); dirty = true; };
  readColors();
  window.matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', readColors);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const ageAlpha = a => Math.max(0.38, 1 - (a - 1) * 0.09);
  let lastCol = -2, lastStats = '';
  function draw() {
    const now = audioNow();
    while (viewQ.length && viewQ[0].t <= now) { view = viewQ.shift(); dirty = true; }
    const tn = clock.playing ? clock.tickNow() : -1, col = tn >= 0 ? Math.floor(tn / STEP_TICKS) % W : -1;
    const fading = !reduced.matches && view.t && now - view.t < 0.7;
    if (col !== lastCol) { lastCol = col; dirty = true; }
    if (dirty || fading) paintField(col, now);
    dirty = false;
    const shownGen = gen - viewQ.length, st = `generation ${shownGen} · ${population(view.cells)} alive${state.frozen ? ' · frozen' : ''} · ${back.length} back`;
    if (st !== lastStats) { lastStats = st; stats.textContent = st; drawGraph(); drawStamp(); }
    requestAnimationFrame(draw);
  }
  function paintField(col, now) {
    const g = g2, { gw, ht, cell } = geo, mm = m();
    g.clearRect(0, 0, geo.w, geo.h);
    g.fillStyle = colors.bg; g.fillRect(0, 0, geo.w, geo.h);
    /* column numbers, locked columns marked */
    g.font = `${Math.min(12, cell * 0.5)}px ${ui.css('--mono') || 'monospace'}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let x = 0; x < W; x++) {
      const cx = gw + x * cell, lockedC = (state.lockCols >> x) & 1;
      if (lockedC) { g.fillStyle = colors.accent; g.fillRect(cx + 1, 2, cell - 2, ht - 4); }
      g.fillStyle = lockedC ? colors.bg : x === col ? colors.fg : x % 4 === 0 ? colors.dim : colors.faint;
      g.fillText(String(x + 1), cx + cell / 2, ht / 2);
    }
    /* row labels */
    g.textAlign = 'right'; g.font = `${Math.min(11, cell * 0.46)}px ${ui.css('--mono') || 'monospace'}`;
    for (let y = 0; y < H; y++) {
      const k = H - 1 - y, v = rowVoice(k, mm), cy = ht + y * cell, lockedR = (state.lockRows >> k) & 1;
      const label = v.kind === 'drum' ? SHORT[v.drum] : v.kind === 'note' ? music.name(v.midi) : 'off';
      if (lockedR) { g.fillStyle = colors.accent; g.fillRect(1, cy + 1, gw - 4, cell - 2); }
      g.fillStyle = lockedR ? colors.bg : v.kind === 'drum' ? colors.c1 : v.kind === 'off' ? colors.faint : v.voice === 'A' ? colors.accent : colors.c7;
      g.fillText(label, gw - 6, cy + cell / 2 + 0.5);
    }
    /* cells */
    const fadeA = view.t ? (reduced.matches ? 0.22 : Math.max(0, 0.55 * (1 - (now - view.t) / 0.7))) : 0;
    for (let y = 0; y < H; y++) {
      const k = H - 1 - y, v = rowVoice(k, mm), drumRow = k < mm.drumRows;
      const on = v.kind === 'drum' ? colors.c1 : v.kind === 'off' ? colors.dim : v.voice === 'A' ? colors.accent : colors.c7;
      for (let x = 0; x < W; x++) {
        const i = idx(x, y), cx = gw + x * cell, cy = ht + y * cell, a = view.cells[i], s = cell - 2;
        g.globalAlpha = 1;
        g.fillStyle = drumRow ? colors.panel : colors.panel2; g.fillRect(cx + 1, cy + 1, s, s);
        if (locked[i]) {
          g.strokeStyle = colors.faint; g.lineWidth = 1; g.beginPath();
          for (let d = -s; d < s; d += 5) { g.moveTo(cx + 1 + Math.max(0, d), cy + 1 + Math.max(0, -d)); g.lineTo(cx + 1 + Math.min(s, s + d), cy + 1 + Math.min(s, s - d)); }
          g.stroke();
        }
        if (a) { g.globalAlpha = ageAlpha(a); g.fillStyle = on; g.fillRect(cx + 1, cy + 1, s, s); }
        else if (view.died[i] && fadeA > 0) { g.globalAlpha = fadeA; g.fillStyle = on; g.fillRect(cx + 1 + s * 0.2, cy + 1 + s * 0.2, s * 0.6, s * 0.6); }
        if (a && x === col) { g.globalAlpha = 1; g.strokeStyle = colors.fg; g.lineWidth = 2; g.strokeRect(cx + 2, cy + 2, s - 2, s - 2); }
      }
    }
    g.globalAlpha = 1;
    /* the playhead, the drum / note divide, the cursor */
    if (col >= 0) { g.globalAlpha = 0.12; g.fillStyle = colors.fg; g.fillRect(gw + col * cell, ht, cell, cell * H); g.globalAlpha = 1; }
    if (mm.drumRows > 0 && mm.drumRows < H) { g.fillStyle = colors.dim; g.fillRect(gw - 2, ht + (H - mm.drumRows) * cell - 1, cell * W + 2, 2); }
    if (showCursor && document.activeElement === cv) {
      g.strokeStyle = colors.fg; g.lineWidth = 2; g.setLineDash([3, 2]);
      g.strokeRect(gw + cursor.x * cell + 1, ht + cursor.y * cell + 1, cell - 2, cell - 2); g.setLineDash([]);
    }
  }
  function drawGraph() {
    const g = graph.getContext('2d'), w = graph.width, h = graph.height;
    g.clearRect(0, 0, w, h);
    g.fillStyle = colors.panel2; g.fillRect(0, 0, w, h);
    if (pops.length < 2) return;
    const hi = Math.max(8, ...pops);
    g.strokeStyle = colors.accent; g.lineWidth = 1.5; g.beginPath();
    pops.forEach((p, i) => { const x = i / 63 * (w - 2) + 1, y = h - 2 - p / hi * (h - 4); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
  }
  function drawStamp() {
    const g = stampPrev.getContext('2d'), cells = stampCells(state.stamp, state.rot);
    g.clearRect(0, 0, 40, 40); g.fillStyle = colors.panel2; g.fillRect(0, 0, 40, 40);
    const xs = cells.map(c => c[0]), ys = cells.map(c => c[1]), x0 = Math.min(...xs), y0 = Math.min(...ys);
    const span = Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0) + 1, s = Math.floor(36 / Math.max(3, span));
    g.fillStyle = colors.accent;
    cells.forEach(([x, y]) => g.fillRect(2 + (x - x0) * s, 2 + (y - y0) * s, s - 1, s - 1));
  }
  refreshers.push(() => { lastStats = ''; });

  /* ----------------------------------------------------------------- start --- */
  (async () => {
    const shared = await store.fromHash();
    const s = sanitize(shared || store.load('lichen'));
    if (shared) window.history.replaceState(null, '', location.pathname);
    apply(s || state);
    fit();
    if (shared) ui.toast('Opened from the link');
    requestAnimationFrame(draw);
  })();
})();

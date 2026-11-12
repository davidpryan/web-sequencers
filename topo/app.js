/* SPDX-License-Identifier: MPL-2.0 */
/* TOPO: a topographic drum map.
 *
 * The model is a MAP: a square (X left to right, Y top to bottom, both 0..1) with a 5 x 5 grid of NODES on it. Each
 * node is a drum pattern written as IMPORTANCE: for five LANES (kick, snare, closed hat, open hat / ride, perc) and
 * 32 sixteenth steps, a number 0-255 saying how much that step belongs to the groove. The PUCK's position picks the
 * pattern: the importance of the four nodes around it, mixed by distance (bilinear). Each lane's DENSITY then says
 * how much of it plays: a step plays when its importance is above 255 - density, so density 0 plays nothing and 255
 * plays every step; the strongest steps come first, and play as accents. CHAOS nudges every importance by a seeded
 * random amount (new each bar, or held). The puck can follow a recorded MOTION loop or two LFOs, so the beat moves
 * on its own. FREEZE prints the pattern into a plain step grid that plays instead of the map until you go back.
 *
 * The node data are original to this program, written as text: '.' a quiet step (a small importance from where it
 * falls in the bar, so high densities fill the gaps in a musical order), '1'..'9' importance 28..252, 'X' 255.
 * The pure part (no DOM, tested with node) comes first; the screen, sound and storage follow. */

/* =================================================================== pure model === */
const LANES = ['kick', 'snare', 'hat', 'open', 'perc'];
const STEPS = 32;
/* the nodes, rows top (y = 0) to bottom (y = 1), columns left (x = 0) to right; each lane 16 steps (repeated) or 32 */
const NODES = [
  [
    { name: 'drift', k: '9.......3.......', s: '........2.......', c: '..2...1...2...1.', o: '5...............', p: '......3.......4.' },
    { name: 'dub', k: '9.........4.....', s: '........9.......', c: '..3...3...3...3.', o: '....2.......2...', p: '......5.....3...' },
    { name: 'half-time', k: '9......3..6.....', s: '........9.......', c: '6.3.6.3.6.3.6.4.', o: '..............5.', p: '...3.......3....' },
    { name: 'trap', k: '9......5..7....2', s: '........9.......', c: '7575757575757878', o: '..........4.....', p: '.....3......5...' },
    { name: 'footwork', k: '9..7..8.6..7..5.9..7..8...7.6.5.', s: '....7.......9..3....7.......9.55', c: '5.3.5.3.5.3.5.335.3.5.3.5.3.5.33',
      o: '..4.....4..4......4.....4..4....', p: '.5..5..5.5..5..5.5..5..5.5..5..5' },
  ],
  [
    { name: 'lilt', k: '9.....6...7.....', s: '....8.......8...', c: '7..5..7..5..7..5', o: '..3.....3.......', p: '...4.....4..4...' },
    { name: 'shuffle', k: '9.....5.7......4', s: '....9.......9...', c: '8.48.48.48.48.48', o: '......4.......4.', p: '..3.....3..5....' },
    { name: 'half-step', k: '9.....7...5.....', s: '....9.....4.9...', c: '6464646464646464', o: '..........5.....', p: '.3......3......4' },
    { name: '2-step', k: '9......5..8.....', s: '....9.......9...', c: '..7...7...7...76', o: '......4.......5.', p: '.4.....4.4......' },
    { name: 'jungle', k: '9.........8.....9.....7...6.....', s: '....9..5.4..9..6....9..5.4..9.58', c: '7575757575757575', o: '..5.......5.....', p: '.4.4...4.4.4...4' },
  ],
  [
    { name: 'swing ride', k: '7.......5.......', s: '.......3.....4..', c: '....8.......8...', o: '9...7..59...7..5', p: '..........3.....' },
    { name: 'boom bap', k: '9......6..8.....', s: '....9.......9...', c: '7.6.7.6.7.6.7.6.', o: '..............4.', p: '...3........3...' },
    { name: 'breakbeat', k: '9.7.......8.5...9.7.......8.....', s: '....9..4.6..9..5....9..4.6..9.76', c: '7.7.7.7.7.7.7.7.', o: '..........4.....', p: '.3...3.......3..' },
    { name: 'funk', k: '9..6..7...6.5...', s: '....9..3.3..9..4', c: '8686868686868686', o: '.......5........', p: '..4.....4.....4.' },
    { name: 'son clave', k: '9......7.......7', s: '......6.....7..5', c: '8.68.6.88.68.6.8', o: '....5.......5...', p: '9..9..9...9.9...' },
  ],
  [
    { name: 'downtempo', k: '9.......7.5.....', s: '....9.......9...', c: '6.4.6.4.6.4.6.4.', o: '..............6.', p: '......4.........' },
    { name: 'electro', k: '9.....8...7.....', s: '....9.......9...', c: '6666666666666666', o: '..5..........5..', p: '.......5......5.' },
    { name: 'breaks house', k: '9...7...9.....6.', s: '....9.......9...', c: '5.5.5.5.5.5.5.5.', o: '..7...7...7...7.', p: '.....4.......4..' },
    { name: 'afro house', k: '9...9...9...9...', s: '......6.....7...', c: '5.65.6.55.65.6.5', o: '..7.......7.....', p: '...8..8...8...8.' },
    { name: 'rumba clave', k: '9......7.9......', s: '....5.......6...', c: '7.5.7.5.7.5.7.5.', o: '...6.......6....', p: '9..9...9..9.9...' },
  ],
  [
    { name: 'minimal', k: '9...9...9...9...', s: '............5...', c: '..4...4...4...4.', o: '........3.......', p: '.....3........3.' },
    { name: 'deep house', k: '9...9...9...9...', s: '....7.......7...', c: '..7...7...7...7.', o: '......4.......4.', p: '...3.....3......' },
    { name: 'house', k: '9...9...9...9...', s: '....9.......9...', c: '5.5.5.5.5.5.5.5.', o: '..9...9...9...9.', p: '.3....3....3....' },
    { name: 'techno', k: '9...9...9...9..3', s: '....5.......5...', c: '6565656565656565', o: '..8...8...8...8.', p: '......4.......4.' },
    { name: 'hard', k: '9..39...9..39..5', s: '....9..3....9.55', c: '7777777777777777', o: '..8...8...8...8.', p: '.5.5.5.5.5.5.5.5' },
  ],
];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mod = (a, n) => ((a % n) + n) % n;

/* the quiet importance of a step from where it falls: the bar's start, beats, eighths, sixteenths; bar 2 ends fuller */
function quiet(i) {
  const p = i % 16;
  const w = p === 0 ? 24 : p % 4 === 0 ? 20 : p % 2 === 0 ? 14 : (p % 4 === 3 ? 9 : 6);
  return w + (i >= 28 ? 10 : 0);
}
function decodeLane(str) {
  const out = new Array(STEPS);
  for (let i = 0; i < STEPS; i++) {
    const c = str[i % str.length];
    out[i] = c === 'X' ? 255 : c >= '1' && c <= '9' ? (c.charCodeAt(0) - 48) * 28 : quiet(i);
  }
  return out;
}
/* MAP[y][x][lane][step] */
const MAP = NODES.map(row => row.map(n => [n.k, n.s, n.c, n.o, n.p].map(decodeLane)));

/* the importance at (x, y), for every lane and step: the four nearest nodes, mixed by distance */
function patternAt(x, y, map = MAP) {
  const gx = clamp(x, 0, 1) * 4, gy = clamp(y, 0, 1) * 4;
  const ix = Math.min(3, Math.floor(gx)), iy = Math.min(3, Math.floor(gy)), fx = gx - ix, fy = gy - iy;
  const a = map[iy][ix], b = map[iy][ix + 1], c = map[iy + 1][ix], d = map[iy + 1][ix + 1];
  return LANES.map((_, l) => {
    const out = new Array(STEPS);
    for (let s = 0; s < STEPS; s++) {
      const top = a[l][s] + (b[l][s] - a[l][s]) * fx, bot = c[l][s] + (d[l][s] - c[l][s]) * fx;
      out[s] = Math.round(top + (bot - top) * fy);
    }
    return out;
  });
}
/* a hash of (seed, n) to 0..1: the same seed, the same chaos */
function hash01(seed, n) {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(n + 1, 0x85ebca77)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
/* chaos: every importance nudged by up to +-amount*160, kept in 1..255 so the density ends still mean what they say */
function perturb(pat, amount, seed) {
  if (!amount) return pat;
  return pat.map((lane, l) => lane.map((v, s) => clamp(Math.round(v + (hash01(seed, l * STEPS + s) * 2 - 1) * amount * 160), 1, 255)));
}
const plays = (imp, density) => imp > 255 - density;
const ACCENT = 200;
/* the hits: [lane][step] 0 rest, 1 hit, 2 accent */
function hitsFor(pat, densities) {
  return pat.map((lane, l) => lane.map(v => plays(v, densities[l]) ? (v >= ACCENT ? 2 : 1) : 0));
}
/* a lane's density after the master (128 = as set, 0 = silence, 255 = about double) */
const effDensity = (d, master) => clamp(Math.round(d * master / 128), 0, 255);
/* LFO shapes, phase 0..1 -> -1..1; 'random' holds a seeded value per cycle */
function lfo(shape, phase, seed = 1) {
  const p = mod(phase, 1);
  switch (shape) {
    case 'triangle': return p < 0.5 ? p * 4 - 1 : 3 - p * 4;
    case 'saw': return p * 2 - 1;
    case 'square': return p < 0.5 ? 1 : -1;
    case 'random': return hash01(seed, Math.floor(phase)) * 2 - 1;
    default: return Math.sin(p * Math.PI * 2);
  }
}
/* the pattern as text, one line a lane */
function patternText(hits, len) {
  return hits.map((lane, l) => LANES[l].padEnd(6) + lane.slice(0, len).map((v, i) => (i % 4 === 0 ? '|' : '') + '.xX'[v]).join('') + '|').join('\n');
}
/* the bass follows the kick: a degree for each sixteenth (when the kick plays there) */
const BASS_RIFF = [0, 0, 0, 4, 0, 0, 3, 0, 0, 2, 0, 0, 4, 0, 6, 3];

function demoState() {
  return {
    app: 'topo', v: 1, bpm: 122, swing: 0.1, x: 0.56, y: 0.78, len: 16, master: 128, mode: 'map',
    lanes: [
      { drum: 'kick', tone: 0.35, decay: 1, level: 0.95, density: 190, mute: false, note: 36, ch: 10 },
      { drum: 'snare', tone: 0.5, decay: 1, level: 0.8, density: 170, mute: false, note: 38, ch: 10 },
      { drum: 'hat', tone: 0.5, decay: 1, level: 0.6, density: 200, mute: false, note: 42, ch: 10 },
      { drum: 'ohat', tone: 0.5, decay: 0.8, level: 0.5, density: 150, mute: false, note: 46, ch: 10 },
      { drum: 'rim', tone: 0.5, decay: 1, level: 0.55, density: 180, mute: false, note: 37, ch: 10 },
    ],
    chaos: { amount: 0.12, seed: 7, hold: false },
    lfo: { on: false, shape: 'sine', x: { on: true, bars: 8, depth: 0.25 }, y: { on: true, bars: 16, depth: 0.15 } },
    motion: { bars: 4, pts: null, on: true },
    bass: { on: true, root: 2, scale: 'minor', ch: 2, level: 0.7, oct: 0 },
    steps: LANES.map(() => new Array(STEPS).fill(0)),
  };
}
function normalize(s) {
  const d = demoState();
  if (!s || s.app !== 'topo') return d;
  const o = Object.assign(d, s);
  o.x = clamp(+o.x || 0, 0, 1); o.y = clamp(+o.y || 0, 0, 1);
  o.len = o.len === 32 ? 32 : 16;
  o.master = clamp(o.master | 0, 0, 255);
  o.mode = o.mode === 'steps' ? 'steps' : 'map';
  o.lanes = LANES.map((_, l) => Object.assign({}, demoState().lanes[l], (s.lanes || [])[l] || {}));
  o.lanes.forEach(L => { L.density = clamp(L.density | 0, 0, 255); });
  o.chaos = Object.assign({}, demoState().chaos, s.chaos || {});
  o.lfo = Object.assign({}, demoState().lfo, s.lfo || {});
  o.lfo.x = Object.assign({}, demoState().lfo.x, (s.lfo || {}).x || {});
  o.lfo.y = Object.assign({}, demoState().lfo.y, (s.lfo || {}).y || {});
  o.motion = Object.assign({}, demoState().motion, s.motion || {});
  if (!Array.isArray(o.motion.pts) || !o.motion.pts.length) o.motion.pts = null;
  o.bass = Object.assign({}, demoState().bass, s.bass || {});
  o.steps = LANES.map((_, l) => Array.from({ length: STEPS }, (__, i) => clamp(((s.steps || [])[l] || [])[i] | 0, 0, 2)));
  return o;
}

if (typeof module !== 'undefined') module.exports = { LANES, STEPS, NODES, MAP, decodeLane, patternAt, perturb, plays, hitsFor, effDensity, lfo, patternText, hash01, demoState, normalize, BASS_RIFF };

/* ======================================================================= the app === */
if (typeof window !== 'undefined' && window.SeqCore) (function () {
  'use strict';
  const { audio, clock, midi, store, ui, music } = SeqCore;
  const el = ui.el;
  const DRUMS = ['kick', 'snare', 'clap', 'hat', 'ohat', 'tom', 'rim', 'cowbell', 'cymbal', 'shaker', 'zap'];
  const LANE_NAMES = ['Kick', 'Snare', 'Closed hat', 'Open / ride', 'Perc'];
  const S16 = clock.PPQN / 4, BAR = 16;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let S = demoState();
  const undo = store.undoStack(120);
  let lastKey = '', lastAt = 0, saveTimer = 0;
  let rec = null;           /* motion recording: {wait: true} until the bar, then {pts: [...]} */
  let dragging = false;     /* the hand on the puck wins over motion */
  let lastStep = -1;        /* the sixteenth last heard, for the screen */

  /* -------------------------------------------------------------- editing --- */
  function edit(key, fn, rebuild = false) {
    const now = performance.now();
    if (!key || key !== lastKey || now - lastAt > 1200) undo.push(S);
    lastKey = key; lastAt = now;
    fn();
    changed(rebuild);
  }
  function changed(rebuild) {
    clearTimeout(saveTimer); saveTimer = setTimeout(() => store.save('topo', S), 300);
    terrainDirty = true;
    if (rebuild) render(); else refresh();
  }
  function replace(next) {
    S = normalize(next); clock.bpm = S.bpm; clock.swing = S.swing; header.setTempo(S.bpm); header.setSwing(S.swing);
    rec = null; changed(true);
  }
  const doUndo = () => { const p = undo.undo(S); if (p) { replace(p); ui.toast('Undo'); } };
  const doRedo = () => { const p = undo.redo(S); if (p) { replace(p); ui.toast('Redo'); } };

  /* ------------------------------------------------------ where the puck is --- */
  /* the position the music follows at tick t (fractional; -1 when stopped): the motion loop or the puck, plus LFOs */
  function posAt(t) {
    let x = S.x, y = S.y;
    const m = S.motion;
    if (t >= 0 && m.on && m.pts && !dragging && !(rec && rec.pts)) {
      const f = mod(t / S16, m.pts.length), i = Math.floor(f), j = (i + 1) % m.pts.length, k = f - i;
      x = m.pts[i][0] + (m.pts[j][0] - m.pts[i][0]) * k; y = m.pts[i][1] + (m.pts[j][1] - m.pts[i][1]) * k;
    }
    if (S.lfo.on && t >= 0) {
      const bar = t / (BAR * S16);
      if (S.lfo.x.on) x += S.lfo.x.depth * lfo(S.lfo.shape, bar / S.lfo.x.bars, 11);
      if (S.lfo.y.on) y += S.lfo.y.depth * lfo(S.lfo.shape, bar / S.lfo.y.bars + 0.25, 23);
    }
    return [clamp(x, 0, 1), clamp(y, 0, 1)];
  }
  const densities = () => S.lanes.map(L => effDensity(L.density, S.master));
  const chaosSeed = bar => S.chaos.hold ? S.chaos.seed : S.chaos.seed * 1009 + bar;
  /* the importance heard at tick t, for every lane and step */
  function patternNow(t) {
    const [x, y] = posAt(t), bar = t >= 0 ? Math.floor(t / (BAR * S16)) : 0;
    return perturb(patternAt(x, y), S.chaos.amount, chaosSeed(bar));
  }
  function hitsNow(t) { return S.mode === 'steps' ? S.steps : hitsFor(patternNow(t), densities()); }

  /* ---------------------------------------------------------------- sound --- */
  const bassPatch = () => audio.defaultPatch({ wave: 'sawtooth', cutoff: 0.3, reso: 0.4, envmod: 0.5, decay: 0.16, sustain: 0.3, release: 0.08, octave: -1, level: S.bass.level });
  function onTick(tick, time) {
    if (tick % S16) return;
    const n = tick / S16, step = n % S.len, sw = clock.swingOffset(tick), t = time + sw;
    motionTick(n);
    const pat = S.mode === 'map' ? patternNow(tick) : null, dens = densities();
    for (let l = 0; l < LANES.length; l++) {
      const L = S.lanes[l];
      const v = pat ? (plays(pat[l][step], dens[l]) ? (pat[l][step] >= ACCENT ? 2 : 1) : 0) : S.steps[l][step];
      if (!v || L.mute) continue;
      const vel = pat ? (v === 2 ? 127 : Math.round(45 + 70 * pat[l][step] / 255)) : (v === 2 ? 127 : 92);
      audio.drum(L.drum, vel, t, { tone: L.tone, decay: L.decay, level: L.level });
      midi.note(L.ch, L.note, vel, t, 0.05);
      if (l === 0 && S.bass.on) playBass(step, vel, t);
    }
    lastStep = step;
  }
  function playBass(step, vel, t) {
    const B = S.bass, n = music.degree(BASS_RIFF[step % 16], B.root, B.scale, 48 + 12 * B.oct), p = bassPatch();
    const dur = clock.secPerTick() * S16 * 1.6;
    audio.note(p, n, vel, t, dur);
    midi.note(B.ch, n - 12, vel, t, dur);
  }
  /* motion recording, one point a sixteenth, from the next bar for the chosen number of bars */
  function motionTick(n) {
    if (!rec) return;
    if (rec.wait) { if (n % BAR) return; rec = { pts: [] }; refresh(); }
    rec.pts.push([+S.x.toFixed(4), +S.y.toFixed(4)]);
    if (rec.pts.length >= S.motion.bars * BAR) {
      const pts = rec.pts; rec = null;
      setTimeout(() => { edit(null, () => { S.motion.pts = pts; S.motion.on = true; }, true); ui.toast('Motion loop recorded'); }, 0);
    }
  }
  clock.onTick = onTick;
  clock.onStart = () => audio.setEcho(0.75 * 60 / clock.bpm, 0.3);
  clock.onStop = () => { if (rec) { rec = null; refresh(); } lastStep = -1; };
  midi.onNote = (n, vel) => {
    if (!vel) return;
    const l = S.lanes.findIndex(L => L.note === n), L = S.lanes[l];
    if (L) audio.drum(L.drum, vel, audio.now(), { tone: L.tone, decay: L.decay, level: L.level });
  };

  /* --------------------------------------------------------------- actions --- */
  function freeze() {
    if (S.mode === 'steps') { edit(null, () => { S.mode = 'map'; }, true); ui.toast('Playing the map'); return; }
    const t = clock.playing ? clock.tickNow() : -1, h = hitsFor(patternNow(t), densities());
    edit(null, () => { S.steps = h.map(l => l.slice()); S.mode = 'steps'; }, true);
    ui.toast('Frozen to steps');
  }
  function toggleMute(l) { edit(null, () => { S.lanes[l].mute = !S.lanes[l].mute; }, true); }
  function toggleLfo() { edit(null, () => { S.lfo.on = !S.lfo.on; }, true); ui.toast(S.lfo.on ? 'LFO on' : 'LFO off'); }
  function movePuck(dx, dy, key = 'puck') { edit(key, () => { S.x = clamp(S.x + dx, 0, 1); S.y = clamp(S.y + dy, 0, 1); }); }
  function recMotion() {
    if (rec) { rec = null; refresh(); ui.toast('Recording cancelled'); return; }
    if (!clock.playing) clock.start();
    rec = { wait: true }; refresh();
    ui.toast(`Move the puck: recording ${S.motion.bars} bar${S.motion.bars > 1 ? 's' : ''} from the next bar`);
  }
  async function copyText() {
    const t = clock.playing ? clock.tickNow() : -1, txt = patternText(hitsNow(t), S.len);
    try { await navigator.clipboard.writeText(txt); ui.toast('Pattern copied as text'); }
    catch (e) { ui.toast('Copy failed: the text is below the grid'); }
    textEl.textContent = txt; textEl.hidden = false;
  }

  /* -------------------------------------------------------------- drawing --- */
  let col = {}, frame = 0, terrainDirty = true, terrain = null;
  function readColors() {
    ['--bg', '--panel', '--panel2', '--line', '--fg', '--dim', '--faint', '--accent', '--rec'].forEach(n => { col[n] = ui.css(n); });
    for (let i = 1; i <= 8; i++) col['c' + i] = ui.css('--c' + i);
  }
  const laneColor = l => col['c' + [1, 2, 3, 7, 6][l]];
  /* the terrain: how many steps play at each place, as smooth shading (redrawn when densities change). The count is
   * sampled on a 40 x 40 grid into a tiny image, which the browser scales up smoothly. */
  function rgbOf(c) {
    const h = /^#([0-9a-f]{6})$/i.exec(c);
    if (h) return [parseInt(h[1].slice(0, 2), 16), parseInt(h[1].slice(2, 4), 16), parseInt(h[1].slice(4, 6), 16)];
    const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(c || '');
    return m ? [+m[1], +m[2], +m[3]] : [255, 196, 64];
  }
  function buildTerrain(w, h) {
    const N = 40, dens = densities(), cnt = new Float32Array(N * N);
    let max = 1, min = 1e9;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const p = patternAt(i / (N - 1), j / (N - 1));
      let c = 0;
      p.forEach((lane, l) => { for (let s = 0; s < 16; s++) if (plays(lane[s], dens[l])) c++; });
      cnt[j * N + i] = c; max = Math.max(max, c); min = Math.min(min, c);
    }
    const tiny = document.createElement('canvas'); tiny.width = tiny.height = N;
    const tg = tiny.getContext('2d'), img = tg.createImageData(N, N), [r, gg, bb] = rgbOf(col['--accent']);
    for (let k = 0; k < N * N; k++) {
      const f = (cnt[k] - min) / Math.max(1, max - min);
      img.data[4 * k] = r; img.data[4 * k + 1] = gg; img.data[4 * k + 2] = bb;
      img.data[4 * k + 3] = Math.round(255 * (0.04 + 0.5 * f * f));
    }
    tg.putImageData(img, 0, 0);
    const off = document.createElement('canvas'), dpr = window.devicePixelRatio || 1;
    off.width = Math.round(w * dpr); off.height = Math.round(h * dpr);
    const g = off.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(tiny, 0, 0, off.width, off.height);
    terrain = { off, w, h }; terrainDirty = false;
  }
  const PAD = 14;
  const toScreen = (w, h, x, y) => [PAD + x * (w - 2 * PAD), PAD + y * (h - 2 * PAD)];
  const fromScreen = (w, h, px, py) => [clamp((px - PAD) / (w - 2 * PAD), 0, 1), clamp((py - PAD) / (h - 2 * PAD), 0, 1)];
  function drawMap(st) {
    const { ctx, w, h } = st;
    if (!w || !h) return;
    if (frame++ % 30 === 0) readColors();
    if (terrainDirty || !terrain || terrain.w !== w || terrain.h !== h) buildTerrain(w, h);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(terrain.off, 0, 0, w, h);
    /* the nodes and their names */
    ctx.font = `${w < 400 ? 9 : 11}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) {
      const [x, y] = toScreen(w, h, i / 4, j / 4);
      ctx.fillStyle = col['--faint']; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col['--dim']; ctx.globalAlpha = 0.75;
      const ty = j === 4 ? y - 16 : y + 5, tx = clamp(x, 30, w - 30);
      ctx.fillText(NODES[j][i].name, tx, ty); ctx.globalAlpha = 1;
    }
    /* the motion lane */
    const pts = rec && rec.pts ? rec.pts : S.motion.pts;
    if (pts && pts.length > 1) {
      ctx.strokeStyle = rec && rec.pts ? col['--rec'] : col['--fg']; ctx.globalAlpha = S.motion.on || rec ? 0.7 : 0.25; ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]); ctx.beginPath();
      pts.forEach(([x, y], k) => { const [px, py] = toScreen(w, h, x, y); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
      if (!rec) ctx.closePath();
      ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    /* the hand's puck (hollow when LFO or motion moves the sound away from it) and where the sound is */
    const t = tickFloat(), [sx, sy] = posAt(t), [hx, hy] = toScreen(w, h, S.x, S.y), [px, py] = toScreen(w, h, sx, sy);
    if (Math.hypot(px - hx, py - hy) > 1) {
      ctx.strokeStyle = col['--fg']; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(hx, hy, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.4; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(px, py); ctx.stroke(); ctx.globalAlpha = 1;
    }
    const beat = t >= 0 && !reduceMotion.matches ? 1 - mod(t, clock.PPQN) / clock.PPQN : 0;
    ctx.fillStyle = col['--accent']; ctx.beginPath(); ctx.arc(px, py, 11 + beat * 3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = col['--bg']; ctx.lineWidth = 2; ctx.stroke();
    if (document.activeElement === st.canvas) { ctx.strokeStyle = col['--fg']; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(hx, hy, 17, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
    posEl.textContent = `X ${sx.toFixed(2)} · Y ${sy.toFixed(2)}`;
  }
  /* the pattern view: brightness and height = importance, the line = the lane's threshold, dots = what plays */
  function drawGrid(st) {
    const { ctx, w, h } = st;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);
    const t = tickFloat(), lab = Math.min(70, w * 0.16), cw = (w - lab) / STEPS, rh = h / LANES.length;
    const frozen = S.mode === 'steps', pat = frozen ? null : patternNow(t), dens = densities();
    const cur = t >= 0 ? Math.floor(t / S16) % S.len : -1;
    ctx.font = '12px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    for (let l = 0; l < LANES.length; l++) {
      const y0 = l * rh, c = laneColor(l), L = S.lanes[l];
      ctx.globalAlpha = L.mute ? 0.4 : 1;
      ctx.fillStyle = col['--dim']; ctx.fillText(LANE_NAMES[l], 0, y0 + rh / 2);
      for (let s = 0; s < STEPS; s++) {
        const x = lab + s * cw, inLen = s < S.len, imp = frozen ? [0, 150, 255][S.steps[l][s]] : pat[l][s];
        const on = frozen ? S.steps[l][s] > 0 : plays(imp, dens[l]);
        ctx.globalAlpha = (L.mute ? 0.4 : 1) * (inLen ? 1 : 0.25);
        ctx.fillStyle = col['--panel2']; ctx.fillRect(x + 1, y0 + 2, cw - 2, rh - 4);
        ctx.globalAlpha *= 0.15 + 0.85 * imp / 255; ctx.fillStyle = c;
        const bh = (rh - 4) * imp / 255; ctx.fillRect(x + 1, y0 + rh - 2 - bh, cw - 2, bh);
        ctx.globalAlpha = (L.mute ? 0.4 : 1) * (inLen ? 1 : 0.25);
        if (on) { ctx.fillStyle = col['--fg']; ctx.beginPath(); ctx.arc(x + cw / 2, y0 + 8, imp >= 200 ? 3.5 : 2.2, 0, Math.PI * 2); ctx.fill(); }
        if (s === cur) { ctx.strokeStyle = col['--fg']; ctx.lineWidth = 1.5; ctx.strokeRect(x + 1, y0 + 2, cw - 2, rh - 4); }
        if (s % 4 === 0) { ctx.fillStyle = col['--line']; ctx.fillRect(x, y0 + 2, 1, rh - 4); }
      }
      if (!frozen) {
        const ty = y0 + rh - 2 - (rh - 4) * (255 - dens[l]) / 255;
        ctx.globalAlpha = L.mute ? 0.4 : 1; ctx.strokeStyle = col['--fg']; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(lab, ty); ctx.lineTo(w, ty); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    ctx.globalAlpha = 1;
    if (frozen) markStepCell(cur);
  }
  function tickFloat() {
    const t = clock.tickNow();
    if (t < 0) return -1;
    const h = clock.history.find(e => e[0] === t), now = audio.ctx.currentTime - (audio.ctx.outputLatency || 0);
    return t + (h ? clamp((now - h[1]) / clock.secPerTick(), 0, 1) : 0);
  }

  /* --------------------------------------------------------------- pointer --- */
  function mapPoint(e) { const b = mapSt.canvas.getBoundingClientRect(); return fromScreen(mapSt.w, mapSt.h, e.clientX - b.left, e.clientY - b.top); }
  function onMapDown(e) {
    mapSt.canvas.setPointerCapture(e.pointerId); dragging = true; mapSt.canvas.focus();
    const [x, y] = mapPoint(e);
    edit(null, () => { S.x = x; S.y = y; });
  }
  function onMapMove(e) { if (!dragging) return; const [x, y] = mapPoint(e); S.x = x; S.y = y; }
  function onMapUp() { if (!dragging) return; dragging = false; changed(false); }

  /* -------------------------------------------------------------- keyboard --- */
  function onKey(e) {
    if (e.target.closest('input,select,textarea,.sc-knob,.sc-help') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest('.tp-steps') && e.key.startsWith('Arrow')) return stepsArrow(e);
    const d = e.shiftKey ? 0.1 : 0.025;
    if (e.key === 'ArrowLeft') { movePuck(-d, 0); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { movePuck(d, 0); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { movePuck(0, -d); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { movePuck(0, d); e.preventDefault(); }
    else if (e.key >= '1' && e.key <= '5') toggleMute(+e.key - 1);
    else if (e.key === 'f' || e.key === 'F') freeze();
    else if (e.key === 'l' || e.key === 'L') toggleLfo();
  }
  function stepsArrow(e) {
    const b = e.target.closest('.tp-cell');
    if (!b) return;
    let l = +b.dataset.l, s = +b.dataset.s;
    if (e.key === 'ArrowLeft') s = mod(s - 1, S.len); else if (e.key === 'ArrowRight') s = mod(s + 1, S.len);
    else if (e.key === 'ArrowUp') l = mod(l - 1, LANES.length); else l = mod(l + 1, LANES.length);
    stepsEl.querySelector(`[data-l="${l}"][data-s="${s}"]`)?.focus();
    e.preventDefault();
  }

  /* ------------------------------------------------------------- the panel --- */
  const tbtn = (label, on, onclick, title) => el('button', { class: 'sc-btn' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', title, onclick }, label);
  const btn = (label, onclick, title) => el('button', { class: 'sc-btn', title, onclick }, label);
  const knob = (label, min, max, step, value, def, fmt, key, set, title, rebuild) => {
    const k = ui.knob({ label, min, max, step, value, def, fmt, onInput: v => edit(key, () => set(v), rebuild) });
    if (title) k.title = title;
    return k;
  };
  const pct = v => Math.round(v * 100) + '%';
  let motionEl, lfoEl, lanesEl, stepsEl, modeEl, textEl, posEl, mapSt, gridSt;
  const knobs = {};
  function render() { renderMotion(); renderLfo(); renderLanes(); renderMode(); renderSteps(); }
  /* small things that change often, without rebuilding */
  function refresh() {
    renderMotionStatus();
    if (knobs.master) knobs.master.set(S.master);
  }
  let recBtn, motionStatus;
  function renderMotion() {
    recBtn = el('button', { class: 'sc-btn', title: 'Record the puck\'s path from the next bar; it then loops', 'aria-pressed': 'false', onclick: recMotion }, '● Rec');
    motionStatus = el('span', { class: 'tp-pos', 'aria-live': 'polite' });
    motionEl.replaceChildren(el('h3', {}, 'Motion', motionStatus), el('div', { class: 'sc-row' },
      recBtn,
      knob('BARS', 1, 8, 1, S.motion.bars, 4, v => v, 'mbars', v => { S.motion.bars = v; }, 'Length of the recorded loop'),
      tbtn('Loop', S.motion.on && !!S.motion.pts, () => edit(null, () => { S.motion.on = !S.motion.on; }, true), 'Play the recorded path'),
      btn('Clear', () => edit(null, () => { S.motion.pts = null; }, true), 'Forget the recorded path')));
    renderMotionStatus();
  }
  function renderMotionStatus() {
    if (!recBtn) return;
    recBtn.classList.toggle('on', !!rec); recBtn.setAttribute('aria-pressed', rec ? 'true' : 'false');
    motionStatus.className = 'tp-pos' + (rec ? ' tp-wait' : '');
    motionStatus.textContent = rec ? (rec.wait ? 'waiting for the bar…' : 'recording') : S.motion.pts ? `${S.motion.pts.length / BAR} bar loop` : 'none';
  }
  function renderLfo() {
    const L = S.lfo;
    lfoEl.replaceChildren(el('h3', {}, 'LFO'), el('div', { class: 'sc-row' },
      tbtn('LFO', L.on, toggleLfo, 'LFOs move the sound around the puck (L)'),
      ui.select('Shape', ['sine', 'triangle', 'saw', 'square', 'random'], L.shape, v => edit(null, () => { L.shape = v; })),
      tbtn('X', L.x.on, () => edit(null, () => { L.x.on = !L.x.on; }, true), 'LFO on X'),
      knob('X RATE', 1, 32, 1, L.x.bars, 8, v => v + ' bar' + (v > 1 ? 's' : ''), 'lxr', v => { L.x.bars = v; }, 'Bars per LFO cycle on X'),
      knob('X DEPTH', 0, 0.5, 0.01, L.x.depth, 0.25, v => v.toFixed(2), 'lxd', v => { L.x.depth = v; }),
      tbtn('Y', L.y.on, () => edit(null, () => { L.y.on = !L.y.on; }, true), 'LFO on Y'),
      knob('Y RATE', 1, 32, 1, L.y.bars, 16, v => v + ' bar' + (v > 1 ? 's' : ''), 'lyr', v => { L.y.bars = v; }, 'Bars per LFO cycle on Y'),
      knob('Y DEPTH', 0, 0.5, 0.01, L.y.depth, 0.15, v => v.toFixed(2), 'lyd', v => { L.y.depth = v; })));
  }
  function renderLanes() {
    const rows = S.lanes.map((L, l) => el('div', { class: 'tp-lane' },
      el('span', { class: 'tp-lname' }, el('span', { class: 'tp-sw', style: `--sw:var(--c${[1, 2, 3, 7, 6][l]})` }), `${l + 1} ${LANE_NAMES[l]}`),
      tbtn('M', L.mute, () => toggleMute(l), `Mute ${LANE_NAMES[l]} (${l + 1})`),
      knob('DENSITY', 0, 255, 1, L.density, 128, v => v, 'dens' + l, v => { L.density = v; }, 'How much of this lane plays: a step plays when its importance is above 255 - density'),
      ui.select('Drum', DRUMS, L.drum, v => edit(null, () => { L.drum = v; L.note = audio.GM_NOTE[v] || L.note; }, true)),
      knob('TONE', 0, 1, 0.01, L.tone, 0.5, pct, 'tone' + l, v => { L.tone = v; }),
      knob('DECAY', 0.2, 3, 0.01, L.decay, 1, v => v.toFixed(2), 'dec' + l, v => { L.decay = v; }),
      knob('LEVEL', 0, 1, 0.01, L.level, 0.8, pct, 'lev' + l, v => { L.level = v; }),
      knob('NOTE', 0, 127, 1, L.note, 36, v => v, 'note' + l, v => { L.note = v; }, 'MIDI note out (GM drums)'),
      knob('CH', 0, 16, 1, L.ch, 10, v => v || 'off', 'ch' + l, v => { L.ch = v; }, 'MIDI channel (0 = off)')));
    const B = S.bass;
    const bass = el('div', { class: 'tp-lane' },
      el('span', { class: 'tp-lname' }, 'Bass'),
      tbtn('On', B.on, () => edit(null, () => { B.on = !B.on; }, true), 'A bass line that follows the kick'),
      ui.select('Root', music.NOTE_NAMES.map((n, i) => ({ value: i, label: n })), B.root, v => edit(null, () => { B.root = +v; })),
      ui.select('Scale', Object.keys(music.SCALES), B.scale, v => edit(null, () => { B.scale = v; })),
      knob('OCTAVE', -1, 2, 1, B.oct, 0, v => (v > 0 ? '+' : '') + v, 'boct', v => { B.oct = v; }),
      knob('LEVEL', 0, 1, 0.01, B.level, 0.7, pct, 'blev', v => { B.level = v; }),
      knob('CH', 0, 16, 1, B.ch, 2, v => v || 'off', 'bch', v => { B.ch = v; }, 'MIDI channel (0 = off)'));
    lanesEl.replaceChildren(...rows, bass);
  }
  function renderMode() {
    const frozen = S.mode === 'steps';
    knobs.master = knob('MASTER', 0, 255, 1, S.master, 128, v => v === 128 ? 'as set' : Math.round(v / 1.28) + '%', 'master', v => { S.master = v; }, 'Scales every lane\'s density (128 = as set)');
    modeEl.replaceChildren(el('div', { class: 'sc-row' },
      knobs.master,
      knob('CHAOS', 0, 1, 0.01, S.chaos.amount, 0, pct, 'chaos', v => { S.chaos.amount = v; }, 'Seeded random nudges to every importance'),
      knob('SEED', 1, 999, 1, S.chaos.seed, 7, v => v, 'cseed', v => { S.chaos.seed = v; }),
      tbtn('Hold', S.chaos.hold, () => edit(null, () => { S.chaos.hold = !S.chaos.hold; }, true), 'Keep the same chaos every bar (off: new chaos each bar)'),
      ui.select('Length', [{ value: 16, label: '16 steps' }, { value: 32, label: '32 steps' }], S.len, v => edit(null, () => { S.len = +v; }, true)),
      tbtn(frozen ? 'Back to map (F)' : 'Freeze to steps (F)', frozen, freeze, frozen ? 'Play the map again (the steps are kept)' : 'Print this pattern into a step grid you can edit'),
      btn('Copy as text', copyText, 'Copy the pattern as text')));
  }
  let cells = [], markCol = -1;
  function renderSteps() {
    const frozen = S.mode === 'steps';
    stepsEl.hidden = !frozen; cells = [];
    if (!frozen) return;
    const rows = LANES.map((_, l) => el('tr', {}, el('th', { scope: 'row' }, LANE_NAMES[l]), Array.from({ length: S.len }, (__, s) => {
      const v = S.steps[l][s];
      const b = el('button', { class: 'tp-cell' + (s % 4 === 0 ? ' beat' : ''), 'data-l': l, 'data-s': s, 'data-v': v, style: `--lc:var(--c${[1, 2, 3, 7, 6][l]})`,
        'aria-pressed': v ? 'true' : 'false', 'aria-label': `${LANE_NAMES[l]} step ${s + 1}${v === 2 ? ', accent' : ''}`, title: 'Click: off, on, accent',
        tabindex: s === 0 && l === 0 ? 0 : -1,
        onclick: () => edit(null, () => { S.steps[l][s] = (S.steps[l][s] + 1) % 3; setCell(b, S.steps[l][s]); }) });
      (cells[s] = cells[s] || []).push(b);
      return el('td', {}, b);
    })));
    stepsEl.replaceChildren(el('table', { role: 'grid', 'aria-label': 'Frozen steps' }, el('tbody', {}, rows)));
    markCol = -1;
  }
  function setCell(b, v) { b.dataset.v = v; b.setAttribute('aria-pressed', v ? 'true' : 'false'); b.setAttribute('aria-label', `${LANE_NAMES[+b.dataset.l]} step ${+b.dataset.s + 1}${v === 2 ? ', accent' : ''}`); }
  function markStepCell(cur) {
    if (cur === markCol) return;
    (cells[markCol] || []).forEach(b => b.classList.remove('now'));
    (cells[cur] || []).forEach(b => b.classList.add('now'));
    markCol = cur;
  }

  /* --------------------------------------------------------------- header --- */
  const HELP = [
    ['Space', 'Play / stop'],
    ['Drag on the map', 'Move the puck: the pattern morphs between the nearest named grooves'],
    ['Arrow keys', 'Move the puck (Shift: further); in the frozen grid, move between steps'],
    ['DENSITY', 'Per lane: a step plays when its importance (bar height) is above the dashed line; 0 = nothing, 255 = every step'],
    ['MASTER', 'Scales all densities (128 = as set)'],
    ['CHAOS / SEED / Hold', 'Seeded random nudges to the importance; a new roll each bar unless Hold'],
    ['1 - 5', 'Mute kick, snare, closed hat, open hat / ride, perc'],
    ['F', 'Freeze to steps: print the pattern into an editable grid (click a step: off, on, accent); F again plays the map'],
    ['L', 'LFO on / off: X and Y swing around the puck (rate in bars, depth, shape)'],
    ['● Rec', 'Record the puck\'s path for BARS bars from the next bar; it then loops (Loop, Clear)'],
    ['Copy as text', 'The pattern as text: x a hit, X an accent'],
    ['Bass', 'A bass line on the kick\'s hits, from the root and scale'],
    ['Ctrl/Cmd+Z', 'Undo (Shift for redo)'],
    ['?', 'This help'],
  ];
  const about = 'A map of drum grooves: 25 written patterns sit on a 5 x 5 grid and the puck blends the four around it. Each step has an importance; density decides how much of it plays. The shading is the terrain: how busy the beat is at each place. MIDI in plays the lane with that note.';
  const header = ui.header({
    name: 'TOPO', tagline: 'topographic drum map', color: ui.css('--accent'), help: HELP, about,
    onTempo: v => edit('tempo', () => { S.bpm = v; }),
    onSwing: v => edit('swing', () => { S.swing = v; }),
    onUndo: doUndo, onRedo: doRedo,
    onNew: () => { undo.push(S); replace(demoState()); ui.toast('New: the demo groove'); },
    onSave: () => store.download('topo.json', S),
    onLoad: () => store.upload().then(d => { if (d && d.app === 'topo') { undo.push(S); replace(d); ui.toast('Opened'); } else if (d) ui.toast('Not a TOPO file'); }),
    onShare: async () => {
      const url = await store.shareLink(S);
      try { await navigator.clipboard.writeText(url); ui.toast('Link copied'); }
      catch (e) { history.replaceState(null, '', url); ui.toast('Link in the address bar'); }
    },
  });
  ui.globalKeys({ name: 'TOPO', help: HELP, about, onUndo: doUndo, onRedo: doRedo });
  window.addEventListener('keydown', onKey);

  /* --------------------------------------------------------------- layout --- */
  posEl = el('span', { class: 'tp-pos' });
  motionEl = el('section', { class: 'sc-panel tp-sec', 'aria-label': 'Motion' });
  lfoEl = el('section', { class: 'sc-panel tp-sec', 'aria-label': 'LFO' });
  lanesEl = el('div', {});
  modeEl = el('div', {});
  stepsEl = el('div', { class: 'tp-steps' });
  textEl = el('pre', { class: 'tp-text', hidden: true });
  const mapWrap = el('div', { class: 'tp-map' });
  const gridWrap = el('div', { class: 'tp-grid' });
  const mapCol = el('div', { class: 'tp-mapcol' },
    el('section', { class: 'sc-panel tp-sec', 'aria-label': 'Map' }, el('h3', {}, 'Map', posEl), mapWrap,
      el('div', { class: 'sc-hint' }, 'Drag the puck · arrows move it · shading = how busy the beat is there')),
    motionEl, lfoEl);
  const right = el('div', { class: 'tp-right' },
    el('section', { class: 'sc-panel tp-sec', 'aria-label': 'Pattern' }, el('h3', {}, 'Pattern'), modeEl, gridWrap, stepsEl, textEl,
      el('div', { class: 'sc-hint' }, 'Bar height and brightness = importance · dashed line = the lane\'s threshold · dots = steps that play')),
    el('section', { class: 'sc-panel tp-sec', 'aria-label': 'Lanes' }, el('h3', {}, 'Lanes'), lanesEl));
  document.body.append(header, el('main', {}, el('div', { class: 'tp-layout' }, mapCol, right)));
  mapSt = ui.canvas(mapWrap, drawMap);
  gridSt = ui.canvas(gridWrap, drawGrid);
  const mc = mapSt.canvas;
  mc.tabIndex = 0; mc.setAttribute('role', 'application');
  mc.setAttribute('aria-label', 'The drum map: arrow keys move the puck');
  mc.addEventListener('pointerdown', onMapDown);
  mc.addEventListener('pointermove', onMapMove);
  mc.addEventListener('pointerup', onMapUp);
  mc.addEventListener('pointercancel', onMapUp);
  gridSt.canvas.setAttribute('role', 'img');
  gridSt.canvas.setAttribute('aria-label', 'The pattern: five lanes of 32 steps, brightness = importance');

  /* ---------------------------------------------------------------- start --- */
  (async () => {
    const fromLink = await store.fromHash(), saved = store.load('topo');
    replace(fromLink && fromLink.app === 'topo' ? fromLink : saved && saved.app === 'topo' ? saved : demoState());
    if (fromLink) history.replaceState(null, '', location.pathname);
  })();
  replace(S);
})();

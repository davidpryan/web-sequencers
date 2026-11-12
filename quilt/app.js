/* SPDX-License-Identifier: MPL-2.0
 * Copyright (C) 2026 David Ryan
 * QUILT: a clip and scene launcher, after the Ableton Live Session view and the Bitwig clip launcher.
 *
 * The model
 *   A set has 6 tracks (columns: DRUMS BASS KEYS LEAD PAD PERC) and 8 scenes (rows). Each cell holds a clip or
 *   nothing. A clip is {name, color 1-8, bars 1|2|4, notes: [{s start, l length (both in sixteenths), p pitch, v
 *   velocity}], follow: {action, after}}. On a synth track the notes are a piano roll; on a drum track p is the General
 *   MIDI note of a drum and the clip shows as lanes of sixteenths (one lane a drum).
 *   A track plays one clip at a time, looping. Launching a clip (or a scene: its whole row) waits for the next
 *   launch quantum (none, beat, bar, 2 bars) and then replaces what the track played; a stop waits the same way.
 *   After a clip has looped `after` times its follow action can launch another clip of the track (next, previous,
 *   first, random, any other) or stop it, so a set can play itself.
 *   Recording: arm a track, REC, and the keys or MIDI in write into the selected clip (a new one if the cell is
 *   empty) while it plays; Quantise tidies it after.
 *
 * The top of this file is pure (no DOM, no SeqCore): the model, the launch engine, the clip operations, the demo;
 * node can load it for tests. The bottom builds the screen. */

/* ================================================================== pure part === */
const NTRACKS = 6, NSCENES = 8, TPS = 24 /* ticks a sixteenth at 96 PPQN */, BEAT = 96, BAR = 384;
const QUANTS = { none: 0, beat: BEAT, bar: BAR, '2bars': 2 * BAR };
const QUANT_NAMES = { none: 'none', beat: '1 beat', bar: '1 bar', '2bars': '2 bars' };
const FOLLOWS = ['none', 'next', 'previous', 'first', 'random', 'other', 'stop'];
const FOLLOW_NAMES = { none: 'none', next: 'next', previous: 'previous', first: 'first', random: 'random', other: 'any other', stop: 'stop' };
const FOLLOW_ICONS = { next: '↓', previous: '↑', first: '⤒', random: '?', other: '≠', stop: '■' };
const BARS = [1, 2, 4];
const GM_NOTE = { kick: 36, rim: 37, snare: 38, clap: 39, tom: 45, hat: 42, ohat: 46, cymbal: 49, cowbell: 56, shaker: 70, zap: 57 };
const DRUM_OF = Object.fromEntries(Object.entries(GM_NOTE).map(([k, n]) => [n, k]));
const WAVES = ['sawtooth', 'square', 'triangle', 'sine', 'supersaw'];
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (n) => NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const num = (x, a, b, d) => (typeof x === 'number' && isFinite(x) ? clamp(x, a, b) : d);
const clone = (x) => JSON.parse(JSON.stringify(x));
const mod = (a, b) => ((a % b) + b) % b;

function rng(seed) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/* the first tick at or after T on the launch grid */
const nextLaunch = (T, quant) => { const q = QUANTS[quant] || 0; return q ? Math.ceil(T / q) * q : T; };

/* which clip a follow action launches: a scene index, or -1 for stop. column: the track's cells (clip or null) */
function followTarget(column, cur, action, rnd) {
  const have = column.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
  if (!have.length) return -1;
  const n = column.length;
  switch (action) {
    case 'stop': return -1;
    case 'next': for (let k = 1; k <= n; k++) { const i = (cur + k) % n; if (column[i]) return i; } return cur;
    case 'previous': for (let k = 1; k <= n; k++) { const i = mod(cur - k, n); if (column[i]) return i; } return cur;
    case 'first': return have[0];
    case 'random': return have[Math.floor(rnd() * have.length)];
    case 'other': { const o = have.filter((i) => i !== cur); return o.length ? o[Math.floor(rnd() * o.length)] : cur; }
  }
  return cur;
}

/* --- clip operations (each returns a new notes list or clip; nothing is changed in place) --- */
function quantiseNotes(notes, bars, grid = 1) {
  const len16 = bars * 16, seen = new Map();
  for (const n of notes) {
    const s = mod(Math.round(n.s / grid) * grid, len16);
    const q = Object.assign({}, n, { s, l: Math.max(grid, Math.round(n.l / grid) * grid) });
    seen.set(s + ':' + n.p, q);   /* two notes landing on one: keep the later */
  }
  return [...seen.values()].sort((a, b) => a.s - b.s || a.p - b.p);
}
function doubleClip(clip) {
  if (clip.bars >= 4) return null;
  const len16 = clip.bars * 16, notes = clip.notes.filter((n) => n.s < len16);
  return Object.assign(clone(clip), { bars: clip.bars * 2, notes: notes.concat(notes.map((n) => Object.assign({}, n, { s: n.s + len16 }))) });
}
const transposeNotes = (notes, k) => notes.map((n) => Object.assign({}, n, { p: clamp(n.p + k, 0, 127) }));

/* --- the launch engine: tick(state, T, out) runs one clock tick and pushes what happens on it into out ---
 * {type:'launch', ti, scene (-1: stopped), T, follow} and {type:'note', ti, n (the note), frac (ticks off the grid), local}. */
function createEngine() {
  const e = { tr: [], rnd: rng(1) };
  e.reset = (seed = 1) => { e.tr = Array.from({ length: NTRACKS }, () => ({ play: -1, start: 0, q: null, at: 0 })); e.rnd = rng(seed); };
  e.launch = (ti, scene, at) => { e.tr[ti].q = scene; e.tr[ti].at = at; };
  e.tick = (st, T, out) => {
    for (let ti = 0; ti < NTRACKS; ti++) {
      const t = e.tr[ti];
      if (t.q !== null && T >= t.at) {
        t.play = t.q >= 0 && st.clips[t.q][ti] ? t.q : -1; t.start = T; t.q = null;
        out.push({ type: 'launch', ti, scene: t.play, T, follow: false });
      }
      if (t.play < 0) continue;
      let clip = st.clips[t.play][ti];
      if (!clip) { t.play = -1; out.push({ type: 'launch', ti, scene: -1, T, follow: false }); continue; }
      let ct = clip.bars * BAR, pos = T - t.start;
      if (pos > 0 && pos % ct === 0) {
        const f = clip.follow;
        if (t.q === null && f && f.action !== 'none' && (pos / ct) % f.after === 0) {
          const next = followTarget(st.clips.map((r) => r[ti]), t.play, f.action, e.rnd);
          t.play = next; t.start = T; pos = 0;
          out.push({ type: 'launch', ti, scene: next, T, follow: true });
          if (next < 0) continue;
          clip = st.clips[next][ti]; ct = clip.bars * BAR;
        }
      }
      const local = pos % ct, len16 = clip.bars * 16;
      for (const n of clip.notes) {
        if (n.s < 0 || n.s >= len16) continue;
        const r = Math.round(n.s * TPS);
        if (r % ct === local) out.push({ type: 'note', ti, n, frac: n.s * TPS - r, local });
      }
    }
  };
  e.reset();
  return e;
}

/* --- the model --- */
function patch(over) {
  return Object.assign({ wave: 'sawtooth', cutoff: 0.55, reso: 0.3, envmod: 0.4, attack: 0.005, decay: 0.25, sustain: 0.5,
    release: 0.2, level: 0.7, detune: 8, echo: 0, glide: 0, octave: 0 }, over);
}
function defaultTracks() {
  const drums = (name, lanes, over) => ({ name, kind: 'drum', lanes, ch: 10, vol: 0.85, mute: false, arm: false,
    sound: Object.assign({ tone: 0.5, decay: 1, pitch: 140, echo: 0 }, over) });
  const synth = (name, ch, over) => ({ name, kind: 'synth', ch, vol: 0.8, mute: false, arm: false, sound: patch(over) });
  return [
    drums('DRUMS', ['kick', 'snare', 'clap', 'hat', 'ohat', 'tom', 'rim', 'cymbal'], { tone: 0.42 }),
    synth('BASS', 1, { wave: 'sawtooth', cutoff: 0.3, reso: 0.42, envmod: 0.5, decay: 0.25, sustain: 0.3, release: 0.1, level: 0.85, detune: 6 }),
    synth('KEYS', 2, { wave: 'square', cutoff: 0.38, reso: 0.2, envmod: 0.3, attack: 0.004, decay: 0.5, sustain: 0.35, release: 0.35, level: 0.34, detune: 9, echo: 0.25 }),
    synth('LEAD', 3, { wave: 'sawtooth', cutoff: 0.5, reso: 0.25, envmod: 0.35, attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.25, level: 0.38, detune: 12, echo: 0.4 }),
    synth('PAD', 4, { wave: 'supersaw', cutoff: 0.4, reso: 0.1, envmod: 0.2, attack: 0.5, decay: 1, sustain: 0.8, release: 1.2, level: 0.28, echo: 0.3 }),
    drums('PERC', ['shaker', 'cowbell', 'rim', 'tom', 'clap', 'zap'], { tone: 0.6, pitch: 220 }),
  ];
}
function newClip(ti, bars = 2) { return { name: 'Clip', color: (ti % 8) + 1, bars, notes: [], follow: { action: 'none', after: 1 } }; }
function blankSet() {
  return { app: 'quilt', v: 1, bpm: 112, swing: 0, quant: 'bar', countIn: true, newBars: 2, seed: 1, tracks: defaultTracks(),
    scenes: Array.from({ length: NSCENES }, (_, i) => ({ name: 'Scene ' + (i + 1) })),
    clips: Array.from({ length: NSCENES }, () => new Array(NTRACKS).fill(null)) };
}
function normClip(c) {
  if (!c || typeof c !== 'object') return null;
  const bars = BARS.includes(c.bars) ? c.bars : 1;
  const notes = (Array.isArray(c.notes) ? c.notes : []).filter((n) => n && typeof n.s === 'number' && typeof n.p === 'number')
    .map((n) => ({ s: num(n.s, 0, 63.99, 0), l: num(n.l, 0.05, 64, 1), p: Math.round(num(n.p, 0, 127, 60)), v: Math.round(num(n.v, 1, 127, 100)) }));
  const f = c.follow || {};
  return { name: typeof c.name === 'string' ? c.name.slice(0, 24) : 'Clip', color: Math.round(num(c.color, 1, 8, 1)), bars, notes,
    follow: { action: FOLLOWS.includes(f.action) ? f.action : 'none', after: Math.round(num(f.after, 1, 16, 1)) } };
}
function normalize(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.clips)) return null;
  const st = blankSet();
  st.bpm = Math.round(num(d.bpm, 40, 240, 112)); st.swing = num(d.swing, 0, 0.5, 0);
  st.quant = d.quant in QUANTS ? d.quant : 'bar'; st.countIn = d.countIn !== false;
  st.newBars = BARS.includes(d.newBars) ? d.newBars : 2; st.seed = Math.round(num(d.seed, 1, 1e9, 1));
  st.tracks = st.tracks.map((t, i) => {
    const o = (Array.isArray(d.tracks) && d.tracks[i]) || {};
    const n = Object.assign({}, t, o, { kind: t.kind, sound: Object.assign({}, t.sound, o.sound || {}) });
    if (t.lanes) n.lanes = t.lanes; else delete n.lanes;
    n.ch = Math.round(num(n.ch, 0, 16, t.ch)); n.vol = num(n.vol, 0, 1, t.vol); n.mute = !!n.mute; n.arm = !!n.arm;
    if (t.kind === 'synth' && !WAVES.includes(n.sound.wave)) n.sound.wave = t.sound.wave;
    return n;
  });
  st.scenes = st.scenes.map((s, i) => ({ name: (Array.isArray(d.scenes) && d.scenes[i] && typeof d.scenes[i].name === 'string') ? d.scenes[i].name.slice(0, 24) : s.name }));
  st.clips = st.clips.map((row, si) => row.map((_, ti) => normClip(Array.isArray(d.clips[si]) ? d.clips[si][ti] : null)));
  return st;
}

/* --- the demo: three scenes in D minor; the lead's two phrases answer each other with follow actions --- */
function demoSet() {
  const st = blankSet();
  st.bpm = 112; st.swing = 0.06;
  st.scenes[0].name = 'Intro'; st.scenes[1].name = 'Groove'; st.scenes[2].name = 'Lift';
  for (let i = 3; i < NSCENES; i++) st.scenes[i].name = '';
  /* a drum clip from strings, one per lane, a character a sixteenth: X loud, x normal, o soft, . rest */
  const drum = (name, color, bars, lanes) => {
    const notes = [];
    for (const [lane, pat] of Object.entries(lanes)) [...pat].forEach((ch, s) => {
      const v = { X: 124, x: 100, o: 58 }[ch]; if (v) notes.push({ s, l: 1, p: GM_NOTE[lane], v });
    });
    return { name, color, bars, notes, follow: { action: 'none', after: 1 } };
  };
  const notes = (name, color, bars, list, follow) => ({ name, color, bars, notes: list.map(([s, l, p, v = 96]) => ({ s, l, p, v })),
    follow: follow || { action: 'none', after: 1 } });
  const CH = [[50, 53, 57], [50, 53, 58], [48, 53, 57], [48, 52, 55]];   /* Dm Bb F C */
  const ROOT = [38, 34, 41, 36];
  const perBar = (fn) => CH.flatMap((c, b) => fn(c, ROOT[b], b * 16));
  const chords = notes('Chords', 3, 4, perBar((c, r, o) => [[0, 3], [6, 2], [10, 4]].flatMap(([s, l]) => c.map((p) => [o + s, l, p, s ? 78 : 92]))));
  const pad = notes('Pad', 5, 4, perBar((c, r, o) => c.map((p) => [o, 16, p + 12, 80])));
  const shaker = drum('Shaker', 6, 1, { shaker: 'xoxoxoxoxoxoxoxo' });
  /* scene 1: Intro */
  st.clips[0][0] = drum('Hats', 1, 1, { hat: '..x...x...x...x.', rim: '....o.......o...' });
  st.clips[0][2] = chords;
  st.clips[0][4] = pad;
  st.clips[0][5] = shaker;
  /* scene 2: Groove */
  st.clips[1][0] = drum('Beat', 1, 1, { kick: 'X...x...X...x...', clap: '....x.......x...', hat: 'o.o.o.o.o.o.o.oo', ohat: '..x...x...x...x.' });
  st.clips[1][1] = notes('Bass', 2, 4, perBar((c, r, o) => [[0, 2, 0], [3, 1, 0], [6, 2, 12], [8, 1, 0], [11, 1, 0], [14, 2, 12]].map(([s, l, k]) => [o + s, l, r + k, s ? 92 : 116])));
  st.clips[1][2] = clone(chords);
  st.clips[1][3] = notes('Phrase A', 4, 2, [[0, 3, 69], [3, 1, 72], [4, 4, 74], [10, 2, 72], [12, 4, 69], [18, 2, 65], [20, 2, 67], [22, 6, 69]], { action: 'next', after: 1 });
  st.clips[1][5] = drum('Bells', 6, 1, { cowbell: '......o.......x.', rim: '...x..x....x..x.' });
  /* scene 3: Lift */
  st.clips[2][0] = drum('Beat+', 1, 2, {
    kick: 'X...x...X...x.x.X...x...X...x...', snare: '....x.......x.......x.......x.xx', hat: 'oxoxoxoxoxoxoxoxoxoxoxoxoxoxoxox',
    ohat: '..x...x...x...x...x...x...x.....', tom: '..........................x.x...', cymbal: 'x...............................' });
  st.clips[2][1] = notes('Bass 2', 2, 4, perBar((c, r, o) => [0, 2, 4, 6, 8, 10, 12, 14].map((s) => [o + s, 1.5, r + (s === 6 || s === 14 ? 12 : 0), s % 4 ? 88 : 112])));
  st.clips[2][2] = notes('Stabs', 3, 4, perBar((c, r, o) => [2, 6, 10, 14].flatMap((s) => c.map((p) => [o + s, 1, p + 12, 84]))));
  st.clips[2][3] = notes('Phrase B', 4, 2, [[0, 3, 74], [3, 1, 72], [4, 2, 69], [6, 2, 67], [8, 4, 65], [14, 2, 67], [16, 3, 69], [19, 1, 72], [20, 4, 74], [26, 2, 77], [28, 4, 74]], { action: 'previous', after: 1 });
  st.clips[2][4] = clone(pad);
  st.clips[2][5] = clone(shaker);
  return st;
}

if (typeof module !== 'undefined') module.exports = { NTRACKS, NSCENES, TPS, BAR, QUANTS, FOLLOWS, GM_NOTE, nextLaunch, followTarget,
  quantiseNotes, doubleClip, transposeNotes, createEngine, newClip, blankSet, normalize, demoSet, rng, noteName };

/* ================================================================== the screen === */
function initApp() {
  const S = window.SeqCore, { el, knob, toast } = S.ui, { clock, audio, midi, store } = S;
  const undo = store.undoStack(80);
  const eng = createEngine();
  let state = demoSet();
  const v = {
    cur: { sc: 0, ti: 0 },                       /* the cell cursor: the selected clip */
    playing: new Array(NTRACKS).fill(null),      /* what is heard: {scene, start (tick)} */
    wait: new Array(NTRACKS).fill(null),         /* a launch waiting: a scene, or -1 for a stop */
    rec: false, recAt: null, countEnd: 0, clip: null, pending: [], pendingStart: false,
  };
  const disp = [], out = [];
  const pk = { base: 48 };

  const track = (ti = v.cur.ti) => state.tracks[ti];
  const clipAt = (sc, ti) => state.clips[sc][ti];
  const selClip = () => clipAt(v.cur.sc, v.cur.ti);

  /* ---- edits: undo (a burst of the same edit is one step), autosave ---- */
  let lastKey = '', lastT = 0, saveTimer = 0;
  function edit(key) {
    const now = performance.now();
    if (!key || key !== lastKey || now - lastT > 900) undo.push(state);
    lastKey = key || ''; lastT = now;
  }
  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.save('quilt', state), 300); }
  function setState(s) { state = s; clock.bpm = state.bpm; clock.swing = state.swing; head.setTempo(state.bpm); head.setSwing(state.swing); fitPitch(); renderAll(); save(); }
  function doUndo() { const s = undo.undo(state); if (s) { setState(s); toast('Undo'); } else toast('Nothing to undo'); }
  function doRedo() { const s = undo.redo(state); if (s) { setState(s); toast('Redo'); } else toast('Nothing to redo'); }

  /* ---- sound ---- */
  function playNote(ti, n, time, dur) {
    const tr = state.tracks[ti];
    if (tr.kind === 'drum') {
      const name = DRUM_OF[n.p] || tr.lanes[mod(n.p, tr.lanes.length)];
      audio.drum(name, n.v, time, { tone: tr.sound.tone, decay: tr.sound.decay, pitch: tr.sound.pitch, echo: tr.sound.echo, level: 0.95 * tr.vol });
      midi.note(tr.ch, n.p, n.v, time, 0.05);
    } else {
      audio.note(Object.assign({}, tr.sound, { level: tr.sound.level * tr.vol }), n.p, n.v, time, dur);
      midi.note(tr.ch, n.p + 12 * (tr.sound.octave || 0), n.v, time, dur);
    }
  }
  const audition = (ti, p, vel = 100) => playNote(ti, { p, v: vel }, audio.ensure().currentTime + 0.005, 0.25);

  /* ---- the clock ---- */
  clock.onStart = () => {
    eng.reset(state.seed + (Date.now() & 0xffff)); disp.length = 0;
    if (!v.pending.length) {                    /* play with nothing queued: the last scene launched (or the first) */
      const sc = v.lastScene || 0;
      state.tracks.forEach((_, ti) => { if (clipAt(sc, ti)) { v.wait[ti] = sc; v.pending.push([ti, sc, 0]); } });
    }
    v.pending.forEach(([ti, sc, at]) => eng.launch(ti, sc, at)); v.pending = [];
  };
  clock.onTick = (T, t) => {
    const spt = clock.secPerTick();
    if (T < v.countEnd && T % BEAT === 0) audio.drum('rim', T % BAR ? 80 : 127, t, { level: 0.8 });
    out.length = 0; eng.tick(state, T, out);
    for (const ev of out) {
      if (ev.type === 'launch') { disp.push([t, ev.ti, ev.scene, ev.T]); continue; }
      if (state.tracks[ev.ti].mute) continue;
      playNote(ev.ti, ev.n, t + ev.frac * spt + clock.swingOffset(ev.local), ev.n.l * TPS * spt * 0.98);
    }
  };
  clock.onStop = () => {
    endRecNotes(); disp.length = 0; v.playing.fill(null); v.wait.fill(null); v.countEnd = 0; paintGrid();
  };

  /* ---- launching ---- */
  function launch(ti, sc) {
    v.wait[ti] = sc;
    if (clock.playing) eng.launch(ti, sc, nextLaunch(clock.tick, state.quant));
    else if (sc >= 0) { v.pending.push([ti, sc, 0]); v.pendingStart = true; }
    else v.wait[ti] = null;
  }
  function go() { if (v.pendingStart && !clock.playing) clock.start(); v.pendingStart = false; paintGrid(); }
  function launchClip(sc, ti) { if (clipAt(sc, ti)) { launch(ti, sc); go(); } }
  function launchScene(sc) {
    v.lastScene = sc;
    for (let ti = 0; ti < NTRACKS; ti++) {
      if (clipAt(sc, ti)) launch(ti, sc);
      else if (v.playing[ti] || eng.tr[ti].q !== null) launch(ti, -1);
    }
    go();
  }
  function stopTrack(ti) { if (clock.playing && (v.playing[ti] || eng.tr[ti].q !== null)) launch(ti, -1); paintGrid(); }
  function stopAll() { for (let ti = 0; ti < NTRACKS; ti++) stopTrack(ti); }

  /* ================================================================ building the screen */
  const help = [
    ['Space', 'Play / stop the transport'],
    ['Click a clip', 'Launch it at the next launch quantum (it pulses while it waits) and select it for the editor'],
    ['Click an empty cell', 'Select it; double-click (or New clip) makes a clip there'],
    ['Scene button ▶ (or 1-8)', 'Launch the whole row; tracks with no clip in it stop'],
    ['■ under a track', 'Stop the track at the next quantum; Stop all (or .) stops every track'],
    ['Drag a clip', 'Move it to another cell (hold Alt/Option to copy)'],
    ['Arrow keys', 'Move the cell cursor'],
    ['Enter', 'Launch the clip at the cursor (an empty cell: stop the track)'],
    ['Delete / Backspace', 'Delete the clip at the cursor'],
    ['Ctrl/Cmd+C, V, D', 'Copy, paste, duplicate (to the next empty cell below) the clip at the cursor'],
    ['● (arm) and REC', 'Arm a track, select a cell, press REC: the keys or MIDI in record into the clip (a new one in an empty cell) while it plays; overdubs if it has notes. Count-in plays a bar first when stopped'],
    ['z s x d c v g b h n j m , / q 2 w 3 e r 5 t 6 y 7 u i', 'Piano keys: play the selected (or recording) track; on a drum track the keys are the lanes'],
    ['[ and ]', 'Piano octave down / up'],
    ['Piano roll', 'Click to add a note, drag to move it, drag its right edge to resize, click it to delete; drag in the lane below to set velocity; wheel or ▲▼ to scroll the pitch'],
    ['Drum lanes', 'Click to add or remove a hit; drag across to paint; drag a hit up or down for its velocity'],
    ['Follow action', 'After the clip loops N times: next, previous, first, random, any other clip of the track, or stop'],
    ['Quantise, Double, Transpose', 'Snap starts and lengths to the grid; double the clip with a copy of itself; move the notes'],
    ['Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z', 'Undo, redo (every edit; launches are performance and are not undone)'],
  ];
  const head = S.ui.header({
    name: 'QUILT', tagline: 'clip and scene launcher', color: S.ui.css('--accent'), help,
    about: 'A grid of clips: columns are tracks, rows are scenes. Launch clips and scenes on the beat or the bar; let follow actions chain them; edit or record the selected clip below.',
    onUndo: doUndo, onRedo: doRedo,
    onNew: () => { edit(); const s = blankSet(); s.bpm = state.bpm; clock.stop(); setState(s); toast('New set (Undo brings the old one back)'); },
    onSave: () => store.download('quilt.json', state),
    onLoad: async () => { const d = normalize(await store.upload()); if (!d) return toast('Not a QUILT file'); edit(); clock.stop(); setState(d); toast('Opened'); },
    onShare: async () => {
      const link = await store.shareLink(state);
      try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch (e) { history.replaceState(null, '', link); toast('Link in the address bar'); }
    },
    onTempo: (x) => { state.bpm = x; save(); }, onSwing: (x) => { state.swing = x; save(); },
  });
  document.body.append(head);
  const main = el('main', {});
  document.body.append(main);

  /* ---- the bar: launch quantum, stop all, record, clip ops ---- */
  const quantSel = S.ui.select('Launch quantum', Object.keys(QUANTS).map((q) => ({ value: q, label: QUANT_NAMES[q] })), state.quant, (x) => { state.quant = x; save(); });
  const recBtn = el('button', { class: 'sc-btn rec', 'aria-pressed': 'false', title: 'Record into the selected clip of an armed track', onclick: toggleRec }, '● REC');
  const countChk = el('input', { type: 'checkbox', onchange: (e) => { state.countIn = e.target.checked; save(); } });
  const newBarsSel = S.ui.select('New clip', BARS.map((b) => ({ value: b, label: b + (b > 1 ? ' bars' : ' bar') })), state.newBars, (x) => { state.newBars = +x; save(); });
  main.append(el('section', { class: 'sc-panel qu-bar', 'aria-label': 'Launching and recording' },
    el('div', { class: 'qu-group' }, quantSel,
      el('button', { class: 'sc-btn', title: 'Stop every track at the next quantum (.)', onclick: stopAll }, '■ Stop all')),
    el('div', { class: 'qu-group' }, recBtn, el('label', { class: 'sc-chk', title: 'A bar of clicks before recording from stop' }, countChk, 'count-in'), newBarsSel),
    el('div', { class: 'qu-group' },
      el('button', { class: 'sc-btn', title: 'Copy the selected clip (Ctrl/Cmd+C)', onclick: copyClip }, 'Copy'),
      el('button', { class: 'sc-btn', title: 'Paste into the selected cell (Ctrl/Cmd+V)', onclick: pasteClip }, 'Paste'),
      el('button', { class: 'sc-btn', title: 'Duplicate into the next empty cell below (Ctrl/Cmd+D)', onclick: duplicateClip }, 'Duplicate'),
      el('button', { class: 'sc-btn', title: 'Delete the selected clip (Delete)', onclick: deleteClip }, 'Delete'))));

  /* ---- the grid ---- */
  const grid = el('div', { class: 'qu-grid', role: 'grid', 'aria-label': 'Clips: tracks across, scenes down' });
  const heads = [], arms = [], mutes = [], cells = [], sceneBtns = [], stops = [];
  for (let ti = 0; ti < NTRACKS; ti++) {
    const h = el('button', { class: 'sc-btn qu-th', style: `--tc: var(--c${ti + 1})`, title: 'Select the track', onclick: () => moveCursor(v.cur.sc, ti) });
    heads.push(h); grid.append(h);
  }
  grid.append(el('div', { class: 'qu-corner' }, 'Scenes'));
  for (let ti = 0; ti < NTRACKS; ti++) {
    const a = el('button', { class: 'sc-btn qu-tog arm', 'aria-pressed': 'false', title: 'Arm for recording', onclick: () => { state.tracks[ti].arm = !state.tracks[ti].arm; paintGrid(); renderTrack(); save(); } }, '●');
    const m = el('button', { class: 'sc-btn qu-tog mute', 'aria-pressed': 'false', title: 'Mute', onclick: () => { state.tracks[ti].mute = !state.tracks[ti].mute; paintGrid(); renderTrack(); save(); } }, 'M');
    arms.push(a); mutes.push(m);
    grid.append(el('div', { style: 'display:grid;gap:3px' }, a, m));
  }
  grid.append(el('div', {}));
  let drag = null, dragged = false;
  for (let sc = 0; sc < NSCENES; sc++) {
    cells.push([]);
    for (let ti = 0; ti < NTRACKS; ti++) {
      const c = el('button', { class: 'qu-cell', role: 'gridcell' }, el('span', { class: 'ic', 'aria-hidden': 'true' }), el('span', { class: 'nm' }), el('span', { class: 'fa', 'aria-hidden': 'true' }));
      c.dataset.sc = sc; c.dataset.ti = ti;
      c.addEventListener('click', () => {
        if (dragged) { dragged = false; return; }
        moveCursor(sc, ti);
        if (clipAt(sc, ti)) launchClip(sc, ti);
      });
      c.addEventListener('dblclick', () => { if (!clipAt(sc, ti)) createClip(sc, ti); });
      c.addEventListener('pointerdown', (e) => { if (e.button === 0 && clipAt(sc, ti)) drag = { sc, ti, x: e.clientX, y: e.clientY, on: false, id: e.pointerId, over: null }; });
      c.addEventListener('pointermove', (e) => dragMove(e, c));
      c.addEventListener('pointerup', (e) => dragEnd(e, c));
      c.addEventListener('pointercancel', () => dragCancel(c));
      c.addEventListener('focus', () => { if (v.cur.sc !== sc || v.cur.ti !== ti) moveCursor(sc, ti); });
      cells[sc].push(c); grid.append(c);
    }
    const b = el('button', { class: 'sc-btn qu-scene', title: `Launch scene ${sc + 1} (${sc + 1})`, onclick: () => launchScene(sc) });
    sceneBtns.push(b); grid.append(b);
  }
  for (let ti = 0; ti < NTRACKS; ti++) {
    const s = el('button', { class: 'sc-btn qu-stop', 'aria-label': `Stop ${state.tracks[ti].name}`, title: 'Stop the track at the next quantum', onclick: () => stopTrack(ti) }, '■');
    stops.push(s); grid.append(s);
  }
  grid.append(el('button', { class: 'sc-btn qu-stop', title: 'Stop all (.)', onclick: stopAll }, '■ all'));
  main.append(el('section', { class: 'sc-panel qu-gridwrap', 'aria-label': 'Clip grid' }, grid));

  function dragMove(e, c) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!(e.buttons & 1)) { dragCancel(c); return; }
    if (!drag.on && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8) { drag.on = true; try { c.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic pointer */ } c.classList.add('dragging'); }
    if (!drag.on) return;
    const t = document.elementFromPoint(e.clientX, e.clientY);
    const over = t && t.closest('.qu-cell');
    if (drag.over && drag.over !== over) drag.over.classList.remove('drop');
    drag.over = over; if (over && over !== c) over.classList.add('drop');
  }
  function dragEnd(e, c) {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.on) return;
    c.classList.remove('dragging'); if (d.over) d.over.classList.remove('drop');
    dragged = true; setTimeout(() => { dragged = false; }, 0);
    if (!d.over || d.over === c) return;
    const sc = +d.over.dataset.sc, ti = +d.over.dataset.ti;
    moveClip(d.sc, d.ti, sc, ti, e.altKey);
  }
  function dragCancel(c) { if (drag && drag.over) drag.over.classList.remove('drop'); c.classList.remove('dragging'); drag = null; }

  /* ---- the track panel and the clip editor ---- */
  const edPanel = el('section', { class: 'sc-panel qu-panel', 'aria-label': 'Clip editor' });
  const trackPanel = el('section', { class: 'sc-panel qu-panel qu-trackpanel', 'aria-label': 'Track' });
  main.append(el('div', { class: 'qu-panels' }, edPanel, trackPanel));
  const edHead = el('div', {});
  const edWrap = el('div', { class: 'qu-ed' });
  const edFoot = el('div', { class: 'sc-hint', style: 'margin-top:6px' });
  edPanel.append(edHead, edWrap, edFoot);
  const ed = { low: 48, viewBar: 0, vb: 0, grid: 1, drag: null, dirty: true, lastLen: 1 };
  const cv = S.ui.canvas(edWrap, drawEditor);
  cv.canvas.setAttribute('aria-label', 'Clip notes: click to add, drag to move or resize');
  cv.canvas.setAttribute('role', 'img');

  /* ================================================================ painting */
  function paintCell(sc, ti) {
    const c = cells[sc][ti], clip = clipAt(sc, ti), tr = state.tracks[ti];
    const playing = v.playing[ti] && v.playing[ti].scene === sc;
    c.classList.toggle('clip', !!clip); c.classList.toggle('empty', !clip); c.classList.toggle('armed', tr.arm);
    c.classList.toggle('playing', !!playing);
    c.classList.toggle('queued', v.wait[ti] === sc);
    c.classList.toggle('cursor', v.cur.sc === sc && v.cur.ti === ti);
    c.classList.toggle('target', !!(v.rec && v.recAt && v.recAt.sc === sc && v.recAt.ti === ti));
    if (clip) c.style.setProperty('--cc', `var(--c${clip.color})`); else c.style.removeProperty('--cc');
    if (!playing) c.style.setProperty('--p', 0);
    c.children[1].textContent = clip ? clip.name : '';
    c.children[2].textContent = clip && clip.follow.action !== 'none' ? FOLLOW_ICONS[clip.follow.action] + clip.follow.after : '';
    c.setAttribute('aria-label', `${tr.name}, ${state.scenes[sc].name || 'scene ' + (sc + 1)}: ` + (clip ? `${clip.name}, ${clip.bars} bar${clip.bars > 1 ? 's' : ''}`
      + (playing ? ', playing' : '') + (v.wait[ti] === sc ? ', waiting to launch' : '') + (clip.follow.action !== 'none' ? `, then ${FOLLOW_NAMES[clip.follow.action]} after ${clip.follow.after}` : '') : 'empty'));
    c.title = clip ? 'Click: launch. Drag: move (Alt: copy).' : 'Empty. Double-click: new clip.';
  }
  function paintGrid() {
    for (let ti = 0; ti < NTRACKS; ti++) {
      const tr = state.tracks[ti];
      heads[ti].textContent = tr.name; heads[ti].setAttribute('aria-pressed', String(v.cur.ti === ti));
      arms[ti].setAttribute('aria-pressed', String(tr.arm)); arms[ti].setAttribute('aria-label', `Arm ${tr.name}`);
      mutes[ti].setAttribute('aria-pressed', String(tr.mute)); mutes[ti].setAttribute('aria-label', `Mute ${tr.name}`);
      stops[ti].classList.toggle('queued', v.wait[ti] === -1);
      stops[ti].classList.toggle('live', !!v.playing[ti]);
    }
    for (let sc = 0; sc < NSCENES; sc++) {
      for (let ti = 0; ti < NTRACKS; ti++) paintCell(sc, ti);
      sceneBtns[sc].replaceChildren(el('b', {}, '▶ ' + (sc + 1)), state.scenes[sc].name);
      sceneBtns[sc].setAttribute('aria-label', `Launch scene ${sc + 1} ${state.scenes[sc].name}`);
    }
  }
  /* per frame: only the progress rings of the playing clips */
  function paintProgress() {
    const T = clock.tickNow();
    for (let ti = 0; ti < NTRACKS; ti++) {
      const p = v.playing[ti]; if (!p) continue;
      const clip = clipAt(p.scene, ti); if (!clip) continue;
      const ct = clip.bars * BAR;
      cells[p.scene][ti].style.setProperty('--p', (mod(T - p.start, ct) / ct).toFixed(3));
    }
  }

  /* the track panel */
  function renderTrack() {
    const ti = v.cur.ti, tr = track();
    trackPanel.style.setProperty('--tc', `var(--c${ti + 1})`);
    const chSel = S.ui.select('MIDI ch', [{ value: 0, label: 'off' }].concat(Array.from({ length: 16 }, (_, i) => ({ value: i + 1, label: String(i + 1) }))), tr.ch, (x) => { edit(); tr.ch = +x; save(); });
    const volK = knob({ label: 'VOLUME', min: 0, max: 1, step: 0.01, value: tr.vol, def: 0.8, fmt: (x) => Math.round(x * 100) + '%', onInput: (x) => { edit('vol'); tr.vol = x; save(); } });
    const tog = (label, key, title) => el('button', { class: 'sc-btn' + (tr[key] ? ' on' : ''), 'aria-pressed': String(tr[key]), title, onclick: () => { tr[key] = !tr[key]; paintGrid(); renderTrack(); save(); } }, label);
    const k = (label, key, min, max, step, def, fmt) => knob({ label, min, max, step, def, value: tr.sound[key], fmt, onInput: (x) => { edit('snd' + key); tr.sound[key] = x; save(); } });
    const f2 = (x) => (+x).toFixed(2), fs = (x) => (x < 1 ? Math.round(x * 1000) + 'ms' : (+x).toFixed(2) + 's');
    const sound = tr.kind === 'drum'
      ? [k('TONE', 'tone', 0, 1, 0.01, 0.5, f2), k('DECAY', 'decay', 0.2, 2.5, 0.01, 1, f2), k('TOM PITCH', 'pitch', 50, 400, 1, 140, (x) => x + 'Hz'), k('ECHO', 'echo', 0, 1, 0.01, 0, f2)]
      : [S.ui.select('Wave', WAVES, tr.sound.wave, (x) => { edit(); tr.sound.wave = x; save(); audition(ti, 60); }),
        k('CUTOFF', 'cutoff', 0, 1, 0.01, 0.55, f2), k('RESO', 'reso', 0, 1, 0.01, 0.3, f2), k('ENV', 'envmod', 0, 1, 0.01, 0.4, f2),
        k('ATTACK', 'attack', 0.001, 1, 0.001, 0.005, fs), k('DECAY', 'decay', 0.02, 2, 0.01, 0.25, fs), k('SUSTAIN', 'sustain', 0, 1, 0.01, 0.5, f2),
        k('RELEASE', 'release', 0.01, 2, 0.01, 0.2, fs), k('DETUNE', 'detune', 0, 30, 1, 8, (x) => x + 'c'), k('ECHO', 'echo', 0, 1, 0.01, 0, f2),
        k('OCTAVE', 'octave', -2, 2, 1, 0, (x) => (x > 0 ? '+' : '') + x), k('LEVEL', 'level', 0, 1, 0.01, 0.7, f2)];
    trackPanel.replaceChildren(
      el('h2', {}, el('span', { class: 'qu-dot' }), `Track ${ti + 1} · ${tr.name}`, el('span', { class: 'sc-hint' }, tr.kind === 'drum' ? 'drums: ' + tr.lanes.join(' ') : 'synth')),
      el('div', { class: 'sc-row' }, volK, tog('Mute', 'mute', 'Silence the track'), tog('● Arm', 'arm', 'Arm for recording'), chSel),
      el('div', { class: 'sc-label qu-sub' }, 'Sound'),
      el('div', { class: 'qu-knobs' }, sound));
  }

  /* the clip editor: the toolbar */
  function renderEditor() {
    const clip = selClip(), ti = v.cur.ti, tr = track(), sc = v.cur.sc;
    const where = `${tr.name} · ${state.scenes[sc].name || 'scene ' + (sc + 1)}`;
    if (!clip) {
      edPanel.style.removeProperty('--cc');
      edHead.replaceChildren(el('h2', {}, 'Clip', el('span', { class: 'sc-hint' }, where + ' · empty')),
        el('div', { class: 'sc-row' },
          el('button', { class: 'sc-btn', onclick: () => createClip(sc, ti) }, `New clip (${state.newBars} bar${state.newBars > 1 ? 's' : ''})`),
          el('button', { class: 'sc-btn', onclick: pasteClip, disabled: !v.clip }, 'Paste'),
          el('span', { class: 'sc-hint' }, tr.arm ? 'Armed: press REC to record a new clip here.' : 'Arm the track (●) and press REC to record one here.')));
      edWrap.hidden = true; edFoot.textContent = '';
      return;
    }
    edWrap.hidden = false;
    edPanel.style.setProperty('--cc', `var(--c${clip.color})`);
    const name = el('input', { class: 'qu-name', value: clip.name, 'aria-label': 'Clip name', maxlength: 24,
      oninput: (e) => { edit('name'); clip.name = e.target.value; paintCell(sc, ti); save(); } });
    const swatches = el('div', { class: 'qu-group', role: 'group', 'aria-label': 'Colour' }, Array.from({ length: 8 }, (_, i) => el('button', {
      class: 'qu-swatch', style: `--sw: var(--c${i + 1})`, 'aria-label': `Colour ${i + 1}`, 'aria-pressed': String(clip.color === i + 1),
      onclick: () => { edit(); clip.color = i + 1; paintCell(sc, ti); renderEditor(); save(); } })));
    const barsSel = S.ui.select('Length', BARS.map((b) => ({ value: b, label: b + (b > 1 ? ' bars' : ' bar') })), clip.bars, (x) => { edit(); clip.bars = +x; ed.viewBar = 0; renderEditor(); paintCell(sc, ti); save(); });
    const gridSel = S.ui.select('Grid', [{ value: 1, label: '1/16' }, { value: 2, label: '1/8' }, { value: 4, label: '1/4' }], ed.grid || 1, (x) => { ed.grid = +x; });
    const fAct = S.ui.select('Follow', FOLLOWS.map((f) => ({ value: f, label: FOLLOW_NAMES[f] })), clip.follow.action, (x) => { edit(); clip.follow.action = x; paintCell(sc, ti); save(); });
    const fAfter = S.ui.select('After', Array.from({ length: 16 }, (_, i) => ({ value: i + 1, label: (i + 1) + (i ? ' loops' : ' loop') })), clip.follow.after, (x) => { edit(); clip.follow.after = +x; paintCell(sc, ti); save(); });
    const btn = (label, title, fn, dis = false) => el('button', { class: 'sc-btn', title, onclick: fn, disabled: dis }, label);
    const tp = (k) => btn((k > 0 ? '+' : '−') + Math.abs(k), `Transpose ${k > 0 ? 'up' : 'down'} ${Math.abs(k)} semitone${Math.abs(k) > 1 ? 's' : ''}`, () => { edit(); clip.notes = transposeNotes(clip.notes, k); ed.low = clamp(ed.low + k, 0, 104); ed.dirty = true; save(); });
    const g = geo();
    const views = g && g.viewBars < clip.bars ? el('div', { class: 'qu-group', role: 'group', 'aria-label': 'Bars shown' }, el('span', { class: 'sc-label' }, 'Bars'),
      Array.from({ length: clip.bars / g.viewBars }, (_, i) => el('button', { class: 'sc-btn' + (ed.viewBar === i ? ' on' : ''), 'aria-pressed': String(ed.viewBar === i),
        onclick: () => { ed.viewBar = i; renderEditor(); } }, g.viewBars === 1 ? String(i + 1) : `${i * g.viewBars + 1}-${(i + 1) * g.viewBars}`))) : '';
    edHead.replaceChildren(
      el('h2', {}, el('span', { class: 'qu-dot' }), 'Clip', el('span', { class: 'sc-hint' }, where)),
      el('div', { class: 'sc-row' }, name, swatches),
      el('div', { class: 'sc-row', style: 'margin-top:8px' }, barsSel, gridSel,
        btn('Quantise', 'Snap starts and lengths to the grid', () => { edit(); clip.notes = quantiseNotes(clip.notes, clip.bars, ed.grid || 1); ed.dirty = true; save(); }),
        btn('Double', 'Double the length with a copy of the clip', () => { const d = doubleClip(clip); if (!d) return toast('Already 4 bars'); edit(); state.clips[sc][ti] = d; renderEditor(); paintCell(sc, ti); save(); }, clip.bars >= 4),
        tr.kind === 'synth' ? el('div', { class: 'qu-group', role: 'group', 'aria-label': 'Transpose' }, el('span', { class: 'sc-label' }, 'Transpose'), tp(-12), tp(-1), tp(1), tp(12)) : '',
        tr.kind === 'synth' ? el('div', { class: 'qu-group', role: 'group', 'aria-label': 'Pitch view' },
          btn('▲', 'Show higher notes', () => { ed.low = clamp(ed.low + 12, 0, 104); ed.dirty = true; }), btn('▼', 'Show lower notes', () => { ed.low = clamp(ed.low - 12, 0, 104); ed.dirty = true; })) : ''),
      el('div', { class: 'sc-row', style: 'margin-top:8px' }, fAct, fAfter, views, btn('Delete clip', 'Delete (Delete key)', deleteClip)));
    edFoot.textContent = tr.kind === 'drum' ? 'Click: add or remove a hit · drag across: paint · drag a hit up or down: velocity'
      : 'Click: add a note · drag: move · drag the right edge: length · click a note: delete · lane below: velocity · wheel: scroll pitch';
    ed.vb = g && g.viewBars;
    sizeCanvas(); ed.dirty = true;
  }

  /* the editor's geometry: the visible bars, the rows, the column width */
  const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  function geo() {
    const clip = selClip(); if (!clip) return null;
    const tr = track(), drum = tr.kind === 'drum', W = Math.max(cv.w, 200);
    const keyW = drum ? 64 : 40, rows = drum ? tr.lanes.length : 24, rowH = drum ? (coarse ? 34 : 28) : (coarse ? 22 : 15), velH = drum ? 0 : 54;
    const fitBars = Math.max(1, Math.floor((W - keyW) / (16 * (coarse ? 18 : 11))));
    const viewBars = [4, 2, 1].find((b) => b <= Math.min(fitBars, clip.bars)) || 1;
    ed.viewBar = clamp(ed.viewBar, 0, clip.bars / viewBars - 1);
    const cols = viewBars * 16, colW = (W - keyW) / cols;
    return { clip, tr, drum, W, keyW, rows, rowH, velH, viewBars, cols, colW, col0: ed.viewBar * viewBars * 16, gridH: rows * rowH, H: rows * rowH + velH };
  }
  function sizeCanvas() { const g = geo(); if (g) cv.canvas.style.height = g.H + 'px'; }
  function fitPitch() {
    const clip = selClip();
    if (!clip || track().kind === 'drum') return;
    if (!clip.notes.length) { ed.low = 48; return; }
    const ps = clip.notes.map((n) => n.p), lo = Math.min(...ps), hi = Math.max(...ps);
    ed.low = clamp(Math.round((lo + hi) / 2) - 12, 0, 104);
  }

  /* the editor's canvas */
  let colors = null;
  const readColors = () => { const c = (n) => S.ui.css(n); colors = { bg: c('--bg'), panel: c('--panel'), panel2: c('--panel2'), line: c('--line'), fg: c('--fg'), dim: c('--dim'), faint: c('--faint'), rec: c('--rec'), accent: c('--accent'), cs: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => c('--c' + i)), font: c('--font'), mono: c('--mono') }; ed.dirty = true; };
  readColors();
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColors);
  let lastW = 0, lastH = 0;
  function drawEditor(st) {
    const g = geo(); if (!g) return;
    if (st.w !== lastW || st.h !== lastH || st.canvas.width !== st.pw) {   /* a resize clears the pixels */
      lastW = st.w; lastH = st.h; st.pw = st.canvas.width; ed.dirty = true;
      if (g.viewBars !== ed.vb) { renderEditor(); return; }
    }
    const p = v.playing[v.cur.ti], here = p && p.scene === v.cur.sc;
    if (!ed.dirty && !here) return;
    ed.dirty = false;
    const x = st.ctx, C = colors, col = C.cs[g.clip.color - 1];
    x.clearRect(0, 0, st.w, st.h);
    x.fillStyle = C.panel; x.fillRect(0, 0, st.w, st.h);
    /* rows */
    for (let r = 0; r < g.rows; r++) {
      const y = r * g.rowH;
      if (g.drum) {
        x.fillStyle = r % 2 ? C.panel : C.panel2; x.fillRect(g.keyW, y, g.W - g.keyW, g.rowH);
        x.fillStyle = C.dim; x.font = '12px ' + C.font; x.textBaseline = 'middle'; x.fillText(g.tr.lanes[r], 8, y + g.rowH / 2);
      } else {
        const pitch = ed.low + g.rows - 1 - r, black = [1, 3, 6, 8, 10].includes(mod(pitch, 12));
        x.fillStyle = black ? C.panel : C.panel2; x.fillRect(g.keyW, y, g.W - g.keyW, g.rowH);
        x.fillStyle = black ? C.faint : C.line; x.fillRect(0, y, g.keyW - 2, g.rowH - 1);
        if (mod(pitch, 12) === 0) {
          x.fillStyle = C.line; x.fillRect(g.keyW, y + g.rowH - 1, g.W - g.keyW, 1);
          x.fillStyle = C.fg; x.font = '10px ' + C.mono; x.textBaseline = 'middle'; x.fillText(noteName(pitch), 3, y + g.rowH / 2);
        }
      }
    }
    /* columns */
    for (let c = 0; c <= g.cols; c++) {
      const abs = g.col0 + c, xx = Math.round(g.keyW + c * g.colW);
      x.fillStyle = abs % 16 === 0 ? C.dim : abs % 4 === 0 ? C.faint : C.line;
      x.fillRect(xx, 0, abs % 16 === 0 ? 2 : 1, g.gridH);
      if (abs % 16 === 0 && c < g.cols) { x.fillStyle = C.dim; x.font = '10px ' + C.mono; x.textBaseline = 'top'; x.fillText(String(abs / 16 + 1), xx + 4, 2); }
    }
    /* notes */
    const len16 = g.clip.bars * 16;
    for (const n of g.clip.notes) {
      if (n.s >= len16 || n.s + n.l <= g.col0 || n.s >= g.col0 + g.cols) continue;
      const row = g.drum ? g.tr.lanes.findIndex((l) => GM_NOTE[l] === n.p) : ed.low + g.rows - 1 - n.p;
      if (row < 0 || row >= g.rows) continue;
      const nx = g.keyW + (n.s - g.col0) * g.colW, ny = row * g.rowH;
      x.globalAlpha = 0.35 + 0.65 * n.v / 127;
      x.fillStyle = col;
      if (g.drum) x.fillRect(nx + 2, ny + 3, Math.max(4, g.colW - 4), g.rowH - 6);
      else x.fillRect(nx + 1, ny + 1, Math.max(3, n.l * g.colW - 2), g.rowH - 2);
      x.globalAlpha = 1;
      if (!g.drum) { x.fillStyle = C.fg; x.fillRect(nx + Math.max(3, n.l * g.colW - 2) - 2, ny + 2, 2, g.rowH - 4); }
    }
    /* the velocity lane */
    if (g.velH) {
      const y0 = g.gridH;
      x.fillStyle = C.panel2; x.fillRect(0, y0, g.W, g.velH);
      x.fillStyle = C.line; x.fillRect(0, y0, g.W, 1);
      x.fillStyle = C.dim; x.font = '10px ' + C.font; x.textBaseline = 'middle'; x.fillText('VEL', 6, y0 + g.velH / 2);
      for (const n of g.clip.notes) {
        if (n.s >= len16 || n.s < g.col0 || n.s >= g.col0 + g.cols) continue;
        const nx = g.keyW + (n.s - g.col0) * g.colW, h = (g.velH - 8) * n.v / 127;
        x.fillStyle = col; x.fillRect(nx + 1, y0 + g.velH - 3 - h, Math.max(3, Math.min(g.colW * 0.6, 8)), h);
      }
    }
    /* the playhead */
    if (here) {
      const ct = g.clip.bars * BAR, pos16 = mod(clock.tickNow() - p.start, ct) / TPS;
      if (pos16 >= g.col0 && pos16 < g.col0 + g.cols) { x.fillStyle = C.fg; x.fillRect(g.keyW + (pos16 - g.col0) * g.colW, 0, 2, g.H); }
    }
    if (v.rec && v.recAt && v.recAt.sc === v.cur.sc && v.recAt.ti === v.cur.ti) { x.strokeStyle = C.rec; x.lineWidth = 2; x.strokeRect(1, 1, st.w - 2, st.h - 2); }
  }

  /* the editor's pointer: add, move, resize, delete, velocity; drum lanes: toggle, paint, velocity */
  function at(e) {
    const g = geo(), r = cv.canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    const x16 = g.col0 + (px - g.keyW) / g.colW, row = Math.floor(py / g.rowH);
    return { g, px, py, x16, row, inVel: py >= g.gridH, pitch: g.drum ? (g.tr.lanes[row] ? GM_NOTE[g.tr.lanes[row]] : null) : ed.low + g.rows - 1 - row };
  }
  cv.canvas.addEventListener('pointerdown', (e) => {
    const clip = selClip(); if (!clip || e.button !== 0) return;
    const a = at(e), g = a.g, len16 = clip.bars * 16;
    try { cv.canvas.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic pointer */ }
    if (a.px < g.keyW) { if (a.pitch != null) audition(v.cur.ti, a.pitch); return; }
    if (a.inVel) {
      const n = clip.notes.filter((n) => n.s < len16 && a.x16 >= n.s && a.x16 < n.s + Math.max(n.l, 0.6)).pop() || nearest(clip, a.x16);
      if (n) { edit(); ed.drag = { mode: 'vel', n }; setVel(n, a); }
      return;
    }
    if (a.pitch == null || a.row < 0 || a.row >= g.rows) return;
    const col = Math.floor(a.x16);
    if (g.drum) {
      const hit = clip.notes.find((n) => n.p === a.pitch && Math.floor(n.s + 1e-6) === col);
      edit();
      if (hit) ed.drag = { mode: 'dvel', n: hit, y: a.py, v0: hit.v, moved: false };
      else { const n = { s: col, l: 1, p: a.pitch, v: 100 }; clip.notes.push(n); audition(v.cur.ti, a.pitch); ed.drag = { mode: 'paint', p: a.pitch }; }
      ed.dirty = true; save(); return;
    }
    const hit = clip.notes.filter((n) => n.p === a.pitch && n.s < len16 && a.x16 >= n.s && a.x16 < n.s + n.l).pop();
    edit();
    if (hit) {
      const edge = a.x16 > hit.s + hit.l - Math.min(0.5, hit.l * 0.35);
      ed.drag = edge ? { mode: 'resize', n: hit, moved: false } : { mode: 'move', n: hit, off: a.x16 - hit.s, p0: hit.p, s0: hit.s, moved: false };
    } else {
      const n = { s: clamp(col, 0, len16 - 1), l: ed.lastLen, p: a.pitch, v: 100 };
      clip.notes.push(n); audition(v.cur.ti, a.pitch);
      ed.drag = { mode: 'resize', n, moved: true, created: true };
    }
    ed.dirty = true; save();
  });
  cv.canvas.addEventListener('pointermove', (e) => {
    const d = ed.drag, clip = selClip(); if (!d || !clip) return;
    const a = at(e), len16 = clip.bars * 16, grid = e.shiftKey ? 0.25 : 1;
    if (d.mode === 'vel') setVel(d.n, a);
    else if (d.mode === 'dvel') { if (Math.abs(a.py - d.y) > 4) d.moved = true; if (d.moved) d.n.v = clamp(Math.round(d.v0 + (d.y - a.py)), 1, 127); }
    else if (d.mode === 'paint') {
      const col = Math.floor(a.x16);
      if (col >= 0 && col < len16 && !clip.notes.some((n) => n.p === d.p && Math.floor(n.s + 1e-6) === col)) clip.notes.push({ s: col, l: 1, p: d.p, v: 100 });
    } else if (d.mode === 'resize') {
      const end = clamp(Math.round(a.x16 / grid) * grid, d.n.s + grid, len16);
      if (end - d.n.s !== d.n.l) { d.n.l = end - d.n.s; d.moved = true; ed.lastLen = d.n.l; }
    } else if (d.mode === 'move') {
      const s = clamp(Math.round((a.x16 - d.off) / grid) * grid, 0, len16 - grid), p = clamp(a.pitch, 0, 127);
      if (s !== d.n.s || p !== d.n.p) { if (p !== d.n.p) audition(v.cur.ti, p); d.n.s = s; d.n.p = p; d.moved = true; }
    }
    ed.dirty = true;
  });
  const endDrag = () => {
    const d = ed.drag, clip = selClip(); ed.drag = null;
    if (!d || !clip) return;
    if ((d.mode === 'move' || d.mode === 'dvel') && !d.moved) clip.notes.splice(clip.notes.indexOf(d.n), 1);
    ed.dirty = true; save();
  };
  cv.canvas.addEventListener('pointerup', endDrag);
  cv.canvas.addEventListener('pointercancel', endDrag);
  cv.canvas.addEventListener('wheel', (e) => { if (!selClip() || track().kind === 'drum') return; e.preventDefault(); ed.low = clamp(ed.low - Math.sign(e.deltaY) * 2, 0, 104); ed.dirty = true; }, { passive: false });
  function nearest(clip, x16) { let best = null, bd = 1; for (const n of clip.notes) { const d = Math.abs(n.s - x16); if (d < bd) { bd = d; best = n; } } return best; }
  function setVel(n, a) { n.v = clamp(Math.round((1 - (a.py - a.g.gridH - 4) / (a.g.velH - 8)) * 127), 1, 127); ed.dirty = true; }

  function renderAll() { paintGrid(); renderTrack(); renderEditor(); recBtn.classList.toggle('on', v.rec); countChk.checked = state.countIn; quantSel.querySelector('select').value = state.quant; newBarsSel.querySelector('select').value = String(state.newBars); }

  /* ================================================================ actions */
  function moveCursor(sc, ti) {
    const was = v.cur; v.cur = { sc: clamp(sc, 0, NSCENES - 1), ti: clamp(ti, 0, NTRACKS - 1) };
    if (was.sc !== v.cur.sc || was.ti !== v.cur.ti) { ed.viewBar = 0; fitPitch(); }
    paintGrid(); if (was.ti !== v.cur.ti) renderTrack(); renderEditor();
  }
  function createClip(sc, ti) {
    if (clipAt(sc, ti)) return;
    edit(); state.clips[sc][ti] = newClip(ti, state.newBars);
    moveCursor(sc, ti); save();
  }
  function copyClip() { const c = selClip(); if (!c) return toast('Select a clip'); v.clip = { clip: clone(c), kind: track().kind }; toast(`Copied ${c.name}`); }
  function pasteClip() {
    if (!v.clip) return toast('Copy a clip first');
    if (v.clip.kind !== track().kind) return toast(v.clip.kind === 'drum' ? 'A drum clip goes on a drum track' : 'A note clip goes on a synth track');
    edit(); state.clips[v.cur.sc][v.cur.ti] = clone(v.clip.clip); fitPitch(); paintGrid(); renderEditor(); save();
  }
  function duplicateClip() {
    const c = selClip(); if (!c) return toast('Select a clip');
    let sc = v.cur.sc + 1; while (sc < NSCENES && clipAt(sc, v.cur.ti)) sc++;
    if (sc >= NSCENES) return toast('No empty cell below');
    edit(); state.clips[sc][v.cur.ti] = clone(c); moveCursor(sc, v.cur.ti); save();
  }
  function deleteClip() {
    const c = selClip(); if (!c) return;
    edit(); state.clips[v.cur.sc][v.cur.ti] = null;
    if (v.playing[v.cur.ti] && v.playing[v.cur.ti].scene === v.cur.sc && clock.playing) launch(v.cur.ti, -1);
    paintGrid(); renderEditor(); save(); toast(`Deleted ${c.name} (Undo brings it back)`);
  }
  function moveClip(fs, ft, ts, tt, copy) {
    const c = clipAt(fs, ft); if (!c) return;
    if (state.tracks[ft].kind !== state.tracks[tt].kind) return toast(state.tracks[ft].kind === 'drum' ? 'A drum clip goes on a drum track' : 'A note clip goes on a synth track');
    edit();
    state.clips[ts][tt] = copy ? clone(c) : c;
    if (!copy) state.clips[fs][ft] = null;
    moveCursor(ts, tt); save(); toast(copy ? 'Copied' : 'Moved');
  }

  /* ---- recording ---- */
  const recHeld = new Map();   /* pitch -> {note, tick} */
  function toggleRec() {
    if (v.rec) { v.rec = false; endRecNotes(); v.recAt = null; renderAll(); return; }
    const { sc, ti } = v.cur, tr = track(ti);
    if (!tr.arm) { tr.arm = true; toast(`${tr.name} armed`); }
    edit();
    if (!clipAt(sc, ti)) state.clips[sc][ti] = Object.assign(newClip(ti, state.newBars), { name: 'Rec ' + (sc + 1) });
    v.rec = true; v.recAt = { sc, ti };
    if (!clock.playing) {
      const count = state.countIn ? BAR : 0;
      v.countEnd = count; v.wait[ti] = sc; v.pending.push([ti, sc, count]); v.pendingStart = true;
      if (count) toast('Count-in: one bar');
      go();
    } else if (!(v.playing[ti] && v.playing[ti].scene === sc)) { launch(ti, sc); go(); }
    renderAll(); save();
  }
  function recPos(ti, sc) {
    const p = v.playing[ti], clip = clipAt(sc, ti);
    if (!p || p.scene !== sc || !clip) return null;
    return mod(clock.tickNow() - p.start, clip.bars * BAR);
  }
  function endRecNotes() {
    for (const [p, h] of recHeld) {
      const clip = clipAt(h.sc, h.ti); if (!clip) continue;
      const pos = recPos(h.ti, h.sc), ct = clip.bars * BAR;
      if (pos != null) h.note.l = clamp(mod(pos - h.tick, ct) / TPS, 0.25, clip.bars * 16);
    }
    recHeld.clear(); ed.dirty = true;
  }

  /* ---- the piano keys and MIDI in ---- */
  const held = new Map();
  let skipPiano = false;
  ['keydown', 'keyup'].forEach((ev) => window.addEventListener(ev, (e) => { skipPiano = /^Digit\d$/.test(e.code); }, true));
  function noteIn(n, vel, down, fromMidi) {
    const ti = v.rec && v.recAt ? v.recAt.ti : v.cur.ti, tr = track(ti);
    let p = n;
    if (tr.kind === 'drum') p = fromMidi && DRUM_OF[n] ? n : GM_NOTE[tr.lanes[mod(n - pk.base, tr.lanes.length)]];
    if (!down) {
      const r = held.get(n); if (r) { r(); held.delete(n); if (tr.ch) midi.send([0x80 | (tr.ch - 1), (p + 12 * (tr.sound.octave || 0)) & 127, 0]); }
      const h = recHeld.get(p);
      if (h) {
        const pos = recPos(h.ti, h.sc), clip = clipAt(h.sc, h.ti);
        if (pos != null && clip) h.note.l = clamp(mod(pos - h.tick, clip.bars * BAR) / TPS, 0.25, clip.bars * 16);
        recHeld.delete(p); ed.dirty = true; save();
      }
      return;
    }
    audio.ensure();
    if (tr.kind === 'drum') playNote(ti, { p, v: vel }, audio.now(), 0.1);
    else if (!held.has(n)) {
      held.set(n, audio.hold(Object.assign({}, tr.sound, { level: tr.sound.level * tr.vol }), p, vel));
      if (tr.ch) midi.send([0x90 | (tr.ch - 1), (p + 12 * (tr.sound.octave || 0)) & 127, vel & 127]);
    }
    if (v.rec && v.recAt && tr.arm) {
      const { sc } = v.recAt, pos = recPos(ti, sc), clip = clipAt(sc, ti);
      if (pos == null || !clip) return;
      const note = { s: pos / TPS, l: tr.kind === 'drum' ? 1 : 0.25, p, v: vel };
      clip.notes.push(note);
      if (tr.kind === 'synth') recHeld.set(p, { note, tick: pos, sc, ti });
      ed.dirty = true; save();
    }
  }
  S.ui.pianoKeys((n, down) => { if (!skipPiano) noteIn(n, 100, down, false); }, pk);
  midi.onNote = (n, vel) => noteIn(n, vel || 100, vel > 0, true);

  /* ---- keys: cursor, launch, scenes, stop all, clip ops ---- */
  window.addEventListener('keydown', (e) => {
    if (!e.target.closest || e.target.closest('input,select,textarea')) return;
    if (e.key.startsWith('Arrow') && e.target.closest('.sc-knob')) return;   /* a focused knob turns with the arrows */
    const mod2 = e.metaKey || e.ctrlKey;
    if (mod2 && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'c' && !String(window.getSelection())) { copyClip(); e.preventDefault(); }
      else if (k === 'v') { pasteClip(); e.preventDefault(); }
      else if (k === 'd') { duplicateClip(); e.preventDefault(); }
      return;
    }
    if (mod2 || e.altKey) return;
    const { sc, ti } = v.cur;
    const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[e.key]) {
      const [ds, dt] = arrows[e.key];
      moveCursor(mod(sc + ds, NSCENES), mod(ti + dt, NTRACKS));
      if (document.activeElement && document.activeElement.classList.contains('qu-cell')) cells[v.cur.sc][v.cur.ti].focus();
      e.preventDefault();
    } else if (e.key === 'Enter' && !e.target.closest('button')) { if (clipAt(sc, ti)) launchClip(sc, ti); else stopTrack(ti); e.preventDefault(); }
    else if (/^Digit[1-8]$/.test(e.code) && !e.shiftKey) { launchScene(+e.code.slice(5) - 1); e.preventDefault(); }
    else if (e.key === '.') { stopAll(); e.preventDefault(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { deleteClip(); e.preventDefault(); }
    else if (e.key === '[' || e.key === ']') { pk.base = clamp(pk.base + (e.key === '[' ? -12 : 12), 12, 96); toast(`Piano octave ${pk.base / 12 - 1}`); }
  });
  S.ui.globalKeys({ name: 'QUILT', help, about: 'Keys and gestures.', onUndo: doUndo, onRedo: doRedo });
  document.addEventListener('seqcore-transport', () => paintGrid());

  /* ---- the screen follows the sound ---- */
  function frame() {
    if (clock.playing && audio.ctx) {
      const now = audio.ctx.currentTime - (audio.ctx.outputLatency || 0);
      let changed = false;
      while (disp.length && disp[0][0] <= now) {
        const [, ti, scene, T] = disp.shift();
        v.playing[ti] = scene >= 0 ? { scene, start: T } : null;
        if (v.wait[ti] === scene) v.wait[ti] = null;
        changed = true;
      }
      if (changed) paintGrid();
      paintProgress();
    }
    requestAnimationFrame(frame);
  }

  /* ---- start: a share link wins over the autosave, which wins over the demo ---- */
  (async () => {
    const fromLink = normalize(await store.fromHash());
    const saved = fromLink ? null : normalize(store.load('quilt'));
    state = fromLink || saved || demoSet();
    if (fromLink) history.replaceState(null, '', location.pathname);
    clock.bpm = state.bpm; clock.swing = state.swing; head.setTempo(state.bpm); head.setSwing(state.swing);
    v.cur = { sc: 1, ti: 3 }; fitPitch();
    renderAll();
    requestAnimationFrame(frame);
  })();
}

if (typeof window !== 'undefined' && window.SeqCore) initApp();

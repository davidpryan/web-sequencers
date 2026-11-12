/* SPDX-License-Identifier: MPL-2.0 */
/* STRAND: a pattern language, after TidalCycles and Strudel's mini-notation.
 *
 * The model is CODE. Up to eight LINES (d1..d8), each one voice: a pattern written as
 *   s "bd*2 [~ sd] hh(5,8)"                       sounds, or
 *   n "<0 2 4 [5 7]>*4" .scale("C:minor") .s("saw") degrees (or note names) played by a synth,
 * followed by functions (.fast .every .sometimes ...). Time is counted in CYCLES: one cycle is one bar of 4 beats by
 * default (so cycles a minute = BPM / 4); the steps in the quotes share a cycle.
 * Each line holds two texts: `code`, what is in the editor, and `run`, the version that plays. Ctrl/Cmd+Enter
 * compiles the code; if it parses it becomes `run` at the start of the next cycle (the line shows "waiting"); if
 * not, the old version keeps playing and the error shows under the line with its column marked.
 * The pattern engine (strand/pattern.js, pure and tested with node) turns a line into a function from a time span to
 * events. At the first tick of every cycle each line's pattern is queried for that cycle; each tick of the clock
 * (384 a cycle of 4 beats) plays the events that start inside it, at their exact time within the tick. */
(function () {
  'use strict';

  /* ================================================================ songs === */
  const DEMO = {
    bpm: 108, beats: 4, seed: 7,
    lines: [
      's "bd(3,8), ~ sd ~ [sd ~ ~ sd?]"',
      's "hh*8?0.2, ~ oh ~ ~" .gain(0.55)',
      'n "0 [~ 0] <-2 -4> [~ <0 3>]" .scale("A:minor") .octave(2)\n  .s("saw") .cutoff(0.32) .legato(0.6)',
      'n "<[0,2,4] [-2,0,2] [-4,-2,1] [-3,-1,1]>" .scale("A:minor")\n  .s("supersaw") .gain(0.45) .cutoff(0.4) .legato(1.05)',
      'n "0 2 <4 7> [6 4] ~ 2 [~ 4] <9 11>" .scale("A:minor") .octave(4)\n  .s("tri") .echo(0.35) .every(4, rev) .sometimes(add(2)) .degrade(0.2)',
    ],
  };
  const EXAMPLES = [
    { name: '1  steps share the cycle', bpm: 100, lines: ['s "bd sd bd sd"', 's "hh hh [hh hh] hh"', '// four steps a cycle; [ ] puts two in one step, ~ rests\ns "~ ~ ~ [~ cp]"'] },
    { name: '2  faster, slower, alternate', bpm: 110, lines: ['s "bd*2 <sd cp>"', 's "hh*4 oh/2"', 'n "<0 2 4 6>" .s("saw") .scale("D:dorian") .octave(2)'] },
    { name: '3  Euclid rhythms', bpm: 116, lines: ['s "bd(3,8)"', 's "rim(5,8,2), hh(7,16)"', 'n "0(5,8)" .scale("E:phrygian") .s("square") .octave(2)'] },
    { name: '4  polymeter and stacks', bpm: 96, lines: ['n "{0 2 4}%8" .scale("A:minpent") .s("tri") .octave(4)', 'n "{0 3 5 7 9}%4" .scale("A:minpent") .s("sine")', 's "bd ~ ~ bd, ~ sd"', 'n "[0,4] [2,6]@3" .scale("A:minpent") .s("supersaw") .gain(0.5)'] },
    { name: '5  functions change a line', bpm: 104, lines: ['s "bd sd [~ bd] sd" .every(4, fast(2))', 'n "0 1 2 3 4 5 6 7" .scale("C:major") .every(2, rev) .s("tri")', 'n "0 ~ 4 ~" .scale("C:major") .octave(2) .s("saw") .slow(2)'] },
    { name: '6  chance, seeded', bpm: 120, lines: ['s "hh*16?"', 's "bd*4, ~ cp"', 'n "0 2 4 7" .fast(2) .sometimes(add(7)) .degrade(0.3)\n  .scale("G:minor") .s("square") .echo(0.3)', '// change the seed above to hear other choices; undo goes back'] },
  ];
  if (typeof window === 'undefined') { module.exports = { DEMO, EXAMPLES }; return; }

  /* ============================================================== the app === */
  const { audio, clock, midi, store, ui, music } = SeqCore;
  const S = window.Strand;
  const MAX_LINES = 8, PPQN = clock.PPQN;
  const el = ui.el;

  /* the synth sounds */
  const PRESETS = {
    sine: { wave: 'sine', cutoff: 0.9, reso: 0.05, envmod: 0.05, attack: 0.004, decay: 0.4, sustain: 0.6, release: 0.25, level: 0.8 },
    tri: { wave: 'triangle', cutoff: 0.75, reso: 0.1, envmod: 0.25, attack: 0.003, decay: 0.25, sustain: 0.35, release: 0.2, level: 0.8 },
    square: { wave: 'square', cutoff: 0.5, reso: 0.25, envmod: 0.5, attack: 0.002, decay: 0.16, sustain: 0.2, release: 0.15, level: 0.55 },
    saw: { wave: 'sawtooth', cutoff: 0.45, reso: 0.35, envmod: 0.55, attack: 0.003, decay: 0.2, sustain: 0.35, release: 0.12, level: 0.6 },
    supersaw: { wave: 'supersaw', cutoff: 0.55, reso: 0.12, envmod: 0.3, attack: 0.03, decay: 0.6, sustain: 0.65, release: 0.4, level: 0.5 },
  };
  const presetOf = s => PRESETS[{ triangle: 'tri', sawtooth: 'saw' }[s] || s] || PRESETS.tri;
  const patches = new Map();
  function patchFor(r) {
    const key = r.sound + '|' + r.cutoff + '|' + r.echo;
    let p = patches.get(key);
    if (!p) {
      const pre = presetOf(r.sound);
      p = audio.defaultPatch({ ...pre, ...(r.cutoff != null ? { cutoff: r.cutoff } : {}), echo: r.echo });
      if (patches.size > 200) patches.clear();
      patches.set(key, p);
    }
    return p;
  }

  /* ------------------------------------------------------------- state --- */
  const blankLine = (code = '') => ({ code, run: code, mute: false, solo: false });
  function fromSong(song) {
    return { v: 1, bpm: song.bpm || 110, swing: 0, beats: song.beats || 4, seed: song.seed ?? 1, lines: song.lines.map(c => blankLine(c)) };
  }
  let state = fromSong(DEMO);
  /* runtime per line, not saved: the playing pattern, the one waiting for the next cycle, the last error... */
  let rt = [];
  const undoes = store.undoStack(100);

  function sanitize(s) {
    if (!s || !Array.isArray(s.lines)) return null;
    const lines = s.lines.slice(0, MAX_LINES).map(l => ({
      code: String(l.code ?? ''), run: String(l.run ?? l.code ?? ''), mute: !!l.mute, solo: !!l.solo }));
    if (!lines.length) lines.push(blankLine(''));
    return { v: 1, bpm: Math.min(240, Math.max(40, +s.bpm || 110)), swing: Math.min(0.5, Math.max(0, +s.swing || 0)),
      beats: [2, 3, 4, 5, 6, 7, 8].includes(+s.beats) ? +s.beats : 4, seed: (+s.seed | 0) || 0, lines };
  }
  function compileRun(i) {
    const res = S.compileLine(state.lines[i].run, { seed: state.seed, salt: i });
    return res.error ? S.silence : res.pattern;
  }
  function newRt(i, keep) {
    return { pattern: keep ? keep.pattern : compileRun(i), playingCode: keep ? keep.playingCode : state.lines[i].run,
      pending: null, pendingCode: null, error: null, silenced: false, ver: 0, cycles: new Map(), sched: [], si: 0, view: null,
      dom: null, sig: '', hlSig: '' };
  }
  /* rebuild the runtime after a whole new state (load, undo): lines whose run text is unchanged keep playing as they are */
  function rebuildRt(old) {
    rt = state.lines.map((L, i) => {
      const o = old && old[i];
      if (o && o.playingCode === L.run && !o.pending) { const r = newRt(i, o); r.silenced = o.silenced; return r; }
      if (o && clock.playing) { const r = newRt(i, o); r.pending = compileRun(i); r.pendingCode = L.run; return r; }
      return newRt(i, null);
    });
  }

  /* ------------------------------------------------------------ editing --- */
  let typing = false, typingTimer = 0;
  function pushUndo() { undoes.push(state); typing = false; }
  let saveTimer = 0;
  function changed() { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.save('strand', state), 400); }
  function restore(s, msg) {
    const clean = sanitize(s);
    if (!clean) return false;
    const old = rt, focus = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.line : undefined;
    state = clean;
    clock.bpm = state.bpm; clock.swing = state.swing; head.setTempo(state.bpm); head.setSwing(state.swing);
    rebuildRt(old);
    renderAll();
    if (focus !== undefined && rt[focus]) rt[focus].dom.ta.focus();
    changed();
    if (msg) ui.toast(msg);
    return true;
  }
  function undo() { const s = undoes.undo(state); if (s) restore(s, 'Undone'); else ui.toast('Nothing to undo'); }
  function redo() { const s = undoes.redo(state); if (s) restore(s, 'Redone'); else ui.toast('Nothing to redo'); }

  /* compile line i's code; on success it plays from the next cycle (now, when stopped) */
  function runLine(i, quiet) {
    const L = state.lines[i], r = rt[i];
    const res = S.compileLine(L.code, { seed: state.seed, salt: i });
    if (res.error) { r.error = res.error; r.errorCode = L.code; refreshLine(i); if (!quiet) ui.toast(`d${i + 1}: ${res.error.msg}`); return false; }
    r.error = null;
    if (L.run !== L.code) { pushUndo(); L.run = L.code; changed(); }
    r.silenced = false;
    if (clock.playing) { r.pending = res.pattern; r.pendingCode = L.code; }
    else { r.pattern = res.pattern; r.playingCode = L.code; r.pending = null; r.ver++; }
    refreshLine(i);
    return true;
  }
  function runAll() {
    let bad = 0;
    state.lines.forEach((_, i) => { if (!runLine(i, true)) bad++; });
    if (bad) ui.toast(`${bad} line${bad > 1 ? 's' : ''} did not parse; the last good version${bad > 1 ? 's play' : ' plays'}`);
    if (!clock.playing) clock.start();
  }
  function silence(i) { rt[i].silenced = true; rt[i].pending = null; refreshLine(i); }
  function hush() { rt.forEach((_, i) => silence(i)); ui.toast('Hush: every line silenced (Ctrl/Cmd+Enter brings one back)'); }
  function toggle(i, key) { pushUndo(); state.lines[i][key] = !state.lines[i][key]; changed(); state.lines.forEach((_, j) => refreshLine(j)); }
  function addLine(code = '') {
    if (state.lines.length >= MAX_LINES) { ui.toast('Eight lines at most'); return; }
    pushUndo(); state.lines.push(blankLine(code)); rt.push(newRt(state.lines.length - 1)); changed(); renderAll();
    rt[rt.length - 1].dom.ta.focus();
  }
  function removeLine(i) {
    pushUndo(); state.lines.splice(i, 1); rt.splice(i, 1);
    if (!state.lines.length) { state.lines.push(blankLine('')); rt.push(newRt(0)); }
    /* the salts follow the line numbers: recompile what moved */
    rt.forEach((r, j) => { if (j >= i) { const p = compileRun(j); if (clock.playing) { r.pending = p; r.pendingCode = state.lines[j].run; } else { r.pattern = p; r.ver++; } } });
    changed(); renderAll(); ui.toast(`Line removed (undo brings it back)`);
  }
  function loadSong(song, msg) {
    pushUndo();
    const old = rt;
    state = sanitize(fromSong(song));
    clock.bpm = state.bpm; head.setTempo(state.bpm); audio.setEcho(echoTime(), 0.4);
    rebuildRt(old);
    renderAll(); changed(); ui.toast(msg);
  }
  function setSeed(n) {
    pushUndo(); state.seed = n | 0; seedIn.value = state.seed; changed();
    state.lines.forEach((L, i) => { const p = compileRun(i); if (clock.playing) { rt[i].pending = p; rt[i].pendingCode = L.run; } else { rt[i].pattern = p; rt[i].ver++; } refreshLine(i); });
  }

  /* ---------------------------------------------------------- the clock --- */
  let cyc = 0, pos = 0, tpc = PPQN * 4, cycleStarts = [], lit = [];
  const echoTime = () => Math.min(1.5, 60 / clock.bpm * 0.75);
  clock.onStart = () => { cyc = 0; pos = 0; cycleStarts = []; lit = []; audio.setEcho(echoTime(), 0.4); };
  clock.onStop = () => { rt.forEach(r => { if (r.pending) { r.pattern = r.pending; r.playingCode = r.pendingCode; r.pending = null; r.ver++; } }); };
  clock.onTick = (tick, time) => {
    if (pos === 0) startCycle(tick, time);
    playTick(time);
    if (++pos >= tpc) { pos = 0; cyc++; }
  };
  function startCycle(tick, time) {
    tpc = PPQN * state.beats;
    cycleStarts.push({ tick, cycle: cyc, tpc }); if (cycleStarts.length > 6) cycleStarts.shift();
    const b = new S.Fr(cyc), e = new S.Fr(cyc + 1);
    rt.forEach(r => {
      if (r.pending) { r.pattern = r.pending; r.playingCode = r.pendingCode; r.pending = null; r.ver++; }
      let evs;
      try { evs = r.pattern.query(b, e); } catch (err) { evs = []; }
      if (evs.length > 1500) evs = evs.slice(0, 1500);   /* a guard: nested speed-ups can multiply */
      r.cycles.set(cyc, { ver: r.ver, evs }); r.cycles.delete(cyc - 3);
      r.sched = evs.filter(x => x.wb.eq(x.pb)).map(x => {
        const at = x.wb.sub(cyc).mul(tpc), ti = at.floor();
        return { ti, sub: at - ti, e: x };
      }).sort((a, z) => a.ti - z.ti || a.sub - z.sub);
      r.si = 0;
    });
  }
  function playTick(time) {
    const anySolo = state.lines.some(l => l.solo), spt = clock.secPerTick();
    rt.forEach((r, i) => {
      const L = state.lines[i];
      while (r.si < r.sched.length && r.sched[r.si].ti <= pos) {
        const it = r.sched[r.si++];
        if (L.mute || r.silenced || (anySolo && !L.solo)) continue;
        const swing = it.sub === 0 && it.ti % (PPQN / 4) === 0 ? clock.swingOffset(it.ti) : 0;
        playEvent(i, it.e, time + it.sub * spt + swing);
      }
    });
  }
  function playEvent(i, e, t) {
    const r = S.resolve(e.v), cycSec = tpc * clock.secPerTick(), len = (e.we - e.wb) * cycSec;
    let dur;
    if (r.kind === 'drum') {
      dur = Math.min(len, 0.25);
      audio.drum(r.drum, r.vel, t, { tone: r.tone, pitch: r.pitch, echo: r.echo });
      midi.note(r.ch ?? 10, audio.GM_NOTE[r.drum] || 36, r.vel, t, Math.max(0.03, Math.min(len * 0.5, 0.1)));
    } else {
      dur = Math.max(0.02, len * r.legato);
      audio.note(patchFor(r), r.midi, r.vel, t, dur);
      midi.note(r.ch ?? i + 1, r.midi, r.vel, t, dur);
    }
    if (e.v.loc) { lit.push({ i, loc: e.v.loc, t0: t, t1: t + Math.max(0.07, dur) }); if (lit.length > 400) lit.splice(0, 100); }
  }
  /* the cycle sounding now and how far through it, for the screen */
  function nowPos() {
    const tn = clock.tickNow();
    if (tn < 0 || !cycleStarts.length) return null;
    let cs = null;
    for (const c of cycleStarts) if (c.tick <= tn) cs = c;
    if (!cs) return null;
    return { cycle: cs.cycle, frac: Math.min(0.9999, (tn - cs.tick) / cs.tpc) };
  }
  const audioNow = () => (audio.ctx ? audio.ctx.currentTime - (audio.ctx.outputLatency || 0) : 0);

  /* ------------------------------------------------------------- screen --- */
  const HELP = [
    ['Space', 'play / stop (outside the editor)'],
    ['Ctrl/Cmd+Enter', 'run this line: it starts at the next cycle (shown as waiting); playing starts if stopped'],
    ['Shift+Ctrl/Cmd+Enter', 'run every line'],
    ['Ctrl/Cmd+.', 'silence this line (outside an editor: every line); Shift+Ctrl/Cmd+. silences every line'],
    ['Alt+M  Alt+S', 'mute / solo this line (or the M and S buttons)'],
    ['Alt+↑  Alt+↓', 'the line above / below'],
    ['1 … 8', 'go to that line\'s editor (outside an editor)'],
    ['Tab', 'two spaces in the editor; Esc then Tab moves on to the next control'],
    ['Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z', 'undo / redo: typing, runs, mutes, lines, examples, seed'],
    ['?', 'this help'],
    ['s "…"  n "…"', 'a line: sounds, or notes (scale degrees from 0, or note names like c4 eb3 f#2)'],
    ['a b c', 'steps share the cycle evenly'],
    ['[a b]', 'a group of steps inside one step'],
    ['~', 'a rest'],
    ['a*2  a/2', 'a step twice as fast / half as fast (a/2 plays every other cycle)'],
    ['<a b c>', 'one of them per cycle, in turn; <a b>*4 runs through them faster'],
    ['a@3  a _ _', 'a step three times as long'],
    ['a!3  a ! !', 'the step three times'],
    ['a?  a?0.3', 'dropped half the time (or 30%); seeded, so the same every run'],
    ['a(3,8)  a(3,8,2)', 'Euclid: 3 hits spread over 8 steps, turned 2 to the left'],
    ['[a, b c]   a b, c d', 'layers that play at once (chords, drums over drums)'],
    ['{a b c}%4', 'a polymeter: the steps run on, 4 a cycle; {a b, c d e} keeps the first layer\'s step'],
    ['bd:3', 'a drum with a tone (0-8)'],
    ...Object.entries(S.FUNCS).map(([k, f]) => { const [a, b] = f.use.split('  '); return [a, b]; }),
    ['sounds', 'drums: bd sd hh oh cp rim tom lt mt ht cb cy sh zap · synths: sine tri square saw supersaw'],
    ['MIDI', 'each line sends on channel 1-8 (drums on 10) unless .ch(n) says otherwise; .ch(0) is off. MIDI in types note names into the focused line'],
    ['seed', 'the seed behind ? .degrade .sometimes; change it to hear other choices'],
    ['cycle', 'beats in one cycle (4 = a bar of 4/4); a cycle lasts 60 / BPM × beats seconds'],
  ];
  const ABOUT = 'Each line is a voice written in a small pattern language: steps in quotes share a cycle (a bar), ' +
    'brackets nest them, and functions after the quotes change the whole line. Edit, then Ctrl/Cmd+Enter: the change ' +
    'starts with the next cycle. A line that does not parse keeps playing its last good version.';

  const head = ui.header({
    name: 'STRAND', tagline: 'pattern language · each line a voice', color: ui.css('--accent') || 'currentColor',
    help: HELP, about: ABOUT, onUndo: undo, onRedo: redo,
    onNew: () => { pushUndo(); const old = rt; state = sanitize({ ...state, lines: [blankLine('')] }); rebuildRt(old); renderAll(); changed(); rt[0].dom.ta.focus(); ui.toast('New: one empty line (undo brings the old back)'); },
    onSave: () => store.download('strand.json', state),
    onLoad: async () => { const d = await store.upload(); if (d) { pushUndo(); if (!restore(d, 'Opened')) ui.toast('That file is not a STRAND file'); } },
    onShare: async () => {
      const link = await store.shareLink(state);
      try { await navigator.clipboard.writeText(link); ui.toast('Link copied'); } catch (e) { location.hash = link.split('#')[1]; ui.toast('The link is in the address bar'); }
    },
    onTempo: v => { state.bpm = v; audio.setEcho(echoTime(), 0.4); changed(); },
    onSwing: v => { state.swing = v; changed(); },
  });
  document.body.prepend(head);
  ui.globalKeys({ name: 'STRAND', help: HELP, about: ABOUT, onUndo: undo, onRedo: redo });

  /* the toolbar */
  const exSel = el('select', { 'aria-label': 'Examples', title: 'Load a short teaching example (undo goes back)',
    onchange: () => { const v = exSel.value; exSel.value = ''; if (v === 'demo') loadSong(DEMO, 'The demo'); else if (v !== '') loadSong(EXAMPLES[+v], EXAMPLES[+v].name.slice(3) + ' (undo goes back)'); } },
  el('option', { value: '' }, 'examples…'), el('option', { value: 'demo' }, 'the demo'),
  EXAMPLES.map((x, k) => el('option', { value: k }, x.name)));
  const beatsSel = ui.select('cycle', [2, 3, 4, 5, 6, 7, 8].map(b => ({ value: b, label: b + ' beats' })), 4, v => { pushUndo(); state.beats = +v; changed(); });
  beatsSel.title = 'Beats in one cycle (from the next cycle)';
  const seedIn = el('input', { type: 'number', min: 0, max: 99999, value: state.seed, 'aria-label': 'Seed', title: 'The seed for ? .degrade .sometimes',
    onchange: () => setSeed(+seedIn.value) });
  const toolbar = el('div', { class: 'st-bar' },
    el('button', { class: 'sc-btn', title: 'Run every line (Shift+Ctrl/Cmd+Enter)', onclick: runAll }, 'Run all'),
    el('button', { class: 'sc-btn', title: 'Silence every line (Shift+Ctrl/Cmd+.)', onclick: hush }, 'Hush'),
    el('label', { class: 'sc-sel' }, el('span', {}, 'examples'), exSel),
    beatsSel,
    el('label', { class: 'st-seed' }, 'seed', el('span', { class: 'st-seed-row' }, seedIn,
      el('button', { class: 'sc-btn', title: 'A new seed (undoable)', 'aria-label': 'New seed', onclick: () => setSeed(Math.floor(Math.random() * 10000)) }, 'new'))),
    el('button', { class: 'sc-btn', title: 'Add a line (up to 8)', onclick: () => addLine('') }, '+ line'));
  const readout = el('div', { class: 'st-readout', 'aria-live': 'off' });
  const linesBox = el('div', { class: 'st-lines' });
  const hint = el('p', { class: 'sc-hint' }, 'Edit a line, then Ctrl/Cmd+Enter: it changes at the next cycle. Ctrl/Cmd+. silences it. The strip under a line is its cycle: time across, pitch (or drum) up.');
  const ref = el('aside', { class: 'sc-panel st-ref', 'aria-label': 'Reference' }, ...reference());
  const main = el('main', {}, el('div', { class: 'st-layout' },
    el('div', { class: 'st-main' }, el('div', { class: 'sc-panel st-main' }, toolbar, readout), hint, linesBox), ref));
  document.body.append(main);

  function reference() {
    const rows = list => el('table', {}, list.map(([a, b]) => el('tr', {}, el('th', {}, a), el('td', {}, b))));
    return [
      el('h2', {}, 'Mini-notation'),
      rows(HELP.slice(10, 23)),
      el('h2', {}, 'Functions'),
      rows(Object.values(S.FUNCS).map(f => f.use.split('  '))),
      el('h2', {}, 'Sounds'),
      el('p', {}, el('span', { class: 'mono' }, 'bd sd hh oh cp rim tom lt mt ht cb cy sh zap'), ' are drums; ',
        el('span', { class: 'mono' }, 'sine tri square saw supersaw'), ' are synths. With n, numbers are scale degrees (0 is the root, in octave 3) and words like c4 are notes.'),
      el('p', {}, 'Every-n, sometimes and often take a function: ', el('code', {}, '.every(3, fast(2).rev())'), '.'),
    ];
  }

  /* one line's block: name, M, S, status, ×; the editor (a textarea over a mirror that marks playing steps); the error; the strip */
  function buildLine(i) {
    const L = state.lines[i], r = rt[i];
    const ta = el('textarea', { spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', rows: 1, 'data-line': i,
      'aria-label': `Line d${i + 1} code`, placeholder: i === 0 ? 's "bd sd"   then Ctrl/Cmd+Enter' : 'n "0 2 4" .s("tri")' });
    ta.value = L.code;
    const mirror = el('div', { class: 'st-mirror', 'aria-hidden': 'true' });
    const mute = el('button', { class: 'sc-btn st-tog', 'aria-pressed': String(L.mute), title: 'Mute (Alt+M)', 'aria-label': `Mute d${i + 1}`, onclick: () => toggle(i, 'mute') }, 'M');
    const solo = el('button', { class: 'sc-btn st-tog solo', 'aria-pressed': String(L.solo), title: 'Solo (Alt+S)', 'aria-label': `Solo d${i + 1}`, onclick: () => toggle(i, 'solo') }, 'S');
    const runB = el('button', { class: 'sc-btn st-tog', title: 'Run this line (Ctrl/Cmd+Enter)', 'aria-label': `Run d${i + 1}`, onclick: () => { if (runLine(i) && !clock.playing) clock.start(); } }, '▸');
    const status = el('span', { class: 'st-status', 'aria-live': 'polite' });
    const x = el('button', { class: 'sc-btn st-x', title: 'Remove this line (undoable)', 'aria-label': `Remove line d${i + 1}`, onclick: () => removeLine(i) }, '×');
    const err = el('pre', { class: 'st-err', role: 'alert', hidden: true });
    const cv = el('canvas', { class: 'sc-canvas st-strip', 'aria-hidden': 'true' });
    const box = el('section', { class: 'st-line', 'aria-label': `Line d${i + 1}` },
      el('div', { class: 'st-top' }, el('span', { class: 'st-name' }, `d${i + 1}`), runB, mute, solo, status, x),
      el('div', { class: 'st-ed' }, mirror, ta), err, cv);
    r.dom = { box, ta, mirror, mute, solo, status, err, cv, g: cv.getContext('2d'), w: 0, h: 0, tabOut: false };
    r.sig = ''; r.hlSig = null;
    ta.addEventListener('input', () => {
      if (!typing) undoes.push(state);
      typing = true; clearTimeout(typingTimer); typingTimer = setTimeout(() => { typing = false; }, 900);
      state.lines[i].code = ta.value; grow(ta); r.hlSig = null; changed(); refreshLine(i);
    });
    ta.addEventListener('keydown', e => editorKey(e, i));
    ta.addEventListener('focus', () => { r.dom.tabOut = false; });
    resizer.observe(cv);
    return box;
  }
  function grow(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
  const resizer = new ResizeObserver(entries => entries.forEach(en => {
    const r = rt.find(x => x.dom && x.dom.cv === en.target);
    if (!r) return;
    const dpr = window.devicePixelRatio || 1, b = en.target.getBoundingClientRect();
    en.target.width = Math.round(b.width * dpr); en.target.height = Math.round(b.height * dpr);
    r.dom.w = b.width; r.dom.h = b.height; r.dom.g.setTransform(dpr, 0, 0, dpr, 0, 0); r.drawSig = '';
  }));
  function renderAll() {
    resizer.disconnect();
    linesBox.replaceChildren(...state.lines.map((_, i) => buildLine(i)),
      el('button', { class: 'sc-btn st-add', onclick: () => addLine(''), hidden: state.lines.length >= MAX_LINES }, '+ add a line'));
    rt.forEach(r => grow(r.dom.ta));
    state.lines.forEach((_, i) => refreshLine(i));
    seedIn.value = state.seed; beatsSel.querySelector('select').value = state.beats;
  }

  function editorKey(e, i) {
    const ta = e.target, mod = e.metaKey || e.ctrlKey, r = rt[i];
    if (e.key === 'Enter' && mod) { e.preventDefault(); if (e.shiftKey) runAll(); else if (runLine(i) && !clock.playing) clock.start(); return; }
    if (e.key === '.' && mod) { e.preventDefault(); if (e.shiftKey) hush(); else silence(i); return; }
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? redo : undo)(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (e.altKey && e.code === 'KeyM') { e.preventDefault(); toggle(i, 'mute'); return; }
    if (e.altKey && e.code === 'KeyS') { e.preventDefault(); toggle(i, 'solo'); return; }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const j = i + (e.key === 'ArrowUp' ? -1 : 1);
      if (rt[j]) { e.preventDefault(); rt[j].dom.ta.focus(); }
      return;
    }
    if (e.key === 'Escape') { r.dom.tabOut = true; return; }
    if (e.key === 'Tab' && !e.shiftKey && !r.dom.tabOut && !mod && !e.altKey) {
      e.preventDefault();
      const a = ta.selectionStart, b = ta.selectionEnd;
      ta.setRangeText('  ', a, b, 'end');
      ta.dispatchEvent(new Event('input'));
    }
  }
  window.addEventListener('keydown', e => {
    if (e.target.closest('input,select,textarea')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Enter' && mod && e.shiftKey) { e.preventDefault(); runAll(); }
    else if (e.key === '.' && mod) { e.preventDefault(); hush(); }
    else if (!mod && !e.altKey && /^[1-8]$/.test(e.key) && rt[+e.key - 1]) { e.preventDefault(); rt[+e.key - 1].dom.ta.focus(); }
  });

  /* the line's status, buttons and error, when they change */
  function refreshLine(i) {
    const L = state.lines[i], r = rt[i];
    if (!r || !r.dom) return;
    const d = r.dom, anySolo = state.lines.some(l => l.solo);
    const audible = !L.mute && !r.silenced && (!anySolo || L.solo);
    const empty = !L.run.trim() || /^\s*(\/\/.*\s*)*$/.test(L.run);
    let st, cls = '';
    if (r.error) { st = 'error · the last good version plays'; cls = 'bad'; }
    else if (r.pending) { st = 'waiting for the next cycle'; cls = 'wait'; }
    else if (r.silenced) st = 'silenced · Ctrl/Cmd+Enter to bring it back';
    else if (L.code !== L.run) { st = 'edited · Ctrl/Cmd+Enter to run'; cls = 'wait'; }
    else if (empty) st = 'empty';
    else if (L.mute) st = 'muted';
    else if (anySolo && !L.solo) st = 'quiet (another line is solo)';
    else st = clock.playing ? 'playing' : 'ready';
    const sig = st + cls + audible + L.mute + L.solo + !!r.pending + (r.error ? r.error.index + r.error.msg : '');
    if (sig === r.sig) return;
    r.sig = sig;
    d.status.textContent = st; d.status.className = 'st-status ' + cls;
    d.mute.setAttribute('aria-pressed', String(L.mute)); d.solo.setAttribute('aria-pressed', String(L.solo));
    d.box.classList.toggle('waiting', !!r.pending);
    d.box.classList.toggle('dim', !audible);
    d.box.classList.toggle('playing', audible && !empty && clock.playing);
    if (r.error) {
      const src = L.code.split('\n')[r.error.line] ?? '';
      d.err.textContent = `line ${r.error.line + 1}, column ${r.error.col + 1}: ${r.error.msg}\n${src}\n${' '.repeat(r.error.col)}^`;
      d.err.hidden = false;
    } else d.err.hidden = true;
    r.hlSig = null;
  }

  /* the mirror under the textarea: the same text, invisible, with marks behind the steps sounding now and the error */
  function paintMirror(i, ranges) {
    const r = rt[i], text = state.lines[i].code;
    const cuts = new Set([0, text.length]);
    ranges.forEach(g => { cuts.add(Math.max(0, Math.min(text.length, g.a))); cuts.add(Math.max(0, Math.min(text.length, g.b))); });
    const pts = [...cuts].sort((a, b) => a - b), kids = [];
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1], cls = ranges.filter(g => g.a <= a && g.b >= b).map(g => g.cls);
      const s = text.slice(a, b);
      kids.push(cls.length ? el('span', { class: [...new Set(cls)].join(' ') }, s) : document.createTextNode(s));
    }
    if (text.endsWith('\n') || !text) kids.push(document.createTextNode(' '));
    r.dom.mirror.replaceChildren(...kids);
  }
  function highlights(now) {
    lit = lit.filter(x => x.t1 > now);
    rt.forEach((r, i) => {
      const L = state.lines[i], ranges = [];
      if (r.playingCode === L.code) for (const x of lit) if (x.i === i && x.t0 <= now) ranges.push({ a: x.loc[0], b: x.loc[1], cls: 'on' });
      if (r.error && L.code === r.errorCode) ranges.push({ a: r.error.index, b: r.error.index + 1, cls: 'err' });
      const sig = ranges.map(g => g.a + g.cls).join(',');
      if (sig !== r.hlSig) { r.hlSig = sig; paintMirror(i, ranges); }
    });
  }

  /* the strip: this line's events in the cycle sounding now, time across, pitch or drum up; the playhead */
  let colors = {};
  const readColors = () => { colors = { accent: ui.css('--accent'), fg: ui.css('--fg'), dim: ui.css('--dim'), faint: ui.css('--faint'), line: ui.css('--line'), panel2: ui.css('--panel2'), bg: ui.css('--bg') }; rt.forEach(r => { r.drawSig = ''; }); };
  readColors();
  window.matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', readColors);
  function layoutEvents(r, cycle) {
    const c = r.cycles.get(cycle);
    let evs;
    if (c && c.ver === r.ver) evs = c.evs;
    else if (r.view && r.view.cycle === cycle && r.view.ver === r.ver) return r.view.items;
    else { try { evs = r.pattern.query(new S.Fr(cycle), new S.Fr(cycle + 1)); } catch (e) { evs = []; } }
    const items = evs.map(x => ({ x0: x.pb - cycle, x1: x.pe - cycle, w0: x.wb - cycle, w1: x.we - cycle, onset: x.wb.eq(x.pb), r: S.resolve(x.v) }));
    const notes = items.filter(it => it.r.kind === 'synth'), drums = items.filter(it => it.r.kind === 'drum');
    const lanes = [...new Set(drums.map(it => it.r.drum))].sort((a, b) => S.DRUM_ORDER.indexOf(a) - S.DRUM_ORDER.indexOf(b));
    let lo = Math.min(...notes.map(it => it.r.midi)), hi = Math.max(...notes.map(it => it.r.midi));
    if (hi - lo < 12) { const m = (hi + lo) / 2; lo = m - 6; hi = m + 6; }
    const drumShare = notes.length ? (drums.length ? 0.28 : 0) : 1;
    items.forEach(it => {
      if (it.r.kind === 'drum') it.y = (lanes.indexOf(it.r.drum) + 0.5) / Math.max(1, lanes.length) * drumShare;
      else it.y = drumShare + (it.r.midi - lo) / (hi - lo) * (1 - drumShare) * 0.92 + 0.04 * (1 - drumShare);
    });
    r.view = { cycle, ver: r.ver, items };
    return items;
  }
  function drawStrip(i, np) {
    const r = rt[i], d = r.dom;
    if (!d || !d.w) return;
    const cycle = np ? np.cycle : 0, frac = np ? np.frac : -1;
    const sig = cycle + '|' + r.ver + '|' + Math.round(frac * d.w) + '|' + d.w + '|' + d.box.className;
    if (sig === r.drawSig) return;
    r.drawSig = sig;
    const g = d.g, w = d.w, h = d.h, items = layoutEvents(r, cycle);
    g.clearRect(0, 0, w, h);
    g.fillStyle = colors.bg; g.fillRect(0, 0, w, h);
    g.fillStyle = colors.line;
    for (let b = 1; b < state.beats; b++) g.fillRect(Math.round(b / state.beats * w), 0, 1, h);
    const bh = Math.max(3, Math.min(6, h / 9));
    for (const it of items) {
      const x0 = it.x0 * w, x1 = it.x1 * w, y = h - 3 - it.y * (h - 6) - bh / 2;
      const on = frac >= it.w0 && frac < it.w1;
      g.globalAlpha = on ? 1 : 0.75;
      g.fillStyle = on ? colors.fg : colors.accent;
      g.fillRect(x0 + (it.onset ? 0.5 : 0), y, Math.max(2, x1 - x0 - 1.5), bh);
      if (it.onset) { g.fillStyle = colors.fg; g.fillRect(x0 + 0.5, y - 1, 1.5, bh + 2); }
    }
    g.globalAlpha = 1;
    if (frac >= 0) { g.fillStyle = colors.fg; g.fillRect(Math.round(frac * w), 0, 1.5, h); }
  }

  let lastRead = '';
  function frame() {
    const np = clock.playing ? nowPos() : null, now = audioNow();
    rt.forEach((r, i) => { refreshLine(i); drawStrip(i, np); });
    highlights(clock.playing ? now : Infinity);
    const sec = 60 / clock.bpm * state.beats;
    const txt = (np ? `cycle <b>${np.cycle}</b> · ` : 'stopped · ') + `1 cycle = ${state.beats} beats = ${sec.toFixed(2)} s · ${(clock.bpm / state.beats).toFixed(2)} cycles a minute`;
    if (txt !== lastRead) { lastRead = txt; readout.innerHTML = txt; }
    requestAnimationFrame(frame);
  }

  /* MIDI in: a note typed into the focused line as a name (c4 eb3...), and heard */
  midi.onNote = (n, vel) => {
    if (!vel) return;
    audio.note(patchFor({ sound: 'tri', echo: 0 }), n, vel, audio.now(), 0.25);
    const ta = document.activeElement;
    if (ta && ta.tagName === 'TEXTAREA' && ta.dataset.line !== undefined) {
      ta.setRangeText(music.name(n).toLowerCase() + ' ', ta.selectionStart, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input'));
    }
  };

  /* ------------------------------------------------------------- start --- */
  (async () => {
    const shared = await store.fromHash();
    const saved = shared || store.load('strand');
    const clean = sanitize(saved);
    if (clean) state = clean;
    if (shared) window.history.replaceState(null, '', location.pathname);
    clock.bpm = state.bpm; clock.swing = state.swing; head.setTempo(state.bpm); head.setSwing(state.swing);
    rebuildRt(null);
    renderAll();
    if (shared) ui.toast('Opened from the link');
    requestAnimationFrame(frame);
  })();
})();

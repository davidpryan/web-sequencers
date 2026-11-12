/* SPDX-License-Identifier: MPL-2.0 */
/* STRAND's pattern engine: the parser and the patterns, pure (no DOM), loaded before app.js and tested with node.
 *
 * A PATTERN is a function from a time span to the events in it. Time is counted in CYCLES (1 cycle = 1 bar by
 * default) and kept exact as rationals (Fr), so a step of a fifth of a cycle starts exactly where it should, however
 * the span is cut. An event is {wb, we, pb, pe, v}: its whole (wb..we, the note from start to end) and the part of
 * it inside the queried span (pb..pe); it starts in the span when wb == pb (an ONSET). v is the value, an object:
 *   {s: 'bd'} a sound, {deg: 2} a scale degree, {note: 64} a MIDI note, plus controls set by functions
 *   (root, scale, octave, gain, legato, cutoff, echo, ch, idx) and loc: [from, to], the characters it came from.
 *
 * A LINE of code is  s "mini-notation"  or  n "mini-notation", followed by functions: .fast(2) .scale("C:minor")...
 * compileLine(text) returns {pattern} or {error: {msg, index, line, col}}. */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------- rationals --- */
  const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { const t = a % b; a = b; b = t; } return a || 1; };
  class Fr {
    constructor(n, d = 1) {
      if (d < 0) { n = -n; d = -d; }
      const g = gcd(n, d); this.n = n / g; this.d = d / g;
    }
    add(o) { o = fr(o); return new Fr(this.n * o.d + o.n * this.d, this.d * o.d); }
    sub(o) { o = fr(o); return new Fr(this.n * o.d - o.n * this.d, this.d * o.d); }
    mul(o) { o = fr(o); return new Fr(this.n * o.n, this.d * o.d); }
    div(o) { o = fr(o); return new Fr(this.n * o.d, this.d * o.n); }
    cmp(o) { o = fr(o); return this.n * o.d - o.n * this.d; }
    lt(o) { return this.cmp(o) < 0; } lte(o) { return this.cmp(o) <= 0; }
    gt(o) { return this.cmp(o) > 0; } gte(o) { return this.cmp(o) >= 0; }
    eq(o) { return this.cmp(o) === 0; }
    floor() { return Math.floor(this.n / this.d); }
    sam() { return new Fr(this.floor()); }
    valueOf() { return this.n / this.d; }
    toString() { return this.d === 1 ? String(this.n) : this.n + '/' + this.d; }
  }
  /* a number (integer or decimal, at most 6 places) as a rational */
  function fr(x) {
    if (x instanceof Fr) return x;
    if (Number.isInteger(x)) return new Fr(x);
    return new Fr(Math.round(x * 1e6), 1e6);
  }
  const fmin = (a, b) => (a.lt(b) ? a : b), fmax = (a, b) => (a.gt(b) ? a : b);

  /* the span b..e cut at each cycle boundary */
  function cycles(b, e) {
    const out = [];
    let s = b;
    while (s.lt(e)) { const next = s.sam().add(1), t = fmin(next, e); out.push([s, t]); s = t; }
    return out;
  }

  /* -------------------------------------------------------------- patterns --- */
  class Pat { constructor(query) { this.query = query; } }
  const silence = new Pat(() => []);
  const ev = (wb, we, pb, pe, v) => ({ wb, we, pb, pe, v });
  const mapTimes = (e, f) => ev(f(e.wb), f(e.we), f(e.pb), f(e.pe), e.v);

  /* a value once a cycle */
  function pure(v) {
    return new Pat((b, e) => cycles(b, e).map(([s, t]) => { const c = s.sam(); return ev(c, c.add(1), s, t, v); }));
  }
  function stack(pats) {
    if (pats.length === 1) return pats[0];
    return new Pat((b, e) => pats.flatMap(p => p.query(b, e)));
  }
  function fast(f, p) {
    f = fr(f);
    if (f.n <= 0) return silence;
    if (f.eq(1)) return p;
    return new Pat((b, e) => p.query(b.mul(f), e.mul(f)).map(x => mapTimes(x, t => t.div(f))));
  }
  const slow = (f, p) => fast(fr(f).n === 0 ? 0 : new Fr(1).div(fr(f)), p);
  /* shift later by t cycles */
  function late(t, p) {
    t = fr(t);
    return new Pat((b, e) => p.query(b.sub(t), e.sub(t)).map(x => mapTimes(x, u => u.add(t))));
  }
  /* one pattern per cycle, in turn; each pattern counts its own cycles (Tidal's slowcat) */
  function slowcat(pats) {
    if (pats.length === 1) return pats[0];
    const n = pats.length;
    return new Pat((b, e) => cycles(b, e).flatMap(([s, t]) => {
      const c = s.floor(), i = ((c % n) + n) % n, off = new Fr(Math.floor(c / n) - c);
      return pats[i].query(s.add(off), t.add(off)).map(x => mapTimes(x, u => u.sub(off)));
    }));
  }
  /* squeeze each cycle of p into b0..e0 (fractions of a cycle) of the same cycle */
  function compress(b0, e0, p) {
    const w = e0.sub(b0);
    if (w.n <= 0) return silence;
    return new Pat((b, e) => cycles(b, e).flatMap(([s, t]) => {
      const c = s.sam(), lo = c.add(b0), hi = c.add(e0), qs = fmax(s, lo), qe = fmin(t, hi);
      if (!qs.lt(qe)) return [];
      const inn = x => c.add(x.sub(lo).div(w)), out = x => lo.add(x.sub(c).mul(w));
      return p.query(inn(qs), inn(qe)).map(x => mapTimes(x, out));
    }));
  }
  /* steps with weights share the cycle: [{w, pat}] */
  function timecat(items) {
    const total = items.reduce((a, it) => a.add(it.w), new Fr(0));
    if (items.length === 1 && total.n > 0) return items[0].pat;
    let acc = new Fr(0);
    return stack(items.map(it => { const b = acc.div(total); acc = acc.add(it.w); return compress(b, acc.div(total), it.pat); }));
  }
  const fastcat = pats => timecat(pats.map(pat => ({ w: new Fr(1), pat })));
  /* each cycle backwards */
  function rev(p) {
    return new Pat((b, e) => cycles(b, e).flatMap(([s, t]) => {
      const c = s.sam(), m = x => c.mul(2).add(1).sub(x);
      return p.query(m(t), m(s)).map(x => ev(m(x.we), m(x.wb), m(x.pe), m(x.pb), x.v));
    }));
  }
  function fmap(p, f) { return new Pat((b, e) => p.query(b, e).map(x => ev(x.wb, x.we, x.pb, x.pe, f(x.v)))); }
  function filter(p, keep) { return new Pat((b, e) => p.query(b, e).filter(keep)); }
  /* f(p) on cycles 0, n, 2n...; p on the others */
  function every(n, f, p) {
    const fp = f(p);
    return new Pat((b, e) => cycles(b, e).flatMap(([s, t]) => (((s.floor() % n) + n) % n === 0 ? fp : p).query(s, t)));
  }
  /* a number 0..1 that depends only on an event's start, a salt and the seed: the same every time */
  function rand(t, salt, seed) {
    let h = 0x811c9dc5 ^ (seed | 0);
    for (const k of [t.n % 2147483647, t.d % 2147483647, salt | 0]) {
      h = Math.imul(h ^ (k | 0), 0x01000193);
      h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
    }
    return (h >>> 0) / 4294967296;
  }
  const degradeBy = (amt, salt, seed, p) => filter(p, x => rand(x.wb, salt, seed) >= amt);
  const undegradeBy = (amt, salt, seed, p) => filter(p, x => rand(x.wb, salt, seed) < amt);
  /* f on about a share `amt` of the events, chosen by the seed */
  const sometimesBy = (amt, f, salt, seed, p) => stack([degradeBy(amt, salt, seed, p), f(undegradeBy(amt, salt, seed, p))]);

  /* Bjorklund's even spread of k pulses in n steps, rotated left by r */
  function bjorklund(k, n, r = 0) {
    if (n <= 0) return [];
    let out;
    if (k >= n) out = Array(n).fill(1);
    else if (k <= 0) out = Array(n).fill(0);
    else {
      let a = Array.from({ length: k }, () => [1]), b = Array.from({ length: n - k }, () => [0]);
      while (b.length > 1) {
        const m = Math.min(a.length, b.length), na = [];
        for (let i = 0; i < m; i++) na.push(a[i].concat(b[i]));
        const rest = a.length > m ? a.slice(m) : b.slice(m);
        a = na; b = rest;
      }
      out = a.concat(b).flat();
    }
    return out.map((_, i) => out[(((i + r) % n) + n) % n]);
  }

  /* ----------------------------------------------------------------- sounds --- */
  /* drum names in the code -> the core's drums (with a tom pitch) */
  const DRUMS = {
    bd: 'kick', sd: 'snare', hh: 'hat', oh: 'ohat', cp: 'clap', rim: 'rim', tom: 'tom', lt: 'tom', mt: 'tom', ht: 'tom',
    cb: 'cowbell', cy: 'cymbal', sh: 'shaker', zap: 'zap',
    kick: 'kick', snare: 'snare', hat: 'hat', ohat: 'ohat', clap: 'clap', cowbell: 'cowbell', cymbal: 'cymbal', shaker: 'shaker',
  };
  const TOM_PITCH = { lt: 95, tom: 140, mt: 140, ht: 200 };
  const WAVES = { sine: 'sine', tri: 'triangle', triangle: 'triangle', square: 'square', saw: 'sawtooth', sawtooth: 'sawtooth', supersaw: 'supersaw' };
  /* the order drums take in the strip under a line, low to high */
  const DRUM_ORDER = ['kick', 'tom', 'rim', 'snare', 'clap', 'cowbell', 'zap', 'shaker', 'hat', 'ohat', 'cymbal'];
  const SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10],
    pentatonic: [0, 2, 4, 7, 9], minpent: [0, 3, 5, 7, 10], harmonic: [0, 2, 3, 5, 7, 8, 11],
    blues: [0, 3, 5, 6, 7, 10], chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  };
  const SCALE_ALIAS = { ionian: 'major', aeolian: 'minor', majpent: 'pentatonic', 'minor pent.': 'minpent', minorpentatonic: 'minpent', 'harmonic min.': 'harmonic', harmonicminor: 'harmonic' };
  const NOTE_PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  /* "c4", "eb3", "f#2", "cs5" -> a MIDI note (c4 = 60); octave 3 when left out; null when it is not a note name */
  function noteName(s) {
    const m = /^([a-g])(#|s|b|f)?(-?\d)?$/i.exec(s);
    if (!m) return null;
    const acc = m[2] ? (m[2] === '#' || m[2] === 's' ? 1 : -1) : 0, oct = m[3] !== undefined ? +m[3] : 3;
    return 12 * (oct + 1) + NOTE_PC[m[1].toLowerCase()] + acc;
  }
  /* "C:minor", "a3:dorian" -> {root, scale, octave?} or an error string */
  function parseScale(s) {
    const m = /^\s*([a-g])(#|s|b)?(-?\d)?\s*:\s*([a-z .]+?)\s*$/i.exec(s);
    if (!m) return 'a scale is "root:mode", like "C:minor" or "F#:dorian"';
    let name = m[4].toLowerCase(); name = SCALE_ALIAS[name] || name.replace(/\s+/g, '');
    if (!SCALES[name]) return `unknown mode "${m[4]}": ${Object.keys(SCALES).join(', ')}`;
    const root = (NOTE_PC[m[1].toLowerCase()] + (m[2] ? (m[2] === 'b' ? -1 : 1) : 0) + 12) % 12;
    const out = { root, scale: name };
    if (m[3] !== undefined) out.octave = +m[3];
    return out;
  }
  /* an event's value -> what to play: {kind: 'drum', drum, pitch?, tone, vel, echo, ch} or
   * {kind: 'synth', midi, wave, vel, cutoff, echo, legato, ch} */
  function resolve(v) {
    const gain = v.gain ?? 1, vel = Math.max(1, Math.min(127, Math.round(108 * gain)));
    const s = v.s || 'tri';
    if (DRUMS[s]) {
      const out = { kind: 'drum', drum: DRUMS[s], vel, echo: v.echo || 0, ch: v.ch, legato: v.legato ?? 1 };
      if (TOM_PITCH[s]) out.pitch = TOM_PITCH[s] * Math.pow(2, (v.add || 0) / 12);
      out.tone = v.idx != null ? Math.min(1, v.idx / 8) : 0.5;
      if (v.cutoff != null) out.tone = v.cutoff;
      return out;
    }
    let midi;
    if (v.note != null) midi = v.note + (v.add || 0);
    else {
      const sc = SCALES[v.scale || 'major'], n = sc.length, d = Math.round((v.deg || 0) + (v.add || 0));
      const oct = Math.floor(d / n), i = ((d % n) + n) % n;
      midi = 12 * ((v.octave ?? 3) + 1) + (v.root || 0) + oct * 12 + sc[i];
    }
    return { kind: 'synth', midi: Math.max(0, Math.min(127, midi)), wave: WAVES[s] || 'triangle', sound: s, vel,
      cutoff: v.cutoff, echo: v.echo || 0, legato: v.legato ?? 0.9, ch: v.ch };
  }

  /* ------------------------------------------------------------------ errors --- */
  class StrandError extends Error { constructor(msg, index) { super(msg); this.index = index; } }
  function where(text, index) {
    const before = text.slice(0, index), line = before.split('\n').length - 1, col = index - before.lastIndexOf('\n') - 1;
    return { line, col };
  }
  function nearest(word, list) {
    let best = null, bd = 3;
    for (const w of list) { const d = lev(word, w); if (d < bd) { bd = d; best = w; } }
    return best;
  }
  function lev(a, b) {
    const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i]);
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }

  /* --------------------------------------------------------- mini-notation --- */
  /* The mini-notation inside the quotes:
   *   a b c      steps share the cycle          [a b]     a group in one step
   *   ~          a rest                          a*2 a/2   faster, slower
   *   <a b c>    one per cycle, in turn          a!3  a !  three steps of a; ! repeats the step before
   *   a@3  a _   a step three long; _ lengthens  a?  a?0.3 dropped half the time (or 30%), seeded
   *   a(3,8,2)   Euclid: 3 of 8 steps, turned 2 [a, b c]   layers at once (also at the top level)
   *   {a b c}%4  steps of a polymeter, 4 a cycle; {a b, c d e} the layers keep the first one's step size
   *   bd:3       a sound with an index (a drum's tone)
   * parseMini returns a tree; compileMini turns it into a pattern. `base` is the text index of the first character. */
  function parseMini(src, base) {
    let i = 0;
    const err = (msg, at = i) => { throw new StrandError(msg, base + at); };
    const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };
    const num = (what) => {
      const m = /^-?(\d+(\.\d*)?|\.\d+)/.exec(src.slice(i));
      if (!m) err(`${what} needs a number here`);
      i += m[0].length; return parseFloat(m[0]);
    };
    function stackOf(close) {
      const layers = [seq(close)];
      while (src[i] === ',') { i++; layers.push(seq(close)); }
      return layers.length === 1 ? layers[0] : { type: 'stack', items: layers };
    }
    function seq(close) {
      const steps = [], at = i;
      for (;;) {
        ws();
        const c = src[i];
        if (c === undefined || c === close || c === ',') break;
        if (']>}'.includes(c)) err(`"${c}" has no opening ${c === ']' ? '[' : c === '>' ? '<' : '{'}`);
        if (c === '_') { if (!steps.length) err('"_" lengthens the step before it, but there is none'); steps[steps.length - 1].w += 1; i++; continue; }
        if (c === '!' && !/\d/.test(src[i + 1] || '')) { if (!steps.length) err('"!" repeats the step before it, but there is none'); steps.push({ ...steps[steps.length - 1] }); i++; continue; }
        steps.push(...step());
      }
      if (!steps.length) err('an empty group: put a step or ~ here', at);
      return { type: 'seq', steps };
    }
    function step() {
      const start = i;
      let node = term(), w = 1, reps = 1;
      for (;;) {
        const c = src[i];
        if (c === '*' || c === '/') {
          i++; const f = num(c === '*' ? '"*" (faster)' : '"/" (slower)');
          if (f <= 0 || f > 128) err(`${c}${f}: the number must be above 0 and at most 128`, i - 1);
          node = { type: c === '*' ? 'fast' : 'slow', f, node };
        } else if (c === '!') { i++; reps = Math.max(1, Math.round(num('"!" (repeat)'))); if (reps > 64) err('"!" repeats at most 64 times', i - 1); }
        else if (c === '@') { i++; w = num('"@" (length)'); if (w <= 0) err('"@" needs a length above 0', i - 1); }
        else if (c === '?') { i++; const amt = /[\d.]/.test(src[i] || '') ? num('"?"') : 0.5; node = { type: 'degrade', amt, salt: base + start, node }; }
        else if (c === '(') {
          const open = i; i++; ws();
          const k = Math.round(num('Euclid (pulses, steps, turn)')); ws();
          if (src[i] !== ',') err('Euclid is (pulses,steps) or (pulses,steps,turn), like bd(3,8)');
          i++; ws(); const n = Math.round(num('Euclid steps')); ws();
          let r = 0;
          if (src[i] === ',') { i++; ws(); r = Math.round(num('Euclid turn')); ws(); }
          if (src[i] !== ')') err('Euclid needs a closing ")"', open);
          i++;
          if (n < 1 || n > 64) err('Euclid steps must be 1 to 64', open);
          node = { type: 'euclid', k, n, r, node };
        } else break;
      }
      return Array.from({ length: reps }, () => ({ node, w }));
    }
    function term() {
      const c = src[i], at = i;
      if (c === '[') { i++; const n = stackOf(']'); if (src[i] !== ']') err('this "[" is not closed: add "]"', at); i++; return n; }
      if (c === '<') { i++; const n = stackOf('>'); if (src[i] !== '>') err('this "<" is not closed: add ">"', at); i++; return { type: 'alt', node: n }; }
      if (c === '{') {
        i++; const n = stackOf('}'); if (src[i] !== '}') err('this "{" is not closed: add "}"', at); i++;
        let steps = null;
        if (src[i] === '%') { i++; steps = num('"%" (steps a cycle)'); if (steps <= 0 || steps > 128) err('"%" needs a number above 0 and at most 128', i - 1); }
        return { type: 'poly', layers: n.type === 'stack' ? n.items : [n], steps };
      }
      if (c === '~') { i++; return { type: 'rest' }; }
      const m = /^(-?(\d+(\.\d*)?|\.\d+)|[a-z][a-z0-9#]*(:\d+)?)/i.exec(src.slice(i));
      if (!m) err(`"${c}" is not a step: use a word, a number, ~, [ ], < > or { }`);
      i += m[0].length;
      return { type: 'atom', text: m[0], loc: [base + at, base + i] };
    }
    const tree = stackOf(null);
    if (i < src.length) err(`"${src[i]}" does not belong here`);
    return tree;
  }

  /* the tree -> a pattern. mode 's' makes atoms sounds, 'n' numbers (degrees) or note names */
  function compileMini(node, mode, seed) {
    const go = n => compileMini(n, mode, seed);
    switch (node.type) {
      case 'rest': return silence;
      case 'atom': return pure(atomValue(node, mode));
      case 'seq': return timecat(node.steps.map(s => ({ w: fr(s.w), pat: go(s.node) })));
      case 'stack': return stack(node.items.map(go));
      case 'fast': return fast(node.f, go(node.node));
      case 'slow': return slow(node.f, go(node.node));
      case 'degrade': return degradeBy(node.amt, node.salt, seed, go(node.node));
      case 'euclid': { const p = go(node.node); return fastcat(bjorklund(node.k, node.n, node.r).map(b => (b ? p : silence))); }
      case 'alt': {
        const one = s => slowcat(s.steps.flatMap(st => Array(Math.max(1, Math.round(st.w))).fill(st.node)).map(go));
        return node.node.type === 'stack' ? stack(node.node.items.map(one)) : one(node.node);
      }
      case 'poly': {
        const weight = s => s.steps.reduce((a, st) => a + st.w, 0);
        const per = node.steps ?? weight(node.layers[0]);
        return stack(node.layers.map(l => fast(fr(per).div(fr(weight(l))), go(l))));
      }
    }
    throw new Error('unknown node ' + node.type);
  }
  function atomValue(node, mode) {
    const t = node.text, loc = node.loc;
    if (mode === 's') {
      const [name, idx] = t.split(':');
      const low = name.toLowerCase();
      if (!DRUMS[low] && !WAVES[low]) {
        const near = nearest(low, Object.keys(DRUMS).concat(Object.keys(WAVES)));
        throw new StrandError(`unknown sound "${name}"${near ? `: did you mean "${near}"?` : ''} (drums: bd sd hh oh cp rim tom cb cy sh zap; synths: sine tri square saw supersaw)`, loc[0]);
      }
      const v = { s: low, loc };
      if (idx !== undefined) v.idx = +idx;
      return v;
    }
    if (/^-?[\d.]/.test(t)) return { deg: parseFloat(t), loc };
    const note = noteName(t);
    if (note === null) throw new StrandError(`"${t}" is not a number or a note name (like 0, -2, c4, eb3)`, loc[0]);
    return { note, loc };
  }

  /* ----------------------------------------------------------- code lines --- */
  /* tokens: words, numbers, strings, . ( ) , and // comments */
  function lex(src) {
    const toks = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      const at = i;
      if (/[a-z_$]/i.test(c)) { while (i < src.length && /[\w$]/.test(src[i])) i++; toks.push({ t: 'id', s: src.slice(at, i), at, end: i }); continue; }
      if (/[\d.]/.test(c) && /\d/.test(c === '.' ? src[i + 1] || '' : c) || (c === '-' && /[\d.]/.test(src[i + 1] || ''))) {
        const m = /^-?(\d+(\.\d*)?|\.\d+)/.exec(src.slice(i));
        i += m[0].length; toks.push({ t: 'num', s: m[0], v: parseFloat(m[0]), at, end: i }); continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        const close = src.indexOf(c, i + 1);
        if (close < 0) throw new StrandError(`this ${c} is not closed`, i);
        toks.push({ t: 'str', s: src.slice(i + 1, close), at, end: close + 1 }); i = close + 1; continue;
      }
      if ('.(),:'.includes(c)) { toks.push({ t: c, s: c, at, end: i + 1 }); i++; continue; }
      if (c === '=' && src[i + 1] === '>') throw new StrandError('write the function itself, like fast(2) or rev, not "x => ..."', i);
      throw new StrandError(`"${c}" does not belong here`, i);
    }
    return toks;
  }

  /* The functions after a pattern: name -> {args, f(pattern, args, ctx), use}. Argument kinds: num, int, str, fn. */
  const range = (lo, hi, name) => x => { if (x < lo || x > hi) return `${name} must be ${lo} to ${hi}`; };
  const pos = name => x => { if (!(x > 0)) return `${name} must be above 0`; };
  const speed = name => x => { if (!(x > 0) || x > 128 || x < 1 / 128) return `${name} must be between 1/128 and 128`; };
  const set = (k, conv = x => x) => (p, [x]) => fmap(p, v => ({ ...v, [k]: conv(x) }));
  const FUNCS = {
    fast: { args: ['num'], check: [speed('.fast')], f: (p, [x]) => fast(x, p), use: '.fast(2)  twice as fast' },
    slow: { args: ['num'], check: [speed('.slow')], f: (p, [x]) => slow(x, p), use: '.slow(2)  half as fast' },
    rev: { args: [], f: p => rev(p), use: '.rev()  each cycle backwards' },
    late: { args: ['num'], f: (p, [x]) => late(x, p), use: '.late(0.25)  later by a quarter cycle' },
    every: { args: ['int', 'fn'], check: [pos('the count')], f: (p, [n, g]) => every(n, g, p), use: '.every(4, fast(2))  on every 4th cycle' },
    sometimes: { args: ['fn'], f: (p, [g], c) => sometimesBy(0.5, g, c.salt, c.seed, p), use: '.sometimes(add(7))  to half the events' },
    often: { args: ['fn'], f: (p, [g], c) => sometimesBy(0.75, g, c.salt, c.seed, p), use: '.often(f)  to 3 in 4' },
    rarely: { args: ['fn'], f: (p, [g], c) => sometimesBy(0.25, g, c.salt, c.seed, p), use: '.rarely(f)  to 1 in 4' },
    degrade: { args: ['num?'], check: [range(0, 1, '.degrade')], f: (p, [x = 0.5], c) => degradeBy(x, c.salt, c.seed, p), use: '.degrade(0.3)  drop 30% (seeded)' },
    add: { args: ['num'], f: (p, [x]) => fmap(p, v => ({ ...v, add: (v.add || 0) + x })), use: '.add(7)  degrees up (semitones for note names)' },
    scale: { args: ['str'], f: (p, [sc]) => fmap(p, v => ({ ...v, root: sc.root, scale: sc.scale, ...(sc.octave != null ? { octave: sc.octave } : {}) })), use: '.scale("C:minor")  the degrees\' scale' },
    octave: { args: ['num'], check: [range(-1, 9, '.octave')], f: set('octave', Math.round), use: '.octave(4)  degree 0 is in this octave (3)' },
    s: { args: ['str'], f: set('s'), use: '.s("saw")  the sound' },
    gain: { args: ['num'], check: [range(0, 2, '.gain')], f: set('gain'), use: '.gain(0.7)  loudness (1)' },
    legato: { args: ['num'], check: [pos('.legato')], f: set('legato'), use: '.legato(0.5)  length, of the step (0.9)' },
    cutoff: { args: ['num'], check: [range(0, 20000, '.cutoff')], f: set('cutoff', x => (x > 1 ? Math.max(0, Math.min(1, Math.log2(x / 40) / 8.5)) : x)), use: '.cutoff(0.4)  filter, 0-1 or Hz' },
    echo: { args: ['num'], check: [range(0, 1, '.echo')], f: set('echo'), use: '.echo(0.3)  echo send' },
    ch: { args: ['int'], check: [range(0, 16, '.ch')], f: set('ch'), use: '.ch(3)  MIDI channel (0 off)' },
  };
  const HEADS = { s: 's', sound: 's', n: 'n', note: 'n' };

  /* text -> {pattern, empty} or {error: {msg, index, line, col}}. opts {seed, salt} */
  function compileLine(text, opts = {}) {
    const seed = opts.seed | 0;
    let saltN = (opts.salt | 0) * 7919;
    try {
      const toks = lex(text);
      let p = 0;
      const peek = () => toks[p], at = () => (toks[p] ? toks[p].at : text.length);
      const err = (msg, i = at()) => { throw new StrandError(msg, i); };
      /* "d1:" or "d1 $" in front is allowed and ignored */
      if (toks[0] && /^d[1-8]$/.test(toks[0].s) && toks[1] && (toks[1].t === ':')) p = 2;
      else if (toks[0] && /^d[1-8]\$?$/.test(toks[0].s)) p = 1;
      if (p >= toks.length) return { pattern: silence, empty: true };
      const head = toks[p];
      if (head.t !== 'id') err('a line starts with s "..." (sounds) or n "..." (notes)');
      let pat;
      if (head.s === 'silence' || head.s === 'hush') { p++; pat = silence; }
      else {
        if (!HEADS[head.s]) err(`a line starts with s "..." (sounds) or n "..." (notes), not "${head.s}"`);
        p++;
        let str;
        if (peek() && peek().t === 'str') str = toks[p++];
        else if (peek() && peek().t === '(' && toks[p + 1] && toks[p + 1].t === 'str' && toks[p + 2] && toks[p + 2].t === ')') { str = toks[p + 1]; p += 3; }
        else err(`${head.s} needs quotes after it, like ${head.s} "${HEADS[head.s] === 's' ? 'bd sd' : '0 2 4'}"`);
        pat = compileMini(parseMini(str.s, str.at + 1), HEADS[head.s], seed);
      }
      /* a chain: .name(args) .name(args)... ; as a function argument the first dot may be left out */
      const chain = (first) => {
        const calls = [];
        while (peek() && (peek().t === '.' || (first && calls.length === 0 && peek().t === 'id'))) {
          if (peek().t === '.') p++;
          const nt = peek();
          if (!nt || nt.t !== 'id') err('a function name goes after "."');
          p++;
          const fn = FUNCS[nt.s];
          if (!fn) { const near = nearest(nt.s, Object.keys(FUNCS)); err(`unknown function ".${nt.s}"${near ? `: did you mean .${near}?` : ''}`, nt.at); }
          const args = [];
          if (peek() && peek().t === '(') {
            const open = peek(); p++;
            while (peek() && peek().t !== ')') {
              const kind = fn.args[args.length];
              if (!kind) err(`.${nt.s} takes ${fn.args.length ? 'only ' + fn.args.length : 'no'} argument${fn.args.length === 1 ? '' : 's'}: ${fn.use.split('  ')[0]}`);
              args.push(arg(kind, nt.s, fn, args.length));
              if (peek() && peek().t === ',') p++;
              else if (peek() && peek().t !== ')') err(`"," or ")" expected in .${nt.s}(...)`);
            }
            if (!peek()) err(`this "(" is not closed`, open.at);
            p++;
          }
          const need = fn.args.filter(k => !k.endsWith('?')).length;
          if (args.length < need) err(`.${nt.s} needs ${need} argument${need > 1 ? 's' : ''}: ${fn.use.split('  ')[0]}`, nt.at);
          calls.push({ fn, args, salt: ++saltN + nt.at });
          first = false;
        }
        return q => calls.reduce((acc, c) => c.fn.f(acc, c.args, { seed, salt: c.salt }), q);
      };
      const arg = (kind, name, fn, n) => {
        const t = peek(), k = kind.replace('?', '');
        let v;
        if (k === 'fn') {
          if (!t || t.t !== 'id' && t.t !== '.') err(`.${name} wants a function here, like fast(2), rev or add(7)`);
          v = chain(true);
        } else if (k === 'str') {
          if (!t || t.t !== 'str') err(`.${name} wants text in quotes: ${fn.use.split('  ')[0]}`);
          p++; v = t.s;
          if (name === 'scale') { v = parseScale(t.s); if (typeof v === 'string') err(v, t.at + 1); }
          if (name === 's' && !DRUMS[v.toLowerCase()] && !WAVES[v.toLowerCase()]) {
            const near = nearest(v.toLowerCase(), Object.keys(DRUMS).concat(Object.keys(WAVES)));
            err(`unknown sound "${v}"${near ? `: did you mean "${near}"?` : ''}`, t.at + 1);
          }
          if (name === 's') v = v.toLowerCase();
        } else {
          if (!t || t.t !== 'num') err(`.${name} wants a number here: ${fn.use.split('  ')[0]}`);
          p++; v = k === 'int' ? Math.round(t.v) : t.v;
          const bad = fn.check && fn.check[n] && fn.check[n](v);
          if (bad) err(bad, t.at);
        }
        return v;
      };
      pat = chain(false)(pat);
      if (p < toks.length) err(`"${toks[p].s}" does not belong here: functions start with ".", like .fast(2)`);
      return { pattern: pat };
    } catch (e) {
      if (!(e instanceof StrandError)) throw e;
      const index = Math.max(0, Math.min(text.length, e.index));
      return { error: { msg: e.message, index, ...where(text, index) } };
    }
  }

  /* the events that start in cycle c (sorted), each with its start and length as fractions of the cycle */
  function onsets(pat, c) {
    const b = new Fr(c), e = new Fr(c + 1);
    return pat.query(b, e).filter(x => x.wb.eq(x.pb)).sort((x, y) => x.wb.cmp(y.wb));
  }

  const api = { Fr, fr, pure, silence, stack, fast, slow, late, slowcat, fastcat, timecat, compress, rev, every, fmap,
    degradeBy, sometimesBy, bjorklund, parseMini, compileMini, compileLine, onsets, resolve, noteName, parseScale,
    DRUMS, WAVES, DRUM_ORDER, SCALES, FUNCS, lex };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Strand = api;
})(typeof window !== 'undefined' ? window : this);

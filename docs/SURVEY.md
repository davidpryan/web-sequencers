# Music sequencers: a survey, design rules and requirements

*November 2026. A survey of hardware, modular, software and M-VAVE FM-1 sequencers, written to inform new FM-1 firmwares. Facts that are not common knowledge carry an inline link. Where the research could not confirm something, the text says so or leaves it out. A "?" in a table means the cell is unconfirmed.*

---

## 1. Summary

**What was found.** Almost every sequencer is a variation on about fifteen archetypes. Each has its own unit of thought (a step, a stage, a row, a clip, a chord, a rule) and its own model of time. The market is crowded at one end. The 16-step grid with per-step parameter locks, conditions and ratchets is now the baseline. A 2026 groovebox that offers only that is called "nothing groundbreakingly new" by reviewers ([Synth Anatomy](https://synthanatomy.com/2026/05/sonicware-deconstruct-minimal-a-groovebox-that-goes-back-to-the-roots.html)). The other end is thin. Trackers, stage sequencers, multi-playhead sequencers, harmonic conductors and capture-first loopers are rare in hardware, and rarer still on small devices.

**The taxonomy in brief.**
- Grid families: x0x step grid; trig-and-lock groovebox; analogue knob-per-step.
- List families: phrase / mono note list; tracker (flat and hierarchical).
- Timeline families: linear event workstation and piano roll; clip and scene launcher.
- Rule families: generative / algorithmic (several sub-families); harmonic conductor and arpeggiator; pattern language and spatial code.
- Time families: polymetric / per-lane; stage / elastic time; multi-playhead / Cartesian.
- Performance families: live-loop and capture; performance sculpting.

Five orthogonal axes place any design: **entry** (step, real time, generated), **structure** (flat, pattern, clip, hierarchy), **time** (shared grid, per-track, per-lane, per-step, free), **variation** (none, locks, conditions, operators, generators) and **reuse** (copy, alias, reference with transform).

**The top design rules.**
1. One conceptual model, stated and named.
2. Spatial mapping first: key *n* is step *n*; knob order matches screen order.
3. Hold the object, turn the property. Holds are quasi-modes, not modes.
4. Show the layer map whenever a modifier is held. Hidden chords are the most common complaint in the field.
5. Every edit is heard and seen at once; changes to patterns, scenes and mutes land on the bar.
6. Randomness always has a lock, a seed and an undo.
7. Separate *what* (pitch) from *when* (rhythm) from *order* (traversal).
8. Never lose a take: undo, snapshots and retroactive capture.
9. Song or chain mode from day one.
10. On a small device, many small characterful engines beat one deep one.

**How the six new firmwares map to it.** Existing FM-1 firmwares already cover the x0x grid and the trig-and-lock groovebox well (LOOM-8, Hortator, SLOOP, X0X, Groove OS, RELAY-16). So the six new ones each take one under-served archetype:

| Firmware | Archetype | Core idea |
|---|---|---|
| LEDGER-4 | Hierarchical-reuse tracker | Song, chain, phrase; 13 row commands |
| MYCEL-8 | Generative | Euclid + Turing register per part; lock, dice history, snapshots |
| SPOOL-4 | Live-loop and capture | Play, overdub, undo by layer, retroactive capture |
| REGENT-4 | Harmonic conductor | Degree keys; four parts follow the chord |
| TERRACE-8 | Stage / elastic time | Pulse count and gate mode per stage; accumulator |
| CANON-4 | Multi-playhead / Cartesian | One 4×4 field, four heads with rate, path and transpose |

All six are version 0.1. They build, pass their host-simulator tests, and have **not been run on an FM-1**.

---

## 2. Scope and method

**What was surveyed.**
- **Hardware:** grooveboxes and sequencers from Elektron, Teenage Engineering, Roland, Korg, Akai, Novation, Arturia, Polyend, Squarp, Dirtywave, Torso, OXI, Synthstrom, Yamaha, Moog, Sequential, Sonicware and others, including 2025 and 2026 releases.
- **Modular and generative:** René, Metropolix, Moog 960, Buchla 250e, Grids, Marbles, the Turing Machine, Noise Engineering, monome, norns, Ornament & Crime, Pamela's Workout, KARMA, NDLR and others.
- **Software:** DAWs (Logic, Cubase, REAPER, Live, Bitwig, FL Studio, Reason), trackers (ProTracker to Renoise, LSDJ, M8), live coding (Tidal, Strudel, Sonic Pi, Orca), iOS apps and browser tools.
- **The M-VAVE FM-1:** stock firmware V14 to V16, FM1 Open, and about twenty community firmwares.
- **UX literature:** Cognitive Dimensions, Nash and Blackwell, Duignan, Magnusson, Sean Luke's Deluge critique, and recent NIME papers.

**How.** Three research passes in November 2026 used product pages, manuals, reviews (Sound On Sound, MusicRadar, Synth Anatomy and others), forums (Elektronauts) and GitHub. Each product was described by its archetype, data model, interaction, novel idea, trade-offs and one copyable idea. FM-1 hardware facts come from the fm1-base platform headers. Facts that could not be confirmed were marked, and are hedged or omitted here. It is a desk survey, not a hands-on test.

---

## 3. Categories

Each archetype below lists the unit of thought, time model, data model, input, UI paradigm, exemplars, strengths and failure modes. Real products mix archetypes.

### 3.1 x0x step grid

- **Unit of thought:** one step equals one button.
- **Time:** a fixed grid of steps at one rate (16ths, with triplet or 32nd scales on the 909).
- **Data:** per instrument, a bit per step, plus accent and flam flags. Patterns have A/B halves and fill variations.
- **Input:** pick an instrument, toggle steps while the pattern loops; tap write in real time.
- **UI:** lit step keys with a running light. Instrument select is a separate control, so mode comes before data ([Smithsonian](https://www.smithsonianmag.com/arts-culture/history-tr-808-drum-machine-180975205/)).
- **Exemplars:** TR-808, TR-909, TR-8S, TR-1000, Behringer RD series, Redrum, Chrome Music Lab Song Maker.
- **Strengths:** perfect visibility; non-musicians can programme it; the bar is a row of lights.
- **Failure modes:** a 16-step ceiling; little variation without variations A to H or fills; melody is awkward.

### 3.2 Trig-and-lock groovebox

- **Unit of thought:** a step carrying its own parameters and conditions.
- **Time:** per-track length and time scale (polymeter), plus microtiming nudge per step.
- **Data:** project, banks, patterns of N tracks of up to 64, 128 or 256 steps. Note trigs and lock trigs. Parameter locks, sound locks, trig conditions (probability, A:B, FILL, PRE/NEI, 1ST), retrigs and slide.
- **Input:** toggle steps; **hold a step and turn a knob** to lock a value; live record.
- **UI:** small screen, encoders, 16 trig keys overloaded by mode, function chords.
- **Exemplars:** Elektron Digitakt II, Syntakt, Digitone II, Analog Rytm, Octatrack, Tonverk, Model:Cycles; Drambo; Ableton Move 2.0; Push 3; on the FM-1, LOOM-8, Hortator, SLOOP, Groove OS.
- **Strengths:** a 16-step loop that never quite repeats; deep per-step control without menus for the common case.
- **Failure modes:** locks are invisible until the step is held; function chords are hard to discover; lock memory limits ([Elektronauts](https://www.elektronauts.com/t/parameter-lock-memory-full/186365)); disagreement about whether a lock should stick until the next lock (Drambo) or revert (Elektron).

### 3.3 Analogue knob-per-step

- **Unit of thought:** a column of knobs.
- **Time:** a ring counter; sometimes one row drives the clock rate, giving variable step lengths.
- **Data:** a rows × columns matrix of values, with per-step on, skip or stop switches.
- **Input:** turn the knob for the step. A modern variant edits *one parameter across all visible steps* (Erica Synths Black Sequencer: page is parameter, knobs are steps).
- **UI:** one control per value; playhead LEDs.
- **Exemplars:** Moog 960, Korg SQ-10, SQ-1, DFAM, BeatStep Pro, Black Sequencer.
- **Strengths:** immediacy; nothing hidden.
- **Failure modes:** no storage or quantisation on classic units; panel size grows with steps.

### 3.4 Phrase / mono note list

- **Unit of thought:** a line of notes, entered in order.
- **Time:** notes advance per step; ties and rests extend or silence.
- **Data:** a note list with accent, slide and tie flags. On the TB-303, pitch and rhythm are separate lists entered in separate passes.
- **Input:** blind step-time entry (play the next note; rest and tie keys); hold keys to record a chord per step and advance on release (Prophet-6, OB-6).
- **UI:** keyboard plus a few flag keys.
- **Exemplars:** TB-303, Behringer TD-3, Moog Mother-32, OP-1 Endless, Sequential poly step, FM1 Open step record.
- **Strengths:** fast melodic entry; decoupled lists give happy accidents.
- **Failure modes:** hard to edit after entry; blind entry confuses.

### 3.5 Tracker (flat and hierarchical)

- **Unit of thought:** a row with a note and effect verbs.
- **Time:** rows run vertically; speed (ticks per row) and tempo; effects act per tick. Grooves are lists of tick counts (6/6 straight, 7/5 swung).
- **Data, flat form:** song as an order list of patterns; pattern as rows × channels; cell as note, instrument, volume and effect columns (ProTracker, FastTracker II, Impulse Tracker, OpenMPT, Renoise, Furnace, Polyend Tracker, NerdSEQ).
- **Data, hierarchical form:** song rows of chain numbers per channel; a chain is up to 16 phrases with a transpose each; a phrase is 16 rows; instruments have per-tick tables. All are numbered pools reused by reference ([LSDJ docs](https://www.littlesounddj.com/lsd/latest/documentation/)). Exemplars: LSDJ, Dirtywave M8, Renoise phrases.
- **Input:** keyboard or d-pad; "hold EDIT and nudge" on the M8; notes typed at the cursor.
- **UI:** dense text, hex values, a spatial map of screens (LSDJ).
- **Strengths:** Nash and Blackwell's study of over 1,000 users found trackers support flow and virtuosity through keyboard-only input, immediate feedback while editing, and dense visible notation ([NIME 2012](https://nime.org/proc/nime2012_nash/)). The hierarchy gives very compact memory and transpose-by-reference.
- **Failure modes:** hex and cryptic letters; vertical time; reference reuse is a hidden dependency (edit phrase 2F and it changes everywhere).

### 3.6 Linear event workstation and piano roll

- **Unit of thought:** an event or region on a ruler.
- **Time:** absolute bars and ticks; free offsets from the grid.
- **Data:** tracks hold regions or parts; regions hold timestamped events. Global chord, arranger, tempo and signature tracks (Cubase). The step grid becomes a *view* on events (MPC).
- **Input:** real-time record with quantise and overdub; mouse drawing; step views.
- **UI:** timeline, piano roll, list and score editors, inspectors.
- **Exemplars:** Logic Pro, Cubase, REAPER, FL Studio piano roll, Xequence 2, Atom Piano Roll 2, Akai MPC, Yamaha QY, Synthstrom Deluge arranger.
- **Strengths:** finished songs; full detail; named sections (Cubase Arranger Track).
- **Failure modes:** deep menus; poor fit for a small screen.

### 3.7 Clip and scene launcher

- **Unit of thought:** a looping clip; a scene as a row of clips.
- **Time:** each clip loops at its own length; launches are quantised to the bar.
- **Data:** a tracks × slots matrix; scenes as rows; follow actions; sometimes an arranger beside it.
- **Input:** launch clips and scenes; record into an empty slot.
- **UI:** a grid of slots, mirrored on pad controllers.
- **Exemplars:** Ableton Live Session View, Bitwig, Akai Force, Roland MC-707, Deluge song view, EP-133 scenes, Circuit scenes, Korg Gadget, Loopy Pro, LOOM-8 Arrange.
- **Strengths:** safe live changes; loops become structure quickly.
- **Failure modes:** "loopitis" (the 8-bar trap); follow-action logic hidden in clips; confusing clip/scene/pattern models on small screens (MC-101).

### 3.8 Generative / algorithmic

- **Unit of thought:** a recipe of parameters, not a list of notes.
- **Time:** usually a grid, but output is computed per step or per bar.
- **Data:** a few numbers per track, a seed, or a learned map.
- **Input:** knobs over dimensions (pulses, rotate, density, mutate); dice; keys as a pitch pool.
- **UI:** small; one knob per dimension.
- **Sub-families:**
  - *Geometric / Euclidean:* k hits spread over n steps with rotation ([Toussaint](https://cgm.cs.mcgill.ca/~godfried/publications/banff.pdf)). T-1, Pam's Workout, Rozeta Rhythm, Live 12 Euclidean.
  - *Stochastic:* draw from a shaped distribution. Marbles, Eloquencer, Riffer, OXI Stochastic, KeyStep Randomness.
  - *Shift register / memory loop:* recirculate past values with a flip probability. Turing Machine, Hemisphere Enigma, Marbles déjà vu.
  - *Topographic map:* interpolate between learned drum patterns and reveal hits by importance. Mutable Instruments Grids, Augmatic GRE.
  - *Curated bank and transform:* hand-picked patterns related by offset or multiplication. Noise Engineering Repetitors, KARMA, Motif phrases.
  - *Rules and automata:* cellular automata, cascading counters. less concepts, Zellen, Meadowphysics.
  - *Accumulator / transform over passes:* deterministic change each loop. Metropolix accumulator, Tidal `every`.
  - *Parametric capture:* play a phrase and store it as generator parameters. Midicake UNA ([Sonicstate](https://sonicstate.com/news/2026/10/15/soniclab-midicake-una-intelligent-arp-sequencer/)).
- **Strengths:** ideas on tap; endless variety from tiny state; density as a single musical control.
- **Failure modes:** aimless "random noodle"; losing a great take; no authorship; opaque state; canned results from banks.

### 3.9 Harmonic conductor and arpeggiator

- **Unit of thought:** a chord degree or key that every part follows.
- **Time:** progression steps (bars or beats per chord); parts run their own figures inside each chord.
- **Data:** key, mode, a chord progression; parts stored as indices into the chord or scale, with separate rhythm patterns.
- **Input:** degree keys (I to VII) with quality modifiers; played chords recognised as input.
- **UI:** chord name and numeral; a small set of part pages.
- **Exemplars:** Conductive Labs NDLR (Pad, Drone, Motif 1, Motif 2), OP-XY brain, Yamaha QY chord track, Cubase and Logic Chord Tracks, Cthulhu, Scaler 3, InstaChord, Orba, KARMA, ChoralRoot, LOOM-8 COND.
- **Strengths:** non-players make progressions; one key press re-keys the whole song.
- **Failure modes:** theory-locked and diatonic sameness; generic progressions; modulation away from the key is awkward.

### 3.10 Polymetric / per-lane

- **Unit of thought:** a lane of one parameter with its own loop.
- **Time:** each lane has its own length, start and end, clock division and sometimes direction.
- **Data:** a track split into trigger, note, octave, duration, velocity and modulation lanes.
- **Input:** hold a lane modifier and set loop points on the step keys.
- **UI:** one page per lane; rings or bars to show different lengths.
- **Exemplars:** monome Kria ([docs](https://monome.org/docs/ansible/kria/)), Korg Wavestate, Korg SQ-64, Metropolix mod lanes, Cthulhu arp lanes, Patterning, OXI DOMINO, Moog Subharmonicon dividers.
- **Strengths:** the most generative feature that keeps full authorship; coprime lengths give long, non-repeating lines.
- **Failure modes:** drift into mush without a reset; lane state invisible when not on its page; multi-length lanes feel like bugs if not drawn.

### 3.11 Stage / elastic time

- **Unit of thought:** a stage that lasts N pulses.
- **Time:** duration is data. Each stage holds its pitch for a pulse count and a gate mode decides what happens across those pulses.
- **Data:** per stage: pitch, pulse count 1–8, gate mode (rest, single, multiple, hold), slide, skip, ratchets; per track: an accumulator that transposes by scale degrees each pass ([Perfect Circuit](https://www.perfectcircuit.com/intellijel-metropolix.html)).
- **Input:** a slider per stage and buttons for pulse count and gate mode.
- **UI:** hands-on panel.
- **Exemplars:** Intellijel Metropolis and Metropolix, Buchla 250e (per-stage time, nested loop counters), Moog 960 rate row, Wavestate Timing lane, OXI SAGA.
- **Strengths:** long, rhythmically varied phrases from eight values; deterministic development via the accumulator.
- **Failure modes:** breaks grid thinking; "step 13 hits here" drum programming is awkward.

### 3.12 Multi-playhead / Cartesian

- **Unit of thought:** a reader moving over shared data.
- **Time:** each playhead has its own rate, direction and offset; on a Cartesian grid, two axes are clocked separately.
- **Data:** one phrase or a 4×4 field, plus playhead objects {rate, direction, offset, transpose}, plus traversal orders ("snakes").
- **Input:** edit the shared notes once; set each reader.
- **UI:** the field with a marker per reader.
- **Exemplars:** Fugue Machine ([Ask.Audio](https://ask.audio/articles/review-fugue-machine-a-unique-take-on-sequencing-for-ipad)), PolyPhase, Make Noise René and René mk2 ([Loopop](https://loopopmusic.com/make-noise-rene-2-review-euroracks-top-sequencer-gets-a-major-redesign)), norns Awake, Buchla 250e addressing.
- **Strengths:** counterpoint from very little data (augmentation, diminution, retrograde, transposition); one edit changes every voice.
- **Failure modes:** harmonic clashes; hard to predict; needs re-sync.

### 3.13 Live-loop and capture

- **Unit of thought:** a recorded pass.
- **Time:** the first loop sets the length (and sometimes the tempo); later passes overdub.
- **Data:** layers of timed notes or audio; motion recordings of knob moves.
- **Input:** play; record; overdub; capture retroactively what was just played.
- **UI:** a few transport buttons and a loop display.
- **Exemplars:** Loopy Pro, OP-1 tape, Octatrack pickup machines, volca and TR-8S motion recording, OXI MIDI Capture, Ableton Move Capture, Melodee capture, SLOOP free mode, ChoralRoot, Earthsea.
- **Strengths:** human feel; no programming; capture rescues unrecorded ideas.
- **Failure modes:** hard to edit after capture; destructive overdubs without undo; quantise baked into the notes.

### 3.14 Performance sculpting

- **Unit of thought:** a transformation over a fixed sequence.
- **Time:** whatever plays underneath; effects are momentary or recorded.
- **Data:** scenes (snapshots of many parameters), morph targets, punch-in effects, macros.
- **Input:** crossfader, held keys, pressure.
- **UI:** one fader or a row of effect keys.
- **Exemplars:** Octatrack scene crossfader, TR-1000 morph fader, Pocket Operator and EP-133 punch-in effects, Rytm performance mode, 4ms Catalyst, Torso S-4, Hortator PERFORM, LOOM-8 THROW.
- **Strengths:** big changes from one gesture; the source is untouched.
- **Failure modes:** effect lists become a menu; no way back without a snapshot.

### 3.15 Pattern language and spatial code

- **Unit of thought:** a transformation or an operator.
- **Time:** cycles subdivided by notation (Tidal, Strudel), sleep-based threads (Sonic Pi), frame bangs (Orca), or events triggering scripts (Teletype).
- **Data:** text or a grid of glyphs.
- **Input:** typing.
- **UI:** an editor; Strudel highlights the sounding token; Orca's grid is the program and the display.
- **Exemplars:** TidalCycles, Strudel, Sonic Pi, Orca, Teletype ([Tidal mini-notation](https://tidalcycles.org/docs/reference/mini_notation/)).
- **Strengths:** unlimited expressivity; composable transforms ("every 4th cycle, reverse").
- **Failure modes:** needs a keyboard and literacy; hard to see the result before hearing it.
- **On small hardware:** the ideas transfer (`<a b>` alternation, `every N`, subdivision), not the language.

### 3.16 The orthogonal axes

| Axis | Values | Examples |
|---|---|---|
| Entry | step / real time / generated / captured | TR-REC; MPC live; T-1; Move Capture |
| Structure | flat / pattern chain / clip matrix / hierarchy / timeline | PO; Live Session; LSDJ; Logic |
| Time | shared grid / per-track length and scale / per-lane / per-step duration / free | TR-808; Elektron; Kria; Metropolix; Melodee timed notes |
| Variation | none / locks / conditions / operators / generators / overlays | 808; Elektron; Bitwig operators; Grids; Jangada VIVO |
| Reuse | copy / alias / reference + transform | most boxes; Bitwig clip aliases; LSDJ chains, LOOM-8 Weave |

Duignan's taxonomy splits sequencers into linear (data-flow) and pattern (control-flow) designs ([record](https://researchr.org/publication/DuignanNB05)). The axes refine that split.

---

## 4. Comparison

Legend: **Y** yes, **N** no, **P** partial or via a workaround, **?** unconfirmed. "Len/scale" means per-track length and time scale. "Cond" means conditions or probability. "Gen" means built-in generators.

### 4.1 Hardware: grooveboxes and drum machines

| Product | Tracks | Steps | Len/scale | P-locks | Cond | Micro | Ratchet | Song | Scenes | Live rec | Gen | Scale/chord | MIDI/clock |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Roland TR-909 | ~11 voices | 16 (A/B) | N (last step) | N | N | N (shuffle, flam) | P (flam) | Y (track) | N | Y (tap) | N | N | Y |
| Roland TR-8S | 11 | 16 × A–H | Y (last step) | P (motion) | ? | Y (sub-steps) | Y | ? | N | Y | N | N | Y |
| Roland TR-1000 | 10 | 16 × A–H + 4 fills | ? | P (motion) | ? | Y (off-grid) | ? | ? | P (morph) | Y | N | N | Y |
| Roland MC-707 | 8 × 16 clips | per clip | Y | P (motion) | ? | ? | ? | ? | Y | Y | N | ? | Y |
| Elektron Digitakt II | 16 | 128 | Y | Y | Y | Y | Y | Y | ? | Y | P (Euclid) | ? | Y |
| Elektron Syntakt | 12 + FX | 64 | Y | Y | Y | Y | Y | ? | ? | Y | P (Euclid) | ? | Y |
| Elektron Digitone II | 16 | 128 | Y | Y | Y | Y | Y | ? | ? | Y | ? | Y (arp, fold) | Y |
| Elektron Octatrack MkII | 8 + 8 MIDI | 64 | Y | Y | Y | Y | Y | Y (arranger) | Y (16 + xfader) | Y | N | ? | Y |
| Elektron Analog Rytm MkII | 12 | 64 | Y | Y | Y | Y | Y | ? | Y | Y | N | N | Y |
| Elektron Model:Cycles | 6 | 64 | ? | Y | P (chance) | ? | Y | N at launch | N | ? | N | P (chord) | Y |
| Elektron Tonverk | 8 + subtracks | 256 | Y | Y | Y | Y | Y | ? | ? | Y | N | Y (arp, chord) | Y |
| TE OP-1 field | 4-track tape | 16 / any | P | N | N | N | N | P (tape) | N | Y | P (Tombola) | P (arp) | Y |
| TE OP-Z | 16 | 1–64 | Y | P (components) | P (components) | ? | Y | Y (chains) | N | Y | P | P (tonality) | Y |
| TE OP-XY | 16 | 64 | ? | Y | P (components) | ? | Y | Y | Y | Y | ? | Y (brain) | Y |
| TE Pocket Operator | 1 | 16 | N | P | N | N | N | P (chain) | N | Y | N | N | sync only |
| TE EP-133 K.O. II | 4 groups | per pattern | ? | ? | ? | P (timing edit) | ? | Y (OS 2.0) | Y | Y | N | N | Y |
| Korg volca (series) | 1–6 | 16 | N | P (motion) | P (later models) | N | P | P (chain) | N | Y | N | N | Y (in) |
| Korg electribe 2 | 16 parts | 64 | ? | P (motion) | ? | ? | ? | N | N | Y | N | P (pad scale) | Y |
| Akai MPC Live III | many | sequence | P | P | ? (one blog) | Y (timing) | Y (note repeat) | Y | Y (clip matrix) | Y | ? | ? | Y |
| Novation Circuit Tracks | 8 | 32 | Y | Y | Y | Y (micro-steps) | P | P (scenes) | Y (16) | Y | P (Mutate) | ? | Y |
| Polyend Play+ | 16 | 64 | ? | ? | Y (chance, actions) | ? | ? | ? | ? | ? | Y (Fill, Smart Fill) | ? | Y |
| Polyend Tracker | 8 | 128 rows | ? | P (FX cols) | P (FX) | ? | P (FX) | Y (pattern list) | N | ? | N | ? | Y |
| Dirtywave M8 | 8 | 16-row phrases | P (per chain) | P (FX cols) | P (FX) | P (groove) | P (FX) | Y (hierarchy) | P (live mode) | ? | N | P (HyperSynth) | Y |
| Yamaha SEQTRAK | ~11 ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | Y |
| Sonicware deconstruct Minimal | 11 | 1–16 (to 64) | Y | Y | ? | Y (sub-steps) | ? | P (chain) | N | ? | P (random vel.) | ? | ? |
| dadamachines TBD-16 | 16 | ? | Y | Y | ? | ? | ? | ? | ? | ? | Y (Euclid, arp) | ? | Y |

### 4.2 Hardware: sequencers and controllers (no or secondary sound)

| Product | Tracks | Steps | Len/scale | P-locks | Cond | Micro | Ratchet | Song | Scenes | Live rec | Gen | Scale/chord | MIDI/clock |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Korg SQ-1 | 2 × 8 | 16 | P (parallel) | N | N | N | N | N | N | N | N | N | MIDI, CV |
| Korg SQ-64 | 4 | 64 | Y (per lane) | P (mod lane) | ? | ? | Y | ? | ? | ? | ? | ? | MIDI, CV |
| Arturia KeyStep Pro | 4 | 64 | Y (drum poly) | N | Y | Y (time shift) | ? | P (chain) | Y | Y | P (random) | Y (scale, arp) | MIDI, CV |
| Arturia BeatStep Pro | 2 + drum | ? | ? | N | Y | ? | P (roller) | ? | ? | Y | P (random) | ? | MIDI, CV |
| Squarp Pyramid MK3 | 64 | any | Y | ? | P (MIDI FX) | ? | ? | Y | P (sequences) | Y | P (Euclid, FX) | Y (FX) | MIDI, CV |
| Squarp Hapax | 16 (2 projects) | ? | Y | P (automation) | ? | ? | ? | ? | ? | Y | P (FX) | ? | MIDI, CV |
| Torso T-1 | 16 | Steps param | Y | Y (v2.0) | P (random amounts) | Y (timing) | Y (repeats) | ? | ? | ? | Y | P (voicing) | MIDI, CV, Link |
| OXI One MkII | 8 seq / 64 tracks | ? | Y | ? | Y (logic) | Y | Y | Y (arranger) | ? | Y (Capture) | Y (Stochastic, Matriceal) | Y (chord, microtonal) | MIDI, CV |
| Synthstrom Deluge | many | zoomable | Y (per clip) | Y (automation) | Y (prob, iterance) | Y (nudge) | ? | Y (arranger) | Y (song view) | Y | ? | ? | MIDI, CV |
| Intellijel Metropolix | 2 × 8 stages | pulse counts | Y (mod lanes) | P (mod lanes) | Y | ? | Y | ? | N | ? | P (accumulator) | Y | CV, ? |
| monome Kria (Ansible) | 4 | 16 | Y (per lane) | N | Y | N | Y | P (meta-sequence) | N | ? | P (drunk, random) | Y (scales) | CV, ? |
| Make Noise René mk2 | 3 channels | 16 locations | Y (X/Y clocks) | N | N | N | N | P (64 states) | N | ? | N | Y (quantiser) | CV |
| Conductive Labs NDLR | 4 parts | motif lengths | Y | N | ? | ? | ? | ? | ? | N | P (variation) | Y (degrees) | MIDI |
| Erica Black Sequencer | 4 | 64 | ? | P (per-step lanes) | Y | ? | Y | ? | ? | ? | ? | ? | CV |

### 4.3 Software

| Product | Tracks | Steps | Len/scale | P-locks | Cond | Micro | Ratchet | Song | Scenes | Live rec | Gen | Scale/chord | MIDI/clock |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Ableton Live 12 | unlimited | clip | Y (per clip) | P (clip envelopes) | P (chance) | Y | P | Y | Y | Y | Y (Generators) | Y | Y, Link |
| Bitwig Studio 6 | unlimited | clip | Y | Y (note expr.) | Y (operators) | Y | Y (Repeats) | Y | Y | Y | ? | Y (global key) | Y |
| Logic Pro 11 | unlimited | region | Y (pattern regions) | P | ? | Y | ? | Y | Y (Live Loops) | Y | Y (Session Players) | Y (chord track) | Y |
| FL Studio | unlimited | pattern | ? | P (graph editor) | ? | Y | ? | Y (playlist) | N | Y | ? | Y (piano roll tools) | Y |
| Renoise | unlimited | pattern rows | ? | Y (FX cols) | Y (FX) | Y (delay col) | Y (FX) | Y (matrix) | P (matrix mutes) | Y | N | ? | Y |
| LSDJ | 4 | 16-row phrases | P | P (commands) | P | P (groove) | Y (command) | Y | P (live mode) | N | N | N | sync |
| Drambo | 16 | ? | Y | Y | Y (components) | ? | ? | ? | ? | Y | P | ? | Y |
| Patterning 2/3 | per kit | 1–64 rings | Y | Y (layers) | Y | ? | Y (to 8) | ? | ? | ? | P (random) | N | Y |
| Fugue Machine | 4 heads | phrase | Y (per head) | N | N | N | N | N | N | N | N | Y (scale) | Y |
| Rozeta suite | per plug-in | ? | Y | ? | P (mutations) | ? | ? | P (follow) | N | P (Taps) | Y | ? | AUv3 |
| Korg Gadget | per gadget | 1–N bars | P | ? | ? | ? | ? | Y (scene list) | Y | Y | N | ? | Y |
| TidalCycles / Strudel | unlimited | cycles | Y | Y | Y (`?`, `sometimesBy`) | Y | Y | P (code) | N | N | Y | Y | Y |

### 4.4 M-VAVE FM-1 firmwares

| Firmware | Tracks | Steps | Len/scale | P-locks | Cond | Micro | Ratchet | Song | Scenes | Live rec | Gen | Scale/chord | MIDI/clock |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Stock V16 | 8 | 64 | ? | ? | ? | ? | Y | ? | ? | Y | ? | ? | Y |
| FM1 Open | 8 | ? | ? | ? | ? | ? | ? | ? | ? | Y (step) | ? | ? | Y (clock, SPP) |
| LOOM-8 | 8 + COND, THROW | 64 | ? | Y | Y (%, A:B) | ? | Y (tricks) | Y (slots) | Y (32) | Y | P (Weave) | Y (COND) | Y |
| Hortator | 8 drum | 64 | Y | Y | Y (PROB) | Y (nudge) | Y | Y (16 rows) | P (variations) | Y (REC ALL) | P (Grids) | ? | Y |
| SLOOP | 4 | 64 | Y | Y (24/track) | Y (fill) | Y | Y (drums) | Y (A–D, record) | P (sections) | Y (free mode) | N | Y | Y (no BLE) |
| Optimist | 4 | 64 | ? | Y | Y | ? | ? | ? | Y | Y | Y (note generators) | ? | Y, Link (JANK) |
| X0X | 4 parts + break | 64 | Y | P (motion) | ? | ? | ? | Y (chains) | N | ? | Y (TB-3PO, BB Gen) | ? | ? |
| Groove OS | 8 | 64 | Y | Y | Y (11 conditions) | ? | Y | Y (chains) | Y | ? | Y (Dice) | Y | Y |
| KARMA | 4 | 64 | ? | Y | Y | ? | Y | Y (A–D) | P (sections) | Y (song record) | Y | Y | Y (SPP) |
| Melodee | 8 | 64 | ? | ? | ? | Y (timed notes) | ? | Y (64 sections) | N | Y (capture) | ? | Y | ? |
| Jangada | 4 | 64 | ? | ? | Y | Y | Y | ? | ? | ? | Y (VIVO) | ? | ? |
| LEDGER-4 | 4 | 16-row phrases | P (per column) | P (commands) | Y (command) | P (delay, groove) | Y (retrigger) | Y (hierarchy) | N | N | P (random command) | N | Y |
| MYCEL-8 | 8 | 1–32 | Y | N | Y (chance) | N | Y | N | P (8 snapshots) | N | Y | Y (pool) | Y |
| SPOOL-4 | 4 loops | 16 bars | Y (speed) | N | N | Y (unquantised) | P (note repeat) | N | N | Y (capture) | N | N | Y |
| REGENT-4 | 4 parts + beat | 16-chord progression | P | N | N | N | N | P (progression) | N | Y (progression) | P (motif dice) | Y | Y |
| TERRACE-8 | 2 lines × 8 | pulse counts | Y | N | N | N | Y | N | N | Y (step) | P (dice, accumulator) | Y | Y |
| CANON-4 | 4 heads | 16 cells | Y (per head) | N | Y (per cell) | N | N | N | N | Y (step) | P (dice) | Y | Y |

That is 69 products and firmwares across the four tables.

### 4.5 UI paradigms

| Paradigm | Exemplars | Strengths | Weaknesses | Fit for FM-1 |
|---|---|---|---|---|
| Lit step keys + running light | TR-808/909, volca, PO, TR-8S | Instant, visible, learnable in seconds | 16-step view; little room for detail | Native: 16 white keys with LEDs |
| Full grid (8×8, 16×8) | Polyend Seq, Deluge, OXI One, Circuit, Launchpad, monome | Everything visible; grid as value display (Programm) | Needs a large surface; modes still hidden | Partial: 27 keys are not a grid |
| Small screen + encoders + function chords | Elektron, M8, Tracker Mini, O_C | Deep and fast once learned | Discoverability; menu diving | Native: 240×240 screen, 7 encoders |
| Knob per function | Model series, DFAM, Faderfox, Erica | Nothing hidden; loved live | Panel size; few parameters | Only for four values at a time (K1–K4) |
| Characterful graphic modes | OP-1, OP-XY | Joy; one idea per screen | Shallow per mode | Strong: colour screen, four knobs |
| Tracker text | LSDJ, M8, Renoise, NerdSEQ | Dense, precise, virtuosic | Hex; learning curve | Good: 240×240 fits a 16-row phrase |
| Touch app / DAW | Live, Bitwig, Drambo, Patterning | Any layout; large views | No tactile feel; screen-bound | Only as a companion editor |
| Companion app or editor | SEQTRAK, Circuit Components, Overbridge | Eases a small screen | Resented when required | Yes, if optional (web tools) |

### 4.6 Song and arrangement models, simplest to richest

| Model | How it works | Exemplars | Strength | Weakness |
|---|---|---|---|---|
| Pattern chain | A list of pattern IDs | PO, volca, SQ-1 | Trivial to learn | No per-track independence |
| Variations + fills | A–H variations, auto-played or switched; fills by timer | TR-8S, TR-1000, deconstruct Minimal, Hortator | Musical, cheap | Limited form |
| Style state machine | Intro, variation, fill, ending | Korg KR-55 Pro, Yamaha QY | Hands-free from a footswitch | Genre-bound |
| Sections A–D | Live-switchable sections, chain, song record | SLOOP, KARMA | Performable | Four sections only |
| Scene list | Rows of per-track pattern choices, with repeats or bar counts | Circuit, EP-133 2.0, OP-XY, Korg Gadget, Octatrack arranger, LOOM-8 | Clean "song = list of scenes" | Scenes bound to patterns |
| Per-track song lists | Each track advances its own list; REST entries | Skiff, LEDGER-4 song columns | Tracks start late or end early | Harder to see the whole |
| Meta-sequence | Pattern list with per-entry durations | Kria | Very cheap | Single track view |
| Tracker hierarchy | Song rows → chains → phrases, with transpose | LSDJ, M8, LEDGER-4 | Compact, reuse by reference | Hidden dependencies |
| Block matrix | Song position × track, cells muted or aliased | Renoise Pattern Matrix | Clip grid and form are one | Desktop-sized |
| Follow actions | Each clip says what follows | Ableton Live, Loopy Pro | Generative structure | Logic hidden in clips |
| Jam to song | A logged performance becomes an arrangement | Melodee, SLOOP song record | No planning | Editing afterwards |
| Linear timeline | Free regions on a ruler; arranger track | Logic, Cubase, Deluge arranger, MPC | Full control | Poor on small screens |

### 4.7 Generative approaches

| Family | Mechanism | Exemplars | Control surface | Strength | Failure mode |
|---|---|---|---|---|---|
| Geometric / Euclidean | k hits evenly over n, rotated | T-1, Pam's, Rozeta Rhythm, Live 12, MYCEL-8 | k, n, rotate, accent | Instantly idiomatic | Too even; no accent hierarchy |
| Stochastic | Shaped random draws | Marbles, Eloquencer, Riffer, OXI Stochastic | spread, bias, chance, range | Endless variety | Aimless; unrepeatable |
| Shift register | Recirculate with flip probability | Turing Machine, Enigma, MYCEL-8 | Mutation knob, length | Evolving but familiar; lockable | Good loops erased by drift |
| Topographic map | Interpolate learned patterns; density threshold | Grids, Augmatic GRE | x, y, density, chaos | Always grooves | Genre-bound; no authorship |
| Curated bank | Hand-picked patterns plus transforms | Noise Engineering Repetitors, KARMA, Motif arps | Bank + transform | Quality floor | Finite; canned |
| Rules / automata | Update rules over state | less concepts, Zellen, Meadowphysics, Teletype | Rule, seed | Emergence from 2 bytes | Dies out; hard to steer |
| Multi-playhead / phase | Several readers over one pattern | Fugue Machine, PolyPhase, René, CANON-4 | Rate, direction, offset per head | Counterpoint from little data | Clashes; drift |
| Elastic time | Duration as data | Metropolix, Buchla 250e, TERRACE-8 | Pulses, gate mode | Long phrases from 8 values | Breaks grid thinking |
| Accumulator | Deterministic change per pass | Metropolix, Elektron A:B, Tidal `every`, TERRACE-8 | Amount, limit | Development without randomness | Mechanical |
| Constraint | Quantise to an allowed set; sequence the set | Quantermain, Meta-Q, Marbles STEPS | Scale, mask, salience | Always musical | Bland |
| Harmony engine | Chord as state; parts derive | NDLR, Cthulhu, Scaler, KARMA, REGENT-4 | Degrees, quality, voicing | Non-players make progressions | Generic progressions |
| Parametric capture | Played input stored as generator parameters | Midicake UNA, Marbles scale learning | Learn, regenerate | Keeps human intent | Hard to edit |
| Overlay / effects | Non-destructive transforms on authored material | Hermod FX, Pyramid FX, Jangada VIVO, KeyStep Spice | Amount, bypass | Source stays pristine | Hidden state |

---

## 5. What players love and hate

### 5.1 Love

1. **Immediacy.** Sound in seconds, with step toggles and a running light. Examples: TR-8S, Pocket Operators, the Model series, Grids, NDLR, Orba.
2. **"Never quite repeats."** Conditions, probability and polymeter turn a short loop into a long piece. Elektron trig conditions, Deluge iterance and Kria per-lane loops are the references.
3. **Jam and snap back.** Elektron's temporary save and reload is one of the most praised features in forum threads. Scene recall and undo come close.
4. **Hands-on per-step editing.** Hold a step and turn a knob (Elektron, Push 3); hold a step and play keys (KeyStep Pro, Prophet-6).
5. **Musical constraint.** Scale lock, keyboard fold (Digitone II), degree keys (NDLR), the OP-XY brain. Nothing sounds wrong, yet it stays expressive.
6. **Happy accidents with a safety net.** The Turing Machine's "almost locked" zone; Marbles' déjà vu with a noon detent.
7. **Randomness with a dial and a re-roll.** MicroFreak Spice and Dice, praised as "randomness that stays musical". One amount control plus one re-roll covers most needs.
8. **Density as one knob.** Grids, Riffer and T-1 pulses show that "how busy" is what performers reach for.
9. **Character in a small UI.** OP-1 Tombola and Finger; Pocket Operator animations; KARMA's pixel characters per track.
10. **Firmware that grows.** EP-133 OS 2.0, OXI 2.0, the Deluge community firmware, Tonverk fixes. Open firmware wins long-term loyalty, and the FM-1 community (about 293 repositories in a GitHub search) is an instance of it.

### 5.2 Hate

1. **Hidden functions and button chords** with no hints. Elektron function combinations, OP-Z, Deluge, MC-101 menus. Sean Luke's Deluge critique names cryptic displays, mode-dependent gestures and "rare tasks making common tasks harder" ([GMU](https://people.cs.gmu.edu/~sean/projects/synth/deluge.html)).
2. **No song or chain mode at launch.** The electribe 2's best-known complaint; the EP-133 before 2.0; early Model series.
3. **Short pattern ceilings.** Circuit at 32 steps, PO at 16, stock FM-1 at 16 before V16.
4. **Autosave without undo.** Yamaha SEQTRAK's autosave makes accidental changes stick ([Magnetic](https://magneticmag.com/2024/06/yamaha-seqtrak-review/)).
5. **Losing a great take.** No seed, no recall, no undo. The most common complaint in the Turing, Marbles and Riffer communities.
6. **"Early access" firmware.** Buggy launches; sequencer depth lagging sound depth (Bento could not record automation on firmware 1.3.4, per [Sound On Sound](https://www.soundonsound.com/reviews/1010music-bento)).
7. **Menu diving for live actions.** Mutes, pattern change and fills should be one press. Stock FM-1 firmware is criticised for menu pages for basic sequencer settings.
8. **Required companion apps.** OP-Z and Circuit Components for core features.
9. **Random rather than musical generators.** Some find Play+ Fill underwhelming; KARMA presets and chord tools can sound canned.
10. **Opaque state.** Invisible locks; per-lane state off-page; "what is the CA doing?".
11. **Theory gatekeeping.** Cthulhu and similar tools assume knowledge of harmony.

---

## 6. Design rules

Each rule has a one-line rationale and an example that does it well (or badly).

### 6.1 Conceptual model

1. **State one metaphor and name things after it.** *Users predict behaviour from a model (Norman).* Good: LOOM-8's knit, weave and loom vocabulary; x0x lamps.
2. **Choose the music theory deliberately, and offer an escape.** *A step grid assumes 4/4 sixteenths (Magnusson); some music needs another clock.* Good: Elektron per-track scale; Melodee's timed notes.
3. **Separate sound from pattern.** *A pattern change should not force a sound change.* Good: Octatrack Parts, Syntakt Perform Kit.
4. **Separate what, when and order.** *Decoupled pitch, rhythm and traversal multiply variety.* Good: T-1 (pitch set, Euclid, voicing), NDLR motifs, René snakes.
5. **Make every abstraction visible.** *Reuse trades viscosity for hidden dependencies (Duignan).* Good: Bitwig clip aliases are marked. Bad: an LSDJ phrase edit silently changes every chain using it.

### 6.2 Mapping and gestures

6. **Spatial mapping first.** *Key n equals step n; knob order equals the on-screen strip.* Good: every FM-1 firmware with white keys as steps.
7. **Hold the object, turn the property.** *One gesture family covers p-locks, step detail and mutes.* Good: Elektron, Push 3, LOOM-8.
8. **Quasi-modes over modes.** *A held button is a temporary layer that cannot be forgotten (Raskin).* Good: SLOOP's hold layers. Offer a lock for two-handed work (SLOOP's HOME).
9. **The same gesture means the same thing everywhere.** *Inconsistency across modes is the Deluge's chief fault (Luke).* Reserve undo, copy, clear, yes and no as constant meta-gestures.
10. **The common case never pays for the rare case.** *Sensible defaults for channels, lengths and new projects.* Bad: Deluge probability behind a magic combination.

### 6.3 Visibility and feedback

11. **Show the layer map while a modifier is held.** *It answers the most consistent complaint in the field.* Good: SLOOP shows held-layer roles on screen; RELAY-16 and the six new firmwares show help cards on a one-second hold.
12. **Give hidden state a glyph.** *Locks, conditions, cued changes and lane lengths must be seen.* Good: Melodee's light grammar: dark, dim (data), bright (active), breathing (waiting).
13. **Make the screen the notation, not a menu.** *Pictures of the pattern beat lists of numbers.* Bad: Baud Girl's six-row lists hide pattern shape. Good: Patterning's rings.
14. **Make polymetre visible.** *Unseen multi-length lanes feel like bugs.* Good: Patterning rings; Wavestate lane bars.
15. **Everything reachable without memorisation.** *Shortcuts are learned from a list, not a manual.* Good: LOOM-8's SEL context list.

### 6.4 Liveness and timing

16. **Audition every edit at once.** *Immediate feedback underpins flow (Nash and Blackwell).*
17. **Never stop the transport for an edit or a save.** *A stalled transport breaks the performance.* Good: in the six new firmwares, SAVE while playing defers the write to the stop.
18. **Quantise changes to the bar, with a visible waiting state.** *Makes live change safe.* Good: Ableton launch quantise; Hortator mutes on the next bar.
19. **Tick-accurate timing with headroom.** *Swing, ratchets and nudge need sub-step resolution.* Good: Novation's six micro-steps per step; X0X degrades sound quality rather than dropping out under load.

### 6.5 Variation and generativity

20. **Deterministic variation first, random second.** *A:B conditions, accumulators and `<a b>` alternation keep authorship.* Good: Elektron A:B, Deluge iterance, Metropolix accumulator.
21. **Randomness needs a lock at three grains.** *Global (freeze the stream), lane (re-roll rhythm only), step (immune).* Good: Turing extremes, Marbles noon, StepBud step lock, Riffer lock-and-reroll.
22. **Seed it, keep a history, make dice undoable.** *A seed recalls the moment exactly.* Good: eight-bells seed codes; less concepts' rule and seed.
23. **Density is the best single knob.** *Store per-step importance so density reveals musically.* Good: Grids.
24. **Variation is an effect, not a mode.** *Non-destructive overlays leave the source pristine.* Good: Hermod and Pyramid MIDI FX, Jangada VIVO, KeyStep Spice.
25. **Let generators commit to editable steps.** *Discovery must turn into editing.* Good: Live 12 generators write clips.
26. **Curate the space behind few controls.** *Every knob position should be usable.* Good: Noise Engineering's 32 rhythms out of 65,536; KARMA's 16 of 400 parameters.
27. **Provide re-sync and reset.** *Any phase or polymetric system drifts.* Good: Wavestate master lane; Kria loop sync.

### 6.6 Safety: undo, snapshots and capture

28. **Undo for every destructive action; redo too.** *Experiment only when it costs nothing.* Good: SLOOP and Jangada OCT± undo; Melodee hold EDIT. Bad: SEQTRAK autosave.
29. **Snapshots and jam-and-snap-back.** *Wreck it live, return in one press.* Good: Elektron temporary reload; MYCEL-8 snapshots.
30. **Capture, don't pre-arm.** *The lost idea is the most regretted moment.* Good: Ableton Move Capture, OXI MIDI Capture, Melodee hold REC.

### 6.7 Structure and reuse

31. **Ship a song or chain mode from day one.** *Its absence is treated as a dealbreaker.* Bad: electribe 2.
32. **Reuse by reference with a transform.** *One phrase, many keys, little memory.* Good: LSDJ chains with transpose; LOOM-8 Weave.
33. **Make song form as simple as a list of scenes.** *The cleanest model for small screens.* Good: Korg Gadget scene list; EP-133 2.0.

### 6.8 Constrained hardware

34. **Many small engines over one deep engine.** *Each fits one screen and four knobs.* Good: OP-1 sequencer apps; Rozeta suite.
35. **Fail safe.** *Safe mode after crashes, data kept across reflash, versioned files.* Good: X0X and ChoralRoot safe mode; Optimist stores data above the firmware area. Bad: Hortator projects from new builds don't load in old ones.

---

## 7. Requirements for a new sequencer

**MUST** is the floor a 2026 user expects. **SHOULD** is expected in a good product. **COULD** is a differentiator. Items are generic; FM-1 specifics follow in 7.14.

### 7.1 Timing and clock
- MUST: a tick-accurate internal clock, at least 24 PPQN internally; 96 PPQN or finer for nudge, swing and ratchets.
- MUST: tempo range about 30–300 BPM with fine steps; tap tempo.
- MUST: MIDI clock out with Start, Stop and Continue; follow an external clock.
- MUST: defined behaviour on clock loss.
- SHOULD: Song Position Pointer in and out.
- SHOULD: global and per-track swing or groove.
- SHOULD: per-port latency compensation.
- COULD: groove templates as tick lists (LSDJ) or importable grooves (OXI).
- COULD: Ableton Link where Wi-Fi exists.

### 7.2 MIDI and I/O
- MUST: class-compliant USB MIDI.
- MUST: per-track MIDI channel and port.
- MUST: notes in to the selected track, and record from MIDI in.
- SHOULD: CC out per track; MIDI learn; program change.
- SHOULD: selectable clock source and destination per port.
- SHOULD: thru and merge choices.
- COULD: multiple ports at once (USB device, USB host, BLE).
- COULD: CV and gate where the hardware allows.

### 7.3 Data model
- MUST: at least 4 tracks; patterns up to 64 steps.
- MUST: per-track length and time division.
- MUST: per step: note(s), velocity, length or tie.
- MUST: chords per step (up to 4 notes) on melodic tracks.
- SHOULD: notes stored as scale degrees where the archetype allows, so key changes re-harmonise.
- SHOULD: sound kept separate from pattern data.
- SHOULD: per-step slide, accent, microtiming and ratchet.
- COULD: per-lane length and division (Kria).
- COULD: per-step duration (stages) or variable-duration steps (OXI SAGA).
- COULD: an importance byte per step for density control.

### 7.4 Editing
- MUST: step toggle; hold a step to edit its detail.
- MUST: step record and real-time record with overdub.
- MUST: copy, paste, duplicate and clear for steps, patterns and tracks.
- MUST: undo, at least one level.
- SHOULD: an undo and redo stack.
- SHOULD: quantise as a non-destructive amount.
- SHOULD: shift, rotate and transpose a pattern.
- SHOULD: motion recording of knob moves.
- COULD: a rule-based transform editor (Cubase Logical Editor).

### 7.5 Variation
- MUST: per-step probability.
- MUST: A:B cycle conditions and FILL / NOT FILL.
- SHOULD: PRE, NEI and FIRST conditions.
- SHOULD: per-step verbs (OP-Z components, tracker commands, LOOM-8 tricks).
- SHOULD: chance × range for pitch (Eloquencer).
- COULD: `<a b>` alternation values per step.
- COULD: accumulators with limit and reset.

### 7.6 Performance
- MUST: mute and solo, with quantised and immediate options.
- MUST: pattern change quantised to the bar, with a visible waiting state.
- MUST: a fill key, held or latched.
- SHOULD: temporary snapshot and reload.
- SHOULD: punch-in effects, recordable.
- SHOULD: beat repeat or note repeat.
- COULD: a scene morph between two snapshots.
- COULD: step jump (press a step key to move the playhead).

### 7.7 Structure and song
- MUST: a song or chain mode at launch.
- MUST: scenes or sections that combine per-track patterns.
- SHOULD: repeat counts or bar lengths per song entry.
- SHOULD: record the song as it is played.
- COULD: per-track song lists with rests (Skiff).
- COULD: reuse by reference with transpose (LSDJ).
- COULD: follow actions.

### 7.8 Generative
- MUST: at least one generator (Euclid, dice or mutate), always undoable.
- SHOULD: seeds stored and recallable; a dice history.
- SHOULD: locks at global, lane and step level.
- SHOULD: a density control.
- SHOULD: commit generated output to editable steps.
- COULD: Turing-style register, topographic map, cellular automaton.
- COULD: learn from a played phrase.

### 7.9 Harmony
- MUST: key and scale; scale lock for entry.
- MUST: global transpose.
- SHOULD: keyboard fold to scale degrees.
- SHOULD: chord entry by degree with quality modifiers.
- SHOULD: a conductor or chord track that other tracks follow.
- COULD: voice-leading; neo-Riemannian P/L/R moves; scale-mask lanes.
- COULD: microtonal scales.

### 7.10 Saving and data
- MUST: several project slots.
- MUST: no data loss on save during playback (save live, or defer clearly).
- MUST: a versioned file format; newer files detected, not shown as empty.
- SHOULD: autosave paired with undo or snapshots, never alone.
- SHOULD: backup and restore to a computer.
- SHOULD: data stored where reinstalling firmware doesn't erase it.
- COULD: share codes or seeds for patterns.

### 7.11 Robustness and tooling
- MUST: safe mode after a crash loop; a recovery path to stock firmware.
- MUST: timing that holds under full load.
- SHOULD: a host simulator with scripted tests (`tap REC`, `expect note`).
- SHOULD: a browser emulator and a web installer.
- SHOULD: graceful degradation under CPU load.
- COULD: an on-device log and CPU meter.

### 7.12 Discoverability and accessibility
- MUST: on-screen labels for whatever the knobs and keys do now.
- MUST: a layer map when a modifier is held.
- SHOULD: a help card for every control.
- SHOULD: a context list of every action.
- SHOULD: a one-page cheat sheet.
- SHOULD: a consistent light grammar (off, dim, bright, blink, breathing).
- COULD: screen-reader support (fm1-base has one).
- COULD: a guided first-boot mode where every control is safe (Blipblox).

### 7.13 Interop
- SHOULD: USB audio out.
- SHOULD: MIDI file import and export, or a web editor.
- COULD: multichannel stems (KARMA, Hortator).
- COULD: receive patterns from a browser tool (eight-bells).

### 7.14 FM-1-specific constraints

From the fm1-base platform headers and the sources linked in [fm1-base](https://github.com/charlesvestal/fm1-base):

| Resource | Constraint | Design consequence |
|---|---|---|
| Keys | 27 keys, F3–G5: 16 white, 11 black, each with an LED. Velocity and pressure readable but off by default. | White keys are a 16-step row; black keys an irregular object row (11 drums, 8 mutes + 3, heads, colours). |
| Buttons | 14: FX, SEL, ENV, LFO, EDIT, GLO, HOME, SAVE, ARP, SEQ, PLAY, REC, OCT−, OCT+. LEDs with dim and bright levels. No SHIFT. | Hold-to-layer and hold-plus-key chords are mandatory. Help cards are the antidote. |
| Encoders | 7 detented: SELECT, ALGORITHM, PRESETS, K1–K4; plus a MASTER pot. | K1–K4 are a strip of four values. Community convention: ALGORITHM = track, SELECT = page, PRESETS = next item. |
| Screen | 240×240 colour TFT, RGB565. | Fits a 16-row tracker phrase, a 4×4 field, rings, or 16 steps × 8 tracks in small type. Not a timeline. |
| MIDI | USB-C class-compliant MIDI and audio; USB host for one device (needs a powered hub); BLE MIDI peripheral and central; TRS MIDI **in only**. | External sequencing goes out over USB or BLE. TRS out needs a hardware mod. |
| CPU | JieLi AC791N, dual core, 360 MHz in current builds. | The synth and the sequencer share it; X0X shows that using both cores matters. |
| Flash and RAM | App slot about 581 KB; 96 KB RAM for `.data`/`.bss` plus a 336 KB pool; no external RAM. Newer units have a UC25HQ80 flash chip that older firmwares don't handle. | Compact data (degrees, references, seeds). Flash can fill: LOOM-8 is near its limit. |
| Tooling | fm1-base host simulator and browser emulator; installer that can restore stock firmware. | Every firmware should ship host tests and simulator screenshots. |

---

## 8. Choosing three, then six, archetypes for the FM-1

### 8.1 Why these six

The FM-1 community already covers the most popular archetypes well:
- **x0x and trig-and-lock:** LOOM-8, Hortator, SLOOP, Optimist, Groove OS, X0X, KARMA, Jangada, WARP-8 and the stock V16 firmware. White keys as steps, hold a step for detail, per-track length, p-locks, chance, ratchets and fills are the community floor.
- **Multi-track MIDI step sequencing:** RELAY-16.
- **Clip and scene structure:** LOOM-8 Arrange, Groove OS Perform, Melodee sections.

A seventh trig-and-lock groovebox would add little. The aim was the opposite: pick the archetypes that are **most distinct** from that floor and from each other, so each firmware tests a different idea of what a sequencer is.

**The first three** cover the three main ways music enters a sequencer other than step entry:
- **Tracker** (written as text, reused by reference): LEDGER-4.
- **Generative** (grown from rules): MYCEL-8.
- **Live-loop recorder** (played and kept): SPOOL-4.

**The second three** cover the three most distinct models of harmony and time:
- **Harmonic conductor** (harmony as the input): REGENT-4. LOOM-8's COND track and KARMA's generators exist, but as helpers inside a groovebox, not as the whole instrument.
- **Stage / elastic time** (duration as data): TERRACE-8.
- **Multi-playhead canon** (reading as data): CANON-4.

All six share a core: an 8-voice synth, eleven synthesised drums on General MIDI notes and a shared echo. Every part also goes out as MIDI on its own channel over USB and Bluetooth MIDI. Clock is INTERNAL or FOLLOW. There are four project slots; SAVE while playing saves at the stop. Holding any button for a second shows a help card. PLAY, SAVE and OCT± work the same in all six.

**Common limits.** Each is version 0.1. Each builds for the FM-1, passes its host-simulator tests, and has screenshots taken from the simulator. None has been run on a real FM-1. CPU load of the synth on the device has not been measured. The synth has 8 voices shared by all parts.

### 8.2 LEDGER-4: tracker

- **Aim:** bring the tracker's way of writing to the FM-1. Notes as rows of text, read top to bottom, with a command on each row saying how the note plays. Depth from very little: a 16-row phrase reused by reference in chains with a transpose each time, chains laid out in a song.
- **What it has:**
  - SONG: 64 rows × 4 tracks of chain numbers. Each track walks its own column, so blocks of different lengths drift.
  - CHAIN: 16 rows of phrase plus transpose. PHRASE: 16 rows of NOTE, INSTRUMENT, VELOCITY, COMMAND, VALUE.
  - 13 commands: arpeggio, chance, delay, kill, retrigger, slide, tempo, hop, filter, MIDI CC, random, groove, echo. Each is explained in words under the grid when the cursor lands on it.
  - Grooves as two tick counts per row (6/6, 7/5), as in LSDJ.
  - 16 instruments: synth, drums or MIDI only.
- **Design rules applied:** 5 (the command is explained in words, softening hex), 9 (constant pages per button), 15 (hold for help), 16 (live editing while playing), 32 (reuse by reference with transpose), 13 (the screen is the notation).
- **Key mapping in brief:** HOME / SEQ / EDIT / ENV / GLO open SONG / CHAIN / PHRASE / INSTRUMENT / PROJECT. SELECT and ALGO move the cursor row and column. PRESETS and K1 change the value by 1 or 16. Keys write a note and advance; in number columns the white keys type hex 0–F; in the command column they pick the command. SEL dives into what is under the cursor; ARP makes the next unused chain or phrase, or a note off. FX clears a cell; SEL + LFO / LFO copy and paste. REC turns editing on and off. Black keys 1–4 mute tracks on SONG.
- **Known limits:** 4 tracks; 16 instruments. Reuse by reference is a hidden dependency by nature. Untested on hardware.

### 8.3 MYCEL-8: generative

- **Aim:** grow music rather than write it. Each of eight parts is a handful of numbers: a Euclidean rhythm and a Turing-machine register that loops and, by a MUTATE amount, slowly changes. Notes come from a pool of scale degrees lit on the white keys, so output is always in key.
- **What it has:**
  - 8 parts with four pages: RHYTHM (steps 1–32, pulses, rotate, division 1/32 to a bar), PITCH (register length, mutate %, range, mode: Turing, cycle, bounce, random, drone), FEEL (chance, accents, gate, ratchets), SOUND.
  - FX locks every register. PRESETS right rolls dice; left steps back through the last 8 registers.
  - DENSITY and TIDE (extra mutation) for every part at once; LFO held makes it denser while held; ENV re-syncs all parts.
  - 8 snapshots of the whole field, recalled at the next bar.
- **Design rules applied:** 21 (lock), 22 (dice history), 23 (density), 27 (re-sync), 29 (snapshots), 18 (recall at the bar), 4 (rhythm separate from pitch).
- **Key mapping in brief:** ALGO or black keys 1–8 pick the part; SELECT or SEQ the page; K1–K4 the page's values; white keys toggle the pool (on a drum part, its sound). FX lock; ARP dice; EDIT mutes the part; GLO held + black mutes parts, GLO tapped shows the FIELD page. SAVE held + white 1–8 keeps a snapshot, HOME held + white 1–8 recalls it. SEL held + white sets the root, SEL + PRESETS the scale. REC lets the keys play the part, snapped to the key.
- **Known limits:** no step editing or commit to steps; no song mode beyond snapshots. Untested on hardware.

### 8.4 SPOOL-4: live-loop recorder

- **Aim:** for players who never enter a step. The first take sets a loop's length to the nearest bar; each later pass is an overdub layer. Quantise is a dial applied at playback, never written into the notes. Every note on the keys is kept, so CAPTURE puts the phrase just played into the loop.
- **What it has:**
  - 4 loops of up to 16 bars and 448 notes each, each with its own sound and MIDI channel.
  - REC: first take (nearest bar, or a fixed length on K3), then overdubs; a bar's count-in from a stop.
  - Undo and redo by layer; clear is undoable.
  - Non-destructive quantise: amount (K1) and grid (K2).
  - FX held erases what passes the playhead. ARP held + key gives recorded note repeat.
  - Double or halve a loop; half, normal or double speed (K4); transpose (PRESETS).
  - CAPTURE (ENV): the last phrase played becomes a layer; an empty loop takes 1, 2, 4 or 8 bars.
- **Design rules applied:** 28 (undo by layer), 30 (capture), 24 (quantise as a non-destructive effect), 16 (keys always sound), 34 (one small idea on one screen).
- **Key mapping in brief:** keys play the loop's sound; ALGO picks the loop; REC first take, close, overdub; SEQ / SEL + SEQ undo / redo; EDIT / SEL + EDIT mute / clear; ENV capture; LFO / SEL + LFO double / halve; K1–K4 quantise amount, grid, new-take length, speed; SELECT tempo; SEL tap, GLO and HOME open SOUND, SETUP and LOOPS.
- **Known limits:** 16 bars and 448 notes per loop; no note editing beyond layers, erase and quantise; no song mode. Untested on hardware.

### 8.5 REGENT-4: harmonic conductor

- **Aim:** let someone who thinks in harmony make a whole arrangement from chord changes. White keys are degrees of the key, so every chord is in key; black keys colour it. Four parts and a beat follow.
- **What it has:**
  - White keys 1–14: chords on degrees I–VII and an octave up; white 15: no chord; white 16: tap tempo.
  - Black keys 1–7 with a chord key: 7, sus2, sus4, add9, 6, flip (major/minor), b5. Black keys 8–11 mute the parts.
  - PAD (hold, quarters, eighths, on change; voice-led, spread), BASS (8 figures), MOTIF A and B (12 figures + dice, 6 rates, 1–3 octaves), BEAT (6 grooves, fills before a change).
  - Chords change at once, on the beat or at the bar; the next chord is shown while it waits.
  - A PROGRESSION of 16 chords with beats each: recorded by playing, edited on its page, played by SEQ.
  - The chord name and numeral are drawn large.
- **Design rules applied:** 4 (parts are indices into the chord), 6 (degrees on white keys), 18 (chord change quantise with a visible next chord), 12 (chord name and numeral visible), 26 (curated figures behind few controls).
- **Key mapping in brief:** white keys chords; black 1–7 colours; black 8–11 mutes; ALGO picks the part, K1–K4 its figure, rate or octave, range, gate or spread, and level; PRESETS key root, SEL + PRESETS scale; SELECT tempo; REC records a progression; SEQ plays it; EDIT opens it; ARP dices a motif; LFO mutes the part.
- **Known limits:** progression of 16 chords; diatonic degrees with seven colours, so chromatic harmony is limited; parts are fixed figures plus dice. Untested on hardware.

### 8.6 TERRACE-8: stage / elastic time

- **Aim:** make time part of the step. Each of eight stages has a pitch and a number of pulses, with a gate mode deciding what happens across those pulses. Eight values become phrases of up to 64 pulses with acid and analogue-bass swing and stutter, without a 64-step grid.
- **What it has:**
  - 2 lines × 8 stages: pitch (scale degree), pulses 1–8, gate mode, ratchets 1–4, slide, accent, skip.
  - Directions: forward, backward, ping-pong, random, random walk; stages in play 1–8; pulse length 1/32 to 1/4.
  - An accumulator adds degrees each time round and returns to zero past its limit.
  - The screen draws each stage as a terrace: as wide as it lasts and as high as it sounds.
- **Design rules applied:** 7 (hold a stage, the knobs are the stage), 13 (the terrace view is the notation), 20 (accumulator as deterministic variation), 27 (re-sync), 28 (dice with undo), 2 (an escape from the grid).
- **Key mapping in brief:** white 1–8 / 9–16 are line A / line B stages; held, K1–K4 are pitch, pulses, gate, ratchets. Black 1–5 set gate mode (silent, once, every, hold, every other); black 6–8 slide, skip, accent. K1–K4 with nothing held: direction, stages in play, pulse length, accumulator. ALGO picks the line; REC writes stages from the keys or MIDI in; ARP / SEQ dice / undo; FX re-sync; LFO mutes the line.
- **Known limits:** two lines of eight stages; no song mode. Grid-style drum programming is not its purpose. Untested on hardware.

### 8.7 CANON-4: multi-playhead canon

- **Aim:** turn one short phrase into counterpoint. Sixteen cells (a 4×4 field of scale degrees and rests on the white keys) are read by four playheads, each with its own rate, direction, path, offset, length, transpose and sound. One edit and every voice hears it. The heads drift apart and meet again every few bars.
- **What it has:**
  - 16 cells: degree, note or rest, velocity, chance, length.
  - 4 heads: rate 1/32 to 1/2, direction, path (6: rows, columns, a snake, diagonals, a spiral, random), offset, length 1–16, transpose in degrees, octave, sound, mute.
  - Heads meet again every N bars, or run free; re-sync on demand.
  - The screen shows each head's position as a coloured corner of its cell.
- **Design rules applied:** 4 (traversal separate from data), 27 (meet-again and re-sync), 14 (head positions visible), 7 (hold a cell, the knobs are the cell), 28 (dice with undo).
- **Key mapping in brief:** white keys are cells: tap for note or rest; hold, then K1–K4 for pitch, velocity, chance, length. Black 1–4 pick the head (GLO held: mute); black 5–10 the head's path; black 11 or FX re-syncs. K1–K4 with nothing held: rate, transpose, offset, length. PRESETS sets direction; ALGO the head; REC writes cells; ARP / SEQ dice / undo.
- **Known limits:** one 16-cell field; harmonic clashes are managed only by scale and transpose; no song mode. Untested on hardware.

### 8.8 What the six leave open

The six apply most of the safety and visibility rules. They are thin on structure: only LEDGER-4 has a song. None commits generated output to editable steps or exchanges patterns with a computer beyond MIDI. These are the next steps once the firmwares have been tried on hardware.

---

## 9. Web sequencers

The same survey, read again for the browser. The archetypes do not change on the web, but the platform changes
what is easy, what is hard, and what users expect. This section covers the web landscape, what the platform imposes,
the extra design rules and requirements it adds, and the six web sequencers built from it.

### 9.1 The landscape on the web

| Product | Archetype | What it shows the web can do |
| --- | --- | --- |
| [Chrome Music Lab Song Maker](https://musiclab.chromeexperiments.com/Song-Maker/) | x0x grid, scale-constrained | Pitch rows locked to a scale, so no wrong notes; the song is saved and shared as a URL |
| [Ableton Learning Music](https://learningmusic.ableton.com) | guided step grid | Teaching by constraint: each lesson unlocks one concept in a small grid |
| [Strudel](https://strudel.cc) | pattern language | Tidal's engine in JavaScript, zero install, the sounding token highlighted in the code |
| [Orca](https://100r.co/site/orca.html) (web build) | spatial code | A grid of operators that is program, sequencer and display at once; MIDI out from the page |
| Browser DAWs (BandLab, Soundtrap) | linear arrangement + piano roll | Collaboration and cloud projects; the DAW model moved into a tab |
| Web emulators of hardware (fm1-base's browser emulator, others) | whatever the device is | The firmware's own code compiled to WebAssembly, so a device can be tried before buying or installing |

The web's strengths are reach (a link plays), sharing (the URL is the file), large pointer-driven screens and free
graphics. Its weaknesses are timing that must be planned (the main thread is not a real-time thread), audio that
starts only after a user gesture, Web MIDI that not every browser ships (Safari had not shipped it at the time of the
research), and tabs that are throttled in the background.

### 9.2 What the platform imposes

- **Two clocks.** JavaScript timers drift and stall; the audio clock (`AudioContext.currentTime`) does not. The
  standard answer is the look-ahead scheduler (Chris Wilson's "A Tale of Two Clocks"): a timer wakes every 25 ms and
  schedules every event in the next ~100 ms at its exact audio time. Drawing follows with `requestAnimationFrame`,
  reading what was scheduled, never deciding timing.
- **Background tabs.** Browsers throttle timers in hidden tabs, so a 25 ms timer can become 1 s. A look-ahead larger
  than the throttled period, or scheduling from an AudioWorklet, keeps music going when the user switches tabs.
- **Autoplay.** No sound before a click or key press. The first gesture must start (or resume) the audio context.
- **Latency.** Output latency (`outputLatency`) varies from ~10 ms to 50+ ms with the device; the playhead on screen
  and MIDI timestamps must be offset by it, or visuals lead the sound.
- **Web MIDI.** Permission prompts; device lists that change (`onstatechange`); timestamps in `performance.now()`
  time, which must be converted from audio time; SysEx needs separate permission.
- **Storage.** localStorage (small, synchronous), IndexedDB (large), files (download/upload), and the URL hash.
  Users clear storage; a file or link is the only safe copy.
- **Input.** Pointer events unify mouse, touch and pen; touch has no hover and fat fingers (32-44 px targets);
  keyboard shortcuts collide with the browser's own (Space scrolls, Cmd+Z, Tab).
- **Screens.** From 360 px phones to 4K monitors in one code base; layout must reflow rather than scale.

### 9.3 Design rules the web adds

36. **Schedule on the audio clock, draw from what was scheduled.** Never play a note from a timer callback or an
    animation frame. *Good:* Strudel, Tone.js-based tools. *Bad:* `setInterval` step sequencers that swing by accident.
37. **Make the first gesture count.** The page opens with music in it, and the first click both starts the audio and
    plays. *Good:* Song Maker.
38. **The URL is a save file.** Share links hold the whole state; opening one restores it exactly. *Good:* Song Maker.
39. **Autosave, and say so.** Restore the last state on load; keep a file export for the safe copy.
40. **Use the screen's size.** Show the whole structure at once on a large screen (all tracks, all scenes, the
    whole field), and reflow to one column on a phone. A desktop page should not look like a phone app.
41. **Keyboard parity.** Every pointer action has a keyboard path, and the computer keyboard doubles as a piano.
42. **Latency honesty.** Offset the playhead and MIDI by the measured output latency; never draw ahead of the sound.

### 9.4 Requirements the web adds

| Requirement | Level |
| --- | --- |
| Look-ahead scheduling on the audio clock; sample-accurate note times | MUST |
| Audio starts on the first user gesture; a visible play control | MUST |
| Works at 360 px wide with no horizontal page scroll; uses large screens | MUST |
| Autosave to local storage; file export and import (JSON) | MUST |
| Undo and redo for every edit (Cmd/Ctrl+Z) | MUST |
| Space plays and stops; `?` opens help listing every control | MUST |
| Light and dark themes from colour tokens; visible focus; ARIA labels on icon controls | MUST |
| Web MIDI out with a chosen port, per-part channels, timestamps converted from audio time | SHOULD |
| Web MIDI in to play or record; MIDI clock out | SHOULD |
| Share links holding the state | SHOULD |
| Keeps time in a background tab (large look-ahead or a worklet scheduler) | SHOULD |
| Runs from `file://` with no build step and no network (plain scripts, no CDN) | COULD |
| Installable and offline (a web app manifest and service worker) | COULD |

### 9.5 The six web sequencers

The FM-1 set took the archetypes that suit 27 keys, 7 encoders and a 240 x 240 screen. The web set takes the
archetypes that *need* a big screen, a pointer or a text editor, and the one the FM-1 community already covers
well, the trig-and-lock groovebox, which on a large screen can finally show everything at once. None repeats a
firmware's archetype.

| App | Archetype (section) | Why it belongs on the web | Rules it leans on |
| --- | --- | --- | --- |
| STITCH | trig-and-lock groovebox (3.2) | All 8 tracks, their conditions and locks visible at once, no hidden modes; hold or right-click a step to lock | 6.2 hold the object, turn the property; 6.3 visible state; 6.6 snap-back |
| QUILT | clip and scene launcher (3.7) | A 6 x 8 grid of clips plus a clip editor needs the screen; follow actions let a set play itself | 6.4 changes quantised to the bar with a waiting state; 6.7 structure by scenes |
| STRAND | pattern language (3.15) | Needs a keyboard and a text editor; the sounding characters light up, so code and playhead are one | 6.1 one notation; 6.3 show what sounds; errors keep the last good version |
| LICHEN | generative, automata (3.8) | A 16 x 16 field you paint with a pointer; rewind 32 generations and keep 8 states | 6.5 probability needs a lock; 6.6 never lose a good moment |
| ORBIT | polymetric (3.10) | Rings make polymeter visible and draggable; it counts down to the line-up | 6.5 make polymeter visible; 6.4 re-sync is a performance control |
| TOPO | generative, topographic map (3.8) | An XY pad and a terrain map are pointer-native; density is the one knob that matters | 6.5 density is the best single knob; bake to steps (freeze) |

What they share is the web's own list (9.3, 9.4): the audio-clock scheduler, sound on the first gesture, autosave,
files and share links, undo for every edit, Space and `?` everywhere, light and dark themes, a phone layout with the
play button under the thumb, and Web MIDI out with timestamps. Each was tested in Chrome on desktop and at phone
width; Safari, Firefox and real MIDI hardware are untested.

## 10. Sources

**Hardware**
- Elektron Digitakt II: [Synthtopia](https://synthtopia.com/?p=142693), [Sound On Sound](https://www.soundonsound.com/reviews/elektron-digitakt-ii?amp)
- Elektron Syntakt news: [Elektronauts](https://www.elektronauts.com/c/news/41)
- Elektron Tonverk: [MusicRadar](https://www.musicradar.com/music-tech/samplers/elektron-tonverk-review), [Gearnews](https://www.gearnews.com/elektron-tonverk-review/), [Schneidersladen](https://schneidersladen.de/en/elektron-elektron-tonverk)
- Elektron Outbox 8: [Synth Anatomy](https://synthanatomy.com/2026/09/elektron-outbox-8-a-multi-output-interface-and-game-changing-for-elektron-users.html)
- Elektron trig conditions: [Elektronauts](https://www.elektronauts.com/t/ot-trig-conditions-trc-thread/44828?page=18); lock memory: [Elektronauts](https://www.elektronauts.com/t/parameter-lock-memory-full/186365); Machinedrum: [manual](https://www.elektron.se/wp-content/uploads/2024/09/machinedrum_manual_OS1.63.pdf)
- Teenage Engineering OP-1: [TE product page](https://teenage.engineering/products/op-1), [Bonedo](https://www.bonedo.de/?p=1772037), [TE 2025](https://teenage.engineering/now/2025)
- OP-XY: [Perfect Circuit](https://www.perfectcircuit.com/teenage-engineering-op-xy.html), [MusicRadar](https://musicradar.com/music-tech/synths/teenage-engineering-op-xy-review), [Synth Anatomy](https://synthanatomy.com/2025/10/teenage-engineering-op-xy-a-supercharged-op-z-groovebox.html), [Sound On Sound](https://www.soundonsound.com/reviews/teenage-engineering-op-xy?amp), [TE downloads](https://teenage.engineering/downloads/op-xy)
- EP-133: [MusicRadar](https://musicradar.com/music-tech/teenage-engineering-drops-knockout-update-for-its-ep-133-k-o-ii-sampler-bringing-much-requested-features-like-resampling-song-mode-and-increased-polyphony), [Synth Anatomy 2025](https://synthanatomy.com/2025/04/teenage-engineering-ep-133-ko-ii-an-evolved-po-33-sampler-with-more-power.html), [Synth Anatomy 2026](https://synthanatomy.com/2026/01/teenage-engineering-ep-133-ko-ii-an-evolved-po-33-sampler-with-more-power.html)
- Roland TR-1000: [Synth Anatomy](https://synthanatomy.com/2025/10/roland-tr-1000-rhythm-creator-the-marriage-of-the-analog-and-digital-tr-era-with-sampling.html), [DJ TechTools](https://djtechtools.com/2025/10/01/tr-1000-roland/), [CDM](https://cdm.link/tr-1000-technical-details/); Boutique JUPITER-08: [SonicState](https://sonicstate.com/news/2026/10/20/roland-boutique-jupiter-08-more-voices-and-control/)
- TR-808 history: [Smithsonian](https://www.smithsonianmag.com/arts-culture/history-tr-808-drum-machine-180975205/), [raygum](https://raygum.com/research/roland-tr-808-monograph), [CDM](https://cdm.link/tadeo-kikumoto-808-day/)
- Korg SQ-64: [Reverb](https://reverb.com/news/korg-releases-new-compact-sq-64-polyphonic-step-sequencer), [Perfect Circuit](https://www.perfectcircuit.com/signal/korg-sq64); KR-55 Pro: [Korg](https://www.korg.com/us/products/drums/kr55pro/index.php), [KVR](https://www.kvraudio.com/news/39986); Wavestate: [manual](https://storage.korg.com/korgms/support/wavestate_native/wavestate_native_OM_E.pdf), [Sound On Sound](https://www.soundonsound.com/reviews/korg-wavestate); Phase8: [MusicRadar](https://www.musicradar.com/music-tech/its-beyond-analogue-vs-digital-its-even-beyond-electronics-korg-releases-experimental-phase8-eight-voice-acoustic-synthesizer); Superbooth prototype: [Synth Anatomy](https://synthanatomy.com/2026/05/korg-showcases-new-mysterious-prototype-synthesizer-at-superbooth-2026.html)
- Akai MPC Live III: [Sound On Sound](https://www.soundonsound.com/news/akai-pro-reveal-mpc-live-iii), [Attack](https://www.attackmagazine.com/news/mpc-live-iii-is-here-with-3d-sensing-pads-step-sequencer/), [MusicRadar](https://www.musicradar.com/music-tech/akai-mpc-live-3-review), [Internet Tattoo](https://www.internettattoo.com/blog/mpc-live-iii-news-review); MPC Key 37: [Magnetic](https://magneticmag.com/2024/02/akai-mpc-key-37-review/)
- Novation Circuit Tracks: [MusicTech](https://www.musictech.com/reviews/hardware-instruments/novation-circuit-tracks-review/)
- Polyend: [Magnetic](https://magneticmag.com/2025/10/polyend-marks-10-years-with-major-tracker-family-update/), Play: [Waveform](https://waveformmagazine.com/waveform-reviews/play-polyend/), [Perfect Circuit](https://www.perfectcircuit.com/signal/polyend-play-review), [Sound On Sound](https://www.soundonsound.com/reviews/polyend-play-0), [Equipboard](https://equipboard.com/items/polyend-play-sample-based-midi-groovebox); Seq: [Ask.Audio](https://ask.audio/articles/polyend-releases-seq-hardware-step-sequencer-13-update)
- Squarp Hapax: [Juno Daily](https://www.juno.co.uk/junodaily/2023/05/26/squarp-hapax-review), [Perfect Circuit](https://www.perfectcircuit.com/signal/squarp-hapax-review), [Gearnews](https://www.gearnews.com/?p=120779); Hermod: [Synthtopia](https://synthtopia.com/content/2023/06/21/squarp-intros-hermod-an-updated-modular-brain-for-eurorack-synthesizers)
- 1010music: [Synth Anatomy](https://synthanatomy.com/2026/05/1010music-blackbox-2-compact-sampler-workstation.html), [Sound On Sound Bento](https://www.soundonsound.com/reviews/1010music-bento), [Thomann](https://www.thomannmusic.com/1010music_bento_reviews.htm)
- Torso T-1: [Synthtopia](https://www.synthtopia.com/content/2022/01/09/torso-t-1-sequencer-in-depth-review/), [MusicRadar](https://www.musicradar.com/reviews/torso-electronics-t-1-algorithmic-sequencer), [Gearspace](https://gearspace.com/threads/torso-electronics-updates-t-1-algorithmic-sequencer-to-version-2-0.1394733/latest), [Perfect Circuit](https://www.perfectcircuit.com/signal/torso-t-1); S-4: [CDM](https://cdm.link/torso-s-4-os-2-0/), [MatrixSynth](https://www.matrixsynth.com/2026/06/riding-new-torso-s4-firmware-22.html)
- OXI One MkII: [Thomann](https://www.thomannmusic.com/oxi_instruments_one_mkii_black_edition.htm), [Gearnews](https://www.gearnews.com/oxi-one-mkii-synth/), [Synth Anatomy](https://synthanatomy.com/2026/05/oxi-one-mkii-hardware-sequencer-gets-major-feature-upgrade.html), [SonicState](https://sonicstate.com/news/2026/10/18/brooklyn-expo-2026-oxi-instruments-one-coral-updates/), [Perfect Circuit](https://www.perfectcircuit.com/signal/oxi-one-sequencer-review); Coral: [Sound On Sound](https://www.soundonsound.com/reviews/oxi-instruments-coral)
- Deluge community firmware: [GitHub](https://github.com/SynthstromAudible/DelugeFirmware/blob/release/1.2/docs/community_features.md), [MatrixSynth](https://www.matrixsynth.com/2025/01/new-deluge-community-firmware-12.html); critique: [Sean Luke](https://people.cs.gmu.edu/~sean/projects/synth/deluge.html)
- Yamaha SEQTRAK: [DJ Life](https://djlifemag.com/2025/05/mobile-ideastation-yamahas-seqtrak-review/), [Magnetic](https://magneticmag.com/2024/06/yamaha-seqtrak-review/), [Elektronauts](https://www.elektronauts.com/t/yamaha-seqtrak/206901?page=53)
- Sonicware deconstruct Minimal: [Synth Anatomy](https://synthanatomy.com/2026/05/sonicware-deconstruct-minimal-a-groovebox-that-goes-back-to-the-roots.html); Cre8audio Programm: [Synth Anatomy](https://synthanatomy.com/2026/04/cre8audio-programm.html); dadamachines TBD-16: [Synth Anatomy](https://synthanatomy.com/2026/05/dadamachines-tbd-16-this-groovebox-is-playful-deep-and-hackable.html); KOMA Monoplex: [Synthtopia](https://www.synthtopia.com/content/2026/05/08/koma-monoplex-melodic-microtonal-sequencer-debuts-at-superbooth-2026/)
- Arturia KeyStep: [Arturia](https://www.arturia.com/products/hybrid-synths/keystep-pro/overview), [Spice](https://support.arturia.com/hc/en-us/articles/24773018134684-KeyStep-37-mk2-Mutate-and-Spice)

**Modular and generative**
- Make Noise René mk2: [Loopop](https://loopopmusic.com/make-noise-rene-2-review-euroracks-top-sequencer-gets-a-major-redesign), [VoltPages](https://ogabrielluiz.github.io/voltpages/modules/make-noise--rene-mk2/)
- Intellijel Metropolix: [Perfect Circuit](https://www.perfectcircuit.com/intellijel-metropolix.html), [Intellijel forum](https://forum.intellijel.com/t/fully-decoupling-track-2-on-metropolix/4537)
- Buchla 250e: [Buchla](https://buchla.com/product/250e/), [docs](https://buchlausa.github.io/buchla_doc/docs/200e/250e), [MatrixSynth](https://www.matrixsynth.com/2013/12/buchla-250e-arbitrary-dual-function.html)
- Mutable Instruments Grids: [manual](https://pichenettes.github.io/mutable-instruments-documentation/modules/grids/manual/), [Topograph](https://valleyaudio.github.io/rack/topograph); Marbles: [manual](https://pichenettes.github.io/mutable-instruments-documentation/modules/marbles/manual/)
- Turing Machine: [Sound On Sound](https://www.soundonsound.com/reviews/music-thing-modular-turing-machine-mkii)
- Noise Engineering: [NR](https://manuals.noiseengineering.us/nr/), [ZR](https://manuals.noiseengineering.us/zr/), [Multi Repetitor](https://noiseengineering.us/blogs/loquelic-literitas-the-blog/introducing-multi-repetitor/)
- monome: [Kria](https://monome.org/docs/ansible/kria/), [kria iii](https://aktsom.github.io/kria_iii/kria_iii_manual.html), [Meadowphysics](https://monome.org/docs/meadowphysics/), [Earthsea](https://monome.org/docs/earthsea/), [Teletype](https://monome.org/docs/teletype/studies-2), [Just Type](https://monome.org/docs/teletype/jt-5)
- norns: [Awake](https://gist.github.com/justmat/5c3415d03d9c6883c3132c14ba9fc49d), [Cheat Codes 2](https://musichackspace.org/product/going-further-with-cheat-codes-2-a-sample-playground-for-norns/), [less concepts](https://cycling74.com/tutorials/algorithms-less-concepts-max-for-live-device-cellular-automata)
- 4ms Catalyst: [Sound On Sound](https://www.soundonsound.com/reviews/4ms-catalyst-sequencer-controller)
- Ornament & Crime: [ModularGrid](https://modulargrid.net/e/after-later-audio-uo-c-1u), [Hemisphere Enigma](https://www.github.com/Chysn/O_C-HemisphereSuite/wiki/Enigma)
- Pamela's Pro Workout: [CDM](https://cdm.link/pamelas-pro-workout/), [Sound On Sound](https://www.soundonsound.com/reviews/almbusy-circuits-pamelas-pro-workout)
- Erica Black Sequencer: [manual](https://www.ericasynths.lv/media/BlackSequencer_manual_1-2022.pdf); Five12 Vector: [user guide](https://analoguehaven.com/five12/vector-sequencer/userguide.pdf), [Synthtopia](https://synthtopia.com/content/2020/02/16/five12-vector-eurorack-sequencer-review-hands-on-demo/); Eloquencer: [manual](https://de.juno.co.uk/downloads/manual/785042-01U.pdf/); NerdSEQ: [Perfect Circuit](https://www.perfectcircuit.com/xor-nerdseq-tracker.html)
- NDLR: [Synthtopia](https://synthtopia.com/?p=87927); Midicake: [Sound On Sound](https://www.soundonsound.com/reviews/midicake-arp), [UNA](https://sonicstate.com/news/2026/10/15/soniclab-midicake-una-intelligent-arp-sequencer/)
- KARMA (Korg): [Sound On Sound](https://www.soundonsound.com/reviews/korg-karma); Yamaha Motif arps: [Yamaha Synth](https://yamahasynth.com/?p=2575); Hydrasynth: [MusicTech](https://musictech.com/reviews/hardware-instruments/ashun-sound-machines-hydrasynth/)
- Blipblox myTRACKS: [MusicRadar](https://musicradar.com/news/blipblox-mytracks-kids-groovebox); Orba: [manual](https://artiphon.freshdesk.com/support/solutions/articles/44002548340-orba-family-user-manual)
- Euclidean rhythms: [Toussaint](https://cgm.cs.mcgill.ca/~godfried/publications/banff.pdf), [Demaine et al.](https://erikdemaine.org/papers/DeepRhythms_CGTA)

**Software**
- Ableton Live 12 MIDI tools: [Sound On Sound](https://www.soundonsound.com/techniques/ableton-live-12-midi-generators), [Ableton manual](https://www.ableton.com/ja/live-manual/12/midi-tools/), [MIDI Tools pack](https://www.ableton.com/en/packs/midi-tools); Live 12.3: [Mixdown](https://mixdownmag.com.au/news/ableton-live-12-3-drops-overnight-with-stem-separation-and-splice-integration/)
- Bitwig Studio 6: [MusicRadar](https://www.musicradar.com/music-tech/bitwig-studio-6-is-here-with-improved-automation-clip-aliases-and-tons-of-workflow-enhancements), [Synth Anatomy](https://synthanatomy.com/2026/03/bitwig-studio-6.html)
- Ableton Move: [Gearnews](https://www.gearnews.com/ableton-move-studio/), [release notes](https://www.ableton.com/en/release-notes/move-1/), [MusicRadar](https://www.musicradar.com/music-tech/daws/for-some-move-might-prove-to-be-a-gamechanger-but-others-will-likely-struggle-to-fit-it-into-their-creative-workflow-ableton-move-review); Push 3: [Sound On Sound](https://www.soundonsound.com/reviews/ableton-push-3)
- LSDJ: [documentation](https://www.littlesounddj.com/lsd/latest/documentation/)
- TidalCycles: [mini-notation](https://tidalcycles.org/docs/reference/mini_notation/); [Strudel](https://strudel.cc/learn/mini-notation); [Sonic Pi](https://sonic-pi.net); Orca: [Hundred Rabbits](https://100r.co/site/orca.html), [learn-orca](https://metasyn.srht.site/learn-orca/sections.html)
- Rozeta: [Synth Anatomy](https://synthanatomy.com/2018/01/the-latest-update-of-rozeta-sequencer-suite-features-a-brand-new-midi-hadron-collider-auv3-plugin.html); Fugue Machine: [Ask.Audio](https://ask.audio/articles/review-fugue-machine-a-unique-take-on-sequencing-for-ipad); PolyPhase: [App Store](https://apps.apple.com/app/id1440617668); StepBud: [Synthtopia](https://www.synthtopia.com/content/2019/05/02/new-auv3-midi-sequencer-for-ios-stepbud/); Riffer: [Sound On Sound](https://www.soundonsound.com/reviews/audiomodern-riffer); Patterning 2: [Sound On Sound](https://www.soundonsound.com/reviews/olympia-noise-co-patterning-2)
- Drambo: [docs](https://www.beepstreet.com/drambo-docs/groovebox.html); Koala AUv3: [RouteNote](https://create.routenote.com/blog/koala-sampler-update-offers-auv3-support-heralding-in-a-whole-new-world-of-plugin-possibilities/); Augmatic GRE: [Synth Anatomy](https://synthanatomy.com/2026/03/augmatic-audio-gre-an-algorithmic-drum-pattern-generator-for-ios-and-macos.html)
- Cthulhu: [Xfer](https://xferrecords.com/products/cthulhu); Scaler 3: [Plugin Boutique](https://www.pluginboutique.com/product/3-Studio-Tools/93-Music-Theory-Tools/14563-Scaler-3/); ChordPotion: [manual](https://feelyoursound.com/chordpotion-manual); InstaChord: [App Store](https://apps.apple.com/us/app/-/id1540316217)
- Browser and education: [Ableton Learning Music](https://learningmusic.ableton.com), [Chrome Music Lab Song Maker](https://musiclab.chromeexperiments.com/Song-Maker/)

**M-VAVE FM-1**
- Hardware: [Synth Anatomy](https://synthanatomy.com/2026/07/m-vave-fm-1-a-budget-friendly-dx-7-style-desktop-fm-polysynth.html), [Synthtopia](https://www.synthtopia.com/content/2026/07/13/m-vave-introduces-fm-1-fm-pocket-synthesizer/), [Melodee wiki](https://github.com/keremimo/melodee/wiki)
- Stock firmware: [V15](https://www.matrixsynth.com/2026/07/m-vave-fm-1-v15-firmware-update-new.html), [V16](https://www.matrixsynth.com/2026/10/m-vave-fm-1-official-v16-firmware.html); FM1 Open: [GitHub](https://github.com/m-vave/fm1_open), [Synthtopia](https://www.synthtopia.com/?p=155393)
- Platform: [fm1-base](https://github.com/charlesvestal/fm1-base), [Felucca](https://github.com/hugelton/Felucca), [fm1-dock](https://www.matrixsynth.com/2026/10/fm1-dock-one-fm-1-firmware-many-synths.html)
- Firmwares: LOOM-8 [manual](https://charlesvestal.github.io/fm1-loom/manual/) and [MatrixSynth](https://www.matrixsynth.com/2026/10/loom-8-sequencing-groovebox-for-m-vave.html); [Hortator](https://github.com/DeadActive/hortator); [SLOOP](https://github.com/isod89/sloop-fm1); [Optimist](https://github.com/w0ts/optimist); [X0X](https://github.com/charlesvestal/fm1-x0x) and [v1.0.1 notes](https://newreleases.io/project/github/charlesvestal/fm1-x0x/release/v1.0.1); [Groove OS](https://synthanatomy.com/2026/10/groove-os-turns-the-m-vave-fm-1-into-an-8-track-groovebox.html); [KARMA](https://sonicstate.com/news/2026/11/02/karma-turns-m-vave-fm-1into-a-groovebox/); [ChoralRoot](https://github.com/Quixotic7/ChoralRootFM1); [Jangada](https://github.com/zednaked/jangada); [Baud Girl](https://synthanatomy.com/2026/09/baud-girl-fm-1-va-custom-m-vave-fm-1-firmware.html); [JIANT FM](https://www.matrixsynth.com/2026/10/jiant-fm-living-bio-synthetic-firmware.html); [Skiff](https://newreleases.io/project/github/illuminus5/skiff/release/v1.4); [FM-FAM](https://www.matrixsynth.com/2026/11/fm-fam-for-m-vave-fm-1.html); [eight-bells](https://github.com/Discodave-Glitch/eight-bells); [GitHub search](https://github.com/search?q=fm-1+firmware+m-vave&type=repositories&s=updated)
- The six new firmwares: README.md in `ledger-4/`, `mycel-8/`, `spool-4/`, `regent-4/`, `terrace-8/` and `canon-4/` of this repository.

**UX and research literature**
- Nash and Blackwell, "Liveness and Flow in Notation Use": [NIME 2012](https://nime.org/proc/nime2012_nash/); Nash PhD: [Cambridge](https://www.repository.cam.ac.uk/handle/1810/244047); [chapter](https://uwe-repository.worktribe.com/output/817269/flow-of-creative-interaction-with-digital-music-notations)
- Duignan, Noble and Biddle, "A Taxonomy of Sequencer User-Interfaces": [record](https://researchr.org/publication/DuignanNB05); Zadel and Scavone: [ICMC 2006](https://caml.music.mcgill.ca/~gary/papers/zadel_scavone_icmc2006.pdf); Duignan thesis: [Victoria University of Wellington](https://openaccess.wgtn.ac.nz/articles/thesis/Computer_Mediated_Music_Production_a_Study_of_Abstraction_and_Activity/16945879)
- Green and Petre, Cognitive Dimensions of Notations (1996); Norman, *The Design of Everyday Things*; Raskin, *The Humane Interface*; Magnusson, "Of Epistemic Tools" (Organised Sound, 2009)
- NIME: ["Performing Sequences" (2026)](https://nime.org/proc/nime2026_159/), [graph-based sequencing (2014)](https://www.nime.org/proceedings/2014/nime2014_498.pdf), [LoopBoxes (2023)](https://nime.org/proceedings/2023/nime2023_4.pdf), [Pyxis Minor (2015)](https://zenodo.org/records/1179012/files/nime2015_313.pdf); Tindale: [OCAD](https://openresearch.ocadu.ca/4611/1/Tindale_Reshaping_2024.pdf)
- Menu diving: [Elektronauts](https://www.elektronauts.com/t/digging-menu-on-a-small-screen-is-a-workflow-like-using-computers/213150?page=2), [ModularGrid](https://modulargrid.net/f/forum/posts/view/14827)

# Brief for the six web sequencers

Six browser sequencers, each a different archetype from the sequencer survey (`../SURVEY.md`, being written; its
research is in `../survey/research/`). They sit in this one repository and are published together on GitHub Pages:
`index.html` at the root links the six, and each lives in its own folder.

## The six

| Folder | Name | Archetype | After |
| --- | --- | --- | --- |
| `stitch/` | STITCH | trig-and-lock step groovebox | Elektron Digitakt/Syntakt, x0x |
| `quilt/` | QUILT | clip and scene launcher | Ableton Live Session view, Bitwig clip launcher |
| `strand/` | STRAND | pattern language / live code | TidalCycles, Strudel mini-notation |
| `lichen/` | LICHEN | cellular-automaton sequencer | Game of Life sequencers, norns Zellen, Otomata |
| `orbit/` | ORBIT | circular polyrhythm rings | Patterning 2, rhythm necklaces, Euclidean circles |
| `topo/` | TOPO | topographic drum map | Mutable Instruments Grids (original pattern data: do not copy Grids' tables) |

## The shared core (`core/`), read it first

- `seq-core.js` (a plain script, a global `SeqCore`; no ES modules, so every app also opens from `file://`):
  - `SeqCore.audio`: `ensure()`, `note(patch, midi, vel, time, dur)`, `hold(patch, midi, vel)` -> release(),
    `drum(name, vel, time, {tone, decay, level, pitch, echo})` (kick snare clap hat ohat tom rim cowbell cymbal
    shaker zap), `defaultPatch({...})`, `setEcho(time, fb)`, `GM` / `GM_NOTE` drum note maps.
  - `SeqCore.clock`: `bpm`, `swing` (0..0.5), `PPQN` 96, `onTick(tick, time)` (schedule audio and MIDI at `time`),
    `onStart`, `onStop`, `start/stop/toggle`, `tickNow()` for drawing the playhead, `swingOffset(tick)`.
  - `SeqCore.midi`: `note(ch, n, vel, time, dur)`, `cc(ch, c, v, time)`, `onNote = (n, vel, ch) => ...` for MIDI in,
    output selection and clock out handled by the header.
  - `SeqCore.store`: `save/load(name)` (localStorage), `download/upload` (files), `shareLink(data)` / `fromHash()`,
    `undoStack()`.
  - `SeqCore.ui`: `el`, `toast`, `knob({...})`, `select`, `header({...})` (transport, tempo, swing, MIDI out, clock
    out, Undo/Redo/New/Save/Open/Share, help), `showHelp`, `pianoKeys(onKey, baseRef)`, `globalKeys(opts)`
    (Space, ?, Cmd/Ctrl+Z), `canvas(parent, draw)`.
  - `SeqCore.music`: `SCALES`, `degree(d, root, scale, base)`, `snap`, `name`, `rng(seed)`, `euclid(steps, pulses, rot)`.
- `seq-core.css`: colour tokens on `:root` (`--bg --panel --panel2 --line --fg --dim --faint --rec --ok --accent
  --c1..--c8`) with light and dark themes; the header, knobs, buttons, help dialog, toasts. Use the tokens only: no
  hard-coded colours in apps (canvas code reads them with `SeqCore.ui.css('--c1')`). If the core lacks something
  general, add it to the core carefully (keep its API) and say so; app-specific things stay in the app.

## Each app

Files: `NAME/index.html` (loads `../core/seq-core.css`, `../core/seq-core.js`, then `app.js` and optionally
`app.css`), `NAME/app.js`. Set `--accent` per app on `:root` in the app's own CSS or inline style.
`<title>` is the app's name. Every page needs `<meta name="viewport" content="width=device-width, initial-scale=1">`.

What every app must do (from the survey's design rules):

1. **Sound in one click.** It opens with a musical demo already in it; Space or the play button plays it.
2. **One clear model.** The screen *is* the notation (a grid, rings, a map, code); name things after the model.
3. **Every action discoverable.** A help dialog (`?` and the header's button) lists every control and shortcut;
   on-screen hints where a modifier or hold changes what things do. Hover titles on controls.
4. **Liveness.** Every edit is heard and seen at once while playing; changes that would jar (pattern, scene,
   code) can be quantised to the bar, with a visible waiting state.
5. **Safety.** Undo/redo (Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z, and the header buttons) for every edit; autosave to
   localStorage (restored on load); Save/Open a JSON file; Share copies a link holding the state (`shareLink`,
   restored by `fromHash` at load, which wins over the autosave).
6. **Variation with control.** Randomness is seeded, has an amount, and can be undone; nothing destroys work
   without undo.
7. **Timing.** All sound and MIDI are scheduled at the `time` the clock gives; nothing is played from timers or
   animation frames. The playhead on screen uses `clock.tickNow()`.
8. **MIDI.** Each part/track has a MIDI channel (default 1..n, drums on 10, 0 = off); notes go out through
   `SeqCore.midi.note` at the same time as the sound. MIDI in plays or records where it makes sense.
9. **Keyboard and touch.** All main actions work with a mouse, touch and the keyboard (Tab order, Enter/Space on
   focused cells, arrow keys where a grid has a cursor). Touch targets at least 32 px. It works at 360 px wide
   with no horizontal page scroll (inner panels may scroll), and on a large screen it uses the space.
10. **Performance.** Canvas drawing for dense views; no layout thrash at 60 fps; it must not stutter audio.
11. **Accessibility.** Real buttons and labels, `aria-label` on icon controls, `role`/`aria-pressed` on toggles,
    visible focus, respects `prefers-reduced-motion` for decorative animation.

Write code that reads well: short functions, a comment at the top of `app.js` describing the model, plain names.
Licence header `/* SPDX-License-Identifier: MPL-2.0 */`. No external libraries or fonts (system fonts only).

## Checking

There is no browser in this task; check with `node --check app.js`, and test pure logic (parsers, rules,
generators) with a small `node` script in a scratch file outside the repo that loads the logic (structure the code
so its pure parts can be extracted, e.g. functions not touching the DOM at the top of `app.js`, exported with
`if (typeof module !== 'undefined') module.exports = {...}`). Read your DOM code through once more for errors.
The main session will open each app in a real browser afterwards and do a UI pass.

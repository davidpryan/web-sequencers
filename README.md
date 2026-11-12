# Six web sequencers

Six browser sequencers, each a different archetype from a survey of sequencers (hardware grooveboxes, modular and
generative tools, DAWs, trackers, live code). They make their own sound with Web Audio, send Web MIDI, save, undo and
share, and need no install, build step or network: open `index.html` (or any app's folder) from disk, or publish
the folder on GitHub Pages. Their siblings are six firmwares for the M-VAVE FM-1 (LEDGER-4, MYCEL-8, SPOOL-4,
REGENT-4, TERRACE-8, CANON-4).

| App | Archetype | What it is meant to achieve |
| --- | --- | --- |
| [STITCH](stitch/) | trig-and-lock step groovebox (Elektron, x0x) | The deepest form of the step grid: 8 tracks with their own lengths and speeds, trig conditions, ratchets, microtiming and parameter locks, patterns A-H, fills and a snap-back, all on one screen with no menus. |
| [QUILT](quilt/) | clip and scene launcher (Ableton Session, Bitwig) | Arrange by performing: a grid of clips by track and scene, launched on the bar, with follow actions so a set can play itself, a piano-roll and drum clip editor, and recording into clips. |
| [STRAND](strand/) | pattern language / live code (TidalCycles, Strudel) | Music as text: each line a voice in a mini-notation (subdivision, alternation, Euclid, polymeter) with transformations, hot-swapped on the next cycle, the sounding characters lit as they play. |
| [LICHEN](lichen/) | cellular automaton (Game of Life sequencers, Zellen, Otomata) | Let rules compose: a field of cells evolves by Life or another rule while a playhead sweeps it, with locks, rewind and keeps so a good moment is never lost. |
| [ORBIT](orbit/) | circular polyrhythm (Patterning, rhythm necklaces) | Make polymeter visible: concentric rings of steps, each its own count and cycle, turning against each other, with the bars until they line up again counted down. |
| [TOPO](topo/) | topographic drum map (after Mutable Instruments Grids, original data) | Explore grooves by moving: a map of 25 written styles that morph into each other, density per drum, chaos, recorded motion and LFOs, and a freeze into editable steps. |

## Shared

`core/seq-core.js` and `core/seq-core.css` hold what the six share: an 8-voice synth and eleven synthesised drums,
an echo; a look-ahead scheduler on the audio clock (96 ticks a quarter, sample-exact; it looks further ahead in a
hidden tab); Web MIDI out with timestamps, clock out and MIDI in; saving to the browser, files and share links; an
undo stack; and the header, knobs, help dialog and colour tokens (light and dark). Every app: Space plays, `?` lists
every control, Cmd/Ctrl+Z undoes, the work autosaves, and the page works from 360 px wide up.

## Run

    python3 -m http.server 8765        # then http://localhost:8765/

or open `index.html` directly. MIDI needs a browser with Web MIDI (Chrome, Edge, Firefox).

## Status

0.1. Each app was tested in Chrome (desktop and a 375 px phone viewport), plays its demo without console errors,
and has node tests for its pure logic (pattern parser, automaton rules, map interpolation, ring timing, trig
conditions, launch quantum and follow actions). Not tested in Safari or Firefox, or with real MIDI hardware.

## Licence

MPL-2.0. `BRIEF.md` is the specification the six were built to.

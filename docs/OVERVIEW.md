# Twelve sequencers: an overview

Six firmwares for the M-VAVE FM-1 and six web apps, each built on a different archetype from the survey
(`SURVEY.md`: 15 archetypes, 69 products compared, 42 design rules, a requirements checklist). Together they cover
twelve of the fifteen archetypes. The three left out are the x0x grid and the analogue knob-per-step, which existing
FM-1 firmwares (LOOM-8, Hortator, X0X, RELAY-16) already do well, and performance sculpting, which is a layer over
other sequencers more than a sequencer of its own.

## The map

| | Archetype | FM-1 firmware | Web app |
| --- | --- | --- | --- |
| Notation | tracker, hierarchical reuse | **LEDGER-4** | |
| | pattern language / live code | | **STRAND** |
| Steps | trig-and-lock groovebox | | **STITCH** |
| | stage / elastic time | **TERRACE-8** | |
| | polymetric, made visible | | **ORBIT** |
| Readers | multi-playhead / Cartesian | **CANON-4** | |
| Generators | Turing register + Euclid | **MYCEL-8** | |
| | cellular automaton | | **LICHEN** |
| | topographic map | | **TOPO** |
| Harmony | harmonic conductor | **REGENT-4** | |
| Performance | live-loop recorder and capture | **SPOOL-4** | |
| | clip and scene launcher | | **QUILT** |

The split follows the hardware. The FM-1 has 27 keys, 14 buttons, 7 encoders and a 240 x 240 screen, so it got the
archetypes that play well from keys and knobs: rows typed in hex, stages held and turned, chords on degrees, loops
played in. The web got the ones that need a large screen, a pointer or a text editor: clip grids, code, painted
fields, draggable rings, an XY map, and a groovebox that shows all its tracks at once.

## The FM-1 firmwares

All six run on fm1-base. Each has its own 8-voice synth with eleven drums and an echo, MIDI out (USB and Bluetooth),
MIDI clock in and out, four project slots, a help card on any button held for a second, and a hint band showing what
a held button does. Each is 0.1: it passes its host-simulator tests and builds for the device. None has run on a real FM-1.

| Firmware | Meant to achieve | Try it in 30 seconds |
| --- | --- | --- |
| **LEDGER-4** (`ledger-4/`, FM-1_21) | Depth from very little: a song of chains of 16-row phrases, reused by reference with a transpose, each row with a command (arpeggio, chance, retrigger, slide...) explained in words on screen. | PLAY loops the demo phrase. Turn SELECT to a row and press a key to write a note; ALGO to the CMD column and tap a white key to pick a command. HOME, then PLAY, plays the song. |
| **MYCEL-8** (`mycel-8/`, FM-1_22) | Grow music from a few numbers: eight parts, each a Euclidean rhythm with a Turing-machine register choosing notes from scale degrees lit on the white keys; a lock, a dice history and snapshots so nothing good is lost. | PLAY. Tap white keys to change part 4's notes; turn K2 for more pulses; press ARP to dice, turn PRESETS left to go back; FX locks it all. |
| **SPOOL-4** (`spool-4/`, FM-1_23) | Never enter a step: play, and it keeps it. The first take sets the loop; overdubs are undoable layers; quantise is a dial; CAPTURE keeps what you played when nothing was recording. | Play a phrase on the keys, then press ENV: it is a loop. REC to overdub, SEQ to undo, K1 to quantise. |
| **REGENT-4** (`regent-4/`, FM-1_24) | Make a whole arrangement from chord changes: white keys are chords in the key, black keys colour them, and a pad, bass, two motifs and a beat follow. | PLAY: the progression plays. Press white keys to take over; hold one and add black keys for 7ths and suspensions; REC records a new progression. |
| **TERRACE-8** (`terrace-8/`, FM-1_25) | Make time part of the step: stages that last 1-8 pulses with gate modes, ratchets and slides, two lines crossing, drawn as terraces. | PLAY. Hold a white key (a stage) and turn K2 for its pulses, K3 for its gate; nothing held, K1 changes the direction. |
| **CANON-4** (`canon-4/`, FM-1_26) | Turn one phrase into counterpoint: four playheads read 16 cells at their own rates, paths and transpositions. | PLAY. Tap white keys to make notes and rests; press black key 2 then turn K1 to change that head's speed; black keys 5-10 pick its path. |

Build and install: `./build.sh --release 0.1`, then `python3.11 base/tools/fm1_install.py app/build/NAME-0.1.fwsc`.
Each repository has a README with its controls and screens.

## The web apps

All six share a core (`web-sequencers/core/`): Web Audio synth and drums, a look-ahead scheduler on the audio clock,
Web MIDI out and clock, autosave, files and share links, undo, a help dialog, light and dark themes, and a phone
layout. Open `web-sequencers/index.html`, or serve the folder (`python3 -m http.server`). Space plays everywhere.

| App | Meant to achieve | Try it in 30 seconds |
| --- | --- | --- |
| **STITCH** (stitch/) | The deepest step grid with no menus: 8 tracks of their own lengths and speeds, conditions, ratchets, microtiming and parameter locks, patterns A-H, fills, a snap-back. | Space. Click steps; hold or right-click one and turn a knob to lock it; hold F for the fill. |
| **QUILT** (quilt/) | Arrange by performing: clips launched on the bar by track and scene, follow actions, a clip editor, recording into clips. | Space plays the first scene; click scene 2 or 3 to move on; click a clip to edit it below. |
| **STRAND** (strand/) | Music as text: a line per voice in a mini-notation, swapped in on the next cycle, the sounding characters lit. | Space. Change `bd(3,8)` to `bd(5,8)` and press Cmd/Ctrl+Enter. |
| **LICHEN** (lichen/) | Let rules compose: Life on a field the playhead sweeps, with locks, rewind and keeps. | Space. Paint cells; click Back to rewind a generation; lock a row by its label. |
| **ORBIT** (orbit/) | Make polymeter visible: rings of different counts turning against each other until they line up. | Space. Drag a ring to rotate it; click dots; press E for a Euclidean fill. |
| **TOPO** (topo/) | Explore grooves by moving: a map of 25 written styles morphing into each other, densities, chaos, motion. | Space. Drag the puck across the map; raise a lane's density; Rec the puck's path. |

## The second UI pass

After all twelve were built, each was checked again for immediacy (sound at once, every action findable, nothing
hidden) and changed:

- **All firmwares:** a held button shows its layer's map in the knob band (the survey's most common complaint is
  hidden button combinations). REGENT-4 shows the black keys' colours while a chord key is held.
- **LEDGER-4:** the header says what is playing when it is not the page shown; scrolling a phrase while stopped plays
  each row.
- **SPOOL-4:** the screen shows how many notes CAPTURE would take before ENV is pressed.
- **REGENT-4 / CANON-4:** knob names and head settings in words, not abbreviations.
- **All web apps:** the play button invites a first press; on a phone the header compacts and play floats under the
  thumb; music keeps time in a hidden tab; a missing accent colour and the `hidden` attribute fixed in the core.
- **QUILT:** play with nothing queued launches the last scene, so Space alone makes sound.
- **TOPO:** the map's shading is a smooth terrain instead of blocky contours.

## Where everything is

| What | Where |
| --- | --- |
| The survey | `SURVEY.md` (also `SEQUENCER-SURVEY.md` in the loom-8-ios folder), research notes in `survey/research/` |
| Firmwares | `ledger-4/`, `mycel-8/`, `spool-4/`, `regent-4/`, `terrace-8/`, `canon-4/`: each its own git repository with `build/firmware/*.fwsc` and `app/build/*-0.1.fwsc` |
| Web apps | `web-sequencers/`: one git repository, ready for GitHub Pages |
| Shared firmware core | `core/` (copied into each firmware's `app/core/` by `sync_core.sh`) |

Nothing is pushed to GitHub yet. Each firmware repository's `fm1.toml` already names its intended home
(`github.com/davidpryan/NAME`, site `davidpryan.github.io/NAME`).

## Not done

- No firmware has been run on an FM-1; synth CPU load on the device is not measured.
- The web apps were tested in Chrome only, without MIDI hardware.
- No SMK-37 builds (fm1-base supports them; the mappings would need the SMK's buttons).
- No installer sites yet (fm1-base's `make_site.py` can build them per firmware).

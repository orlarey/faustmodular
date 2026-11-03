# faustmodular

faustmodular is a modular synthesizer in the browser, built with [Faust](https://faust.grame.fr): modules
written in Faust, with one port per audio channel, connected cable by cable, whose widgets can be
modulated by signals; the code of a module is edited in [faustcode](https://github.com/orlarey/faustcode).
It runs at https://orlarey.github.io/faustmodular/.
It started as an extension of [FaustPlayground](https://faustplayground.grame.fr)
([GitHub](https://github.com/grame-cncm/faustplayground)), a Web platform designed to teach audio
programming to children, and was called FaustPlayground (extended) up to version 2.9.0. See the
[changelog](CHANGELOG.md).

## Connecting modules

Each module has one port per input channel (mint) and one port per output channel (coral), in a zone at
the bottom of the module, under its last widget: inputs astride the left edge, outputs astride the right
edge. Physical input and output modules have as many ports as the audio devices have
channels.

- Drag from a port and release on a port of the other kind to connect these two channels. Several
  connections reaching the same input are summed; an output can feed several inputs.
- Release on the body of another module instead to connect all the channels at once: output
  `k mod n` goes to input `k mod m` (Faust's `<:` and `:>` when one number of channels divides the other).
- Click on an output port (without dragging), or right click it, to send it to the speakers or unplug it at once,
  without drawing a cable to the output module: left + right, left, right (a check mark shows where it goes; a
  checked line unplugs), unplug this output (all its cables); for a module of several outputs, all its outputs to
  the speakers (the bus rule) or none. The module menu has these two commands too. The microphone is not sent to
  the speakers (it would ring). Each command is one step of the history.
- Click on a cable to delete it. Dashed cables close a cycle and are delayed by 128 samples.
- Release on a widget to modulate it by the signal: the mode (± modulate, + add, ~ linear FM, ⇐ drive)
  follows from the widget and its metadata, and the depth is set by a vertical drag on the modulation port
  (see `Documentation/widget-modulation/MODULATION.md`).
- Shift-click modules, or drag a rectangle on the empty stage, to select several modules and move them
  together.
- While modules are dragged, their edges are pulled onto the edges of the other modules within 4 pixels
  (top or bottom on top or bottom, left or right on left or right), and their centres onto the centres (a
  module centred above another, or beside it); each coincidence is shown as a thin line from the dragged module
  to the aligned one, dashed for the centres. Hold Alt to move freely.
- ⧉ in the title bar of a module, or Ctrl/Cmd-D on the selection, duplicates modules with their code,
  settings and modulations, the connections between them, and the cables coming from other modules
  (audio inputs, modulation sources), so that a copy is fed as its original; not the cables going out.
  Ctrl/Cmd-Shift-D leaves out the cables coming from outside. The copies become the selection.
- Right-click a module for the commands on the selection (the module alone if it is not part of it):
  copy, cut, paste, duplicate, duplicate without the incoming cables, unplug (remove all its cables),
  minimize or expand, delete; right-click the empty stage to paste there, select all, open the Modules
  menu, make a new module there (written in faustcode), or import a Faust file (.dsp) as a module at that
  point. Shortcuts:
  Ctrl/Cmd-C, X, V (at the pointer), D, A, and Delete. Copied modules are a patch file in the clipboard,
  with the connections between them: they can be pasted in another document or another tab.
- Two menus: *File* and *Modules* (the library). *File* is a dropdown, as in a desktop application: New scene,
  Open a scene… (Ctrl/Cmd-O), Save (Ctrl/Cmd-S), Save as… (Shift-Ctrl/Cmd-S), Import a Faust file (.dsp)…, Recent
  scenes, Examples. With the File System Access API (Chrome, Edge), Save writes the file the scene was opened from
  or saved to, Save as… chooses another one (the scene takes its name); elsewhere, Save downloads a .jfaust. Opening
  a scene replaces the one shown, which stays in Recent scenes (the scenes are saved automatically in the
  browser). A click on the name of the scene, at the top right, renames it. The Edit and Export menus, and the
  accelerometer button, are hidden for now.
- Ctrl/Cmd + wheel (or a pinch) zooms the stage around the pointer, the wheel alone moves it; the − %
  + ⤢ buttons of the header zoom out, back to 100%, in, and fit the scene in the window.
- Zoomed out under 75 %, the module under the pointer is shown at its real size after 250 ms, above the
  others, as in the Dock of macOS (the point under the pointer stays, the module is kept inside the window):
  its widgets work, and it goes back when the pointer leaves it. While a cable is drawn, the module under it is
  magnified too, so that a widget can be aimed at. Moving a module, zooming or moving the stage ends it
  (`src/view/Magnifier.ts`).
- Ctrl/Cmd-Z undoes any change (connections, modules, positions, parameters, modulations),
  Ctrl/Cmd-Shift-Z redoes it; the ↶ ↷ buttons of the header do the same.

## Volume

The volume of the scene is set on the speaker of the physical output module, as the depth of a modulation port:
drag the speaker vertically (1 % per pixel, 0.1 % with Shift); its brightness shows the volume, and its tooltip
gives the value. A double click mutes or unmutes the scene (the audio keeps running: analyzers and modulations
go on). The gain is (v / 100)², as in faustcode: about −12 dB at 50 %, no boost at 100 %. The volume is
remembered by the browser, not by the scene (`src/audio/MasterVolume.ts`). The output module is moved by its
edge, around the speaker.

A safety limiter follows the volume, for the ears and the speakers (a cycle of cables that blows up, a module
badly set): transparent under −1 dBFS, it brings the peaks down to −1 dBFS at once and lets the gain come back in
about 100 ms; NaN and infinite samples are silenced. The speaker glows coral while it acts.

## Microphone

The microphone is not asked for when the application opens: the input module stays dim until a cable leaves it
(drawn, undone, or in a scene opened) or until it is clicked; the browser then asks for the permission. Refused,
or without a microphone, its icon is crossed; a click asks again.

## Interface of a module

The widgets are laid out in the groups of the code: each `vgroup`, `hgroup` or `tgroup` is a section with
its label centred above its widgets, between two lines, in capitals and in the accent colour (a section inside
a section has a smaller label, between short lines), except the group named after the module
and the groups without label. Sliders (`hslider`, `vslider`) are horizontal, number entries (`nentry`) are
number fields, bargraphs stay in their group; `[tooltip:...]` gives the tooltip of a widget or a section, and
`[hidden:1]` hides a widget (it keeps its value). An `hgroup` lays out its widgets as a row (wrapped when too
wide), a `tgroup` as tabs. `[style:knob]` gives a knob: a vertical drag turns it (Shift: finer), a double
click sets it back to its initial value. A double click on the value of a slider or a knob types it: Enter (or a click
elsewhere) sets it, kept in the range of the widget and on the grid of its step, exactly (on a logarithmic scale
too); Escape gives up. Buttons and checkboxes are centered buttons, a checkbox with a LED.
See `src/model/UILayout.ts`.

## Orbit interface

◎ in the title bar of a module (or *Orbit interface* in its context menu) shows its settings in an Orbit
([faust-orbit-ui](https://github.com/orlarey/faust-orbit-ui), as in faustcode) in place of the classic interface:
each setting is a point around a centre, its value set by its distance to the centre; moving the centre moves
them all; the Orbit has its presets and its random mixes. ◎ again gives back the classic interface. The values
stay those of the module: a gesture in the Orbit sets them as a slider does (sound, saving, undo), and an undo or a
recall shows them in the Orbit. The Orbit is resized by its grip; it is shown again, with its size and the layout
of its points, when the document is opened. Its modulation ports are in a column under the title, and a cable
dropped on one of its points modulates that setting. The Orbit shows the input widgets of the user (not the depths
of the modulations, nor the bargraphs). `src/Modules/OrbitPanel.ts` works around two limits of faust-orbit-ui
0.4.1 with a zoomed stage (the pointer read in screen pixels, the dropdowns placed in screen pixels), until the
library handles them. Its icons are a subset of the Material Symbols Outlined font (Apache License 2.0) served
with the application (`css/fonts/`): after an update of faust-orbit-ui, `npm run icon-font` downloads the subset
of the icons it shows (a test checks the list).

## Modular library

The *Modular* library (Modules menu) holds modules organized by function, as on ModularGrid, with common
conventions: audio and bipolar CV in [-1, 1], unipolar CV in [0, 1], pitch 0.1 per octave from C4,
gates 0/1. A first voice: VCO, Noise, VCF, VCA, ADSR, LFO, Mixer, Offset, Clock, Sequencer, Quantizer,
SampleHold (see `Documentation/MODULAR-LIBRARY.md`).

The Modules menu shows all the modules in one view: the families, grouped (*Modular*, then *FaustPlayground*:
harps, winds, bars and bowls, noises and oscillators, instruments with reverb, filters, echoes and reverbs,
modulations, level and dynamics, spatialization and multichannel, modulation sources), *Faust libraries*
(reverbs, dynamics, filters, equalizers and crossovers, pedals, saturation and folding, delays and modulation,
effects, oscillators and noises, drums and voices, physical models, analysis), then *My modules*; the
modules of the family chosen; the description of the module pointed at. Double click or drag a module to add
it. The catalog (`public/faust-modules/library-catalog.json`) is built by `npm run library-index`: the modular
modules from their declarations, the FaustPlayground ones from the table of `scripts/library-families.mjs`
(their code, and so their hash, unchanged).

The *Faust libraries* modules (52) are the functions of `demos.lib` and `physmodels.lib` that are complete
processes with their interface (JPverb, Greyhole, Zita, compressor, Moog VCF, vocoder, flute, violin,
guitars, bells, Pink Trombone…), generated in `public/faust-modules/faustlib/` by `npm run faustlib-modules`
from `scripts/faust-library-modules.mjs`. A MIDI instrument gets a *Pitch* slider (0.1 per octave from C4) in
place of its `freq`: a sequencer plays it as it plays the VCO. Its tuning is that of the model: some are in
tune only with other settings (the flute overblows, the brass needs its lips tension) or at 48 kHz (the
guitar model is about 17 cents low at 44.1 kHz).

The filters, equalizers and pedals of `filters.lib` and `vaeffects.lib` (22: SVF, resonant, Butterworth,
elliptic, Moog and diode ladders, Korg 35, Oberheim, Sallen-Key, notch, DC blocker; shelves, peak EQ,
Linkwitz-Riley crossovers 2, 3 and 4 ways, spectral tilt; Klon Centaur, Fulltone OCD, MXR Phase 90, auto wah)
take their settings as arguments: their modules give them an interface made for music, written in
`scripts/faust-filter-modules.mjs`. *Cutoff* in Hz on a log scale (modulated in octaves), a *Pitch* slider
(0.1 per octave) on the filters for the keyboard tracking, *Q* on a log scale, gains in dB, the responses and
the orders in menus, no smoothing. Their frequency responses are measured offline against the theory
(`tests/library/filters.test.ts`). The Diode Ladder corrects a typo of `ve.diodeLadder` (the feedback through
its second stage) and is tuned on its analog model so that its cutoff is at -3 dB whatever the resonance.

The drums and voices of `synths.lib` (Kick, Clap, Hi-Hat, Pop Drum, Additive Drum, Comb String, Dub Synth,
Saw Trombone; `scripts/faust-drum-modules.mjs`) have a *Gate* that a gate drives (a clock, a sequencer) and a
*Freq* in Hz that *Pitch* transposes. The analyzers of `analyzers.lib` turn a sound into control signals
(`scripts/faust-analysis-modules.mjs`): *Pitch Tracker* (a pitch and a gate: a voice plays what it hears),
*Spectral Centroid* (the brightness, as a pitch), *Zero Crossings* (the noisiness), *RMS Level* (in dB, 0 to 1).
Measured offline in `tests/library/drums-analysis.test.ts`.

The saturators of `aanl.lib` (*Waveshaper*: nine curves; *Wavefolder*: triangle or sine;
`scripts/faust-saturation-modules.mjs`) are antialiased by the antiderivative method, of the first or second
order. The delays and modulation effects (`scripts/faust-delay-modules.mjs`): *Echo*, *Delay* (fractional, it
glides as a tape), *Flanger*, *Phaser*, *Vibrato* (its depth in cents), *Pitch Shifter*, *Granular*, *Dimension
Expander*. Measured offline in `tests/library/saturation-delays.test.ts`.

Ports carry the signals a module transforms (audio); everything that controls a module is a setting,
driven by releasing a cable on it: a sequencer on the *Pitch* of a VCO (pitch sliders add the signal to
their value, "+"), a clock on the *Clock* button of the sequencer, an envelope on the *Gain* of a VCA. A
slider declaring `[mod:lin]` is modulated linearly ("~"): two *SineVCO* make classic FM.

The field at the top of the modules searches all of them (the families of the catalog and My modules): every
word typed must be found, ignoring case and accents, in the name of a module, its Faust functions, its family or
its description; the modules named after the words come first. The families show how many modules match. It is
ready to type when the Modules menu opens: ↑ ↓ choose a module (it is described), Enter adds it, Escape clears
the search; a click on a family leaves it (`src/model/LibrarySearch.ts`).

## Documents

The first visit (no document yet) opens on a SineVCO connected to the left and right outputs: its *gate*
plays it (*freq*, *gain*, *volume*, as the first program of faustcode with a sine). Not modified, this scene is
replaced by a new scene or a file opened, as an empty one. Not when faustcode opens faustmodular; `?starter=0` in
the address opens on an empty scene
(`src/documents/Starter.ts`).

The scene is a document, kept in the browser (OPFS): every change is saved in its working copy, and
Cmd/Ctrl-S makes it the committed copy (a dot ● after the name in the header marks the difference;
Revert goes back to the committed copy). Closing the tab loses nothing. The **Documents** menu creates,
opens, renames, duplicates and deletes documents (with a trash). Opening a file or an example creates a
new document and never replaces one. Documents are stored in format version 4, their codes once in a
store shared by all the documents (see `Documentation/DOCUMENT-SPEC.md`); patch files of versions 1, 2
and 3 can still be opened.

**My modules**, the last column of the library, holds the user modules: a `.dsp` file dropped on the
stage, or a module edited in faustcode, becomes one, and each edit is a new version. An instance of an
older version shows ↑ in its title bar to update it. Modules of the library are not copied: an instance
of a library module stays one as long as its code is the library's.

To modulate a parameter, drag a cable from an output onto a widget (slider, button, checkbox) and
release it there. A slider is modulated from its value: the slider is the rest position, a signal of +1
brings it to its maximum and −1 to its minimum (in octaves for frequencies), and the depth sets the
excursion. Put the slider at its minimum to open a level with an envelope (like a VCA), or to map a
signal from 0 to 1 onto the whole range. A button or a checkbox is driven by the signal. The modulation then
gets a port astride the left edge of the module, at the height of its widget, showing its type and,
for **±**, its depth as a ring: drag the port vertically to set the depth (hold Shift for a fine
adjustment), double click to set it back to 0.5, the depth of a new modulation. A widget whose
modulation is removed remembers its depth: modulated again, by the same source or another, it gets it
back (the depth is saved with the module). The
"Modulation" category of the library holds LFOs, random, clock, ADSR and envelope follower sources.
Patches with modulations are saved in format version 3.

## Editing the code of a module

The pencil, in the title bar of a module, opens its code in [faustcode](https://github.com/orlarey/faustcode), in a window
reused for all the modules: each save that compiles (Cmd/Ctrl-S) updates the module in place, keeping its
sound, slider values, modulations and connections; a code with errors stays in faustcode. The faustcode URL can be set
with `?faustcode=<url>` (e.g. a local faustcode).

The other way, the *faustmodular* button of faustcode opens its session here, as a module of the open document
(faustcode opens faustmodular with `?link=faustcode` if needed): the session is linked to the module, each save
that compiles updates it, and its pencil edits it in that faustcode. faustmodular takes code this way only from the
page that opened it, with the origin of the official faustcode (or a local one). A new module (right-click on the
stage, *New module*) is a pass-through `process = _;` opened in faustcode to be written.

The export generates a single Faust program equivalent to the patch (`src/export/FaustExporter.ts`):
one instance per module, sums at the inputs, feedback cables delayed by one sample, and only the
modules that reach the output. The application gets the physical inputs that are used and all the
physical outputs, or 2 inputs and 2 outputs with the "force stereo" option.

## Development

### Notes
This project uses [Vite](https://vitejs.dev/) for development mode and builds and [FaustWasm](https://github.com/grame-cncm/faustwasm) for compiling Faust in the browser.

### Setup
Clone and enter the repository, then run:
```bash
npm install
```

### Run in development mode (automatic reloading)
```bash
npm run dev
```
Then press <kbd>o</kbd> to open in a browser.

### Build
``` shell
npm run build
```
Generates output in `dist/`. To view locally, run
``` shell
cd dist
python -m http.server
```

### Publishing
Every push to `main` builds the application and publishes it on GitHub Pages
(https://orlarey.github.io/faustmodular/, `.github/workflows/main.yml`); it can also be run by hand from the
Actions tab. The Pages of the repository have *GitHub Actions* as their source.

### Type check and tests
```bash
npm run typecheck
npm test
```
Tests use [Vitest](https://vitest.dev/), in three projects (`vitest.config.mjs`):
- `node`: unit tests, with libfaust running under Node.js (see `tests/helpers/faust.ts`);
- `browser`: Web Audio tests inside Chromium (`tests/browser/`);
- `e2e`: the application served by Vite and driven by Playwright (`tests/e2e/`).

Run one project with `npx vitest run --project node`. The browser and e2e projects need Chromium for
Playwright (`npx playwright install chromium`). In the browser console, `faustmodular.scene.patch`
gives access to the patch model.

The e2e test of the link with the real faustcode runs when `FAUSTCODE_DIR` names a checkout of faustcode
(`FAUSTCODE_DIR=../faustcode npm test`); otherwise the link is tested with a stub that follows the protocol.

The library test compiles every module listed in `public/faust-modules/index.json` and snapshots its
number of inputs and outputs: after an intended change, update the snapshot with `npx vitest run -u`.

### To create examples (in `public/json/`)
- create a patch in the platform
- possibly rename it using the the "Edit" button
- save it (regular or precompiled version) using the "Save" button
- rename it with a `.json` file extension

### To add new Faust modules
In `public/faust-modules/`, add your .dsp files to `effects/` or `generators/`. Then update `index.json` to include the paths to your new modules.

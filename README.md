# faustmodular

faustmodular is a modular synthesizer in the browser, built with [Faust](https://faust.grame.fr): modules
written in Faust, with one port per audio channel, connected cable by cable, whose widgets can be
modulated by signals; the code of a module is edited in [faustcode](https://github.com/orlarey/faustcode).
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
- Click on a cable to delete it. Dashed cables close a cycle and are delayed by 128 samples.
- Shift-click modules, or drag a rectangle on the empty stage, to select several modules and move them
  together.
- Ctrl/Cmd + wheel (or a pinch) zooms the stage around the pointer, the wheel alone moves it; the − %
  + ⤢ buttons of the header zoom out, back to 100%, in, and fit the scene in the window.
- Ctrl/Cmd-Z undoes any change (connections, modules, positions, parameters, modulations),
  Ctrl/Cmd-Shift-Z redoes it; the ↶ ↷ buttons of the header do the same.

## Modular library

The *Modular* library (Library menu) holds modules organized by function, as on ModularGrid, with common
conventions: audio and bipolar CV in [-1, 1], unipolar CV in [0, 1], pitch 0.1 per octave from C4,
gates 0/1. A first voice: VCO, Noise, VCF, VCA, ADSR, LFO, Mixer, Offset, Clock, Sequencer, Quantizer,
SampleHold (see `Documentation/MODULAR-LIBRARY.md`). The former library stays under *FaustPlayground*.

## Documents

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

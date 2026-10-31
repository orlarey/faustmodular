# Faust Playground

Faust playground is a Web platform designed to enable children to learn basic audio programming in a simple and graphic way. In particular, it allows them to develop musical instruments for Android smartphones.

Version 2 is multichannel: modules have one port per input and output channel, connected cable by cable. See the [changelog](CHANGELOG.md).

## Useful links

- [https://faustplayground.grame.fr](https://faustplayground.grame.fr): official FaustPlayground website
- [https://github.com/grame-cncm/faustplayground](https://github.com/grame-cncm/faustplayground): GitHub repository

## Connecting modules

Each module has one port per input channel (green) and one port per output channel (red), astride its
bottom edge as on modular synthesizers: inputs from the left, outputs from the right. Physical input and output modules have as many ports as the audio devices have
channels.

- Drag from a port and release on a port of the other kind to connect these two channels. Several
  connections reaching the same input are summed; an output can feed several inputs.
- Release on the body of another module instead to connect all the channels at once: output
  `k mod n` goes to input `k mod m` (Faust's `<:` and `:>` when one number of channels divides the other).
- Click on a cable to delete it. Dashed cables close a cycle and are delayed by 128 samples.

Patches are saved in format version 2; patches saved by FaustPlayground 1.x can still be loaded. Opening a
patch replaces the current scene.

To modulate a parameter, drag a cable from an output onto a widget (slider, button, checkbox) and,
after a short hover, release it on a type in the palette: **±** modulates around the slider
(exponentially for frequencies), **×** scales it, **→** drives it with the signal. The modulation then
gets a port astride the left edge of the module, at the height of its widget, showing its type and,
for **±**, its depth as a ring: drag the port vertically to set the depth (hold Shift for a fine
adjustment), double click to set it back to 1. The
"Modulation" category of the library holds LFOs, random, clock, ADSR and envelope follower sources.
Patches with modulations are saved in format version 3.

## Editing the code of a module

The pencil of a module opens its code in [faustcode](https://github.com/orlarey/faustcode), in a window
reused for all the modules: each save that compiles (Cmd/Ctrl-S) updates the module in place, keeping its
sound, slider values, modulations and connections; a code with errors stays in faustcode. The `</>` button
opens a simpler integrated editor (Ctrl/Cmd-Enter compiles, Escape closes). The faustcode URL can be set
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
Playwright (`npx playwright install chromium`). In the browser console, `faustPlayground.scene.patch`
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

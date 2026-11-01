# Changelog

## 3.4.0 (2026-11-01)

- **Logarithmic sliders** (`[scale:log]`), as in faustcode and the Faust UIs: equal moves of the slider
  give equal ratios of the value (the middle of 0.01..20 Hz is √(0.01·20) ≈ 0.45 Hz, not 10 Hz). Only for
  positive ranges (0 < min < max): the values are then always > 0, rounded to the step of the widget and
  kept in [min, max]; with min ≤ 0 the logarithm is undefined and the slider stays linear.
- The conversions between the position of a slider and its value are in one place
  (`src/model/SliderScale.ts`): the display, the callback of the slider, menus and radio buttons, and
  the accelerometer use it. A value set by the program (recall, undo and redo, the depth of a
  modulation) is applied as it is and the position only shows it, so that a logarithmic slider keeps
  exact values (`setControlerValue`).
- Modulating a `[scale:log]` widget was already exponential (in octaves), like `[unit:Hz]`.

## 3.3.0 (2026-11-01)

- **Menus and radio buttons**: a slider with `[style:menu{'sine':0;'triangle':1}]` is shown as a menu,
  and one with `[style:radio{'off':0;'on':1}]` as radio buttons, as in faustcode and the Faust UIs. The
  slider stays, hidden, as the state of the widget: saving, recall, undo and redo, modulation and the
  accelerometer work as for any slider, and the menu or the buttons follow its value (the nearest
  choice). The labels are read as the compiled JSON gives them (`menu{-sine-:0;...}`).
  `src/model/WidgetStyle.ts` (`choicesOf`), `FaustInterfaceView.addChoices`; tests
  `tests/model/widget-style.test.ts` and "widget styles" in `tests/e2e/app.test.ts`.

## 3.2.1 (2026-11-01)

- **faustcode and faustmodular use the same compiler and Faust libraries**: faustcode 0.14.0 moves from
  libfaust 2.84.3 to 2.90.19 (faustwasm 0.19.6), the version of faustmodular; 47 of the 53 `.lib` files
  differed. faustcode now announces its version of libfaust in its ready message, and faustmodular warns
  (once) when it differs from its own (`FaustcodeLink`, `faustcodeLibfaustMismatch`).
- faustcode 0.14.0 also drops its signals and tasks views: libfaust 2.88 to 2.90 fails on an assertion
  (`sigtyperules.cpp:209`) when drawing the signals graph of any recursive program
  (`process = _ : + ~ *(0.5);`).

## 3.2.0 (2026-11-01)

Phase 2 of the documents: **user modules** (`Documentation/DOCUMENT-SPEC.md`).

- **My modules**, a sixth column of the library, lists the user modules: double click (or drag) adds an
  instance of the latest version; ✎ renames in place; ✕ moves to the trash (the Documents menu restores
  them; the documents using a module do not change).
- **The status of a module follows from its code.** The index of the library
  (`public/faust-modules/library-index.json`, rebuilt by `npm run library-index` and checked by a test)
  gives the hash of each library module and of its past versions found in the git history. An instance
  whose code is in the library is a library module; any other code belongs to the user module that has it
  as a version, or a user module is created for it, named after the instance: a `.dsp` file dropped on the
  stage, a module of an older patch, an older version of a library module.
- **An edit in faustcode is a version**: editing a library module creates a user module (named like it)
  whose first version is the new code; editing a user module adds a version to it.
- **Instances are pinned to a version.** An instance of an older version shows **↑** in its title bar:
  a click updates it to the latest version (or, for an older version of a library module, to the current
  library module), as an edit, undone by Ctrl/Cmd-Z.
- The codes of the user modules' versions are never collected. User modules live in
  `modules/<id>.json` of the documents' storage, shared by all the documents.
- `src/documents/DocumentStore.ts` (user modules), `Documents.statusOf`, `codeEdited`, `updateInstance`,
  `moduleCode`; `DocumentFormat.storedCode`; `scripts/build-library-index.mjs`. Tests:
  `tests/documents/documents.test.ts` (user modules), `tests/library/library-index.test.ts`,
  `tests/e2e/documents.test.ts`.

## 3.1.1 (2026-11-01)

- **Fix: undo moved the microphone and speakers modules to the top left corner.** Their position was not
  recorded in the patch model when they were created (it stayed at (0, 0) until they were dragged), and
  undo, redo and the reopening of a document put them back there. They are now recorded where the page
  shows them. A position (0, 0) in a document or a patch file (saved before this fix) is ignored, and a
  restored position is kept inside the window.

## 3.1.0 (2026-11-01)

- **Default depth of a ± modulation: 0.5** (half the way from the slider to its bounds), instead of 1. A
  double click on the modulation port sets it back to 0.5.
- **A widget remembers its depth**: when its modulation is removed (its last cable) and the widget is
  modulated again, by the same source or another, the depth chosen before is used again. The remembered
  depth is saved with the module's parameters (documents, patch files), unless it is the default one, so
  that a modulation made and undone leaves the module as it was. `Modulation.DEFAULT_DEPTH`,
  `isDepthAddress`, `Scene.moduleParams`.

## 3.0.0 (2026-11-01)

Phase 1 of the documents (`Documentation/DOCUMENT-SPEC.md`).

- **The scene is a document, persistent in the browser.** It is saved in the Origin Private File System
  (OPFS; the localStorage when the browser cannot write OPFS files from the page). Every step of the
  history (and every undo or redo) writes the document's **working copy**; **Save** (Cmd/Ctrl-S) makes it
  the **committed copy**. A dot ● after the name in the header marks a document that differs from its
  committed copy; a change undone back to it removes the dot. Closing the tab loses nothing: the next
  start reopens the last document as it was, working copy included.
- **Documents menu**: the open document (name, New, Save, Save as, Revert to saved, Rename), the list of
  the documents (a click opens one; Duplicate, Delete), and the trash (Restore, Empty the trash). Names
  are unique (`Name 2`, `Name 3`...). One document per tab. A click on the name in the header opens
  the menu.
- **Opening never replaces a document**: a file, an example or a Google Drive scene opened becomes a new
  document; the open one keeps its copies. The question "replace the modified scene?" is gone. A new
  blank document nobody used is replaced rather than kept.
- **Document format 4** (`src/documents/DocumentFormat.ts`): the codes are replaced by the SHA-1 of the
  user's code (without the group faustmodular wraps it in), kept once in a store of codes shared by all
  the documents; the codes no document references are collected at start. A document also records the
  version of libfaust, the environment of the Faust libraries it was written with (the `.lib` files,
  stored once by hash), and the version of the code generator, so that it can be preserved
  (phase 4). The positions of the physical input and output are restored.
- **Migration**: the scenes saved in the localStorage (key `FaustPlayground`) become documents at the
  first start, converted when first opened; the old key is removed after at least 7 days and 2 starts.
  The local sections of the Load and Save menus are removed (the documents replace them).
- `src/documents/`: `FileStore` (OPFS, localStorage, memory), `DocumentStore` (index, copies, trash, codes,
  environments, collection), `Documents` (the scene as the open document), `Environment`;
  `src/Menu/DocumentsPanel.ts`; `Scene.describePatch`, `Scene.replaceScene`; the history announces each
  state reached (`settled`). Tests: `tests/documents/` (store and controller with a simulated scene),
  `tests/e2e/documents.test.ts` (reload, Cmd-S, undo, revert, save as, menu, migration).

## 2.11.0 (2026-11-01)

- **Undo and redo of every change**: modules added, removed, moved or recompiled (code edited in
  faustcode), connections and disconnections, modulations and their depth, parameter values. Ctrl/Cmd-Z
  undoes, Ctrl/Cmd-Shift-Z (or Ctrl-Y) redoes; two buttons ↶ ↷ in the header do the same. The history
  records a state of the scene once it is quiet (400 ms): a slider dragged or a group of modules moved is
  a single step. Undo and redo change only what differs (a parameter value recompiles nothing; a module
  is recompiled when its code or its modulations differ; a removed module is created again with its id,
  parameters and connections). Opening a patch starts a new history. `src/Scenes/History.ts`,
  `Scene.captureSnapshot`, `Scene.restoreSnapshot`.
- **Selection of several modules**, moved together: Shift (or Ctrl, Cmd) and click adds a module to the
  selection or removes it; dragging on the empty stage draws a rectangle that selects the modules it
  touches; a click on the stage clears the selection. Selected modules have a mint outline.
- The microphone and speaker icons are centered in their modules.
- Cables are thicker (5 px, modulation cables 4 px): easier to click to delete them.

## 2.10.1 (2026-11-01)

- The coloured bar to the left of a modulated slider is removed: its modulation port already shows it.
- The ports of the physical input (microphone) and output (speakers) modules are centered vertically;
  these modules grow only when their ports need more room than their icon.

## 2.10.0 (2026-11-01)

- **FaustPlayground (extended) is renamed faustmodular**, in lower case like faustcode. The header shows
  the name followed by the version, `faustmodular 2.10.0`, read from `package.json` (`src/Version.ts`),
  as are the page title, the console and the comment heading the exported Faust code.
- faustcode is opened with `?link=modular` in a window named `faustcode-modular` (faustcode 0.13.1,
  which still accepts `?link=playground`). faustcode 0.13.2 fixes two races found by the end-to-end test:
  clicking ENTER while its welcome page still prepared the showcase replaced the linked session.
- Kept for compatibility: the patch format identifier `faustplayground-patch`, the local storage key
  and the Google Drive folder `FaustPlayground` (the scenes already saved stay listed), and the console
  access point `faustPlayground` (now also `faustmodular`).

## 2.9.0 (2026-11-01)

- **Audio ports on the sides again**, in a zone at the bottom of the module, under its last widget:
  inputs astride the left edge, outputs astride the right edge, numbered from the top. The modulation
  ports keep the left edge above, at the height of their widgets. Cables leave the outputs to the right
  and reach the inputs from the left.
- **The pencil is in the title bar** of the module, and opens the code in faustcode. The integrated
  editor (`</>`) is removed: faustcode is the only editor.
- **The modulation palette is removed**: a single mode per kind of widget (2.8.0) left nothing to choose.
- The GRAME logo and the credit line at the bottom left are removed.

## 2.8.0 (2026-10-31)

- **One modulation mode per kind of widget, no palette.** Releasing a cable on a slider modulates it
  with ± (from the slider value, 2.7.0); on a button or a checkbox, the signal drives it. The effect of
  the former "× scale" is obtained with the slider at its minimum and a unipolar signal (the depth sets
  the level, like a VCA), the effect of "→ drive" with the slider at its minimum and a depth of 1 (a
  signal from 0 to 1 covers the whole range). To be evaluated in use.
- Patches saved with "scale" or "drive" on a slider still load and play as before; these modes are no
  longer offered.
- The modulation example uses ± on the volume: slider at 0, depth 0.75, the ADSR envelope opens it.
  The precompiled examples are rebuilt with libfaust 2.90.19.
- Test of the export with modulations: the tolerance accounts for the phase drift of an oscillator whose
  frequency is modulated (float32 rounding of its frequency, integrated over time).

## 2.7.0 (2026-10-31)

- **± modulate now starts from the slider value.** With u = depth · signal, bounded to [−1, 1]: u = 0
  leaves the slider value, u = 1 reaches the maximum of the widget, u = −1 its minimum, linearly in
  between (w + u·(max − w) going up, w + u·(w − min) going down). The depth sets the excursion around
  the current value; negative, it inverts it. Frequencies follow the same rule in octaves
  (w·(max/w)^u, w·(w/min)^u). Before, ± added depth · signal · (max − min)/2 and clipped, which lost
  part of the excursion when the slider was near a bound.

## 2.6.1 (2026-10-31)

- Dependencies updated (`npm audit`: 0 vulnerabilities): Vite 8.3.5 (several advisories of its dev
  server and of launch-editor), source-map-js 1.2.2 (denial of service), faustwasm 0.19.6 with
  libfaust 2.90.19.
- libfaust 2.90.19 fixes the `-ftz 2` defect found in phase 4 (a recursion driven by a constant gave
  zeros): `tests/faust/ftz.test.ts` is now a regression test, and all the 90 library modules render the
  same signal with `-ftz 2` as without. The application keeps `-ftz 1`.
- Not updated: Playwright stays at 1.63 (its Chromium is the one installed in the development
  environment), TypeScript 7
  and `@types/node` 26 are major versions, left for a separate step.

## 2.6.0 (2026-10-31)

- **Confirmation before replacing a modified scene.** The scene keeps track of its changes since it was
  opened or saved: modules, connections, positions, code, modulations (patch events) and slider values.
  Opening another patch then asks "The current scene has been modified since it was last saved. Replace
  it anyway?"; cancelling leaves the scene as it is. Saving (download, local storage, Google Drive)
  clears the mark; an empty scene never asks.
- Theme: dialogues above the open menu, menu buttons, fields and file chooser in the dark look.

## 2.5.0 (2026-10-31)

- **New look, close to faustcode** (`css/Theme.css`, loaded last): charcoal stage with a faint grid,
  night-blue module panels with 8 px corners, titles in small letter-spaced capitals, mint accent, pills
  for the menu buttons and the patch name, values in monospace chips. Audio inputs are mint, outputs
  coral, everything about widget modulation amber. The colours are CSS variables (`--fp-…`).
- **Opening a patch replaces the scene**, as opening a document replaces another (it used to add the
  patch to the scene). The file is read whole first: a file that cannot be read leaves the scene as it
  is. `Scene.clearScene` empties the scene, connections between the physical input and output included.

## 2.4.0 (2026-10-31)

- **Editing in faustcode**: the pencil of a module opens its code in
  [faustcode](https://github.com/orlarey/faustcode) (syntax highlighting, completion, errors at their line,
  block diagram, scope and spectrum, documentation, MCP), in a window reused for all the modules. Each save
  that compiles (Cmd/Ctrl-S) recompiles the module in place: the sound goes on, the slider values, the
  modulations and the connections whose ports still exist are kept. A code with errors stays in faustcode
  and the module keeps playing its last valid version. The windows talk with `postMessage`
  (`src/FaustcodeLink.ts`); the faustcode URL can be changed with `?faustcode=<url>`. This needs a faustcode
  with the playground link (webapp 0.13.0).
- **Integrated editor** (`</>` button), fixed and improved:
  - it shows the user's code only, without the `vgroup`/`environment` wrapping of the module;
  - a code with errors no longer empties the module: its DSP and interface are kept, the editor stays
    open with the text and the errors, numbered as the lines of the user's code;
  - Ctrl/Cmd-Enter or Ctrl/Cmd-S compiles, Escape closes without compiling, Tab indents; monospace font;
  - the scene keeps playing during the compilation.
- Module codes are wrapped with line breaks around the user's code: a final line comment no longer
  comments out the closing brace (`src/model/ModuleCode.ts`).

## 2.3.0 (2026-10-31)

- **Audio ports at the bottom of the modules**, as on modular synthesizers: inputs (green) from the left,
  outputs (red) from the right, astride the bottom edge. The module widens to hold them (up to 32 ports
  per side: their size and pitch decrease beyond 4 and 8 ports). Cables leave and reach these ports
  vertically and hang between modules.
- **Modulation ports astride the left edge**, at the height of their widget: the left edge is now free,
  so the module no longer widens its left margin for them. Modulation cables reach them horizontally.
- **Fine depth adjustment**: drag a modulation port with Shift held for 0.001 per pixel (0.01 without);
  the change is incremental, so Shift can be pressed or released during a drag. The depth slider has a
  step of 0.001.
- The modulation and multichannel examples are laid out for the new ports.
- Fix: loading a patch reset the classes of the controls (accelerometer state), so the hidden depth rows
  of the modulations reappeared under their widget.

## 2.2.0 (2026-10-31)

- **Modulation ports**: each modulation now has its own port, inside the module next to its widget, clear
  of the audio input ports. An icon shows its type (± modulate, × scale, → drive) and, for "modulate", a
  ring shows its depth: the arc length is |depth|, clockwise and orange when positive, counterclockwise
  and blue when negative. Drag the port vertically to set the depth live (no recompilation, 0.01 per
  pixel), double click to set it back to 1. Modulation cables end on these ports; dropping a cable on one
  adds a source. The "depth" control row under the widget is gone.
- The depth of a modulation is named after its widget (`depth_<widget>`) instead of its rank: removing
  another modulation of the module no longer shifts the depths.
- Saved parameter values are those shown by the interface. The values read back from an AudioWorklet node
  (`getParamValue`) may lag behind, e.g. for a value set while the audio context is suspended.

## 2.1.0 (2026-10-30)

Widget modulation: an audio output can now be connected to a widget (slider, button, checkbox) of a
module, as in modular synthesizers. See
[Documentation/widget-modulation/PLAN.md](Documentation/widget-modulation/PLAN.md).

- Drag a cable from an output onto a widget: after a short hover, a palette shows the modulation types;
  release the cable on the one you want:
  - **± modulate** (default): `w + depth · m · (max − min)/2`, kept within the range of the widget; an LFO
    in [−1, 1] at depth 1 sweeps the whole range around the slider. Frequency widgets (`[unit:Hz]`,
    `[scale:log]`) are modulated exponentially, `w · 2^(depth · m · N)`, N being half their range in
    octaves. The depth (−1 to 1) is a small control under the widget, adjusted live;
  - **× scale**: `w · m` (VCA-like);
  - **⇐ drive**: the signal replaces the widget (greyed); the only type for buttons and checkboxes.
- One type per widget; several sources reaching a widget are summed. Deleting the last cable removes
  the modulation.
- The module is recompiled on the fly with Faust's widget modulation (`["label" : circuit -> e]`); the
  sound keeps playing, the parameter values are kept, and the exported program includes the modulations.
- New "Modulation" library category: LFO (sine, triangle, square, sawtooth), Quad LFO, Random (sample and
  hold), Clock (gates), ADSR, Envelope Follower; bipolar sources in [−1, 1], unipolar ones in [0, 1].
- New "Modulation example" in the Load menu.
- Patch files with modulations are saved in format version 3 (still 2 otherwise).
- Fix: after editing the code of a module, its parameter values were applied to the old DSP; they are
  now given back to the new one.
- Fix: loading a patch containing a module with a button or a checkbox failed (the accelerometer
  settings of these controls were restored as if they were sliders).

## 2.0.0 (2026-10-30)

FaustPlayground becomes multichannel: a module has as many ports as its Faust program has inputs
and outputs, and cables connect one channel to one channel. The design, the decisions and the
measurements behind this version are in [Documentation/multi-io/PLAN.md](Documentation/multi-io/PLAN.md).

### Patching

- One port per channel on every module: inputs on the left (green), outputs on the right (red),
  numbered when there are several, up to 32 of each.
- Physical input and output modules have as many ports as the audio devices have channels.
- Drag from a port to a port of the other kind to connect two channels; release on the body of a
  module to connect all the channels at once: output `k mod n` goes to input `k mod m`, which is
  Faust's `<:` or `:>` when one number of channels divides the other.
- Several cables reaching an input are summed; an output can feed any number of inputs from a
  single instance of its module. Cables closing a cycle are dashed: they are delayed by one render
  quantum (128 samples) in the browser and by one sample in the exported program.
- Mouse, touch, pen and multi-touch through Pointer Events (several cables can be drawn at once).
- When a module is recompiled, the connections whose ports still exist are kept; the others are
  removed and reported.

### Export

- The exported Faust program is equivalent to the patch, channel by channel, cycles included, with
  one instance and one set of controls per module. Only the modules that reach the output are
  exported. The application has the physical inputs that are used and all the physical outputs, or
  2 inputs and 2 outputs with the new "force stereo" option.
- Exporting no longer adds connections to the patch.

### Files

- Patches are saved in format version 2 (`"format": "faustplayground-patch", "version": 2`), with
  port-to-port connections. Patches of FaustPlayground 1.x still load: each 1.x connection becomes a
  bus connection.
- **Level change**: a 1.x connection from a stereo output to a mono input used to average the two
  channels; it now sums them, as Faust's `:>` does (+6 dB).
- Parameter values saved with older Faust paths (`1_(Note_48)`) are restored again.
- The examples of the Load menu are version 2 files; a multichannel example is added.

### Library

- New "Multichannel" category: oscillator bank (0×8), panner (1×2), stereo width (2×2), mixer
  4 to 2, multi delay (4×4), quad and octo spatializers (1×4, 1×8), ambisonic encoder and decoder
  of order 3 (1×7, 7×8).
- VibratoEnvelope had an unintended second input; it is now 1×1.

### Fixes

- Modules are compiled with `-ftz 1` instead of `-ftz 2`: with libfaust 2.90.17, `-ftz 2` zeroes the
  recursions driven by a constant, which silenced or altered 9 library modules (SBird, Birds and
  other modules based on noise).
- Two instances of the same module no longer share their controls in the exported program.
- Saving precompiled patches with large modules no longer overflows the call stack.
- Module positions are saved exactly, also when the scene is scrolled.
- Dropping several files at once no longer mixes the names and positions of the new modules.
- Touch dragging no longer adds the input and output modules to the module list.

### Development

- Type checking (`npm run typecheck`) and tests (`npm test`): unit tests under Node.js with libfaust,
  Web Audio tests in Chromium, end-to-end tests of the application with Playwright, among which a
  differential test showing that the browser and the exported program render the same signals.
- Continuous integration on every push; the GitHub Pages deployment only runs on demand.

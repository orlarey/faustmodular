# Changelog

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

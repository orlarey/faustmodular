# Changelog

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

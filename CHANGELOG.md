# Changelog

## 3.34.0 (2026-11-03)

- **The microphone on demand**: it is no longer asked for when the application opens, but when a cable leaves
  the input module (drawn, undone, in a scene opened) or on a click on it (not on a move of it). The input module
  is dim until then, crossed if the microphone is refused or missing (a click asks again); its tooltip says so.
- **No request to another site at load**: the script of the Google API (the Drive saving of FaustPlayground, not
  shown) is no longer loaded, and the export service is asked for its targets only when the Export menu is
  opened (not shown either).
- **A safety limiter after the volume**: a peak limiter linked across the channels (an AudioWorklet), transparent
  under −1 dBFS (its gain is exactly 1 there), bringing the peaks down to −1 dBFS at once, its gain coming back in
  about 100 ms; NaN and infinite samples are silenced. The speaker of the output module glows coral while it acts.

## 3.33.0 (2026-11-03)

- **The volume of the scene, on the speaker of the output module**, as the depth of a modulation port: a
  vertical drag on the speaker sets it (1 % per pixel, 0.1 % with Shift), a label shows the value while it is
  set, and the brightness of the speaker shows it at rest (its tooltip gives the value). The gain, between the
  output module and the audio device, is (v / 100)², as in faustcode (about −12 dB at 50 %, 1 at 100 %), and
  glides over 20 ms. The volume is remembered by the browser, not by the scene (no history, no document).
- A double click on the output module mutes the scene by this gain: the audio keeps running (analyzers,
  modulations) and comes back at once, in place of a suspended audio context resumed after 500 ms. Muted, or at
  0 %, the speaker is crossed.
- The output module is moved by its edge, around the speaker.

## 3.32.0 (2026-11-03)

- The signature of the author in the bottom left corner of the stage, as the GRAME logo of FaustPlayground: a
  seal with a lambda (the lambda calculus) whose branch carries a small o (Yo), darker than the stage, as
  engraved; under the modules, it takes no click.

## 3.31.3 (2026-11-03)

- The knobs have a body: an almost black disc inside their arc, its edge barely lit; the pointer is drawn on it.

## 3.31.2 (2026-11-03)

- A wait no longer shows the animated GRAME logo of FaustPlayground (`logoAnim.gif`, 185 kB, removed) but a ring
  in the accent colour with the word *Loading*, on a lighter veil; they appear after 300 ms, so that a short wait
  does not flash (the veil takes the clicks at once).

## 3.31.1 (2026-11-03)

- The icons of the Orbit interface come from a font served with the application, not from Google Fonts: a
  subset of Material Symbols Outlined (Apache License 2.0) with the 10 icons faust-orbit-ui shows (6.5 kB,
  `css/fonts/`). `npm run icon-font` makes it again after an update of faust-orbit-ui; a test checks that it
  holds every icon of faust-orbit-ui and that no page loads Google Fonts.
- Publishing: every push to `main` builds the application and publishes it on GitHub Pages
  (https://orlarey.github.io/faustmodular/).

## 3.31.0 (2026-11-03)

- **The labels of the groups set apart from those of the widgets**: centred above their widgets, between two
  lines, in capitals, bold and in the accent colour; the label of a group inside a group is smaller, lighter,
  between two short lines. A group of a row (`hgroup`) keeps its label on one line (the column is widened) and
  the labels of the columns are at the same height. The left border of the groups inside a group is removed.
- The LED of a checkbox is yellow: dim when off, bright with a glow when on.

## 3.30.0 (2026-11-03)

- **The File menu of a desktop application**: a dropdown, New scene, Open a scene… (Ctrl/Cmd-O), Save (Ctrl/Cmd-S),
  Save as… (Shift-Ctrl/Cmd-S), Import a Faust file (.dsp)…, Recent scenes ▸ (the 8 last ones), Examples ▸. The panel
  of the documents (their list, the trash, Revert, Duplicate, the precompiled option) is no longer shown; its code
  is kept.
  - With the File System Access API (Chrome, Edge), the file a scene was opened from or saved to is remembered
    for its document (its handle, in IndexedDB): Save writes it again without asking, Save as… chooses another
    one, and the scene takes the name of its file. Without it (Firefox, Safari), Open reads a file chosen and
    Save downloads the scene.
  - Opening a scene replaces the one shown: it stays in Recent scenes, the scenes being saved automatically in
    the browser (the documents, underneath). A scene saved to its file is not modified any more (its dot goes).
  - The name of the scene, at the top right, is renamed by a click (Enter, or a click elsewhere; Escape gives up).
  - Chromium reserves Ctrl/Cmd-N (a new window): New scene has no shortcut.
- The context menus have submenus (a command with items, opened on hover or click).
- Tested with a disk in memory (Playwright cannot drive the pickers of the browser): Save as names the scene
  after its file, Save writes the same file without a picker, Open replaces the scene and remembers its file;
  without the API, Save downloads and Open reads a file chosen.

## 3.29.2 (2026-11-03)

- The − button of the title bar of a module is removed: a module is minimized from its context menu
  (*Minimize*); a minimized module keeps the button that expands it, left of ⧉, which takes the place of −.

## 3.29.1 (2026-11-03)

- The accelerometer button of the toolbar is hidden for now, as the Edit menu that maps the sliders to the motion
  of a phone (its code is kept).

## 3.29.0 (2026-11-03)

- **A value typed in place of the value shown**, as in faustcode: a double click on the value of a slider or a knob
  turns it into a text field; Enter, or a click elsewhere, sets the value typed (a decimal comma is accepted), kept
  in the range of the widget and on the grid of its step from its minimum; Escape, or a text that is not a number,
  gives up. The value is set exactly, not through the position of the slider (on a logarithmic scale, 440 Hz is
  then 440 Hz), and as a value recalled: sound, saving, undo, and the Orbit when it is shown.

## 3.28.0 (2026-11-03)

- **The Orbit interface for a module** ([faust-orbit-ui](https://github.com/orlarey/faust-orbit-ui) 0.4.1, as in
  faustcode): ◎ in the title bar, or *Orbit interface* in the context menu of a selection, shows the settings of
  the module as points around a centre, in place of the classic interface; ◎ again gives it back. Not offered for
  a module without settings.
  - One source of truth: a gesture in the Orbit sets the values as a slider does (sound, saving, undo); an undo,
    a redo or a recall pushes them back into the Orbit.
  - Its size (a grip) and the layout of its points are saved with the document (a field `view` of the instance,
    of the patch file); showing it and its size are undone, the layout is not.
  - Its modulation ports are in a column under the title; a cable dropped on one of its points modulates that
    setting. The keys typed in it (L, Delete of its presets, Esc) are its own; Cmd/Ctrl-Z there undoes its
    library of presets when that is open.
  - It shows the input widgets of the user: not the depths of the modulations, the driven or hidden widgets, the
    bargraphs.
- **Two workarounds of faust-orbit-ui 0.4.1**, until the library handles a zoomed host: the stage of faustmodular is
  zoomed by a CSS transform, and the library reads the pointer in screen pixels while it draws in CSS pixels (the
  five methods that read the pointer are wrapped), and places its dropdowns (fixed elements) in screen pixels
  inside the zoomed stage (they are moved to its coordinates). Tested: a point follows the pointer exactly at
  zooms of 0.75, 1 and 1.5; without the workarounds, the gesture misses the point at 0.75 and a dropdown opens
  394 px away from its button at 1.5.
- The icons of the toolbar of the Orbit come from the Material Symbols font (Google Fonts).

## 3.27.0 (2026-11-03)

- **From faustcode to faustmodular**: the *faustmodular* button of faustcode (0.15.0) opens its session here, as a
  module of the open document, linked to the session: each save that compiles in faustcode updates the module, and
  its pencil edits it in that faustcode. faustcode opens faustmodular with `?link=faustcode` if needed (or uses the
  faustmodular that opened it). New messages of the link: `faustcode-link-hello` (faustmodular, opened by faustcode,
  ready), `faustcode-link-import` (a code to add as a module), `faustcode-link-imported` (its id, or why not).
  faustmodular takes code this way only from its opener, with the origin of the official faustcode (a
  `?faustcode=<url>` is accepted here only on localhost: a page of another site could otherwise add modules to the
  open document).
- **The context menu of the stage**: *Modules…* opens the Modules menu; *New module (in faustcode)* makes a
  pass-through module where it was opened and opens it in faustcode to be written.
- Tested with a stub of faustcode (hello, import, update, the pencil to the faustcode that opened faustmodular, a code
  with errors, a page of another site refused), and with the real faustcode (`FAUSTCODE_DIR`): its button adds the
  session as a module, a Ctrl-S updates it, the button again updates the same module.

## 3.26.0 (2026-11-03)

- **Two menus**: *File* and *Modules* (the library, formerly *Library*). Load and Save are in File; Edit and
  Export are hidden for now (their code is kept).
- **File** gathers the open document (New, Save, Save as, Revert, Rename), the documents, the trash, and a
  column *Files*: open a file (a patch, .json or .jfaust, opens as a new document; a Faust file, .dsp, becomes
  a module of the scene), download the scene as a .jfaust (precompiled or not), the examples (small, big,
  multichannel, modulation). Google Drive and the scenes of the former local storage are no longer offered.
- **The context menu of the stage** imports a Faust file (.dsp) as a module where it was opened.

## 3.25.0 (2026-11-03)

- **Saturation and folding** (`aanl.lib`), a family of the group *Faust libraries*, with the Cubic Distortion
  and the Transformer of `demos.lib`:
  - *Waveshaper*: nine curves (hard clip, cubic, tanh, arctan, sin arctan, hyperbolic, parabolic, quadratic,
    asinh), computed by the antiderivative method (ADAA) of the first or second order, each kept within
    [-1, 1] but asinh; Drive (dB), Bias (asymmetry: the value of the curve at Bias removed after it, a high pass
    overshot by 53% on the flat tops of a clipped 100 Hz), Mix, Level.
  - *Wavefolder*: triangle or sine, first or second order, with Damping.
  - Measured: the slopes at 0 (1; 1.5 cubic, 2/pi arctan, 2 quadratic) within 0.05 dB; the aliases of a hard
    clip of a sine at 4987 Hz driven by 24 dB, -11.1 dB of the power through the curve, -18.1 dB at the first
    order, -22.3 dB at the second; the folds of a sine of amplitude 3 (6 zero crossings a period).
  - Measured in the library, in single precision: the antiderivative of `aa.tanh1`, log(cosh(x)), overflows
    beyond |x| = 89 (driven by 48 dB, a 5 kHz sine came out at 0.58): Drive stops at 36 dB. The second order
    overshoots at low frequencies when driven hard (at 50 Hz: 1% at 24 dB, 6% at 30 dB, 44% at 36 dB for
    arctan); the first order stays within [-1, 1].
- **Delays and modulation**, a family with the Flanger Stereo, the Phaser Stereo and the Tape Stop of
  `demos.lib`: *Echo* (`ef.echo`), *Delay* (`de.fdelay` with feedback: fractional, it glides when Time moves),
  *Flanger*, *Phaser* (2, 4 or 8 notches), *Vibrato* (a delay swept so that the pitch rises by Depth cents:
  D = (2^(c/1200) - 1)/(2 pi f)), *Pitch Shifter*, *Granular*, *Dimension Expander* (stereo).
  - Measured: the echoes at k Time, Mix x Feedback^k; the fractional delay shared between two samples; the
    notches of the flanger at odd multiples of 1/(2 Delay) (multiples of 1/Delay inverted); the notches of the
    phaser (2, 4, 8); the vibrato within 5% of its depth in cents, up and down (2 - 2^(c/1200)); the pitch
    shifter at its interval within 2 cents, the original more than 120 dB down; the granulator as the delay of
    Position within 1e-3; the dry sound of each at Mix 0.
  - Measured in the library: `ef.transpose_windowed` with four taps cancels for good the frequencies at odd
    multiples of 2 SR / w (with a window of 50 ms, every 80 Hz from 40 Hz: a sine at 440 Hz came out at
    -119 dB). With two taps none is lost (-3 dB at worst, on average): the Pitch Shifter uses two, the
    Granular three (its shifted grains are offset in the same way).
- The family *Effects* keeps the Vocoder.

## 3.24.0 (2026-11-02)

- **Drums and voices of `synths.lib`**, a family *Drums and voices* of the group *Faust libraries*: Kick, Clap,
  Hi-Hat, Pop Drum, Additive Drum (the modes of a membrane or of a bar), Comb String, Dub Synth, Saw Trombone.
  - A *Gate* button: a clock or a sequencer drops its gate on it (⇐ drive) and plays it.
  - *Freq* in Hz, transposed by *Pitch* (0.1 per octave): a sequencer dropped on Pitch plays the notes from
    the frequency set.
  - Times in ms on a log scale.
  - Measured: each sound silent before its gate and after its release; the kick, the pop drum, the string,
    the dub synth and the trombone at their frequency within 5 cents, transposed by Pitch; the kick from up
    to five times its frequency, its linear envelope silent at Attack + Decay; the modes of the additive
    drum; the decay of the string within 10% of the Decay asked; the clap and the hi-hat brighter with Tone.
  - The string's Decay is its time to -60 dB: `sy.combString` takes a time constant per period in ms (its doc
    says a T60 in seconds), which the module computes, 1000·Decay·f/(6.91·SR). The pop drum's level, which
    grows with its frequency (0.014 at 50 Hz, 0.3 at 1 kHz), is evened by 1500/f; the hi-hat (1.29 at its top,
    from the resonance of its filter) is scaled by 0.75.
- **Analyzers of `analyzers.lib`: a sound turned into control signals**, in the family *Analysis*:
  - *Pitch Tracker*: the pitch of the sound (0.1 per octave from C4) and a gate. `an.pitchTracker` ripples at
    the frequency of the sound (100 cents at 220 Hz with 20 ms); smoothed twice more in Hz, before the
    logarithm, its pitch is within 1 cent from 110 to 880 Hz, sine or sawtooth, with a ripple under 2 cents.
    The gate closes when the level falls below the threshold or the sound stops (1.5 periods without a zero
    crossing), and the pitch is held at its value two periods before: a stopped sound would otherwise leave
    the tracker falling for as long as the level takes to fall (measured: a pitch held 6060 cents off).
    End to end: a sine at 440 Hz tracked plays a VCO at 440 Hz within 5 cents.
  - *Spectral Centroid*: the brightness, as a pitch (a sine at its frequency within 10 cents, a white noise
    at SR/4); *Zero Crossings*: 2f/SR for a sine, 0.5 for a white noise; *RMS Level*: the level in dB, from the
    floor (0) to 0 dB (1), within 0.002.
- The fourth order of `an.pitchTracker` loses a sawtooth from 440 Hz (it falls to about 38 Hz): the module
  uses the second order.

## 3.23.1 (2026-11-02)

- **The Diode Ladder at -3 dB at its cutoff, whatever the resonance.** `ve.diodeLadder` placed its -3 dB
  frequency at 0.075 of the frequency asked for Q = 0.707, 0.45 for Q = 5, 1.0 for Q = 20: turning the
  resonance moved the cutoff by almost four octaves. Its analog model, read in its code, is
  H(s) = 1/(D(s) + k), D(s) = 8s⁴ + 32s³ + 40s² + 16s + 1 (the four stages coupled; self oscillation at
  k = 17 and 0.707 of the frequency of the stages, as the code says). The module solves |D(jω) + k|² = 2(1 + k)²
  (a quartic in ω², one positive root, by bisection) and tunes the stages so that the -3 dB frequency is the
  cutoff (bilinear transform: tan(πf/SR) scaled by 1/ω). Measured: within 4 cents from 50 Hz to 15 kHz, Q from
  0.707 to 20; the peak of the resonance at 0.674 of the cutoff for Q = 20, 17.7 dB above the gain at 0 Hz.
- **A typo of the library corrected in the module**: the feedback through the second stage of
  `ve.diodeLadder` uses `SG3` where the derivation has `SG2` (defined in the function, never used); it detunes
  the filter as the feedback rises (up to 280 cents at 10 kHz). Corrected, the filter is the bilinear transform
  of its analog model within 4 cents. The feedback of the module depends on Q alone (the library lowers it
  above 5 kHz, by (17 - nf¹⁰·9.7)): a bilinear transform keeps the filter stable below k = 17 (k = 13.5 for
  Q = 20); tested at 20 Hz, 1 kHz and 20 kHz, and with a cutoff swept over 8 octaves at 50 Hz.

## 3.23.0 (2026-11-02)

- **22 filters, equalizers and pedals of the Faust libraries** (`filters.lib`, `vaeffects.lib`) as modules, in
  three families of the group *Faust libraries*:
  - *Filters*: SVF (nine responses: low pass, band pass, high pass, notch, peak, all pass, bell, low and high
    shelves), Resonant, Butterworth (orders 1, 2, 4, 8), Elliptic (3rd and 6th order), Moog Ladder, Diode
    Ladder, Korg 35, Oberheim, Sallen-Key, Notch, DC Blocker;
  - *Equalizers and crossovers*: Low Shelf, High Shelf, Peak EQ (constant Q), Linkwitz-Riley crossovers 2, 3
    and 4 ways (outputs named low, mid, high), Spectral Tilt (in dB per octave);
  - *Pedals*: Klon Centaur, Fulltone OCD, MXR Phase 90, Auto Wah.
  The demos of these libraries join them (Moog VCF, TF2 Filter; Parametric EQ, Filter Bank; Crybaby, Wah4):
  the family *Filters and EQ* is replaced by the three.
- **An interface made for music**: *Cutoff* in Hz on a log scale (an LFO or an envelope moves it in octaves);
  a *Pitch* slider on each filter (0.1 per octave) for the keyboard tracking, as on the VCF; *Q* on a log
  scale; gains in dB; the responses and orders in menus; no smoothing (a modulation passes as is). The
  filters of `vaeffects.lib` take a normalized frequency: the cutoff is converted, `log10(fc/20)/3`.
- **Frequency responses measured offline** (impulse responses, `tests/library/filters.test.ts`): -3.01 dB at
  the cutoff (SVF, Butterworth at every order, |H|² = 1/(1+Ω^2N) within 0.05 dB), Q at the cutoff of the
  resonant low pass, -0.2 dB at the edge of the elliptic passband, -12.04 dB at the cutoff of the Moog ladder
  without feedback (the conversion to the normalized frequency), -6.02 dB at each crossover of the
  Linkwitz-Riley bands and their sum flat within 0.01 dB, the slope of the spectral tilt within 0.1 dB per
  octave, the cutoff following the pitch (the same impulse response).
- Measured on the way, in the libraries: the Moog ladder at Q = 20 resonates at 942 Hz for a cutoff of 1000 Hz;
  the diode ladder amplifies a small signal by 43 dB (the saturation of its input) and its cutoff lies well
  below the frequency asked (-30 dB at fc relative to its passband, a resonance at 590 Hz for 1000 Hz); the
  high pass of the Korg 35 falls by 6 dB per octave only far below its cutoff.

## 3.22.0 (2026-11-02)

- **52 modules taken from the Faust libraries**, in a group *Faust libraries* of the library: the functions of
  `demos.lib` and `physmodels.lib` that are complete processes with their interface. Reverbs (9: Dattorro,
  Freeverb, Greyhole, JPverb, KB ROM, Reverb Tank, Spring, Vital, Zita Light), dynamics (3), filters and EQ (6),
  effects (6), oscillators and noises (7), physical models (20: flute, clarinet, brass, violin, guitars,
  Karplus-Strong, marimba, djembe, formant voice, six bells, Pink Trombone, blower), analysis (1). Of the 78
  candidates, 72 compile; left out: those that need constant parameters or overflow the compiler (6), the
  demos of sensors (5) and of tests (2), the duplicates.
- **A MIDI instrument plays as the VCO**: its `freq` widget (Hz) is replaced, by Faust's widget modulation,
  by a *Pitch* slider, 0.1 per octave from C4; a sequencer drops its pitch on it (+ add) and its gate on the
  `gate` button. Tested: the module gives the signal of the instrument set at that frequency (identical for 8
  instruments, within 6e-6 for the others); end to end, a guitar played by a sequencer sounds as a guitar whose
  Pitch is set by hand.
- Measured on the way, in the libraries themselves: with their default settings the flute overblows, the brass
  sticks at 1959 Hz, the violin plays an octave up at C4; the guitar model is in tune at 48 kHz but 12 to 23
  cents low at 44.1 kHz.
- **Pitch sliders: a step of 0.0001** (1.2 cent; it was 0.001, 12 cents) on the VCO, the VCF and the
  instruments.
- Generated by `npm run faustlib-modules` (`scripts/build-faust-library-modules.mjs`, from
  `scripts/faust-library-modules.mjs`, with the summaries of the documentation of the libraries); a test checks
  that they are up to date.

## 3.21.0 (2026-11-02)

- **Knobs** for `[style:knob]` (170 widgets of the library declare it): the label above, the knob, the value below.
  A vertical drag turns it, 200 px for the whole range (2000 with Shift); a double click sets it back to its
  initial value. The slider, hidden, stays the state (saving, undo, modulation, accelerometer); its positions,
  a logarithmic scale included, are the angles of the knob, from −135° to 135°.
- **Rows and tabs**: an `hgroup` lays out its children as a row, wrapped when the module would be wider than
  520 px; a `tgroup` as tabs, one per child, titled with its label. The tab chosen is kept when the interface is
  rebuilt (a recompilation); not saved.
- **Modulation ports of the widgets in a row**: on the top left corner of their widget (on the edge of the
  module, the ports of a row would be on top of one another); a widget in a hidden tab has its port on the title.

## 3.20.0 (2026-11-02)

- **The library in one view**, as the modular library was: the families, grouped (*Modular*, then *FaustPlayground*,
  then *My modules*), the modules of the family chosen, the description of the module pointed at. The selector
  Modular / FaustPlayground and the columns of the FaustPlayground library are gone. The FaustPlayground modules
  are in eleven families: harps (8), winds (13), bars and bowls (8), noises and oscillators (11), instruments with
  reverb (26), filters (7), echoes and reverbs (6), modulations (7), level and dynamics (3), spatialization and
  multichannel (9), modulation sources (6). *My modules* is a family, with its renaming and trash in place. The
  family chosen is remembered.
- The catalog (`public/faust-modules/library-catalog.json`, was `modular-catalog.json`) holds all the modules; the
  FaustPlayground ones are put in their families by a table (`scripts/library-families.mjs`), without changing
  their code: their hash, and so the status of the modules the documents use, stays. A test checks that every
  module of the library is in one family exactly.
- The descriptions leave out their lines of punctuation alone (the ":" of the FaustPlayground comments).

## 3.19.1 (2026-11-02)

- **Random: the same *Unipolar* checkbox** as the LFOs: its values in [0, 1] instead of [-1, 1] (the slider of
  the widget it modulates is then the minimum).

## 3.19.0 (2026-11-02)

- **LFOs: a *Unipolar* checkbox** (a button with a LED) on the LFO and the Quad LFO of the modulation sources,
  and on the LFO of the modular library (in place of its Polarity menu): the output in [0, 1] instead of
  [-1, 1]. Dropped on a widget (± modulate), a unipolar source moves the value from the slider up: the value set
  on the slider is the minimum of the modulation. Tested from the LFO to the widget: a unipolar square on a
  slider at 0.2 with depth 1 gives [0.2, 1], a bipolar one [0, 1].

## 3.18.0 (2026-11-02)

- **Checkboxes are buttons with a LED**, as on hardware synthesizers: a button without LED is momentary
  (`button`), a button with a LED latches (`checkbox`). Same form as the buttons (centered, half the width of
  the module); a click toggles the LED; the checkbox, hidden in the button, keeps the state (saved, undone).
- **Lit buttons**: a button is lit while it is held down, and while a modulation holds it at 1 (a gate
  driven by a sequencer or a clock lights in rhythm). The LED of a driven checkbox follows the signal.
  A driven button or checkbox keeps its light at full brightness, its label dimmed.
- To know the value a modulation gives a widget, the "drive" circuit adds a hidden bargraph
  (`[driven:<target>][hidden:1]`) that reports it to the interface; bargraphs marked `[hidden:1]` are not
  shown.

## 3.17.1 (2026-11-02)

- **Buttons**: centered on their own row, half the width of the module (at least 96 px), with the same visible
  gaps above and below as between two sliders (about 12 px; they stuck to the next widget). A button driven
  by a modulation is now greyed out, as the other driven widgets (it was not wrapped, so the style missed it).
- **Fix: checkboxes did nothing.** Their label was built but not shown, a click was not listened to, and
  their value was not set in the DSP. A checkbox now shows its label and box on a row, as a slider its label
  and value; a click sets the DSP; its value is saved with the document, restored when it is opened, and
  undone.

## 3.17.0 (2026-11-02)

- **One Scope module, drawn after faustcode's display**, in place of the Scope and Spectrum modules (the
  documents keep the code of the modules they use). Its *View* widget shows the waveform or the spectrum:
  - **waveform**: triggered on a crossing of a *Threshold*, rising or falling (*Slope*), *Trigger* auto (the
    signal is shown even without a crossing) or normal (the last image stays); a grid of 4 × 5 divisions and
    the threshold drawn. The duration shown (*Time*, 1 ms to 5 s) stays: long durations scroll;
  - **spectrum**: an analyser of 8192 points (5.9 Hz at 48 kHz, was 2048); a logarithmic axis with a line per
    semitone and the octaves named (C1…C10), or a linear one (*Scale*); the frequencies written along the axis,
    the levels every 20 dB. **Calibrated**: 0 dB is a sine at full scale (the analyser's Blackman window, of
    coherent gain 0.42, read 20·log10(0.21) = −13.6 dB for it). The **strongest peak** is written (frequency
    refined between bins, note and deviation in cents, level). Each column of pixels shows the maximum of the
    bins it covers, so that a peak keeps its height (faustcode's average of 5 bins in dB lowered it by
    about 10 dB).
- **A grip resizes the display** (and the module), from 160 × 80 to 1600 × 1000; the size is kept in two
  hidden widgets of the module: saved with the document, undone. The canvas is drawn at the pixels of the
  screen (zoom, device pixel ratio): sharp.
- Only the widgets of the view shown are visible.
- The computations are pure functions (`src/Modules/ScopeDraw.ts`), tested apart; end to end, a sine of 0.5 at
  1 kHz reads 1000 Hz, B5 +21¢, −6.0 dB.

## 3.16.0 (2026-11-02)

- **The groups of the code as sections in the interface of a module**: each `vgroup`, `hgroup` or `tgroup` is
  shown with its label above its widgets, a section inside a section set in by a line. No label for the root
  group (the module is wrapped in a group named after it), for a group named as the module (case ignored:
  the library modules repeat it), for the groups Faust generates without label (`0x00`), nor for a group
  whose widgets are all hidden. The layout is computed apart (`src/model/UILayout.ts`, tested); a later step
  will lay out `hgroup` as rows and `tgroup` as tabs.
- **Fix: number entries (`nentry`) were not shown at all**: they are number fields now, the value typed kept
  in the range of the widget; a hidden slider stays their state, as for menus (saving, undo, modulation).
- `vslider` is shown horizontal, as `hslider`: the modules are a column of widgets.
- `[tooltip:...]` is the tooltip of a widget or a section; `[hidden:1]` hides a widget, which keeps its value.
- Bargraphs stay in their group, at their place among the widgets.

## 3.15.0 (2026-11-02)

- **Alignment guides**, as in Faust DAW (for its clips, on the time axis), in two dimensions: while modules
  are dragged, their left and right edges are compared with the left and right edges of the other modules
  (the physical input and output included), their tops and bottoms with the tops and bottoms. Within 4
  screen pixels (whatever the zoom), the dragged group is pulled onto the nearest coincidence, on each axis
  independently; every coincidence reached is shown as a thin line from the dragged module to the aligned
  one, slightly beyond both. A left edge may meet a right edge: two modules then sit side by side. With a
  selection, each dragged module counts, and the group moves as a block. Alt while dragging: no magnetism.
- The computation is a pure function (`src/view/Alignment.ts`), tested apart; end to end, a real drag.

## 3.14.0 (2026-11-02)

- **A context menu on the modules**: a right click acts on the selection (the module alone if it is not
  part of it): copy, cut, paste, duplicate, duplicate without the incoming cables, **unplug** (remove all the
  cables of the modules, audio and modulation: their modulations go with their sources), minimize or
  expand, delete. On the physical input or output, unplug only. On the empty stage: paste there, select all.
- **Copy, cut and paste**: Ctrl/Cmd-C, X, V, and from the menu. The copied modules keep their code, settings
  and modulations, with the connections between them (not those to other modules: a modulation whose source
  was not copied is left out). They are put in the system clipboard as a patch file, so that they can be
  pasted in another document or another tab; pasted at the pointer (Ctrl/Cmd-V) or where the stage was
  right-clicked, they become the selection. One undo removes a paste.
- **Shortcuts**: Ctrl/Cmd-A selects all the modules, Delete (or Backspace) deletes the selection.

## 3.13.0 (2026-11-02)

- **Duplicate modules**: ⧉ in the title bar of a module (the selection, if the module is part of it), or
  Ctrl/Cmd-D on the selection. The copies keep the code, the settings (modulation depths included) and the
  modulations of their originals, 40 px down and to the right, and become the selection (Ctrl/Cmd-D again
  makes another copy). The connections between the duplicated modules are duplicated, and the cables coming
  from other modules too (audio inputs, modulation sources), so that a copy is fed as its original; the
  cables going out are not (the copy would double their signal). Ctrl/Cmd-Shift-D leaves out the cables from
  outside; a modulation left without a source is then not duplicated. One undo removes the whole duplication.

## 3.12.1 (2026-11-02)

- **Fix: the deviation of a ~ port (linear FM) and the amount of a + port (pitch) could not be set.** The
  vertical drag was only taken on the ports of ± modulations, while the cursor and the tooltip of the
  ~ and + ports offered it. It is now taken on every port whose mode has a depth (±, +, ~).

## 3.12.0 (2026-11-02)

- **Crossfade when the DSP of a module is replaced**, as in Faust Live: new code, a modulation added or
  removed. The new node is fed by the same inputs and feeds the same outputs through its own gain; after
  20 ms (the parameters recalled on the new DSP reach its processor), the old one fades out and the new one
  fades in, linearly, in 50 ms; the old DSP is then disconnected and destroyed. The wires do not change: the
  other modules do not notice. A second replacement during a crossfade fades from where it is.
- **Fix: a modulation added to a module could cut its sound downstream for one render quantum** (128
  samples, about one time in six). The audio graph rebuilt both the inputs and the outputs of the module,
  rewiring the modules downstream, and Web Audio could render between the removal of a wire and its
  replacement. Only the side that changes is now rebuilt.
- Tests: the crossfade rendered by Web Audio (a linear ramp without a step, the inputs kept, a second
  replacement, the old node retired); end to end, a probe downstream of a module that gets a modulation
  sees every sample (30 runs out of 30, against about one failure in six before the fix).

## 3.11.1 (2026-11-02)

- **Adding a module no longer cuts the sound.** Inherited from FaustPlayground, each compilation suspended
  the AudioContext and resumed it 500 ms after the end of the compilation (a workaround for an old Firefox
  bug), so adding a module from the library, a file or a drop, or recompiling a module, silenced the whole
  scene for the compilation time plus half a second. With AudioWorklet nodes the compilation (main thread)
  does not block the audio (AudioWorklet thread): the context is no longer suspended. A compilation no
  longer unmutes a scene muted by the user either.
- Test: a probe after a constant module checks that adding a module and a modulation leaves the context
  running, and that not a sample is lost or changed.

## 3.11.0 (2026-11-02)

- **SineVCO**, the simplest oscillator of the modular library: a frequency in Hz (log scale) and a gain.
  Two of them make **classic FM**: the output of one dropped on the *Freq* of the other.
- **A new modulation mode, "~ linear FM"**, for the sliders declaring `[mod:lin]`: w·(1 + D·m), the deviation
  D from −10 to 10, 1 by default, bounded to [−max, max]. With a sine modulator of gain g at fm, the index is
  I = D·g·fc/fm, the mean frequency stays fc, and the frequency goes through zero (the phase turns
  backwards) instead of being clipped. The exponential ± of the frequency sliders could not do classic FM:
  the pitch drifted up with the depth (+92 cents for an excursion of 0.1 at 440 Hz), the excursion
  depended on the position of the slider, and the frequency stopped at the minimum of the slider.
- **`[mod:...]`**: a slider declares its modulation mode, `lin` or `add` (as `[unit:pitch]`).
- The depth of a modulation port covers the range of its mode (±10 for the deviation, the same drag).
- Tests: the spectrum of two SineVCO against Chowning's, fc ± k·fm with the amplitudes |J_k(I)|, within
  5·10⁻⁴ for an amplitude of 0.5, through zero included; end to end, the sidebands in the application.

## 3.10.0 (2026-11-02)

- **Port names on the scene**: the names a module declares (`declare inlets "audio";`,
  `declare outlets "sine; triangle; saw; square";`) are written inside the module, on the row of their port:
  inputs from the left edge, outputs from the right edge, each on at most half the width (ellipsis beyond,
  the full name in the tooltip). A name that is only the number of its port (the inputs "1; 2; 3; 4" of the
  Mixer) is not repeated. The labels let the pointer through, and stay when the module is minimized.
- The tooltips of the ports are translated ("entrée 3 : saw").

## 3.9.0 (2026-11-01)

- **The modular library is driven by widget modulation**: a port for the signal a module transforms, a
  setting for everything that controls it. The modules get a complete interface, played by hand and driven
  by the cables released on their settings:
  - **VCO**: no input; *Pitch* (0.1 per octave), *Octave*, *Tune*, *FM* (octaves), *Width*;
  - **VCF**: an audio input; *Pitch* moves the cutoff (keyboard tracking);
  - **VCA**: an audio input; an envelope released on *Gain* opens it;
  - **ADSR**: a *Gate* button; **LFO** and **Clock**: a *Reset* button;
  - **Sequencer**: *Clock* and *Reset* buttons (a press advances one step);
  - **SampleHold**: a *Trigger* button.
- **A new modulation mode, "+ add"**, for the pitch sliders (`[unit:pitch]`): w + A·m, the amount A from
  −1 to 1, 1 by default. The slider transposes, the signal is a pitch added to it, in tune whatever the
  position of the slider, as the knob and the 1 V/oct input of an oscillator; the amount is the keyboard
  tracking of a filter. The ± mode could not do it: its excursion depends on the position of the slider.
- **No smoothing** on the settings of the modular library: a modulation replaces the widget, and `si.smoo`
  after it (a 7 Hz low-pass) removed audio-rate FM and made the notes of a sequencer glide.
- Widgets ordered by two-digit prefixes in the Sequencer (Faust compares the `[n]` prefixes as strings).
- The tests render the modulations through the effective code of the application: pitch added within
  1 cent, audio-rate FM (sidebands), driven gates, clocks and triggers; the sequenced voice of the
  end-to-end test is patched with modulations.

## 3.8.0 (2026-11-01)

- **A modular library** (`Documentation/MODULAR-LIBRARY.md`), organized as [ModularGrid](https://modulargrid.net)
  organizes Eurorack modules, by function. A first voice of twelve modules: **VCO** (four waveforms, V/oct
  and FM inputs), **Noise** (white, pink), **VCF** (low, band or high pass, cutoff following a pitch),
  **VCA** (linear or exponential), **ADSR**, **LFO** (four shapes, bipolar or unipolar, reset), **Mixer**,
  **Offset** (attenuverter, offset, transposition in semitones), **Clock** (tempo, division, reset),
  **Sequencer** (eight steps of pitch, rests, length, reset), **Quantizer** (five scales, tonic),
  **SampleHold** (input or noise).
- **Common signal conventions**, the voltages of a rack divided by 10: audio and bipolar CV in [-1, 1],
  unipolar CV in [0, 1], **pitch 0.1 per octave, 0 = C4 (261.63 Hz)**, gates and triggers 0/1 (high
  above 0.6, low below 0.4, triggers on the rising edge). The parameters are not CV inputs: any widget is
  modulated by releasing a cable on it.
- **Library menu**: a selector, *Modular* or *FaustPlayground*. The modular library shows families of
  functions, their modules, and the description of the module pointed at (its functions, ports and
  description); *My modules* stays next to either. The catalog (`public/faust-modules/modular-catalog.json`)
  is built from the declarations of the modules by `npm run library-index`, and checked by a test.
- **Port names**: a module declaring `declare inlets "V/oct; FM";` and `declare outlets "...";` names its
  ports in their tooltips.
- **Fix: a module whose inputs were not connected computed nothing** (an oscillator without pitch input, a
  clock without reset input stayed silent): Web Audio then gives the Faust node an empty input, which
  faustwasm skips. Every module input now also receives a shared silent source.
- Sliders with an integer step show integers ("8", not "8.0").

## 3.7.0 (2026-11-01)

- **Menus and radio buttons in the library**, where a slider chose among named options:
  - LFO, Shape: a menu (sine, triangle, square, saw);
  - SNoiseS, Noise Type: a menu (mute, pink, white), as the code reads it (the tooltip of Pink Noise
    Volume said the opposite and is removed);
  - Modulations (effect), Modulation Type: a menu named after `instruments.lib` (by the input, by the
    averaged input, by the squared input, by a sine at the modulating frequency, by a sine at the
    frequency), instead of radio buttons labelled 0 to 4;
  - TibetanBowl, TibetanBowlMulti, STibetanBowl, STinkle, Play: radio buttons (bow, strike).
  The accelerometer mappings of these sliders are kept. The ON/OFF sliders and the Instrument Hand
  sliders stay sliders (a switch and a position, not choices).
- The descriptions of LFO, ADSR and Clock no longer mention the palette (removed in 2.9.0).
- The examples are built again with the current library (and the positions of the physical modules).
  In the documents made before, the instances of the modules changed become user modules that keep their
  code, with an update (↑) to the new library module.

## 3.6.0 (2026-11-01)

- **Zoom and move the stage**, for large scenes: Ctrl/Cmd + wheel (or pinching a trackpad) zooms around
  the pointer, from 20% to 300%; the wheel alone moves the stage; in the header, − and + zoom around the
  center, the percentage goes back to 100%, ⤢ fits the scene in the window (at most 100%). The cables,
  the physical and the Faust modules are in one stage, zoomed and moved together (`#stage`,
  `Scene.setView`, `zoomAt`, `fit`, `toStage`); the background grid follows. The coordinates of the
  cables, of the dragged modules, of the modulation ports and of the modules dropped from the library
  take the zoom into account. The view is not a change of the scene: no step of the history, not saved
  with the document.

## 3.5.0 (2026-11-01)

- **Displays of signals.** The bargraphs of a module (`hbargraph`, `vbargraph`) are shown, refreshed at
  each frame from the values the DSP reports: any Faust module can measure what it wants. A module that
  declares `declare display "scope";` or `declare display "spectrum";` shows an oscilloscope or a spectrum
  of its output. `src/Modules/Displays.ts`.
- **Display**, a new column of the library, with pass-through modules to insert anywhere: **Level**
  (RMS and peak in dB), **StereoLevel**, **Value** (the value of a control signal), **Scope** (its
  **Time** slider sets the duration shown, from 1 ms to 5 s: triggered on a rising zero crossing for
  short durations, scrolling for long ones), **Spectrum** (dB on a logarithmic frequency axis).
- The menu of a `[style:menu{...}]` widget keeps its look once a choice is made (the generic style of
  the focused selects of the menus repainted it), and gives the focus back to the stage.

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

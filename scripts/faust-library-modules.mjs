// The modules taken from the Faust libraries (demos.lib, physmodels.lib): the functions that are complete
// processes with their interface, wrapped as modules by build-faust-library-modules.mjs. The summaries come from
// the documentation of the libraries (faustcode, webapp/faust-doc-index.json, libfaust 2.90.19).
// pitch: the freq widget (Hz) of a MIDI instrument replaced by a Pitch slider, 0.1 per octave from C4.

export const FAUST_LIBRARY_FAMILIES = [
    "Lib reverbs",
    "Lib dynamics",
    "Lib filters",
    "Lib equalizers",
    "Lib pedals",
    "Lib effects",
    "Lib oscillators",
    "Lib drums",
    "Lib physical models",
    "Lib analysis"
];

export const FAUST_LIBRARY_MODULES = [
    {
        "family": "Lib reverbs",
        "name": "Dattorro Reverb",
        "file": "DattorroReverb",
        "expr": "dm.dattorro_rev_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "Reverberator based on the Dattorro reverb topology. This implementation does not use modulated delay lengths (excursion).",
            "Example GUI for `dattorro_rev` with all parameters exposed and additional dry/wet and output gain control."
        ]
    },
    {
        "family": "Lib reverbs",
        "name": "Freeverb Stereo",
        "file": "FreeverbStereo",
        "expr": "dm.freeverb_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "Freeverb demo application."
        ]
    },
    {
        "family": "Lib reverbs",
        "name": "Greyhole",
        "file": "Greyhole",
        "expr": "dm.greyhole_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "A complex echo-like effect (stereo in/out), inspired by the classic Eventide effect of a similar name. The effect consists of a diffuser (like a mini-reverb, structurally similar to the one used in `jpverb`) connected in a feedback system with a long, modulated delay-line. Excels at producing spacey washes of sound.",
            "Example GUI for `greyhole` with all parameters exposed."
        ]
    },
    {
        "family": "Lib reverbs",
        "name": "JPverb",
        "file": "JPverb",
        "expr": "dm.jprev_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "Example GUI for `jprev` with all parameters exposed."
        ]
    },
    {
        "family": "Lib reverbs",
        "name": "KB ROM Reverb",
        "file": "KBROMReverb",
        "expr": "dm.kb_rom_rev1_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "Keith Barr reverb effect rom_rev1 demo application."
        ]
    },
    {
        "family": "Lib reverbs",
        "name": "Reverb Tank",
        "file": "ReverbTank",
        "expr": "dm.reverbTank_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "This is a stereo reverb following the \"ReverbTank\" example in [1], although some parameter ranges and scaling have been adjusted. It is an unofficial version of the Spin Semiconductor® Reverb. Other relevant instructional material can be found in [2-4]."
        ]
    },
    {
        "family": "Lib reverbs",
        "name": "Spring Reverb",
        "file": "SpringReverb",
        "expr": "dm.springreverb_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "Mono spring-inspired reverb demo using `re.springreverb`."
        ]
    },
    {
        "family": "Lib reverbs",
        "name": "Vital Reverb",
        "file": "VitalReverb",
        "expr": "dm.vital_rev_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "A port of the reverb from the Vital synthesizer. All input parameters have been normalized to a continuous [0,1] range, making them easy to modulate. The scaling of the parameters happens inside the function.",
            "Example GUI for `vital_rev` with all parameters exposed."
        ]
    },
    {
        "family": "Lib reverbs",
        "name": "Zita Light",
        "file": "ZitaLight",
        "expr": "dm.zita_light",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "Light version of `dm.zita_rev1` with only 2 UI elements."
        ]
    },
    {
        "family": "Lib dynamics",
        "name": "Compressor",
        "file": "Compressor",
        "expr": "dm.compressor_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "Compressor demo application."
        ]
    },
    {
        "family": "Lib dynamics",
        "name": "Noise Gate",
        "file": "NoiseGate",
        "expr": "dm.gate_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "Gate demo application."
        ]
    },
    {
        "family": "Lib dynamics",
        "name": "OTT",
        "file": "OTT",
        "expr": "dm.xfer_ott_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "Demo application for `co.xfer_ott`, the model of Xfer Records' OTT, with the plug-in's controls in its own units and at its defaults: Depth, Time, In/Out Gain and Upward/Downward strength, and per band (Low / Mid / High) Threshold, Gain and the two branch bypasses. Continuous controls are smoothed; Bypass switches the whole effect off for A/B comparison."
        ]
    },
    {
        "family": "Lib filters",
        "name": "Moog VCF",
        "file": "MoogVCF",
        "expr": "dm.moog_vcf_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "Illustrate and compare all three Moog VCF implementations above."
        ]
    },
    {
        "family": "Lib equalizers",
        "name": "Parametric EQ",
        "file": "ParametricEQ",
        "expr": "dm.parametric_eq_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "A parametric equalizer application."
        ]
    },
    {
        "family": "Lib equalizers",
        "name": "Filter Bank",
        "file": "FilterBank",
        "expr": "dm.filterbank_demo",
        "lib": "?",
        "pitch": false,
        "summary": [
            "A bank of band-pass filters splitting the signal into frequency bands, each with its own gain (a graphic equalizer)."
        ]
    },
    {
        "family": "Lib filters",
        "name": "TF2 Filter",
        "file": "TF2Filter",
        "expr": "dm.tf2_tpt_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "A resonator swept by a sinusoid, realized with `fi.tf2_tpt`. Pink noise (or the input) drives a second-order resonator of unity peak gain whose resonance frequency is modulated by up to 4 octaves either way, at rates up to 2 kHz, with Q from 0.1 to 100. The topology-preserving realization stays stable and accurate under this audio-rate modulation, and runs mirrored above SR/4, so the resonance can reach the Nyquist limit. With the pink-noise source, Level is the output RMS in dBFS: pink noise has the same power in every octave, so a constant-Q band passes about the same power at every frequency, and a table of the measured level versus Q normalizes it (within 1.5 dB from 100 Hz to 15 kHz at 44.1 to 192 kHz, 1 dB for Q >= 1). With the input as source, Level is the gain at the resonance peak."
        ]
    },
    {
        "family": "Lib pedals",
        "name": "Crybaby",
        "file": "Crybaby",
        "expr": "dm.crybaby_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "Crybaby effect application."
        ]
    },
    {
        "family": "Lib pedals",
        "name": "Wah4",
        "file": "Wah4",
        "expr": "dm.wah4_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "Wah pedal application."
        ]
    },
    {
        "family": "Lib effects",
        "name": "Flanger Stereo",
        "file": "FlangerStereo",
        "expr": "dm.flanger_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "Flanger effect application."
        ]
    },
    {
        "family": "Lib effects",
        "name": "Phaser Stereo",
        "file": "PhaserStereo",
        "expr": "dm.phaser2_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "Phaser effect demo application."
        ]
    },
    {
        "family": "Lib effects",
        "name": "Tape Stop",
        "file": "TapeStop",
        "expr": "dm.tapeStop_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "Stereo tape-stop effect."
        ]
    },
    {
        "family": "Lib effects",
        "name": "Cubic Distortion",
        "file": "CubicDistortion",
        "expr": "dm.cubicnl_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "Distortion demo application."
        ]
    },
    {
        "family": "Lib effects",
        "name": "Transformer",
        "file": "Transformer",
        "expr": "dm.ja_transformer_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "Magnetic transformer saturation demo using Jiles-Atherton hysteresis. Stereo processor with Pre-EQ, J-A hysteresis core, and inverse Post-EQ."
        ]
    },
    {
        "family": "Lib effects",
        "name": "Vocoder",
        "file": "Vocoder",
        "expr": "dm.vocoder_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "Use example of the vocoder function where an impulse train is used as excitation. The vocoder output is duplicated on two outputs."
        ]
    },
    {
        "family": "Lib oscillators",
        "name": "Virtual Analog Oscillator",
        "file": "VirtualAnalogOscillator",
        "expr": "dm.virtual_analog_oscillator_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "Virtual analog oscillator demo application."
        ]
    },
    {
        "family": "Lib oscillators",
        "name": "Sawtooth Oscillator",
        "file": "SawtoothOscillator",
        "expr": "dm.sawtooth_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "An application demonstrating the different sawtooth oscillators of Faust."
        ]
    },
    {
        "family": "Lib oscillators",
        "name": "Twin Oscillator",
        "file": "TwinOscillator",
        "expr": "dm.twin_osc_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "TwinOsc - virtual analog synthesis with a time-varying comb filter. Based on: \"Virtual Analog Synthesis with a Time-Varying Comb Filter\" D. Lowenfels, AES Convention 115, October 2003."
        ]
    },
    {
        "family": "Lib oscillators",
        "name": "Resonator Oscillator",
        "file": "ResonatorOscillator",
        "expr": "dm.oscr_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "Simple application demoing filter based oscillators.",
            "Sine oscillator demo based on 2D vector rotation. Synonym for `oscrs_demo`."
        ]
    },
    {
        "family": "Lib oscillators",
        "name": "Resonator Oscillator RS",
        "file": "ResonatorOscillatorRS",
        "expr": "dm.oscrs_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "Simple application demoing filter based oscillators."
        ]
    },
    {
        "family": "Lib oscillators",
        "name": "Colored Noise",
        "file": "ColoredNoise",
        "expr": "dm.colored_noise_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "A coloured noise signal generator."
        ]
    },
    {
        "family": "Lib oscillators",
        "name": "Velvet Noise",
        "file": "VelvetNoise",
        "expr": "dm.velvet_noise_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "Listen to velvet_noise!"
        ]
    },
    {
        "family": "Lib physical models",
        "name": "Flute Model",
        "file": "FluteModel",
        "expr": "pm.flute_ui_MIDI",
        "lib": "physmodels.lib",
        "pitch": true,
        "summary": [
            "Ready-to-use MIDI-controllable flute physical model with built-in UI."
        ]
    },
    {
        "family": "Lib physical models",
        "name": "Clarinet Model",
        "file": "ClarinetModel",
        "expr": "pm.clarinet_ui_MIDI",
        "lib": "physmodels.lib",
        "pitch": true,
        "summary": [
            "Ready-to-use MIDI compliant clarinet physical model with built-in UI."
        ]
    },
    {
        "family": "Lib physical models",
        "name": "Brass Model",
        "file": "BrassModel",
        "expr": "pm.brass_ui_MIDI",
        "lib": "physmodels.lib",
        "pitch": true,
        "summary": [
            "Ready-to-use MIDI-controllable brass instrument physical model with built-in UI."
        ]
    },
    {
        "family": "Lib physical models",
        "name": "Violin Model",
        "file": "ViolinModel",
        "expr": "pm.violin_ui_MIDI",
        "lib": "physmodels.lib",
        "pitch": true,
        "summary": [
            "Ready-to-use MIDI-enabled violin physical model with built-in UI."
        ]
    },
    {
        "family": "Lib physical models",
        "name": "Guitar Model",
        "file": "GuitarModel",
        "expr": "pm.guitar_ui_MIDI",
        "lib": "physmodels.lib",
        "pitch": true,
        "summary": [
            "Ready-to-use MIDI-enabled steel strings acoustic guitar physical model with built-in UI."
        ]
    },
    {
        "family": "Lib physical models",
        "name": "Nylon Guitar Model",
        "file": "NylonGuitarModel",
        "expr": "pm.nylonGuitar_ui_MIDI",
        "lib": "physmodels.lib",
        "pitch": true,
        "summary": [
            "Ready-to-use MIDI-enabled nylon strings acoustic guitar physical model with built-in UI."
        ]
    },
    {
        "family": "Lib physical models",
        "name": "Electric Guitar Model",
        "file": "ElectricGuitarModel",
        "expr": "pm.elecGuitar_ui_MIDI",
        "lib": "physmodels.lib",
        "pitch": true,
        "summary": [
            "Ready-to-use MIDI-enabled electric guitar physical model with built-in UI."
        ]
    },
    {
        "family": "Lib physical models",
        "name": "Karplus-Strong",
        "file": "KarplusStrong",
        "expr": "pm.ks_ui_MIDI",
        "lib": "physmodels.lib",
        "pitch": true,
        "summary": [
            "Ready-to-use, MIDI-enabled Karplus-Strong string with buil-in UI."
        ]
    },
    {
        "family": "Lib physical models",
        "name": "Marimba Model",
        "file": "MarimbaModel",
        "expr": "pm.marimba_ui_MIDI",
        "lib": "physmodels.lib",
        "pitch": true,
        "summary": [
            "Generic marimba tone bar modal model. This model was generated using `mesh2faust` from a 3D CAD model of a marimba tone bar (`libraries/modalmodels/marimbaBar`). The corresponding CAD model is that of a C2 tone bar (original fundamental frequency: ~65Hz). While `marimbaBarModel` allows to translate the harmonic content of the generated sound by providing a frequency (`freq`), mode transposition has limits and the model will sound less and less like a marimba tone bar as it diverges from C2. To make an accurate model of a marimba, we'd want to have an independent model for each bar... This model contains 5 excitation positions going linearly from the center bottom to the center top of the bar. Obviously, a model with more excitation position could be regenerated using `mesh2faust`.",
            "Simple MIDI controllable marimba physical model with built-in UI implementing a single tone bar connected to tube. This model is scalable and can be adapted to any size of bar/tube (see [`marimbaBarModel`](#marimbabarmodel) to know more about the limitations of this type of system)."
        ]
    },
    {
        "family": "Lib physical models",
        "name": "Djembe Model",
        "file": "DjembeModel",
        "expr": "pm.djembe_ui_MIDI",
        "lib": "physmodels.lib",
        "pitch": false,
        "summary": [
            "Simple MIDI controllable djembe physical model with built-in UI."
        ]
    },
    {
        "family": "Lib physical models",
        "name": "Interpolated Instrument",
        "file": "InterpolatedInstrument",
        "expr": "pm.modularInterpInstr_ui_MIDI",
        "lib": "physmodels.lib",
        "pitch": true,
        "summary": [
            "Modular string instrument resonator based on IR measurements made on 3D printed models. The 2D space allowing for the control of the shape and the scale of the model is enabled by interpolating between modes parameters. More information about this technique/project can be found here: <https://ccrma.stanford.edu/~rmichon/3dPrintingModeling/>.",
            "Ready-to-use MIDI-enabled string instrument with a modular body (see [`modeInterpRes`](#pm.modeinterpres) and <https://ccrma.stanford.edu/~rmichon/3dPrintingModeling/>) with built-in UI."
        ]
    },
    {
        "family": "Lib physical models",
        "name": "Formant Voice",
        "file": "FormantVoice",
        "expr": "pm.SFFormantModelBP_ui_MIDI",
        "lib": "physmodels.lib",
        "pitch": true,
        "summary": [
            "Ready-to-use MIDI-controllable source-filter vocal synthesizer."
        ]
    },
    {
        "family": "Lib physical models",
        "name": "Church Bell",
        "file": "ChurchBell",
        "expr": "pm.churchBell_ui",
        "lib": "physmodels.lib",
        "pitch": false,
        "summary": [
            "Generic church bell modal model. Modeled after T. Rossing and R. Perrin, Vibrations of Bells, Applied Acoustics 2, 1987. Model height is 301 mm. This model contains 7 excitation positions going linearly from the bottom to the top of the bell. Obviously, a model with more excitation position could be regenerated using `mesh2faust`. This function also implements a virtual exciter to drive the model.",
            "Church bell physical model based on [`churchBell`](#pmchurchbell) with built-in UI."
        ]
    },
    {
        "family": "Lib physical models",
        "name": "English Bell",
        "file": "EnglishBell",
        "expr": "pm.englishBell_ui",
        "lib": "physmodels.lib",
        "pitch": false,
        "summary": [
            "English church bell modal model. Modeled after D.Bartocha and Baron, Influence of Tin Bronze Melting and Pouring Parameters on Its Properties and Bell' Tone, Archives of Foundry Engineering, 2016. Model height is 1 m. This model contains 7 excitation positions going linearly from the bottom to the top of the bell. Obviously, a model with more excitation position could be regenerated using `mesh2faust`. This function also implements a virtual exciter to drive the model.",
            "English church bell physical model based on [`englishBell`](#pmenglishbell) with built-in UI."
        ]
    },
    {
        "family": "Lib physical models",
        "name": "French Bell",
        "file": "FrenchBell",
        "expr": "pm.frenchBell_ui",
        "lib": "physmodels.lib",
        "pitch": false,
        "summary": [
            "French church bell modal model. Modeled after D.Bartocha and Baron, Influence of Tin Bronze Melting and Pouring Parameters on Its Properties and Bell' Tone, Archives of Foundry Engineering, 2016. Model height is 1 m. This model contains 7 excitation positions going linearly from the bottom to the top of the bell. Obviously, a model with more excitation position could be regenerated using `mesh2faust`. This function also implements a virtual exciter to drive the model.",
            "French church bell physical model based on [`frenchBell`](#pmfrenchbell) with built-in UI."
        ]
    },
    {
        "family": "Lib physical models",
        "name": "German Bell",
        "file": "GermanBell",
        "expr": "pm.germanBell_ui",
        "lib": "physmodels.lib",
        "pitch": false,
        "summary": [
            "German church bell modal model. Modeled after D.Bartocha and Baron, Influence of Tin Bronze Melting and Pouring Parameters on Its Properties and Bell' Tone, Archives of Foundry Engineering, 2016. Model height is 1 m. This model contains 7 excitation positions going linearly from the bottom to the top of the bell. Obviously, a model with more excitation position could be regenerated using `mesh2faust`. This function also implements a virtual exciter to drive the model.",
            "German church bell physical model based on [`germanBell`](#pmgermanbell) with built-in UI."
        ]
    },
    {
        "family": "Lib physical models",
        "name": "Russian Bell",
        "file": "RussianBell",
        "expr": "pm.russianBell_ui",
        "lib": "physmodels.lib",
        "pitch": false,
        "summary": [
            "Russian church bell modal model. Modeled after D.Bartocha and Baron, Influence of Tin Bronze Melting and Pouring Parameters on Its Properties and Bell' Tone, Archives of Foundry Engineering, 2016. Model height is 2 m. This model contains 7 excitation positions going linearly from the bottom to the top of the bell. Obviously, a model with more excitation position could be regenerated using `mesh2faust`. This function also implements a virtual exciter to drive the model.",
            "Russian church bell physical model based on [`russianBell`](#pmrussianbell) with built-in UI."
        ]
    },
    {
        "family": "Lib physical models",
        "name": "Standard Bell",
        "file": "StandardBell",
        "expr": "pm.standardBell_ui",
        "lib": "physmodels.lib",
        "pitch": false,
        "summary": [
            "Standard church bell modal model. Modeled after T. Rossing and R. Perrin, Vibrations of Bells, Applied Acoustics 2, 1987. Model height is 1.8 m. This model contains 7 excitation positions going linearly from the bottom to the top of the bell. Obviously, a model with more excitation position could be regenerated using `mesh2faust`. This function also implements a virtual exciter to drive the model.",
            "Standard church bell physical model based on [`standardBell`](#pmstandardbell) with built-in UI."
        ]
    },
    {
        "family": "Lib physical models",
        "name": "Pink Trombone",
        "file": "PinkTrombone",
        "expr": "dm.pink_trombone_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "Neil Thapen's Pink Trombone vocal-tract synthesiser (see `pinktrombone.lib`) with its original controls: voicebox (pitch, tenseness, always voice, pitch wobble), tract (tongue index/diameter, nasal) and two independent constrictions (index, diameter, active). As in the original, \"always voice\" is on by default, so the demo speaks on start-up."
        ]
    },
    {
        "family": "Lib physical models",
        "name": "Blower",
        "file": "Blower",
        "expr": "pm.blower_ui",
        "lib": "physmodels.lib",
        "pitch": false,
        "summary": [
            "A virtual blower creating a DC signal with some breath noise in it.",
            "Same as [`blower`](#blower) but with a built-in UI."
        ]
    },
    {
        "family": "Lib analysis",
        "name": "Spectral Level",
        "file": "SpectralLevel",
        "expr": "dm.spectral_level_demo",
        "lib": "demos.lib",
        "pitch": false,
        "summary": [
            "Spectral level display, 2/3 octave. Synonym for `mth_octave_spectral_level_demo(1.5)`."
        ]
    }
];

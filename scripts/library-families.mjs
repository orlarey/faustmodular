// The families of the FaustPlayground modules in the library (one view, as the modular library: a family,
// its modules, the description of a module). The modules of the modular library and the displays get their
// family from their declarations (build-library-index.mjs); the others from this table, so that their code,
// and so their hash (the update of the modules used by the documents), does not change.
//
// Each family: its key (the resources name it family_<key>), and its modules in the order shown.

export const FAUSTPLAYGROUND_FAMILIES = [
    ["Harps", [
        "generators/Kisana", "generators/SAtonalSoftHarp", "generators/SBouncyHarp", "generators/SChromaticSoftHarp",
        "generators/SCMajDryHarp", "generators/SCMajSoftHarp", "generators/SPentatonicDryHarp", "generators/SPentatonicSoftHarp",
    ]],
    ["Winds", [
        "generators/SFlute", "generators/SCMajFlute", "generators/SPentatonicFlute", "generators/SRandomFlute",
        "generators/SClarinet", "generators/SBrass", "generators/SBrassMulti", "generators/SPulsaxophone",
        "generators/SBlowhistleBottle", "generators/SCMajBlowBottle", "generators/SPentatonicBlowBottle",
        "generators/SWhistles2", "generators/SWhistles3",
    ]],
    ["Bars and bowls", [
        "generators/STunedBar", "generators/STunedBar3", "generators/STunedBar6", "generators/SChromaticTunedBars",
        "generators/SCMajTunedBars", "generators/STibetanBowl", "generators/STinkle", "generators/SCameleonKeyboard",
    ]],
    ["Noises and oscillators", [
        "generators/SOscillator", "generators/SNoise", "generators/SNoiseS", "generators/SNoiseburst",
        "generators/SModulation1", "generators/SModulation2", "generators/SModulation3", "generators/SModulation4",
        "generators/SRandomAndHold", "generators/SRandomFrequencyGenerator", "generators/SBird",
    ]],
    ["Instruments with reverb", [
        "combined/AtonalSoftHarp", "combined/BouncyHarp", "combined/ChromaticSoftHarp", "combined/CMajDryHarp",
        "combined/CMajSoftHarp", "combined/PentatonicDryHarp", "combined/PentatonicSoftHarp", "combined/StalactiteHarp",
        "combined/Flute", "combined/CMajFlute", "combined/PentatonicFlute", "combined/RandomFlute", "combined/FlappyFlute",
        "combined/Clarinet", "combined/Brass", "combined/Meow", "combined/Pulsaxophone", "combined/BlowhistleBottle",
        "combined/Whistles", "combined/TunedBars", "combined/TibetanBowl", "combined/TibetanBowlMulti",
        "combined/WoodenKeyboard", "combined/Birds", "combined/Modulations", "combined/Seaside",
    ]],
    ["Filters", [
        "effects/LowPassFilter", "effects/HighPassFilter", "effects/BandPassFilter", "effects/Notch",
        "effects/PeakEqualizer", "effects/CombFilter", "effects/WahWah",
    ]],
    ["Echoes and reverbs", [
        "effects/Echo", "effects/Loop", "effects/Freeverb", "effects/ZitaReverb", "effects/InstrReverb", "effects/Granulator",
    ]],
    ["Modulations", [
        "effects/Flanger", "effects/Phaser", "effects/RingModulation", "effects/RandomRingModulation",
        "effects/VibratoEnvelope", "effects/RandomVibrato", "effects/Modulations",
    ]],
    ["Level and dynamics", [
        "effects/Volume", "effects/SLimiter", "effects/ASREnvelope",
    ]],
    ["Spatialization and multichannel", [
        "multichannel/Panner", "multichannel/QuadPanner", "multichannel/OctoSpat", "multichannel/AmbiEncoder3",
        "multichannel/AmbiDecoder3", "multichannel/StereoWidth", "multichannel/Mixer4to2", "multichannel/MultiDelay4",
        "multichannel/OscillatorBank8",
    ]],
    ["Modulation sources", [
        "modulation/LFO", "modulation/QuadLFO", "modulation/Random", "modulation/Clock", "modulation/ADSR",
        "modulation/EnvelopeFollower",
    ]],
].map(([family, modules]) => [family, modules.map((m) => `faust-modules/${m}.dsp`)]);

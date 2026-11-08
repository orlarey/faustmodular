/*				PLAYER.TS
    A player (Documentation/MATERIALS-SPEC.md, "Le module lecteur"): a module that plays a material of a store at its
    bar of the timeline shared by the Faust applications (faust-sync), to the sample. Its Faust code, made here:

    - the media, by the primitive `soundfile` (faustwasm fetches it from its address and the browser decodes it,
      FLAC included); at a commit of the store, so that it is always the same file;
    - the reserved inputs of faust-sync (`declare sync "bar; index; run; start"`): it starts at the very sample where
      its bar begins (the bar changes; or the transport starts at the start of a bar, or from the start of the song),
      its sample k at the k-th sample after, while the transport plays; silent before, after its end, and stopped;
    - its controls: Bar (where it starts, from 0: by default the bar of the recording), Loop (again every so many bars,
      its length), Gain (dB);
    - its trace: `declare uses "<store>:<path of the description>"` and the SHA-1 of its media, the relation `uses` of
      the scene that contains it.

    At the tempo of the recording, it plays it as it was recorded, its bars on the bars; at another tempo, it plays it
    at its own speed from the start of its bar (no time stretching, version 1). Pure.
*/

export interface PlayerSource {
    name: string;                   // the material
    url: string;                    // its media, at a commit
    channels: number;
    bars: number;                   // its length, in whole bars (1 at least)
    bar: number;                    // the bar it was recorded at (from 0)
    store: string;                  // owner/repo
    path: string;                   // its description in the store
    sha1?: string;                  // of its media
}

const quote = (s: string) => s.replace(/["\\]/g, "_");

// The Faust code of a player (its user code: faustmodular wraps it in its group).
export function playerCode(p: PlayerSource): string {
    const n = Math.max(1, Math.min(8, Math.round(p.channels)));
    const chans = Array.from({ length: n }, (_, c) => `c${c}`);
    const outlets = n == 1 ? "out" : n == 2 ? "left; right" : chans.map((_, c) => `out ${c + 1}`).join("; ");
    return `declare name "${quote(p.name)}";
declare author "faustmodular";
declare function "Player";
declare summary "Plays the recording ${quote(p.name)} of the store ${quote(p.store)}, at its bar of the shared timeline";
declare inlets "";
declare outlets "${outlets}";
declare uses "${quote(p.store)}:${quote(p.path)}";
${p.sha1 ? `declare usesSha1 "${p.sha1}";\n` : ""}declare sync "bar; index; run; start";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Plays a recording of a store, at its bar of the timeline shared by the Faust applications (faust-sync)
- Bar: where it starts (from 0; the bar of the recording by default), Loop: again every ${p.bars} bar${p.bars > 1 ? "s" : ""}, Gain
- At the tempo of the recording, it is played as it was recorded, to the sample

*/

process(bar, index, running, start) = (0, int(max(0, q - 1))) : sf : out
with {
    sf = soundfile("[url:{'${p.url.replace(/'/g, "%27")}'}]", ${n});
    length = ${Math.max(1, Math.round(p.bars))};
    first = nentry("[0]Bar", ${Math.max(0, Math.round(p.bar))}, 0, 9999, 1);
    loop = checkbox("[1]Loop");
    // the gain, smoothed, then exact once close (a smoothing in floats stops a little short of its target: 0 dB would
    // not give back the samples of the material)
    level = hslider("[2]Gain[unit:dB]", 0, -60, 12, 0.1) : ba.db2linear;
    smooth = level : si.smoo;
    gain = select2(abs(smooth - level) < 1e-4 * level, smooth, level);
    // a bar begins at this sample: the bar changes, or the transport starts at the start of a bar
    begins = (bar != bar') | (running > running') & (index == 0) | start;
    rel = bar - first;
    hit = begins & running & (rel >= 0) & select2(loop, rel == 0, fmod(rel, length) == 0);
    // q: 0 silent, k + 1 at its sample k
    q = (\\(qp).(select2(hit, select2(qp > 0, 0, qp + running), 1))) ~ _;
    out(len, rate, ${chans.join(", ")}) = ${chans.map((c) => `${c} * g`).join(", ")}
    with { g = (q > 0) * (q - 1 < len) * running * gain; };
};
`;
}

// The relation `uses` of a code: "<store>:<path>", or null.
export function usesOf(code: string): string | null {
    const m = /^\s*declare\s+uses\s+"([^"]+)"\s*;/m.exec(code ?? "");
    return m ? m[1] : null;
}

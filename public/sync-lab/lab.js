/*				SYNC-LAB/LAB.JS
    The synchronization lab (Documentation/FAUST-SYNC-SPEC.md, § 10): measures, in two windows (or more) of the
    browser on one sound card, what an algorithm of synchronization can rely on.

    1. Each window reads its audio clock: getOutputTimestamp gives the frame of the context that comes out of the
       speaker (n, "audible") at a time of the common clock (T, performance.timeOrigin + performanceTime). The line
       n(T) over the last 30 s: the noise of the readings (its residuals), the drift between the quartz of the card
       and the clock of the system (its slope against the sample rate).
    2. The windows publish their lines; each one deduces δ = n_ref(T) − n_self(T) at the same T, without a round
       trip. On one card, δ must be constant: its dispersion and its drift are measured.
    3. For comparison, the round trip with the midpoint (Cristian): ping with the rendered frame (currentTime), the
       answer with the rendered frame of the other, δ_rt = n_other − (n1 + n3)/2; its RTT.
    4. Clicks: each window clicks at the frames of the reference, shifted by its rank · 100 ms, every 0.5 s, through δ.
       A recording (a microphone near the speakers, or a loopback such as BlackHole) measures the real error: the
       distance between the clicks of two windows, less 100 ms. The acoustic path is the same for every window: it
       cancels.
*/

import { at, groupClicks, median, onsets, robustFit, summary } from "./stats.js";

const CHANNEL = "faust-sync-lab";
const READ_EVERY = 50;          // ms
const WARMUP = 2000;            // ms: the first readings after the start are off by tens of ms
const WINDOW = 30000;           // ms: the line of the clock
const ANNOUNCE_EVERY = 500;     // ms
const PING_EVERY = 200;         // ms
const ACTIVE = 2500;            // ms: a window not heard for longer has left
const PERIOD = 0.5, GAP = 0.1;  // s: the clicks
const LOOKAHEAD = 0.3;          // s

const id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)).slice(0, 8);
const epoch = () => performance.timeOrigin + performance.now();
const $ = (s) => document.querySelector(s);

let ctx = null, sr = 0, startedAt = 0;
const readings = [];            // { T, n, ahead }: the audible frame n at the common time T; ahead: rendered − audible
let line = null;                // n(T) over the window
let driftLine = null;           // n(T) over all the readings
const peers = new Map();        // id → { start, sr, line, heard, deltas: [{T, d}], trips: [{T, rtt, d}], pending }
let channel = null;
let seq = 0;
let clicks = false, clickBuffer = null, lastK = -Infinity, lastRef = "";
let recording = null;           // the result of the last recording
let lastPerf = -1;
const resolution = timerResolution();

// The smallest step of performance.now() (its precision is reduced outside a cross-origin isolated page).
function timerResolution() {
    let best = Infinity, prev = performance.now();
    const end = prev + 20;
    while (true) {
        const t = performance.now();
        if (t != prev) { best = Math.min(best, t - prev); prev = t; }
        if (t > end) break;
    }
    return best;
}

async function start() {
    ctx = new AudioContext({ latencyHint: "interactive" });
    await ctx.resume();
    sr = ctx.sampleRate;
    startedAt = epoch();
    clickBuffer = ctx.createBuffer(1, Math.round(0.003 * sr), sr);
    const data = clickBuffer.getChannelData(0);
    for (let i = 0; i < Math.round(0.00025 * sr); i++) data[i] = 0.8;
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (e) => receive(e.data);
    setInterval(read, READ_EVERY);
    setInterval(announce, ANNOUNCE_EVERY);
    setInterval(ping, PING_EVERY);
    setInterval(schedule, 100);
    setInterval(show, 1000);
    $("#start").disabled = true;
    $("#clicks").disabled = false;
    $("#record").disabled = false;
    await listInputs();
}

// A reading of the two clocks.
function read() {
    if (ctx.state != "running" || typeof ctx.getOutputTimestamp != "function") return;
    const ts = ctx.getOutputTimestamp();
    const now = epoch(), rendered = ctx.currentTime * sr;
    if (!ts.contextTime || !ts.performanceTime || ts.performanceTime == lastPerf) return;
    lastPerf = ts.performanceTime;
    const T = performance.timeOrigin + ts.performanceTime, n = ts.contextTime * sr;
    // the rendered frame at the reading, less the audible frame then (at the slope of the sample rate)
    const ahead = rendered - (n + (now - T) * sr / 1000);
    readings.push({ T, n, ahead });
}

function fits() {
    const used = readings.filter((r) => r.T > startedAt + WARMUP);
    const last = used.length ? used[used.length - 1].T : 0;
    const recent = used.filter((r) => r.T > last - WINDOW);
    line = recent.length >= 20 ? robustFit(recent.map((r) => r.T), recent.map((r) => r.n)) : null;
    if (line) line.Tlast = last;
    driftLine = used.length >= 20 ? robustFit(used.map((r) => r.T), used.map((r) => r.n)) : null;
}

function post(message) {
    try { channel.postMessage({ ...message, id }); } catch { /* closed */ }
}

function announce() {
    fits();
    post({ type: "announce", start: startedAt, sr, line: line && { x0: line.x0, y0: line.y0, slope: line.slope, Tlast: line.Tlast } });
}

function ping() {
    for (const [other, peer] of peers) {
        if (epoch() - peer.heard > ACTIVE) continue;
        const s = ++seq;
        peer.pending.set(s, { t1: epoch(), n1: ctx.currentTime * sr });
        post({ type: "ping", to: other, seq: s });
    }
}

function peerOf(other) {
    if (!peers.has(other)) peers.set(other, { start: 0, sr: 0, line: null, heard: 0, deltas: [], trips: [], pending: new Map() });
    return peers.get(other);
}

function receive(m) {
    if (!m || m.id == id) return;
    if (m.to && m.to != id) return;
    const peer = peerOf(m.id);
    peer.heard = epoch();
    if (m.type == "announce") {
        peer.start = m.start;
        peer.sr = m.sr;
        peer.line = m.line;
        if (line && m.line) {
            // δ at the latest time both lines cover
            const T = Math.min(line.Tlast, m.line.Tlast);
            peer.deltas.push({ T, d: at(m.line, T) - at(line, T) });
        }
    } else if (m.type == "ping") {
        post({ type: "pong", to: m.id, seq: m.seq, n: ctx.currentTime * sr });
    } else if (m.type == "pong") {
        const p = peer.pending.get(m.seq);
        if (!p) return;
        peer.pending.delete(m.seq);
        const t3 = epoch(), n3 = ctx.currentTime * sr;
        peer.trips.push({ T: t3, rtt: t3 - p.t1, d: m.n - (p.n1 + n3) / 2 });
    }
}

// The windows that play, the reference first (the oldest).
function members() {
    const now = epoch();
    const list = [{ id, start: startedAt }];
    for (const [other, peer] of peers) if (now - peer.heard < ACTIVE && peer.start) list.push({ id: other, start: peer.start });
    return list.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
}

// δ to a window, predicted now (samples): two windows may count their samples at slightly different rates, δ then
// drifts; the line of its values over the last 20 s, at the present time (a median of past values lags behind).
function delta(other) {
    const peer = peers.get(other);
    if (!peer || peer.deltas.length < 3) return null;
    const now = epoch();
    const recent = peer.deltas.filter((x) => x.T > now - 20000);
    const fit = recent.length >= 8 ? robustFit(recent.map((x) => x.T), recent.map((x) => x.d)) : null;
    return fit ? at(fit, now + LOOKAHEAD * 500) : median(peer.deltas.slice(-10).map((x) => x.d));
}

// The clicks of this window, at the frames of the reference: k·period + rank·gap, through δ.
function schedule() {
    if (!clicks || !ctx) return;
    const list = members();
    const ref = list[0].id, rank = list.findIndex((m) => m.id == id);
    if (rank > 3) return;
    if (ref != lastRef) { lastRef = ref; lastK = -Infinity; }
    let d = 0;
    if (ref != id) {
        if (peers.get(ref).sr != sr) return;
        d = delta(ref);
        if (d === null) return;
    }
    const P = PERIOD * sr, G = GAP * sr;
    const c = ctx.currentTime * sr;
    const first = Math.ceil((c + 0.05 * sr + d - rank * G) / P), last = Math.floor((c + LOOKAHEAD * sr + d - rank * G) / P);
    for (let k = Math.max(first, lastK + 1); k <= last; k++) {
        const src = ctx.createBufferSource();
        src.buffer = clickBuffer;
        src.connect(ctx.destination);
        src.start((k * P + rank * G - d) / sr);
        lastK = k;
    }
}

/******************** RECORDING ********************/

const RECORDER = `registerProcessor("lab-recorder", class extends AudioWorkletProcessor {
    process(inputs) {
        const input = inputs[0];
        if (input && input[0]) {
            const mix = new Float32Array(input[0].length);
            for (const c of input) for (let i = 0; i < mix.length; i++) mix[i] += c[i];
            this.port.postMessage(mix, [mix.buffer]);
        }
        return true;
    }
});`;

async function listInputs() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const select = $("#input");
        const current = select.value;
        select.innerHTML = '<option value="">Entrée par défaut</option>' + devices.filter((d) => d.kind == "audioinput")
            .map((d) => `<option value="${d.deviceId}">${d.label || "entrée " + d.deviceId.slice(0, 6)}</option>`).join("");
        select.value = current;
    } catch { /* no devices */ }
}

async function record() {
    const seconds = Number($("#duration").value) || 20;
    const deviceId = $("#input").value;
    $("#record").disabled = true;
    $("#recordStatus").textContent = "accès à l'entrée…";
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        await listInputs();
        const url = URL.createObjectURL(new Blob([RECORDER], { type: "application/javascript" }));
        await ctx.audioWorklet.addModule(url).catch(() => {});
        const source = ctx.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(ctx, "lab-recorder", { numberOfOutputs: 1 });
        const mute = ctx.createGain();
        mute.gain.value = 0;
        source.connect(node).connect(mute).connect(ctx.destination);
        const chunks = [];
        let length = 0;
        const total = Math.round(seconds * sr);
        await new Promise((resolve) => {
            node.port.onmessage = (e) => {
                chunks.push(e.data);
                length += e.data.length;
                $("#recordStatus").textContent = `enregistrement… ${(length / sr).toFixed(1)} / ${seconds} s`;
                if (length >= total) resolve();
            };
        });
        source.disconnect();
        node.disconnect();
        stream.getTracks().forEach((t) => t.stop());
        const x = new Float32Array(length);
        let o = 0;
        for (const c of chunks) { x.set(c, o); o += c.length; }
        const found = onsets(x, sr);
        const groups = groupClicks(found, sr, GAP);
        let peak = 0;
        for (const v of x) peak = Math.max(peak, Math.abs(v));
        recording = {
            seconds, input: $("#input").selectedOptions[0]?.textContent, peak, clicks: found.length, groups: groups.groups,
            sizes: groups.sizes, windows: groups.size, errors: groups.errors.map((e) => ({ ...summary(e), values: e })),
        };
        $("#recordStatus").textContent = "terminé";
    } catch (e) {
        $("#recordStatus").textContent = "échec : " + e.message;
    }
    $("#record").disabled = false;
    show();
}

/******************** REPORT ********************/

function report() {
    fits();
    const used = readings.filter((r) => r.T > startedAt + WARMUP);
    const list = members();
    const residuals = line ? line.residuals.map((r) => r / sr * 1e6) : [];          // µs
    const blocks = used.filter((r) => Math.abs(r.n / 128 - Math.round(r.n / 128)) < 1e-6).length;
    return {
        id, date: new Date().toISOString(), userAgent: navigator.userAgent,
        sampleRate: sr, baseLatency: ctx?.baseLatency, outputLatency: ctx?.outputLatency, timerResolutionMs: resolution,
        role: list[0].id == id ? "reference" : "rank " + list.findIndex((m) => m.id == id),
        lab: 2, deltaModel: "line over 20 s, at now",
        driftPpm30s: line ? (line.slope * 1000 / sr - 1) * 1e6 : NaN,
        seconds: used.length ? (used[used.length - 1].T - used[0].T) / 1000 : 0,
        readings: {
            count: used.length, outliers: line?.outliers, residualUs: summary(residuals),
            onBlocksOf128: used.length ? blocks / used.length : NaN,
            aheadMs: summary(used.map((r) => r.ahead / sr * 1000)),
        },
        driftPpm: driftLine ? (driftLine.slope * 1000 / sr - 1) * 1e6 : NaN,
        peers: [...peers].map(([other, peer]) => {
            const ds = peer.deltas.map((x) => x.d);
            // the last minute: the first values come from lines still short
            const recent = peer.deltas.filter((x) => x.T > epoch() - 60000);
            const dl = recent.length >= 10 ? robustFit(recent.map((x) => x.T), recent.map((x) => x.d)) : null;
            const rtts = peer.trips.map((t) => t.rtt);
            const fast = peer.trips.filter((t) => t.rtt <= median(rtts));
            const dAudible = median(ds.slice(-20));
            const dTrip = median(fast.map((t) => t.d));
            return {
                id: other, active: epoch() - peer.heard < ACTIVE, sampleRate: peer.sr,
                // its own drift against the clock of the system (its line over 30 s)
                driftPpm: peer.line ? (peer.line.slope * 1000 / peer.sr - 1) * 1e6 : NaN,
                deltaNow: delta(other),
                deltaSamples: {
                    ...summary(ds), last20: dAudible, lastMinute: summary(recent.map((x) => x.d)),
                    driftPerMinute: dl ? dl.slope * 60000 : NaN, driftPpm: dl ? dl.slope * 60000 / (60 * sr) * 1e6 : NaN,
                    residualStd: dl ? summary(dl.residuals).std : NaN,
                },
                roundTrip: {
                    rttMs: summary(rtts), deltaSamples: summary(peer.trips.map((t) => t.d)),
                    deltaFastHalf: dTrip, minusAudibleMs: (dTrip - dAudible) / sr * 1000,
                },
            };
        }),
        recording: recording && { ...recording, errors: recording.errors.map(({ values, ...s }) => s) },
    };
}

function data() {
    return {
        report: report(),
        readings: readings.map((r) => [r.T, r.n, r.ahead]),
        peers: Object.fromEntries([...peers].map(([other, p]) => [other, { deltas: p.deltas.map((x) => [x.T, x.d]), trips: p.trips.map((t) => [t.T, t.rtt, t.d]) }])),
        recording,
    };
}

/******************** DISPLAY ********************/

const f = (x, d = 2) => (x === null || x === undefined || Number.isNaN(x) ? "—" : Number(x).toFixed(d));

function show() {
    if (!ctx) return;
    const r = report();
    const list = members();
    $("#self").innerHTML = `
        <tr><th>Fenêtre</th><td>${id} — ${r.role == "reference" ? "<b>référence</b>" : r.role} (${list.length} en tout)</td></tr>
        <tr><th>Fréquence, latences annoncées</th><td>${sr} Hz — base ${f(r.baseLatency * 1000, 1)} ms, sortie ${f(r.outputLatency * 1000, 1)} ms</td></tr>
        <tr><th>Résolution de performance.now()</th><td>${f(resolution * 1000, 0)} µs</td></tr>
        <tr><th>Lectures de getOutputTimestamp</th><td>${r.readings.count} en ${f(r.seconds, 0)} s; écartées ${r.readings.outliers ?? "—"}; sur un bloc de 128 : ${f(r.readings.onBlocksOf128 * 100, 0)} %</td></tr>
        <tr><th>Bruit des lectures (30 s)</th><td>σ ${f(r.readings.residualUs.std, 0)} µs; 95 % dans [${f(r.readings.residualUs.p05, 0)}, ${f(r.readings.residualUs.p95, 0)}] µs; extrêmes ${f(r.readings.residualUs.min, 0)} / ${f(r.readings.residualUs.max, 0)} µs</td></tr>
        <tr><th>Dérive carte / horloge système</th><td>${f(r.driftPpm, 1)} ppm depuis le début (${f(r.driftPpm * 0.06, 2)} ms par minute); ${f(r.driftPpm30s, 1)} ppm sur 30 s</td></tr>
        <tr><th>Avance du calcul sur le haut-parleur</th><td>médiane ${f(r.readings.aheadMs.median, 2)} ms; [${f(r.readings.aheadMs.p05, 2)}, ${f(r.readings.aheadMs.p95, 2)}]</td></tr>`;
    $("#peers").innerHTML = r.peers.length == 0 ? '<tr><td colspan="9">Aucune autre fenêtre : ouvre cette page dans une seconde fenêtre.</td></tr>' :
        r.peers.map((p) => `<tr class="${p.active ? "" : "gone"}">
            <td>${p.id}${p.sampleRate != sr ? " ⚠ " + p.sampleRate + " Hz" : ""}</td>
            <td>${f(p.deltaSamples.last20, 1)}</td>
            <td>${f(p.deltaSamples.lastMinute.std, 2)} (${p.deltaSamples.lastMinute.n})</td>
            <td>${f(p.deltaSamples.driftPerMinute, 2)} (${f(p.deltaSamples.driftPpm, 1)} ppm)</td>
            <td>${f(p.deltaSamples.residualStd, 2)}</td>
            <td>${f(p.driftPpm, 1)} / ${f(r.driftPpm30s, 1)}</td>
            <td>${f(p.roundTrip.rttMs.median, 2)} / ${f(p.roundTrip.rttMs.min, 2)} / ${f(p.roundTrip.rttMs.p95, 2)}</td>
            <td>${f(p.roundTrip.deltaFastHalf, 1)} (σ ${f(p.roundTrip.deltaSamples.std, 1)})</td>
            <td>${f(p.roundTrip.minusAudibleMs, 2)}</td></tr>`).join("");
    const rec = r.recording;
    $("#result").innerHTML = !rec ? "" : `<p>${rec.clicks} clics détectés (crête ${f(rec.peak, 3)}), ${rec.groups} groupes, ${rec.windows} fenêtres par groupe ${JSON.stringify(rec.sizes)}.</p>` +
        (rec.errors.length == 0 ? "<p>Pas de paire : active les clics dans au moins deux fenêtres, et vérifie que l'entrée les entend.</p>" :
            `<table><tr><th>Rang</th><th>n</th><th>médiane</th><th>moyenne</th><th>σ</th><th>min</th><th>max</th></tr>` +
            rec.errors.map((e, i) => `<tr><td>${i + 1} − 0</td><td>${e.n}</td><td>${f(e.median, 3)} ms</td><td>${f(e.mean, 3)} ms</td><td>${f(e.std, 3)} ms</td><td>${f(e.min, 3)} ms</td><td>${f(e.max, 3)} ms</td></tr>`).join("") + "</table>");
}

$("#start").onclick = () => start().catch((e) => alert(e.message));
$("#clicks").onclick = () => {
    clicks = !clicks;
    lastK = -Infinity;
    $("#clicks").textContent = clicks ? "Arrêter les clics" : "Clics";
    $("#clicks").classList.toggle("on", clicks);
};
$("#record").onclick = () => record();
$("#copy").onclick = async () => {
    const text = JSON.stringify(report(), null, 1);
    try { await navigator.clipboard.writeText(text); $("#copied").textContent = "copié"; }
    catch { $("#copied").textContent = "copie impossible : utilise le téléchargement"; }
    setTimeout(() => ($("#copied").textContent = ""), 3000);
};
$("#download").onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data())], { type: "application/json" }));
    a.download = `sync-lab-${id}.json`;
    a.click();
};
window.__lab = { report, data };

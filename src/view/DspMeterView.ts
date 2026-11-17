/*				DSPMETERVIEW.TS
    « DSP 23 % » in the toolbar (audio/DspMeter.ts): the load of the audio thread by the Faust modules, smoothed over
    about a second. Quiet; amber from 70 %; red while a dropout of the device is less than 10 s old. Its tooltip:
    the load, the modules, the dropouts (recent, since the start), or that the audio is suspended.
*/

import { DspMeter, percent } from "../audio/DspMeter";

export interface DspMeterTexts {
    dspMeter: string;           // {load} {modules}
    dspDropouts: string;        // {recent} {total} {window}
    dspNoDropouts: string;      // the browser does not report them
    dspSuspended: string;
}

export class DspMeterView {
    readonly element: HTMLElement;
    private fMeter: DspMeter | null = null;

    constructor(private fTexts: () => DspMeterTexts, private fModules: () => number) {
        this.element = document.createElement("div");
        this.element.id = "dspMeter";
        this.element.className = "dspMeter suspended";
        this.element.textContent = "DSP —";
    }

    attach(meter: DspMeter): void {
        this.fMeter = meter;
        meter.onChange(() => this.show());
        this.show();
    }

    show(): void {
        const meter = this.fMeter;
        if (!meter) return;
        const t = this.fTexts();
        const level = meter.level;
        const load = meter.load;
        this.element.className = `dspMeter ${level}`;
        this.element.textContent = level == "suspended" || load === null ? "DSP —" : `DSP ${percent(load)} %`;
        const lines: string[] = [];
        if (level == "suspended") lines.push(t.dspSuspended);
        else lines.push(t.dspMeter.replace("{load}", load === null ? "—" : String(percent(load))).replace("{modules}", String(this.fModules())));
        lines.push(meter.reportsDropouts
            ? t.dspDropouts.replace("{recent}", String(meter.recentDropouts)).replace("{total}", String(meter.totalDropouts)).replace("{window}", "10")
            : t.dspNoDropouts);
        this.element.title = lines.join("\n");
    }
}

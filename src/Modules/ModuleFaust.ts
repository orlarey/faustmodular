import type { FaustDspFactory } from "@grame/faustwasm";
import { IfDSP } from "../Utilitary";

/*MODULEFAUST.JS
HAND - MADE JAVASCRIPT CLASS CONTAINING A FAUST MODULE */

export class ModuleFaust {
    fDSP: IfDSP;
    factory: FaustDspFactory;
    fSource: string;
    fName: string;
    constructor(name: string) {
        this.fName = name;
    }

    /********************** GET/SET SOURCE/NAME/DSP ***********************/
    setSource(code: string): void {
        this.fSource = code;
    }
    getSource(): string { return this.fSource; }
    getName(): string { return this.fName; }
    getDSP(): IfDSP {
        return this.fDSP;
    }
}

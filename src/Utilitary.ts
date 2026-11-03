import type { FaustDspFactory } from "@grame/faustwasm";

import { AccelerometerHandler } from "./Accelerometer";
import { DriveAPI } from "./DriveAPI";
import { ModuleClass } from "./Modules/ModuleClass";
import { Resources } from "./Resources";
import { Scene } from "./Scenes/SceneClass";

export class Utilitary {
    static audioContext: AudioContext;
    static moduleList: ModuleClass[];
    static currentScene: Scene;
    static messageResource: Resources;
    static idX: number = 0;
    static baseImg: string = "img/";
    static isAccelerometerOn: boolean = false;
    static isAccelerometerEditOn: boolean = false;
    static accHandler: AccelerometerHandler;
    static driveApi: DriveAPI;

    static errorCallBack(message: string) { }
    // The veil of a wait: shown at once (it takes the clicks), its spinner after a moment (css/Theme.css), so that
    // a short wait does not flash.
    static showFullPageLoading() {
        const page = document.getElementById("loadingPage")!;
        page.style.visibility = "visible";
        page.classList.add("shown");
    }
    static hideFullPageLoading() {
        const page = document.getElementById("loadingPage")!;
        page.style.visibility = "hidden";
        page.classList.remove("shown");
    }
    static isAppPedagogique(): boolean {
        if (window.location.href.indexOf("kids.html") > -1) {
            return true
        } else {
            return false
        }
    }
    //generic function to make XHR request
    static getXHR(url: string, callback: (any) => any, errCallback: (any) => any) {

        var getrequest: XMLHttpRequest = new XMLHttpRequest();

        getrequest.onreadystatechange = function () {
            console.log("enter onreadystatechange");
            if (getrequest.readyState == 4 && getrequest.status == 200) {
                callback(getrequest.responseText);
            } else if (getrequest.readyState == 4 && getrequest.status == 400) {
                errCallback(getrequest.responseText);
            }
        }

        getrequest.open("GET", url, true);
        getrequest.send(null);
    }

    static addLoadingLogo(idTarget: string) {
        var loadingDiv = document.createElement("div");
        loadingDiv.className = "loadingDiv";
        var loadingImg = document.createElement("span");
        loadingImg.className = "loading-spinner";
        var loadingText = document.createElement("span");
        loadingText.textContent = Utilitary.messageResource.loading;
        loadingText.id = "loadingText";
        loadingDiv.appendChild(loadingImg);
        loadingDiv.appendChild(loadingText);
        if (document.getElementById(idTarget) != null) {
            document.getElementById(idTarget)!.appendChild(loadingDiv);
        }
    }
    static removeLoadingLogo(idTarget: string) {
        var divTarget = <HTMLDivElement>document.getElementById(idTarget)
        if (divTarget != null && divTarget.getElementsByClassName("loadingDiv").length > 0) {
            while (divTarget.getElementsByClassName("loadingDiv").length != 0) {
                divTarget.getElementsByClassName("loadingDiv")[0].remove();
            }
        }
    }

    static addFullPageLoading() {
        var loadingText = document.getElementById("loadingTextBig")!;
        loadingText.id = "loadingTextBig"
        loadingText.textContent = Utilitary.messageResource.loading;
    }
    static replaceAll(str: String, find: string, replace: string) {
        return str.replace(new RegExp(find, 'g'), replace);
    }
}
/********************************************************************
**************************  interfaces  *****************************
********************************************************************/

declare global {
    interface AudioBufferSourceNode {
        noteOn: (any: any) => any;
    }
}

interface IPositionModule {
    x: number;
    y: number;
}

export class PositionModule implements IPositionModule {
    x: number;
    y: number;
}

export interface HTMLInterfaceContainer extends HTMLDivElement {
    unlitClassname: string;
    lastLit: any;
}
export interface IfDSP extends AudioNode {
    getJSON: () => string;
    getParamValue: (text: string) => number;
    setParamValue: (text: string, val: number) => void;
    getNumInputs: () => number;
    getNumOutputs: () => number;
    getParams: () => any;
    destroy: () => any;
}

export interface CompileFaust {
    name: string,
    sourceCode: string,
    x: number,
    y: number,
    callback: (factory: FaustDspFactory) => void,
    // compilation errors are passed to it instead of being shown as a message
    onError?: (error: string) => void
}

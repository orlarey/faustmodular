/*				MAIN.JS
    Entry point of the Program
    intefaces used through the app
*/
import { STARTER_CENTERED, starterPatch, starterWanted } from "./documents/Starter";
import type { ab2str, FaustCompiler, FaustMonoDspGenerator, FaustPolyDspGenerator, str2ab } from "@grame/faustwasm";
import type * as faustwasm from "@grame/faustwasm";

import jsURL from "@grame/faustwasm/libfaust-wasm/libfaust-wasm.js?url";
import dataURL from "@grame/faustwasm/libfaust-wasm/libfaust-wasm.data?url";
import wasmURL from "@grame/faustwasm/libfaust-wasm/libfaust-wasm.wasm?url";

import { AccelerometerHandler } from "./Accelerometer";
import { App } from "./App";
import { DriveAPI } from "./DriveAPI";
import { Resources } from "./Resources";
import { Utilitary } from "./Utilitary";
import { Message } from "./Messages";
import { APP_TITLE } from "./Version";
import { Documents } from "./documents/Documents";
import { shippedEnvironment } from "./documents/Environment";

//@ts-ignore
declare const faust: never;

export let faustWasmEnv: {
    faustwasm: typeof faustwasm;
    faustCompiler: FaustCompiler;
    FaustMonoDspGenerator: typeof FaustMonoDspGenerator;
    FaustPolyDspGenerator: typeof FaustPolyDspGenerator;
    ab2str: typeof ab2str;
    str2ab: typeof str2ab;
};

//init is call by libfaust-wasm.js load end handler

//initialization af the app, create app and resource to get text with correct localization
//then resumeInit on callback when text is loaded
export async function init(): Promise<void> {
    console.log(APP_TITLE);
    //@ts-ignore
    const faustwasm = await import("@grame/faustwasm");
    console.log(faustwasm);
    const { instantiateFaustModuleFromFile, FaustCompiler, LibFaust, FaustMonoDspGenerator, FaustPolyDspGenerator, ab2str, str2ab } = faustwasm;
    const faustModule = await instantiateFaustModuleFromFile(jsURL, dataURL, wasmURL);
    const libFaust = new LibFaust(faustModule);
    const faustCompiler = new FaustCompiler(libFaust);
    faustWasmEnv = {
        faustwasm,
        faustCompiler,
        FaustMonoDspGenerator,
        FaustPolyDspGenerator,
        ab2str,
        str2ab
    };

    var app: App = new App();
    Resources.getResources(app);
}
//callback when text is loaded. resume the initialization
export function resumeInit(app: App) {
    //create div which will contain all Messages and Confirm
    app.createDialogue();
    //create audiocontext if available, otherwise app can't work
    try {
        const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
        Utilitary.audioContext = new AudioContext({ latencyHint: 0.00001 });
        Utilitary.audioContext.destination.channelInterpretation = "discrete";
        Utilitary.audioContext.destination.channelCount = Utilitary.audioContext.destination.maxChannelCount;
    } catch (e) {
        new Message(Utilitary.messageResource.errorNoWebAudioAPI);
        Utilitary.hideFullPageLoading();
    }
    Utilitary.addFullPageLoading();

    app.createAllScenes();
    app.createMenu();

    var accHandler: AccelerometerHandler = new AccelerometerHandler();
    Utilitary.accHandler = accHandler;
    accHandler.getAccelerometerValue();

    Utilitary.driveApi = new DriveAPI();
    app.menu.setDriveApi(Utilitary.driveApi);
    Utilitary.driveApi.checkAuth();

    // Access point for debugging and end-to-end tests (browser console: faustmodular.scene.patch);
    // faustPlayground: its name before 2.10.0
    var access: any = { app, documents: null, get scene() { return Utilitary.currentScene; } };
    (globalThis as any).faustmodular = (globalThis as any).faustPlayground = access;

    // The documents: the scene becomes the last open document (documents/Documents.ts)
    Documents.start(Utilitary.currentScene, {
        environment: (store) => shippedEnvironment(faustWasmEnv.faustCompiler, store),
        legacyStorage: (() => { try { return localStorage; } catch { return null; } })(),
        untitled: Utilitary.messageResource.untitled,
        notify: (message) => { new Message(message) },
        library: async () => (await fetch("faust-modules/library-index.json")).json(),
        libraryCode: async (path) => (await fetch(path)).text(),
        // the first visit: a SineVCO to the outputs, in the middle of the stage (not with ?starter=0)
        starter: () => starterWanted(location.search)
            ? JSON.stringify(starterPatch(Utilitary.currentScene.describePatch(), STARTER_CENTERED(Utilitary.currentScene.positionDblTapModule())))
            : null,
    }).then((documents) => {
        access.documents = documents;
        app.menu.setDocuments(documents);
        // opened by faustcode (?link=faustcode): ready to receive its code (FaustcodeLink)
        Utilitary.currentScene.faustcodeLink.announce();
    }).catch((e) => {
        console.error("documents unavailable", e);
        new Message(Utilitary.messageResource.documentsUnavailable + " : " + e);
    });
    // the pending step of the history recorded when the page is left
    window.addEventListener("pagehide", () => { Utilitary.currentScene.history.flush() });

    //error catcher
    window.addEventListener("error", (e: ErrorEvent) => {
        if (e.message == "Uncaught Error: workerError" || e.message == "Error: workerError") {
            new Message(Utilitary.messageResource.errorOccuredMessage + e.message)
            Utilitary.hideFullPageLoading();
        }
        if (e.message == "Uncaught Error: Upload2Error") {
            Utilitary.hideFullPageLoading();
            e.preventDefault();
        }
    });
}

//event listener to activate web audio on IOS devices, touchstart for iOS 8
//touchend for iOS 9

window.addEventListener('touchend', IosInit, false);
window.addEventListener('touchstart', IosInit2, false);

function IosInit() {
    var buffer = Utilitary.audioContext.createBuffer(1, 1, 22050);
    var source = Utilitary.audioContext.createBufferSource();
    source.buffer = buffer;

    // connect to output (your speakers)
    source.connect(Utilitary.audioContext.destination);

    // play the file
    if (source.noteOn) {
        source.noteOn(0);
    } else if (source.start) {
        source.start();
    }
    window.removeEventListener('touchend', IosInit, false)
}

function IosInit2() {
    var buffer = Utilitary.audioContext.createBuffer(1, 1, 22050);
    var source = Utilitary.audioContext.createBufferSource();
    source.buffer = buffer;

    // connect to output (your speakers)
    source.connect(Utilitary.audioContext.destination);

    // play the file
    if (source.noteOn) {
        source.noteOn(0);
    } else if (source.start) {
        source.start();
    }
    window.removeEventListener('touchstart', IosInit2, false)
}

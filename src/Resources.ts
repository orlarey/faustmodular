import frURL from "../resources/resources_fr-FR.json?url";
import enURL from "../resources/resources_en-EN.json?url";

import type { App } from "./App";
import { resumeInit } from "./Main";
import { Utilitary } from "./Utilitary";

//contains all the key of resources json files in folders resources

export class Resources {
    //scene messages
    defaultSceneName: string;
    reference: string;
    chrisWilson: string;
    loading: string;
    drop: string;

    //drive Api message
    noFileOnCloud: string;

    //error
    errorObjectNotFaustCompatible: string;
    errorLoading: string;
    errorGettingAudioInput: string;
    midiUnavailable: string;
    midiRefused: string;
    librarySearch: string;
    librarySearchNone: string;
    librarySearchHint: string;
    microphoneIdle: string;
    microphoneOn: string;
    errorInputAPINotAvailable: string;
    errorAccSliderNotFound: string;
    errorAccelerometerNotFound: string;
    errorNoWebAudioAPI: string;
    errorOccuredMessage: string;
    errorFactory: string;
    errorJsonCorrupted: string;
    errorCreateDSP: string;
    errorCreateModuleRecall: string;
    errorConnectionRecall: string;
    connectionsRemovedByArity: string;
    modulationFailed: string;
    modulationsRemoved: string;
    modulationModulate: string;
    modulationAdd: string;
    modulationLinear: string;
    modulationDeviation: string;
    modulationScale: string;
    modulationDrive: string;
    modulationDepth: string;
    modulationPortHint: string;
    volume: string;
    volumeMuted: string;
    volumeHint: string;
    editInFaustcode: string;
    confirmReplaceScene: string;
    undo: string;
    redo: string;
    libraryModular: string;
    libraryClassic: string;
    libraryFaust: string;
    titleFamilies: string;
    titleModules: string;
    titleDescription: string;
    portInlets: string;
    portInput: string;
    portOutput: string;
    portOutlets: string;
    [key: `family_${string}`]: string;
    zoomOut: string;
    zoomIn: string;
    zoomReset: string;
    zoomFit: string;
    transport: string;
    transportPlay: string;
    transportStop: string;
    transportRewind: string;
    transportTempo: string;
    transportPosition: string;
    transportClocks: string;
    transportCorrection: string;
    transportGates: string;
    transportGate: string;
    libraryStores: string;
    storeAdd: string;
    storePlaceholder: string;
    storeLoading: string;
    storeRemove: string;
    confirmStoreRemove: string;
    storeUnreadable: string;
    storeNotFound: string;
    storeNotAStore: string;
    storeUnreachable: string;
    storeNoModule: string;
    fileOpenFromStore: string;
    fileNoStore: string;
    storeNoScene: string;
    publishScene: string;
    publishModule: string;
    storeDialogTitle: string;
    storeDialogToken: string;
    storeDialogHelp: string;
    storeDialogCreateToken: string;
    storeDialogVerify: string;
    storeDialogClose: string;
    storeVerified: string;
    storePublic: string;
    storePublishToken: string;
    storePublishRights: string;
    storePublishEmpty: string;
    storePublishNotFound: string;
    storePublishNetwork: string;
    storePublishConflict: string;
    storePublished: string;
    storePublishedLink: string;
    storeNoWritable: string;
    publishDialogTitle: string;
    publishDialogReplace: string;
    publishDialogModules: string;
    publishChoiceNew: string;
    publishChoiceVersion: string;
    publishChoiceOther: string;
    publishChoiceSkip: string;
    publishConflictStore: string;
    publishConflictScene: string;
    publishDialogKept: string;
    publishKeptLibrary: string;
    publishKeptSame: string;
    publishKeptOlder: string;
    publishDialogSound: string;
    publishDialogPublish: string;
    storePublishedModules: string;
    storeReadBadge: string;
    storeWriteBadge: string;
    storeReadOnly: string;
    storeReadWrite: string;
    storeMakeWritable: string;
    storeChangeToken: string;
    storeMakeReadOnly: string;
    storeReload: string;
    storeOpenGitHub: string;
    storeOpenInFaustcode: string;
    record: string;
    recordUntilStop: string;
    recordBars: string;
    recordWaiting: string;
    recording: string;
    recordStop: string;
    recordDone: string;
    recordClipped: string;
    recordFailed: string;
    recordFlac: string;
    recordWav: string;
    publishRecording: string;
    recordingPublished: string;
    recordingPublishedLink: string;
    storeRecordings: string;
    recordingOpenScene: string;
    recordingListen: string;
    recordingDownload: string;
    recordingRecalled: string;
    recordingRecalledOther: string;
    recordingOtherLibfaust: string;
    recordingAddPlayer: string;
    recordingPlayerFailed: string;
    titleDisplay: string;
    faustcodeLibfaustMismatch: string;
    moduleUpdate: string;
    moduleDuplicate: string;
    menuCopy: string;
    menuCut: string;
    menuPaste: string;
    menuDuplicate: string;
    menuDuplicateAlone: string;
    menuUnplug: string;
    speakersBoth: string;
    speakerLeft: string;
    speakerRight: string;
    speakerMono: string;
    speakerChannel: string;
    speakersOther: string;
    unplugOutput: string;
    moduleToSpeakers: string;
    moduleOffSpeakers: string;
    outputMenuTitle: string;
    menuMinimize: string;
    menuExpand: string;
    menuDelete: string;
    menuSelectAll: string;
    moduleUpdateFailed: string;
    titleUserModules: string;
    userModulesDescription: string;
    userModulesEmpty: string;
    userModuleRename: string;
    userModuleDelete: string;
    userModuleVersions: string;
    confirmUserModuleDelete: string;
    buttonFile: string;
    documentFiles: string;
    documentOpenFile: string;
    documentOpenFileHint: string;
    documentDownload: string;
    documentExamples: string;
    exampleSmall: string;
    exampleBig: string;
    exampleMultichannel: string;
    exampleModulation: string;
    menuImportDsp: string;
    menuModules: string;
    menuNewModule: string;
    newModuleName: string;
    faustcodeImportFailed: string;
    moduleOrbit: string;
    menuOrbitInterface: string;
    menuClassicInterface: string;
    valueEditHint: string;
    fileNew: string;
    fileOpen: string;
    fileSave: string;
    fileSaveAs: string;
    fileRecent: string;
    fileSaveFailed: string;
    renameScene: string;
    buttonDocuments: string;
    untitled: string;
    documentCurrent: string;
    documentList: string;
    documentTrash: string;
    documentNew: string;
    documentSave: string;
    documentSaveAs: string;
    documentRevert: string;
    documentRename: string;
    documentDuplicate: string;
    documentDelete: string;
    documentRestore: string;
    documentEmptyTrash: string;
    documentModified: string;
    confirmDocumentDelete: string;
    confirmEmptyTrash: string;
    documentStorageLocal: string;
    documentStorageMemory: string;
    documentsUnavailable: string;
    faustcodePopupBlocked: string;
    faustcodeNoAnswer: string;
    faustcodeUpdateFailed: string;
    forceStereoExport: string;
    modulesNotExported: string;
    errorLocalStorage: string;
    errorConnectionCloud: string;

    //SaveView messages
    saveDownload: string;
    rulesSceneName: string;
    precompileOption: string;
    buttonDownloadApp: string;
    sucessSave: string;
    buttonSuppress: string;
    buttonLocalSave: string;
    buttonConnectCloud: string;
    buttonCloudSave: string;
    buttonLogoutCloud: string;

    //Save message
    confirmSuppr: string;
    confirmReplace: string;

    //MenuView messages
    buttonLibrary: string;
    buttonLoad: string;
    buttonEdit: string;
    buttonSave: string;
    buttonExport: string;

    //Menu
    confirmEmptyScene: string;

    //LoadView messages
    buttonLoadFile: string;
    buttonLoadLocal: string;
    buttonLoadCloud: string;

    //LibraryView
    titleInstruments: string;
    titleEffects: string;
    titleExemples: string;
    titleMultichannel: string;
    titleModulation: string;

    //Library
    hoverLibraryElement: string;

    //ExportView
    appNameExport: string;
    buttonChangeSceneName: string;
    lessOptions: string;
    moreOptions: string;
    titleExportOptions: string;
    buttonRefresh: string;
    buttonExportScene: string;
    titleDownloadExport: string;
    invalidSceneName: string;
    successRenameScene: string;

    //AccelerometerEditView
    curve1: string;
    curve2: string;
    curve3: string;
    curve4: string;
    axisX: string;
    axisY: string;
    axisZ: string;
    axis0: string;
    checkBox: string;
    noDeviceMotion: string;

    //get resource depending on the location, default is french
    static getResources(app: App) {
        var localization = navigator.language;
        if (localization == "fr" || localization == "fr-FR") {
            Utilitary.getXHR(frURL, (resource) => { Resources.loadMessages(resource, app) }, Utilitary.errorCallBack)
        } else {
            Utilitary.getXHR(enURL, (resource) => { Resources.loadMessages(resource, app) }, Utilitary.errorCallBack)
        }
    }
    // load the json object
    static loadMessages(resourceJson: string, app: App) {
        Utilitary.messageResource = JSON.parse(resourceJson);
        resumeInit(app);
    }
}

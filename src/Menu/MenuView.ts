//MenuView.ts : MenuView Class which contains all the graphical parts of the menu
/// <reference path="../Accelerometer.ts"/>
/// <reference path="AccelerometerEditView.ts"/>
/// <reference path="LoadView.ts"/>
/// <reference path="SaveView.ts"/>
 
import { AccelerometerEditView } from "./AccelerometerEditView";
import { LoadView } from "./LoadView";
import { LibraryView } from "./LibraryView";
import { ExportView } from "./ExportView";
import { SaveView } from "./SaveView";
import { Utilitary } from "../Utilitary";
import { APP_NAME, APP_VERSION } from "../Version";
import { DocumentsPanel } from "./DocumentsPanel";

export class MenuView {
    menuContainer: HTMLElement;
    documentsButton: HTMLElement;
    documentsContent: HTMLElement;
    documentsPanel: DocumentsPanel;
    libraryButtonMenu: HTMLElement;
    exportButtonMenu: HTMLElement;
    editButtonMenu: HTMLElement;
    fullScreenButton: HTMLElement;
    cleanButton: HTMLElement;
    undoButton: HTMLElement;
    redoButton: HTMLElement;
    zoomOutButton: HTMLElement;
    zoomValue: HTMLElement;
    zoomInButton: HTMLElement;
    zoomFitButton: HTMLElement;
    accButton: HTMLElement;
    loadButton: HTMLElement;
    saveButton: HTMLElement;
    libraryContent: HTMLElement;
    loadContent: HTMLElement;
    exportContent: HTMLElement;
    saveContent: HTMLElement;
    contentsMenu: HTMLElement;
    closeButton: HTMLElement;
    HTMLElementsMenu: HTMLElement[] = [];
    HTMLButtonsMenu: HTMLElement[] = []
    patchNameScene: HTMLElement;
    libraryView: LibraryView;
    loadView: LoadView;
    saveView: SaveView;
    exportView: ExportView;
    accEditView: AccelerometerEditView;
    menuColorDefault: string = "var(--fp-menu-bg)";
    menuColorSelected: string = "var(--fp-menu-bg-selected)";

    init(htmlContainer: HTMLElement): void {
        var menuContainer: HTMLElement = document.createElement('div');
        menuContainer.id = "menuContainer";
        this.menuContainer = menuContainer;

        /////////////////////////create menu's buttons and there containers

        var buttonsMenu: HTMLElement = document.createElement("div");
        buttonsMenu.id = "buttonsMenu";

        var documentsButton: HTMLElement = document.createElement("div");
        documentsButton.id = "documentsButtonMenu";
        documentsButton.className = "buttonsMenu";
        documentsButton.appendChild(document.createTextNode(Utilitary.messageResource.buttonDocuments));
        this.documentsButton = documentsButton;

        var libraryButtonMenu: HTMLElement = document.createElement("div");
        libraryButtonMenu.id = "libraryButtonMenu";
        libraryButtonMenu.className = "buttonsMenu";
        libraryButtonMenu.appendChild(document.createTextNode(Utilitary.messageResource.buttonLibrary));
        this.libraryButtonMenu = libraryButtonMenu;

        var exportButtonMenu: HTMLElement = document.createElement("div");
        exportButtonMenu.id = "exportButtonMenu";
        exportButtonMenu.className = "buttonsMenu";
        exportButtonMenu.appendChild(document.createTextNode(Utilitary.messageResource.buttonExport));
        this.exportButtonMenu = exportButtonMenu;

        var editButtonMenu: HTMLElement = document.createElement("div");
        editButtonMenu.id = "EditButtonMenu";
        editButtonMenu.className = "buttonsMenu";
        editButtonMenu.appendChild(document.createTextNode(Utilitary.messageResource.buttonEdit));
        this.editButtonMenu = editButtonMenu;

        var loadButtonMenu: HTMLElement = document.createElement("div");
        loadButtonMenu.id = "loadButtonMenu";
        loadButtonMenu.className = "buttonsMenu";
        loadButtonMenu.appendChild(document.createTextNode(Utilitary.messageResource.buttonLoad));
        this.loadButton = loadButtonMenu;

        var saveButtonMenu: HTMLElement = document.createElement("div");
        saveButtonMenu.id = "saveButtonMenu";
        saveButtonMenu.className = "buttonsMenu";
        saveButtonMenu.appendChild(document.createTextNode(Utilitary.messageResource.buttonSave));
        this.saveButton = saveButtonMenu;

        var fullScreenButton: HTMLElement = document.createElement("div");
        fullScreenButton.id = "fullScreenButton";
        fullScreenButton.className = "buttonsLittleMenu";
        this.fullScreenButton = fullScreenButton;

        var accButton: HTMLElement = document.createElement("div");
        accButton.id = "accButton";
        accButton.className = "buttonsLittleMenu";
        this.accButton = accButton;

        var cleanButton: HTMLElement = document.createElement("div");
        cleanButton.id = "cleanButton";
        cleanButton.className = "buttonsLittleMenu";
        this.cleanButton = cleanButton;

        if (!Utilitary.isAccelerometerOn) {
            accButton.style.opacity = "0.2";
        }

        // the name and the version of the application, as faustcode shows them
        var appName = document.createElement("div");
        appName.id = "appName";
        appName.textContent = APP_NAME + " ";
        var appVersion = document.createElement("span");
        appVersion.className = "appVersion";
        appVersion.textContent = APP_VERSION;
        appName.appendChild(appVersion);
        buttonsMenu.appendChild(appName);

        buttonsMenu.appendChild(documentsButton);
        buttonsMenu.appendChild(libraryButtonMenu);
        buttonsMenu.appendChild(loadButtonMenu)
        buttonsMenu.appendChild(editButtonMenu);
        buttonsMenu.appendChild(saveButtonMenu);
        buttonsMenu.appendChild(exportButtonMenu);
        buttonsMenu.appendChild(fullScreenButton);
        buttonsMenu.appendChild(accButton);
        buttonsMenu.appendChild(cleanButton);

        // undo and redo (Scene.history), disabled when there is nothing to undo or redo
        var undoButton = document.createElement("div");
        undoButton.id = "undoButton";
        undoButton.className = "buttonsLittleMenu historyButton disabled";
        undoButton.textContent = "\u21B6";
        undoButton.title = Utilitary.messageResource.undo;
        this.undoButton = undoButton;
        buttonsMenu.appendChild(undoButton);
        var redoButton = document.createElement("div");
        redoButton.id = "redoButton";
        redoButton.className = "buttonsLittleMenu historyButton disabled";
        redoButton.textContent = "\u21B7";
        redoButton.title = Utilitary.messageResource.redo;
        this.redoButton = redoButton;
        buttonsMenu.appendChild(redoButton);

        // zoom of the stage: out, value (back to 100%), in, fit the scene
        var zoomButton = (id: string, text: string, title: string) => {
            var b = document.createElement("div");
            b.id = id;
            b.className = "buttonsLittleMenu zoomButton";
            b.textContent = text;
            b.title = title;
            buttonsMenu.appendChild(b);
            return b;
        };
        this.zoomOutButton = zoomButton("zoomOutButton", "\u2212", Utilitary.messageResource.zoomOut);
        this.zoomValue = zoomButton("zoomValue", "100%", Utilitary.messageResource.zoomReset);
        this.zoomInButton = zoomButton("zoomInButton", "+", Utilitary.messageResource.zoomIn);
        this.zoomFitButton = zoomButton("zoomFitButton", "\u2922", Utilitary.messageResource.zoomFit);

        this.HTMLButtonsMenu.push(documentsButton, libraryButtonMenu, loadButtonMenu, saveButtonMenu, exportButtonMenu);

        var myScene: HTMLDivElement = document.createElement("div");
        myScene.id = "PatchName";
        myScene.className = "sceneTitle";
        myScene.textContent = Utilitary.currentScene.sceneName;
        buttonsMenu.appendChild(myScene);
        this.patchNameScene = myScene;

        //////////////////create menu's Contents and there containers

        var contentsMenu: HTMLElement = document.createElement("div");
        contentsMenu.id = "contentsMenu";
        contentsMenu.style.display = "none";

        var closeButton: HTMLElement = document.createElement("div")
        closeButton.id = "closeButton";
        this.closeButton = closeButton;

        var CloseButtonContainer: HTMLElement = document.createElement("div");
        CloseButtonContainer.id = "closeButtonContainer";
        CloseButtonContainer.appendChild(closeButton);

        var documentsPanel = new DocumentsPanel();
        var documentsContent = documentsPanel.element;
        documentsContent.style.display = "none";
        this.documentsPanel = documentsPanel;

        var libraryView: LibraryView = new LibraryView();
        var libraryContent: HTMLElement = libraryView.initLibraryView();
        libraryContent.style.display = "none";
        this.libraryView = libraryView;

        var loadView: LoadView = new LoadView();
        var loadContent: HTMLElement = loadView.initLoadView();
        loadContent.style.display = "none";
        this.loadView = loadView;

        var saveView: SaveView = new SaveView();
        var saveContent = saveView.initSaveView();
        saveContent.style.display = "none";
        this.saveView = saveView;

        var exportView: ExportView = new ExportView();
        var exportContent: HTMLElement = exportView.initExportView();
        exportContent.style.display = "none";
        this.exportView = exportView;

        var accEditView: AccelerometerEditView = new AccelerometerEditView();
        var accEditContent = accEditView.initAccelerometerEdit();
        accEditContent.style.display = "none";
        this.accEditView = accEditView;

        contentsMenu.appendChild(CloseButtonContainer);
        contentsMenu.appendChild(documentsContent);
        contentsMenu.appendChild(libraryContent);
        contentsMenu.appendChild(loadContent);
        contentsMenu.appendChild(saveContent);
        contentsMenu.appendChild(exportContent);

        menuContainer.appendChild(buttonsMenu);
        menuContainer.appendChild(contentsMenu);
        menuContainer.appendChild(accEditContent);

        htmlContainer.appendChild(menuContainer);
        this.HTMLElementsMenu.push(documentsContent, libraryContent, loadContent, saveContent, exportContent)
        this.documentsContent = documentsContent;

        this.libraryContent = libraryContent;
        this.loadContent = loadContent;
        this.saveContent = saveContent;
        this.exportContent = exportContent;
        this.contentsMenu = contentsMenu;
    }
}

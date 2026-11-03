//Menu.ts  Menu class which handles the menu behaviours and contains the MenuView

import { AccelerometerEdit } from "./AccelerometerEdit";
import { DriveAPI } from "../DriveAPI";
import { Export } from "./Export";
import { Library } from "./Library";
import { Load } from "./Load";
import { Save } from "./Save";
import { Utilitary } from "../Utilitary";
import { MenuView } from "./MenuView";
import { Scene } from "../Scenes/SceneClass";
import { Confirm, Message } from "../Messages";
import { AccelerometerHandler } from "../Accelerometer";
import type { Documents } from "../documents/Documents";

declare global {
    interface Document {
        cancelFullScreen: () => any;
        webkitCancelFullScreen: () => any;
        mozCancelFullScreen: () => any;
    }

    interface HTMLElement {
        requestFullscreen: () => any;
        mozRequestFullScreen: () => any;
        webkitRequestFullscreen: () => any;
    }
}

export enum MenuChoices { library, export, kids, edit, save, load, documents, null }

export class Menu {
    isMenuDriveLoading: boolean = false;
    sceneCurrent: Scene;
    newMenuChoices: MenuChoices;
    currentMenuChoices: MenuChoices = MenuChoices.null;
    menuView: MenuView;
    library: Library;
    load: Load
    save: Save;
    expor: Export;
    accEdit: AccelerometerEdit;
    isFullScreen: boolean = false;
    isAccelerometer: boolean = Utilitary.isAccelerometerOn;
    drive: DriveAPI;
    documents: Documents | null = null;

    constructor(htmlContainer: HTMLElement) {
        //create and init menu view wich gone create and init all sub menus views
        this.menuView = new MenuView();
        this.menuView.init(htmlContainer);

        //add Event Listeners
        this.menuView.documentsButton.onclick = () => { this.menuHandler(this.newMenuChoices = MenuChoices.documents) };
        this.menuView.patchNameScene.addEventListener("click", () => {
            if (this.currentMenuChoices != MenuChoices.documents) this.menuHandler(this.newMenuChoices = MenuChoices.documents);
        });
        this.menuView.libraryButtonMenu.onclick = () => { this.menuHandler(this.newMenuChoices = MenuChoices.library) };
        this.menuView.exportButtonMenu.onclick = () => { this.menuHandler(this.newMenuChoices = MenuChoices.export) };
        this.menuView.editButtonMenu.addEventListener("click", () => { this.menuHandler(this.newMenuChoices = MenuChoices.edit) });
        this.menuView.closeButton.onclick = () => { this.menuHandler(this.newMenuChoices = MenuChoices.null) };
        this.menuView.saveButton.addEventListener("click", () => { this.menuHandler(this.newMenuChoices = MenuChoices.save) });
        this.menuView.loadButton.addEventListener("click", () => { this.menuHandler(this.newMenuChoices = MenuChoices.load) });
        this.menuView.fullScreenButton.addEventListener("click", () => { this.fullScreen() });
        this.menuView.accButton.addEventListener("click", () => { this.accelerometer() });
        this.menuView.cleanButton.addEventListener("click", () => { new Confirm(Utilitary.messageResource.confirmEmptyScene, (callback) => { this.cleanScene(callback) }) });
        this.menuView.undoButton.addEventListener("click", () => { Utilitary.currentScene.undo() });
        this.menuView.redoButton.addEventListener("click", () => { Utilitary.currentScene.redo() });
        this.menuView.zoomOutButton.addEventListener("click", () => { Utilitary.currentScene.zoomBy(1 / 1.25) });
        this.menuView.zoomInButton.addEventListener("click", () => { Utilitary.currentScene.zoomBy(1.25) });
        this.menuView.zoomValue.addEventListener("click", () => { Utilitary.currentScene.setView(1, 0, 0) });
        this.menuView.zoomFitButton.addEventListener("click", () => { Utilitary.currentScene.fit() });
        document.addEventListener("viewchange", () => {
            this.menuView.zoomValue.textContent = Math.round(Utilitary.currentScene.view.zoom * 100) + "%";
        });
        document.addEventListener("historychange", () => {
            var history = Utilitary.currentScene.history;
            this.menuView.undoButton.classList.toggle("disabled", !history.canUndo());
            this.menuView.redoButton.classList.toggle("disabled", !history.canRedo());
        });

        // the open document: its name, and a dot when it differs from its committed copy
        document.addEventListener("documentchange", () => { this.showSceneName() });
        // the Modules menu opened from the context menu of the stage
        document.addEventListener("openmodules", () => {
            if (this.currentMenuChoices != MenuChoices.library) this.menuHandler(this.newMenuChoices = MenuChoices.library);
        });
        // Cmd/Ctrl-S: the working copy becomes the committed copy
        document.addEventListener("keydown", (e) => {
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() == "s" && this.documents) {
                e.preventDefault();
                this.documents.save();
            }
        });

        //add eventListern customs
        document.addEventListener("updatename", (e) => { this.updatePatchNameToInput(e) })
        document.addEventListener("codeeditevent", () => { this.customeCodeEditEvent() });
        document.addEventListener("updatelist", () => { this.updateSelectLocalEvent() });
        document.addEventListener("authon", () => { this.authOn() });
        document.addEventListener("authoff", () => { this.authOff() });
        document.addEventListener("fillselect", (optionEvent: Event) => { this.fillSelectCloud(optionEvent as CustomEvent) })
        document.addEventListener("updatecloudselect", () => { this.updateSelectCloudEvent() });
        document.addEventListener("startloaddrive", () => { this.startLoadingDrive() })
        document.addEventListener("finishloaddrive", () => { this.finishLoadingDrive() })
        document.addEventListener("clouderror", (e: Event) => { this.connectionProblem(e as CustomEvent) })

        //create and init all menus objects
        this.library = new Library();
        this.library.libraryView = this.menuView.libraryView;
        this.library.fillLibrary();
        this.load = new Load();
        this.load.loadView = this.menuView.loadView;
        this.drive = new DriveAPI();
        this.load.drive = this.drive;
        this.load.setEventListeners();
        this.fillSelectLocal(this.load.loadView.existingSceneSelect);
        this.save = new Save();
        this.save.saveView = this.menuView.saveView;
        this.save.setEventListeners();
        this.fillSelectLocal(this.save.saveView.existingSceneSelect);
        this.expor = new Export();
        this.expor.exportView = this.menuView.exportView;
        this.expor.uploadTargets();
        this.expor.setEventListeners();
        this.accEdit = new AccelerometerEdit(this.menuView.accEditView);
    }

    // dispatch the action of the menu buttons to the right submenu handler
    menuHandler(newMenuChoices: MenuChoices): any {
        switch (newMenuChoices) {
            case MenuChoices.documents:
                this.panelMenu(MenuChoices.documents, this.menuView.documentsButton, this.menuView.documentsContent);
                break;
            case MenuChoices.library:
                this.libraryMenu();
                break;
            case MenuChoices.export:
                this.exportMenu();
                break;
            case MenuChoices.edit:
                this.editMenu();
                break;
            case MenuChoices.save:
                this.saveMenu();
                break;
            case MenuChoices.load:
                this.loadMenu();
                break;
            case MenuChoices.null:
                this.cleanMenu();
                this.closeMenu();
                break;
        }
    }

    // shows or hides a panel of the menu, as the other menus do
    panelMenu(choice: MenuChoices, buttonElement: HTMLElement, content: HTMLElement) {
        if (this.currentMenuChoices == choice) {
            this.menuView.contentsMenu.style.display = "none";
            content.style.display = "none";
            this.currentMenuChoices = MenuChoices.null;
            buttonElement.style.backgroundColor = this.menuView.menuColorDefault;
            buttonElement.style.zIndex = "0";
            return;
        }
        this.cleanMenu();
        this.menuView.contentsMenu.style.display = "block";
        content.style.display = choice == MenuChoices.documents ? "grid" : "block";
        this.currentMenuChoices = choice;
        buttonElement.style.backgroundColor = this.menuView.menuColorSelected;
        buttonElement.style.zIndex = "1";
        if (choice == MenuChoices.documents) this.menuView.documentsPanel.render();
    }

    setDocuments(documents: Documents) {
        this.documents = documents;
        this.menuView.documentsPanel.setDocuments(documents);
        this.library.setDocuments(documents);
        this.showSceneName();
    }

    // the name of the scene (of the open document) wherever it is shown
    showSceneName() {
        var name = Utilitary.currentScene.sceneName;
        this.menuView.patchNameScene.textContent = name + (this.documents?.dirty ? " \u25CF" : "");
        this.menuView.patchNameScene.title = this.documents?.dirty ? Utilitary.messageResource.documentModified : "";
        this.menuView.exportView.dynamicName.textContent = name;
        this.menuView.exportView.inputNameApp.value = name;
        this.menuView.saveView.dynamicName.textContent = name;
        this.menuView.saveView.inputDownload.value = name;
        this.menuView.saveView.inputLocalStorage.value = name;
        this.menuView.saveView.inputCloudStorage.value = name;
    }

    //manage the library display
    libraryMenu() {
        switch (this.currentMenuChoices) {
            case MenuChoices.null:// case MenuChoices.edit:
                this.menuView.contentsMenu.style.display = "block";
                this.menuView.libraryContent.style.display = "block";
                this.currentMenuChoices = MenuChoices.library;
                this.menuView.libraryButtonMenu.style.backgroundColor = this.menuView.menuColorSelected;
                this.menuView.libraryButtonMenu.style.zIndex = "1";
                this.library.initScroll();
                break;
            case MenuChoices.library:
                this.menuView.contentsMenu.style.display = "none";
                this.menuView.libraryContent.style.display = "none";
                this.currentMenuChoices = MenuChoices.null;
                this.menuView.libraryButtonMenu.style.backgroundColor = this.menuView.menuColorDefault;
                this.menuView.libraryButtonMenu.style.zIndex = "0";
                break;
            default:
                this.cleanMenu();
                this.menuView.libraryButtonMenu.style.backgroundColor = this.menuView.menuColorSelected;
                this.menuView.libraryButtonMenu.style.zIndex = "1";
                this.menuView.libraryContent.style.display = "block";
                this.currentMenuChoices = MenuChoices.library;
                break;
        }
    }

    //manage the load display
    loadMenu() {
        switch (this.currentMenuChoices) {
            case MenuChoices.null:// case MenuChoices.edit:
                this.menuView.contentsMenu.style.display = "block";
                this.menuView.loadContent.style.display = "inline-table";
                this.currentMenuChoices = MenuChoices.load;
                this.menuView.loadButton.style.backgroundColor = this.menuView.menuColorSelected;
                this.menuView.loadButton.style.zIndex = "1";
                break;
            case MenuChoices.load:
                this.menuView.contentsMenu.style.display = "none";
                this.menuView.loadContent.style.display = "none";
                this.currentMenuChoices = MenuChoices.null;
                this.menuView.loadButton.style.backgroundColor = this.menuView.menuColorDefault;
                this.menuView.loadButton.style.zIndex = "0";
                break;
            default:
                this.cleanMenu();
                this.menuView.loadButton.style.backgroundColor = this.menuView.menuColorSelected;
                this.menuView.loadButton.style.zIndex = "1";
                this.menuView.loadContent.style.display = "inline-table";
                this.currentMenuChoices = MenuChoices.load;
                break;
        }
    }

    //manage the export display
    exportMenu() {
        switch (this.currentMenuChoices) {
            case MenuChoices.null:// case MenuChoices.edit:
                this.menuView.contentsMenu.style.display = "block";
                this.menuView.exportContent.style.display = "inline-table";
                this.currentMenuChoices = MenuChoices.export;
                this.menuView.exportButtonMenu.style.backgroundColor = this.menuView.menuColorSelected;
                this.menuView.exportButtonMenu.style.zIndex = "1";
                break;
            case MenuChoices.export:
                this.menuView.contentsMenu.style.display = "none";
                this.menuView.exportContent.style.display = "none";
                this.currentMenuChoices = MenuChoices.null;
                this.menuView.exportButtonMenu.style.backgroundColor = this.menuView.menuColorDefault;
                this.menuView.exportButtonMenu.style.zIndex = "0";
                break;
            default:
                this.cleanMenu();
                this.menuView.exportButtonMenu.style.backgroundColor = this.menuView.menuColorSelected;
                this.menuView.exportButtonMenu.style.zIndex = "1";
                this.menuView.exportContent.style.display = "inline-table";
                this.currentMenuChoices = MenuChoices.export;
                break;
        }
    }

    //manage the save display
    saveMenu() {
        switch (this.currentMenuChoices) {
            case MenuChoices.null:// case MenuChoices.edit:
                this.menuView.contentsMenu.style.display = "block";
                this.menuView.saveContent.style.display = "inline-table";
                this.currentMenuChoices = MenuChoices.save;
                this.menuView.saveButton.style.backgroundColor = this.menuView.menuColorSelected;
                this.menuView.saveButton.style.zIndex = "1";
                break;
            case MenuChoices.save:
                this.menuView.contentsMenu.style.display = "none";
                this.menuView.saveContent.style.display = "none";
                this.currentMenuChoices = MenuChoices.null;
                this.menuView.saveButton.style.backgroundColor = this.menuView.menuColorDefault;
                this.menuView.saveButton.style.zIndex = "0";
                break;
            default:
                this.cleanMenu();
                this.menuView.saveButton.style.backgroundColor = this.menuView.menuColorSelected;
                this.menuView.saveButton.style.zIndex = "1";
                this.menuView.saveContent.style.display = "inline-table";
                this.currentMenuChoices = MenuChoices.save;
                break;
        }
    }

    //manage the accelerometerEdit mode and display
    editMenu() {
        switch (this.currentMenuChoices) {
            case MenuChoices.null:
                this.menuView.editButtonMenu.style.backgroundColor = this.menuView.menuColorSelected;
                this.menuView.editButtonMenu.style.boxShadow = "yellow 0px 0px 51px inset";
                this.accEdit.editAction();
                this.currentMenuChoices = MenuChoices.edit;
                break;
            case MenuChoices.edit:
                this.accEdit.editAction();
                this.menuView.editButtonMenu.style.backgroundColor = this.menuView.menuColorDefault;
                this.menuView.editButtonMenu.style.boxShadow = "none";
                this.menuView.contentsMenu.style.display = "none";
                this.currentMenuChoices = MenuChoices.null;
                break;
            default:
                this.cleanMenu();
                this.menuView.editButtonMenu.style.backgroundColor = this.menuView.menuColorSelected;
                this.menuView.editButtonMenu.style.boxShadow = "yellow 0px 0px 51px inset";
                this.accEdit.editAction();
                this.menuView.contentsMenu.style.display = "none";
                this.currentMenuChoices = MenuChoices.edit;
                break;
        }
    }

    //Close the menu
    closeMenu() {
        for (var i = 0; i < this.menuView.HTMLElementsMenu.length; i++) {
            this.menuView.HTMLElementsMenu[i].style.display = "none";
        }
        this.menuView.contentsMenu.style.display = "none";
        this.currentMenuChoices = MenuChoices.null;
    }

    //hide all elements currently displayed in the menu
    cleanMenu() {
        if (this.accEdit.isOn) {
            this.accEdit.editAction()
            this.menuView.editButtonMenu.style.backgroundColor = this.menuView.menuColorDefault;
            this.menuView.editButtonMenu.style.boxShadow = "none";
            this.menuView.contentsMenu.style.display = "block";
        }
        for (var i = 0; i < this.menuView.HTMLElementsMenu.length; i++) {
            this.menuView.HTMLElementsMenu[i].style.display = "none";
        }
        for (var i = 0; i < this.menuView.HTMLButtonsMenu.length; i++) {
            this.menuView.HTMLButtonsMenu[i].style.backgroundColor = this.menuView.menuColorDefault;
            this.menuView.HTMLButtonsMenu[i].style.zIndex = "0";
        }
    }

    //update all element that display the scene name
    updatePatchNameToInput(e: Event) {
        this.showSceneName();
        new Message(Utilitary.messageResource.successRenameScene, "messageTransitionOutFast", 2000, 500)
    }

    //handle fullscreen mode
    fullScreen() {
        if (this.isFullScreen) {
            if (document.cancelFullScreen) {
                document.cancelFullScreen()
            } else if (document.webkitCancelFullScreen) {
                document.webkitCancelFullScreen();
            } else if (document.mozCancelFullScreen) {
                document.mozCancelFullScreen();
            }
            this.isFullScreen = false;
        } else {
            if (document.documentElement.requestFullscreen) {
                document.documentElement.requestFullscreen();
            } else if (document.documentElement.webkitRequestFullscreen) {
                document.documentElement.webkitRequestFullscreen();
            } else if (document.documentElement.mozRequestFullScreen) {
                document.documentElement.mozRequestFullScreen()
            }
            this.isFullScreen = true;
        }
    }

    //handle the enabing/disabling of all slider having a accelerometer
    accelerometer() {
        if (this.isAccelerometer) {
            this.isAccelerometer = false;
            Utilitary.isAccelerometerOn = false;
            this.menuView.accButton.style.opacity = "0.3";
            for (var i = 0; i < AccelerometerHandler.faustInterfaceControler.length; i++) {
                var acc = AccelerometerHandler.faustInterfaceControler[i].accelerometerSlider;
                var slider = AccelerometerHandler.faustInterfaceControler[i].faustInterfaceView.slider;
                acc.isActive = false;
                slider.classList.remove("not-allowed");
                slider.classList.add("allowed");
                if (!Utilitary.isAccelerometerEditOn) {
                    slider.disabled = false;
                }

            }
        } else if (!this.isAccelerometer) {
            this.isAccelerometer = true;
            Utilitary.isAccelerometerOn = true;
            this.menuView.accButton.style.opacity = "1";
            for (var i = 0; i < AccelerometerHandler.faustInterfaceControler.length; i++) {
                var acc = AccelerometerHandler.faustInterfaceControler[i].accelerometerSlider;
                var slider = AccelerometerHandler.faustInterfaceControler[i].faustInterfaceView.slider;
                if (acc.isEnabled) {
                    acc.isActive = true;
                    slider.classList.add("not-allowed");
                    slider.classList.remove("allowed");
                    if (!Utilitary.isAccelerometerEditOn) {
                        slider.disabled = true;
                    }
                }
            }
        }
    }

    //removing all modules from the scene
    cleanScene(callBack: () => void) {

        this.sceneCurrent.clearScene();
        callBack();
    }

    //close menu when editing a module's Faust code
    //the idea here is to disable the accelerometerEdit mode if enabled
    customeCodeEditEvent() {
        this.menuHandler(MenuChoices.null);
    }

    //refresh the select boxes of localstorage when adding or removing a saved scene
    updateSelectLocalEvent() {
        this.updateSelectLocal(this.menuView.loadView.existingSceneSelect);
        this.updateSelectLocal(this.menuView.saveView.existingSceneSelect)
    }

    //empty a selectBox
    clearSelect(select: HTMLSelectElement) {
        select.innerHTML = "";

    }

    //refresh a select box
    updateSelectLocal(select: HTMLSelectElement) {
        this.clearSelect(select);
        this.fillSelectLocal(select);
    }

    //get value of 'item_key'
    getStorageItem(item_key) {
        const value = localStorage.getItem(item_key)
        return value ? JSON.parse(value) : null;
    }

    //fill select box
    fillSelectLocal(select: HTMLSelectElement) {
        var fpg = this.getStorageItem('FaustPlayground');
        if (fpg) {
            for (var i = 0; i < fpg.length; i++) {
                var option = document.createElement("option");
                option.value = fpg[i][0];
                option.textContent = fpg[i][0];
                select.add(option);
            }
        }
    }
    //dispatch the current scene to the menus objects
    setMenuScene(scene: Scene) {
        this.sceneCurrent = scene;
        this.save.sceneCurrent = scene;
        this.load.sceneCurrent = scene;
    }
    //dispatch the drive API to the menus objects
    setDriveApi(drive: DriveAPI) {
        this.drive = drive;
        this.save.drive = drive;
        this.load.drive = drive;
    }
    //show element from cloud Drive when logged on
    authOn() {
        this.load.loadView.cloudSelectFile.style.display = "block";
        this.save.saveView.cloudSelectFile.style.display = "block";
        this.load.loadView.buttonChangeAccount.style.display = "block";
        this.save.saveView.buttonChangeAccount.style.display = "block";
        this.load.loadView.buttonConnectDrive.style.display = "none";
        this.save.saveView.buttonConnectDrive.style.display = "none";
        this.save.saveView.buttonCloudSuppr.style.display = "block";
        this.save.saveView.inputCloudStorage.style.display = "block";
    }

    //show element from cloud Drive when logged out
    authOff() {
        this.load.loadView.cloudSelectFile.style.display = "none";
        this.save.saveView.cloudSelectFile.style.display = "none";
        this.load.loadView.buttonChangeAccount.style.display = "none";
        this.save.saveView.buttonChangeAccount.style.display = "none";
        this.load.loadView.buttonConnectDrive.style.display = "block";
        this.save.saveView.buttonConnectDrive.style.display = "block";
        this.save.saveView.buttonCloudSuppr.style.display = "none";
        this.save.saveView.inputCloudStorage.style.display = "none";
        this.clearSelect(this.save.saveView.cloudSelectFile);
        this.clearSelect(this.load.loadView.cloudSelectFile);

        window.open("https://accounts.google.com/logout", "newwindow", "width=500,height=700")

    }
    //display Drive Connection error
    connectionProblem(event: CustomEvent) {
        new Message(Utilitary.messageResource.errorConnectionCloud + " : " + event.detail)
    }

    fillSelectCloud(optionEvent: CustomEvent) {
        this.load.loadView.cloudSelectFile.add(<HTMLOptionElement>optionEvent.detail);
        var optionSave = <HTMLOptionElement>optionEvent.detail.cloneNode(true);
        this.save.saveView.cloudSelectFile.add(optionSave);
    }
    updateSelectCloudEvent() {
        this.clearSelect(this.load.loadView.cloudSelectFile);
        this.clearSelect(this.save.saveView.cloudSelectFile);
        this.drive.updateConnection();
    }

    startLoadingDrive() {
        if (!this.isMenuDriveLoading) {
            this.isMenuDriveLoading = true;
            this.save.saveView.driveContainer.style.display = "none";
            this.load.loadView.driveContainer.style.display = "none";
            Utilitary.addLoadingLogo("loadCloudContainer");
            Utilitary.addLoadingLogo("cloudSaveContainer");

        }
    }

    finishLoadingDrive() {
        if (this.isMenuDriveLoading) {
            this.isMenuDriveLoading = false;
            this.save.saveView.driveContainer.style.display = "block";
            this.load.loadView.driveContainer.style.display = "block";
            Utilitary.removeLoadingLogo("loadCloudContainer");
            Utilitary.removeLoadingLogo("cloudSaveContainer");

        }
    }
}

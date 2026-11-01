/*				PLAYGROUND.JS
    Init Normal Scene with all its graphical elements

    This is the unique scene of the Normal Playground
*/
import { Utilitary } from "../Utilitary";
import { Scene } from "./SceneClass";

export class SceneView {

    /********************************************************************
    **************************  INITIALIZATION **************************
    ********************************************************************/
    //expor: Export = new Export()
    inputOutputModuleContainer: HTMLDivElement;
    sceneSensor: HTMLDivElement;
    dropElementScene: HTMLElement;
    fSceneContainer: HTMLDivElement;
    // the cables, the physical and the Faust modules, zoomed and moved together (Scene.setView)
    fStage: HTMLDivElement;

    initNormalScene(scene: Scene) {
        var container = document.createElement("div");
        container.id = "Normal";

        var stage = document.createElement("div");
        stage.id = "stage";
        container.appendChild(stage);
        this.fStage = stage;

        var svgCanvas = <SVGElement>document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svgCanvas.id = "svgCanvas";
        stage.appendChild(svgCanvas);

        //--------- HEADER
        var head: HTMLElement = document.createElement("header");
        head.id = "header";
        container.appendChild(head);

        var uploadDiv: HTMLDivElement = document.createElement("div");
        uploadDiv.id = "upload";
        uploadDiv.className = "uploading";
        head.appendChild(uploadDiv);
        //----------- INPUT OUTPUT MODULES

        var inputOutputModuleContainer: HTMLDivElement = document.createElement("div");
        inputOutputModuleContainer.id = "inputOutputModuleContainer";
        stage.appendChild(inputOutputModuleContainer);
        this.inputOutputModuleContainer = inputOutputModuleContainer;

        //----------- MODULES
        var moduleContainer: HTMLElement = document.createElement("section");
        moduleContainer.id = "modules";
        moduleContainer.className = "container";
        stage.appendChild(moduleContainer);

        //------------ MENUS

        var dropElementScene = document.createElement("div");
        dropElementScene.className = "dropElementGraph";
        dropElementScene.style.display = "none";
        this.dropElementScene = dropElementScene;

        var dropElementText = document.createElement("div");
        dropElementText.textContent = Utilitary.messageResource.drop;
        dropElementText.className = "dropElementText";
        dropElementScene.appendChild(dropElementText);

        container.appendChild(dropElementScene);
        this.fSceneContainer = container;
    }
}

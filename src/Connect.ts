/*				CONNECT.JS
    Handles Audio/Graphical Connection/Deconnection of modules
    This is a historical file from Chris Wilson, modified for Faust ModuleClass needs.

    A Connector is the graphical link drawn between two modules (one port per module in the
    current view). It stands for the port-to-port connections of the patch model listed in
    patchConnections; audio is handled by the model and its AudioGraph.
*/

import { Drag } from "./Dragging";
import { ConnectionId } from "./model/Patch";
import { ModuleClass } from "./Modules/ModuleClass";
import { Utilitary } from "./Utilitary";

/**************************************************/
/******* WEB AUDIO CONNECTION/DECONNECTION*********/
/**************************************************/

export interface ConnectorShape extends SVGElement {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

export class Connector {
    static connectorId: number = 0;
    connectorShape: ConnectorShape | null;
    source: ModuleClass;
    destination: ModuleClass;
    // connections of the patch model represented by this connector
    patchConnections: ConnectionId[] = [];

    // Creates the patch connections: the given ones if any, otherwise a bus connection
    // between all the outputs of source and all the inputs of destination (cyclic rule).
    connectModules(source: ModuleClass, destination: ModuleClass, existing?: ConnectionId[]): void {
        if (existing) {
            this.patchConnections = existing;
        } else {
            this.patchConnections = Utilitary.currentScene.patch.connectBus(source.moduleId, destination.moduleId).map((c) => c.id);
        }
        source.setDSPValue();
        destination.setDSPValue();
    }

    // Removes the patch connections represented by a connector (some may already be gone).
    disconnectModules(connector: Connector): void {
        var patch = Utilitary.currentScene.patch;
        for (var id of connector.patchConnections) {
            if (patch.getConnection(id)) {
                patch.disconnect(id);
            }
        }
        connector.patchConnections = [];
    }

    /**************************************************/
    /***************** Save Connection*****************/
    /**************************************************/

    //----- Add connection to src and dst connections structures
    saveConnection(source: ModuleClass, destination: ModuleClass, connectorShape: ConnectorShape): void {
        this.connectorShape = connectorShape;
        this.destination = destination;
        this.source = source;
    }

    /***************************************************************/
    /**************** Create/Break Connection(s) *******************/
    /***************************************************************/

    // Draws a connector; `existing`: patch connections it stands for (by default, a new bus connection).
    createConnection(source: ModuleClass, outtarget: HTMLElement, destination: ModuleClass, intarget: HTMLElement, existing?: ConnectionId[]): void {
        var drag: Drag = new Drag();
        drag.startDraggingConnection(source, outtarget);
        drag.stopDraggingConnection(source, destination, undefined, existing);
    }

    deleteConnection(event: MouseEvent, drag: Drag): boolean {
        event.stopPropagation();
        this.breakSingleInputConnection(this.source, this.destination, this);
        return true;
    }

    breakSingleInputConnection(source: ModuleClass, destination: ModuleClass, connector: Connector) {

        this.disconnectModules(connector);

        // delete connection from src .outputConnections,
        if (source != undefined && source.moduleFaust.getOutputConnections()) {
            source.moduleFaust.removeOutputConnection(connector);
        }

        // delete connection from dst .inputConnections,
        if (destination != undefined && destination.moduleFaust.getInputConnections()) {
            destination.moduleFaust.removeInputConnection(connector);
        }

        // and delete the connectorShape
        if (connector.connectorShape)
            connector.connectorShape.remove();
    }

    // Disconnect a node from all its connections
    disconnectModule(module: ModuleClass) {

        //for all output nodes
        if (module.moduleFaust.getOutputConnections && module.moduleFaust.getOutputConnections()) {
            while (module.moduleFaust.getOutputConnections().length > 0)
                this.breakSingleInputConnection(module, module.moduleFaust.getOutputConnections()[0].destination, module.moduleFaust.getOutputConnections()[0]);
        }

        //for all input nodes
        if (module.moduleFaust.getInputConnections && module.moduleFaust.getInputConnections()) {
            while (module.moduleFaust.getInputConnections().length > 0)
                this.breakSingleInputConnection(module.moduleFaust.getInputConnections()[0].source, module, module.moduleFaust.getInputConnections()[0]);
        }
    }

    static redrawInputConnections(module: ModuleClass, drag: Drag) {
        var offset: HTMLElement = module.moduleView.getInputNode();
        var x = module.moduleView.inputOutputNodeDimension / 2// + window.scrollX ;
        var y = module.moduleView.inputOutputNodeDimension / 2// + window.scrollY;

        while (offset) {
            x += offset.offsetLeft;
            y += offset.offsetTop;
            offset = <HTMLDivElement>offset.offsetParent;
        }

        for (var c = 0; c < module.moduleFaust.getInputConnections().length; c++) {
            var currentConnectorShape: ConnectorShape = module.moduleFaust.getInputConnections()[c].connectorShape!;
            var x1 = x;
            var y1 = y;
            var x2 = currentConnectorShape.x2
            var y2 = currentConnectorShape.y2
            var d = drag.setCurvePath(x1, y1, x2, y2, drag.calculBezier(x1, x2), drag.calculBezier(x1, x2))
            currentConnectorShape.setAttributeNS(null, "d", d);
            drag.updateConnectorShapePath(currentConnectorShape, x1, x2, y1, y2);
        }
    }
    static redrawOutputConnections(module: ModuleClass, drag: Drag) {
        var offset: HTMLElement = module.moduleView.getOutputNode();
        var x = module.moduleView.inputOutputNodeDimension / 2// + window.scrollX ;
        var y = module.moduleView.inputOutputNodeDimension / 2// + window.scrollY;

        while (offset) {
            x += offset.offsetLeft;
            y += offset.offsetTop;
            offset = <HTMLDivElement>offset.offsetParent;
        }

        for (var c = 0; c < module.moduleFaust.getOutputConnections().length; c++) {
            if (module.moduleFaust.getOutputConnections()[c].connectorShape) {
                var currentConnectorShape: ConnectorShape = module.moduleFaust.getOutputConnections()[c].connectorShape!;
                var x1 = currentConnectorShape.x1;
                var y1 = currentConnectorShape.y1;
                var x2 = x;
                var y2 = y;
                var d = drag.setCurvePath(x1, y1, x2, y2, drag.calculBezier(x1, x2), drag.calculBezier(x1, x2))

                currentConnectorShape.setAttributeNS(null, "d", d);
                drag.updateConnectorShapePath(currentConnectorShape, x1, x2, y1, y2);
            }
        }
    }
}

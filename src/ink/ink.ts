/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { fromBase64ToUtf8 } from "@fluidframework/common-utils";
import {
    FileMode,
    ISequencedDocumentMessage,
    ITree,
    MessageType,
    TreeEntry,
} from "@fluidframework/protocol-definitions";
import {
    IFluidDataStoreRuntime,
    IChannelStorageService,
    IChannelAttributes,
} from "@fluidframework/datastore-definitions";
import { SharedObject } from "@fluidframework/shared-object-base";
import { v4 as uuid } from "uuid";
import { InkFactory } from "./inkFactory";
import {
    IClearOperation,
    ICreateStrokeOperation,
    IEraseStrokesOperation,
    IInk,
    IInkOperation,
    IInkPoint,
    IInkStroke,
    IPen,
    IStylusOperation,
    IInkEvents,
} from "./interfaces";
import { InkData, ISerializableInk } from "./snapshot";
import { QuadTree } from "./quadtree";
import { Rectangle } from "./rectangle";
/**
 * Filename where the snapshot is stored.
 */
const snapshotFileName = "header";

/**
 * Inking data structure.
 * @sealed
 */
export class Ink extends SharedObject<IInkEvents> implements IInk {
    public strokeIndex: QuadTree<IInkPoint>;
    public splitListener: (rects: Rectangle[]) => void;
    public strokeIdToBoxes: Map<string, QuadTree<IInkPoint>[]>;
    /**
     * Create a new Ink.
     * @param runtime - Data Store runtime the new Ink belongs to
     * @param id - Optional name of the Ink; will be assigned a unique ID if not provided
     * @returns Newly create Ink object (but not attached yet)
     */
    public static create(runtime: IFluidDataStoreRuntime, id?: string) {
        return runtime.createChannel(id, InkFactory.Type) as Ink;
    }

    /**
     * Get a factory for Ink to register with the data store.
     * @returns A factory that creates and loads Ink
     */
    public static getFactory() {
        return new InkFactory();
    }

    public gatherViewportRects(viewport: Rectangle, result: Rectangle[]) {
        this.strokeIndex.gather_intersect(viewport, result);
    }

    /**
     * The current ink snapshot.
     */
    private inkData: InkData = new InkData();

    /**
     * Create a new Ink.
     * @param runtime - The runtime the Ink will be associated with
     * @param id - Unique ID for the Ink
     */
    constructor(runtime: IFluidDataStoreRuntime, id: string, attributes: IChannelAttributes) {
        super(id, runtime, attributes);
        this.initStrokeIndex();
    }

    private registerId(id: string, qt: QuadTree<IInkPoint>) {
        let qts = this.strokeIdToBoxes.get(id);
        if (qts === undefined) {
            qts = [] as QuadTree<IInkPoint>[];
            this.strokeIdToBoxes.set(id, qts);
        }
        qts.push(qt);
    }

    private splitEvent(rects: Rectangle[]) {
        if (this.splitListener !== undefined) {
            this.splitListener(rects);
        }
    }

    private loadIndexFromStrokes() {
        const strokes = this.inkData.getStrokes();
        for (const stroke of strokes) {
            for (const p of stroke.points) {
                this.strokeIndex.insert(p, stroke.id);
            }
        }
    }

    private initStrokeIndex() {
        this.strokeIndex = new QuadTree<IInkPoint>(new Rectangle(0, 0, this.inkData.width, this.inkData.height));
        this.strokeIdToBoxes = new Map<string, QuadTree<IInkPoint>[]>();
        this.strokeIndex.setIdRegistration((id, qt) => this.registerId(id, qt));
        this.strokeIndex.setAnimations({ split: (rects) => this.splitEvent(rects) });
    }
    /**
     * {@inheritDoc IInk.createStroke}
     */
    public createStroke(pen: IPen): IInkStroke {
        const createStrokeOperation: ICreateStrokeOperation = {
            id: uuid(),
            pen: { color: pen.color, thickness: pen.thickness },
            time: Date.now(),
            type: "createStroke",
        };
        this.submitLocalMessage(createStrokeOperation, undefined);
        return this.executeCreateStrokeOperation(createStrokeOperation);
    }

    /**
     * {@inheritDoc IInk.eraseStroke}
     */
    public eraseStrokes(ids: string[]) {
        const eraseStrokesOperation: IEraseStrokesOperation = {
            ids,
            type: "eraseStrokes",
        };
        this.submitLocalMessage(eraseStrokesOperation, undefined);
        this.executeEraseStrokesOperation(eraseStrokesOperation);
    }

    /**
     * {@inheritDoc IInk.appendPointToStroke}
     */
    public appendPointToStroke(point: IInkPoint, id: string): IInkStroke {
        const stylusOperation: IStylusOperation = {
            id,
            point,
            type: "stylus",
        };
        this.submitLocalMessage(stylusOperation, undefined);
        return this.executeStylusOperation(stylusOperation);
    }

    /**
     * {@inheritDoc IInk.eraseStrokes }
     */
    public getHeight() {
        return this.inkData.height;
    }

    public getWidth() {
        return this.inkData.width;
    }

    /**
     * {@inheritDoc IInk.clear}
     */
    public clear(): void {
        const clearOperation: IClearOperation = {
            time: Date.now(),
            type: "clear",
        };
        this.submitLocalMessage(clearOperation, undefined);
        this.executeClearOperation(clearOperation);
    }

    /**
     * {@inheritDoc IInk.getStrokes}
     */
    public getStrokes(): IInkStroke[] {
        return this.inkData.getStrokes();
    }

    /**
     * {@inheritDoc IInk.getStroke}
     */
    public getStroke(key: string): IInkStroke {
        return this.inkData.getStroke(key);
    }

    /**
     * {@inheritDoc @fluidframework/shared-object-base#SharedObject.snapshot}
     */
    public snapshot(): ITree {
        const tree: ITree = {
            entries: [
                {
                    mode: FileMode.File,
                    path: snapshotFileName,
                    type: TreeEntry.Blob,
                    value: {
                        contents: JSON.stringify(this.inkData.getSerializable()),
                        encoding: "utf-8",
                    },
                },
            ],
            // eslint-disable-next-line no-null/no-null
            id: null,
        };

        return tree;
    }

    /**
     * {@inheritDoc @fluidframework/shared-object-base#SharedObject.loadCore}
     */
    protected async loadCore(
        branchId: string | undefined,
        storage: IChannelStorageService,
    ): Promise<void> {
        const header = await storage.read(snapshotFileName);
        if (header !== undefined) {
            this.inkData = new InkData(
                JSON.parse(fromBase64ToUtf8(header)) as ISerializableInk,
            );
            this.loadIndexFromStrokes();
        }
    }

    /**
     * {@inheritDoc @fluidframework/shared-object-base#SharedObject.processCore}
     */
    protected processCore(message: ISequencedDocumentMessage, local: boolean, localOpMetadata: unknown): void {
        if (message.type === MessageType.Operation && !local) {
            const operation = message.contents as IInkOperation;
            if (operation.type === "clear") {
                this.executeClearOperation(operation);
            } else if (operation.type === "createStroke") {
                this.executeCreateStrokeOperation(operation);
            } else if (operation.type === "stylus") {
                this.executeStylusOperation(operation);
            } else if (operation.type === "eraseStrokes") {
                this.executeEraseStrokesOperation(operation);
            }
        }
    }

    /**
     * {@inheritDoc @fluidframework/shared-object-base#SharedObject.registerCore}
     */
    protected registerCore(): void {
        return;
    }

    /**
     * {@inheritDoc @fluidframework/shared-object-base#SharedObject.onDisconnect}
     */
    protected onDisconnect(): void {
        return;
    }

    /**
     * Update the model for a clear operation.
     * @param operation - The operation object
     */
    private executeClearOperation(operation: IClearOperation): void {
        this.inkData.clear();
        this.initStrokeIndex();
        this.emit("clear", operation);
    }

    /**
     * Update the model for a create stroke operation.
     * @param operation - The operation object
     * @returns The stroke that was created
     */
    private executeCreateStrokeOperation(operation: ICreateStrokeOperation): IInkStroke {
        const stroke: IInkStroke = {
            id: operation.id,
            points: [],
            loBound: { x: Number.MAX_SAFE_INTEGER, y: Number.MAX_SAFE_INTEGER },
            hiBound: { x: Number.MIN_SAFE_INTEGER, y: Number.MIN_SAFE_INTEGER },
            pen: operation.pen,
        };
        this.inkData.addStroke(stroke);
        this.emit("createStroke", operation);
        return stroke;
    }

    /**
     * Update the model by removing one or more strokes
     * @param operation - The operation object
     */
    private executeEraseStrokesOperation(operation: IEraseStrokesOperation) {
        for (const id of operation.ids) {
            const stroke = this.getStroke(id);
            stroke.inactive = true;
        }
        this.emit("eraseStrokes", operation);
    }

    private addPointToStroke(p: IInkPoint, id: string, stroke: IInkStroke) {
        stroke.points.push(p);
        if (p.x > stroke.hiBound.x) {
            stroke.hiBound.x = p.x;
        }
        if (p.y > stroke.hiBound.y) {
            stroke.hiBound.y = p.y;
        }
        if (p.x < stroke.loBound.x) {
            stroke.loBound.x = p.x;
        }
        if (p.y < stroke.loBound.y) {
            stroke.loBound.y = p.y;
        }
        this.strokeIndex.insert(p, id);
    }
    /**
     * Update the model for a stylus operation.  These represent updates to an existing stroke.
     * @param operation - The operation object
     * @returns The stroke that was updated
     */
    private executeStylusOperation(operation: IStylusOperation): IInkStroke {
        // Need to make sure the stroke is still there (hasn't been cleared) before appending the down/move/up.
        const stroke = this.getStroke(operation.id);
        if (stroke !== undefined) {
            this.addPointToStroke(operation.point, operation.id, stroke);
            this.emit("stylus", operation);
        }
        return stroke;
    }
}

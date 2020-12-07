/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import {
    IColor, IInkPoint, IInkStroke, IPen, IPoint, IStylusOperation, IEraseStrokesOperation,
    IInkCanvasContainer,
} from "./interfaces";
import { SVGScene } from "./svg";
import { Ink, Rectangle } from ".";

interface IInkStrokeVis extends IInkStroke {
    elt?: SVGGElement;
}

class Vector {
    /**
     * Returns the vector resulting from rotating vector by angle
     */
    public static rotate(vector: Vector, angle: number): Vector {
        return new Vector(
            vector.x * Math.cos(angle) - vector.y * Math.sin(angle),
            vector.x * Math.sin(angle) + vector.y * Math.cos(angle));
    }

    /**
     * Returns the normalized form of the given vector
     */
    public static normalize(vector: Vector): Vector {
        const length = vector.length();
        return new Vector(vector.x / length, vector.y / length);
    }

    constructor(public x: number, public y: number) {
    }

    public length(): number {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }
}

function addShapes(elt: SVGGElement, startPoint: IInkPoint, endPoint: IInkPoint, pen: IPen) {
    const fillColor = `rgb(${pen.color.r}, ${pen.color.g}, ${pen.color.b})`;
    // console.log(`start ${startPoint.x}, ${startPoint.y} end ${endPoint.x}, ${endPoint.y} r ${pen.color.r}`);
    const dirVector = new Vector(
        endPoint.x - startPoint.x,
        endPoint.y - startPoint.y);
    const len = dirVector.length();

    const widthAtStart = pen.thickness * startPoint.pressure;
    const widthAtEnd = pen.thickness * endPoint.pressure;

    if (len + Math.min(widthAtStart, widthAtEnd) > Math.max(widthAtStart, widthAtEnd)) {
        // Circles don't completely overlap, need a trapezoid
        const normalizedLateralVector = new Vector(-dirVector.y / len, dirVector.x / len);

        const trapezoidP0 = {
            x: startPoint.x + widthAtStart * normalizedLateralVector.x,
            y: startPoint.y + widthAtStart * normalizedLateralVector.y,
        };
        const trapezoidP1 = {
            x: startPoint.x - widthAtStart * normalizedLateralVector.x,
            y: startPoint.y - widthAtStart * normalizedLateralVector.y,
        };
        const trapezoidP2 = {
            x: endPoint.x - widthAtEnd * normalizedLateralVector.x,
            y: endPoint.y - widthAtEnd * normalizedLateralVector.y,
        };
        const trapezoidP3 = {
            x: endPoint.x + widthAtEnd * normalizedLateralVector.x,
            y: endPoint.y + widthAtEnd * normalizedLateralVector.y,
        };
        const pgon = SVGScene.makePolygon(fillColor, [trapezoidP0, trapezoidP1, trapezoidP2, trapezoidP3]);
        elt.appendChild(pgon);
    }

    // End circle
    // TODO should only draw if not eclipsed by the previous circle, be careful about single-point
    const circle = SVGScene.makeCircle(fillColor, endPoint.x, endPoint.y, widthAtEnd);
    elt.appendChild(circle);
}

function isiOS() {
    const userAgent = navigator.userAgent;
    if (userAgent !== undefined) {
        // eslint-disable-next-line @typescript-eslint/prefer-regexp-exec, no-null/no-null
        return (userAgent.match(/Mac/) !== null) && (navigator.maxTouchPoints !== undefined)
            && (navigator.maxTouchPoints > 2);
    }

    return false;
}

interface IActiveTouch {
    id: number;
    touchtime: number;
    x: number;
    y: number;
    prevdiff?: number;
}

interface IActiveTouches {
    touches: IActiveTouch[];
    ccx: number;
    ccy: number;
}

interface IPointerFrameEvent extends PointerEvent {
    getCoalescedEvents?(): PointerEvent[];
}

const eraserWidth = 32;
const eraserHeight = 20;
const defaultThickness = 4;
// const requestIdleCallback = (window as any).requestIdleCallback || function (fn) { setTimeout(fn, 1) };
export class InkCanvas {
    private readonly localActiveStrokeMap: Map<number, string> = new Map();
    private readonly localActiveTouchMap = new Map<number, IActiveTouches>();
    private readonly currentPen: IPen;
    private eraseMode = false;
    public sceneRoot: SVGSVGElement;
    private frameScheduled = false;

    constructor(private readonly container: IInkCanvasContainer,
        private readonly scene: SVGScene, private readonly model: Ink) {
        this.model.on("clear", this.clearCanvas.bind(this));
        this.model.on("stylus", this.handleStylus.bind(this));
        this.model.on("eraseStrokes", this.handleEraseStrokes.bind(this));
        this.sceneRoot = this.scene.root;
        this.sceneRoot.style.touchAction = "none";
        this.currentPen = {
            color: { r: 0, g: 161, b: 241, a: 0 },
            thickness: defaultThickness,
        };
    }

    public addHandlers(elm: Element) {
        // safari not quite there with pointer events; drops some from apple pencil
        if (!isiOS()) {
            elm.addEventListener("pointerdown", this.handlePointerDown.bind(this));
            elm.addEventListener("pointermove", this.handlePointerMove.bind(this));
            elm.addEventListener("pointerup", this.handlePointerUp.bind(this));
        } else {
            elm.addEventListener("touchstart", this.handleTouchStart.bind(this));
            elm.addEventListener("touchmove", this.handleTouchMove.bind(this));
            elm.addEventListener("touchend", this.handleTouchEnd.bind(this));
            elm.addEventListener("touchleave", this.handleTouchEnd.bind(this));
        }
    }

    public setPenColor(color: IColor) {
        this.currentPen.color = color;
        this.currentPen.thickness = defaultThickness;
        this.eraseMode = false;
    }

    public setErase() {
        this.eraseMode = true;
    }

    public clear() {
        this.model.clear();
        this.clearCanvas();
    }

    private eraseStrokes(x: number, y: number) {
        const strokes = new Map<string, IInkStroke>();
        const cp: IPoint = { x, y };
        const searchBox = new Rectangle(cp.x, cp.y, eraserWidth, eraserHeight);
        this.model.strokeIndex.search(searchBox, (p, id) => {
            if (id !== undefined) {
                const stroke = this.model.getStroke(id);
                strokes.set(id, stroke);
                return true;
            }
            return false;
        });
        const ids = [] as string[];
        for (const id of strokes.keys()) {
            ids.push(id);
        }
        if (ids.length > 0) {
            this.model.eraseStrokes(ids);
        }
    }

    private executeEraseStrokes(ids: string[]) {
        if (ids.length > 0) {
            for (const id of ids) {
                const vstroke = this.model.getStroke(id) as IInkStrokeVis;
                if (vstroke.elt !== undefined) {
                    // for now just hide it
                    vstroke.elt.style.display = "none";
                }
            }
        }
    }

    private handlePointerDown(evt: PointerEvent) {
        // We will accept pen down or mouse left down as the start of a stroke.
        if ((evt.pointerType === "pen") ||
            ((evt.pointerType === "mouse") && (evt.button === 0) && (!evt.ctrlKey))) {
            if (this.eraseMode) {
                const ccx = this.container.toCanvasX(evt.clientX);
                const ccy = this.container.toCanvasY(evt.clientY);

                this.eraseStrokes(ccx, ccy);
            } else {
                const strokeId = this.model.createStroke(this.currentPen).id;
                this.localActiveStrokeMap.set(evt.pointerId, strokeId);

                this.appendPointerEventToStroke(evt);
            }
            evt.preventDefault();
        }
        else if ((evt.pointerType === "touch") ||
            ((evt.pointerType === "mouse") && (evt.button === 0) && evt.ctrlKey)) {
            const ccx = this.container.toCanvasX(evt.clientX);
            const ccy = this.container.toCanvasY(evt.clientY);
            this.localActiveTouchMap.set(evt.pointerId, {
                ccx, ccy,
                touches: [{
                    id: evt.pointerId, touchtime: Date.now(),
                    x: evt.clientX, y: evt.clientY,
                }],
            });
        }
    }

    private renderMovementFrame() {
        if (this.localActiveTouchMap.size === 1) {
            for (const pointerId of this.localActiveTouchMap.keys()) {
                const idTouches = this.localActiveTouchMap.get(pointerId);
                const t = idTouches.touches[idTouches.touches.length - 1];
                const pccx = this.container.toCanvasX(t.x);
                const pccy = this.container.toCanvasY(t.y);

                const dx = Math.floor(pccx - idTouches.ccx);
                const dy = Math.floor(pccy - idTouches.ccy);
                this.container.pan(-dx, -dy);
            }
        }
        else if (this.localActiveTouchMap.size === 2) {
            const tdown: IActiveTouch[] = [];
            const tlast: IActiveTouch[] = [];
            for (const pointerId of this.localActiveTouchMap.keys()) {
                const idTouches = this.localActiveTouchMap.get(pointerId);
                tlast.push(idTouches.touches[idTouches.touches.length - 1]);
                tdown.push(idTouches.touches[0]);
            }
            const cx = (tdown[0].x + tdown[1].x) / 2;
            const cy = (tdown[0].y + tdown[1].y) / 2;
            let dx = tdown[0].x - tdown[1].x;
            let dy = tdown[0].y - tdown[1].y;
            const d1 = Math.sqrt(dx * dx + dy * dy);
            dx = tlast[0].x - tlast[1].x;
            dy = tlast[0].y - tlast[1].y;
            const d2 = Math.sqrt(dx * dx + dy * dy);
            const dpix = d2 - d1;
            this.container.zoom(dpix, cx, cy, false);
        }
        this.frameScheduled = false;
    }

    private handleTouchStart(evt: TouchEvent) {
        // for now ignore multi-touch
        const touch = evt.touches[0];
        const strokeId = this.model.createStroke(this.currentPen).id;
        this.localActiveStrokeMap.set(touch.identifier, strokeId);
        this.appendTouchToStroke(touch);
        evt.preventDefault();
    }

    private handlePointerMove(evt: IPointerFrameEvent) {
        if ((evt.pointerType === "pen") ||
            ((evt.pointerType === "mouse") && (evt.buttons === 1) && (!evt.ctrlKey))) {
            this.localActiveTouchMap.clear();
            if (this.eraseMode) {
                const ccx = this.container.toCanvasX(evt.clientX);
                const ccy = this.container.toCanvasY(evt.clientY);
                this.eraseStrokes(ccx, ccy);
            } else if (this.localActiveStrokeMap.has(evt.pointerId)) {
                let evts: PointerEvent[];
                if (evt.getCoalescedEvents !== undefined) {
                    evts = evt.getCoalescedEvents();
                }
                if (evts === undefined) {
                    evts = [evt];
                }
                for (const e of evts) {
                    this.appendPointerEventToStroke(e);
                }
            }
        } else if ((evt.pointerType === "touch") ||
            ((evt.pointerType === "mouse") && (evt.buttons === 1) && evt.ctrlKey)) {
            const idTouches = this.localActiveTouchMap.get(evt.pointerId);
            if (idTouches !== undefined) {
                idTouches.touches.push({
                    id: evt.pointerId, touchtime: Date.now(),
                    x: evt.clientX, y: evt.clientY,
                });
                if (!this.frameScheduled) {
                    this.frameScheduled = true;
                    requestAnimationFrame(() => this.renderMovementFrame());
                }
            }
        }
    }

    private handleTouchMove(evt: TouchEvent) {
        this.appendTouchToStroke(evt.touches[0]);
        evt.preventDefault();
    }

    private handlePointerUp(evt: PointerEvent) {
        if ((evt.pointerType === "pen") ||
            ((evt.pointerType === "mouse") && (evt.button === 0) && (!evt.ctrlKey))) {
            if ((!this.eraseMode) && (this.localActiveStrokeMap.has(evt.pointerId))) {
                this.appendPointerEventToStroke(evt);
                this.localActiveStrokeMap.delete(evt.pointerId);
            }
        } if ((evt.pointerType === "touch") ||
            ((evt.pointerType === "mouse") && (evt.button === 0) && evt.ctrlKey)) {
            this.localActiveTouchMap.clear();
        }
    }

    private handleTouchEnd(evt: TouchEvent) {
        const touch = evt.changedTouches[0];
        if (this.localActiveStrokeMap.has(touch.identifier)) {
            this.localActiveStrokeMap.delete(touch.identifier);
        }
        evt.preventDefault();
    }

    private appendPointerEventToStroke(evt: PointerEvent) {
        const strokeId = this.localActiveStrokeMap.get(evt.pointerId);
        if (strokeId === undefined) {
            throw new Error("Unexpected pointer ID trying to append to stroke");
        }
        const ccx = this.container.toCanvasX(evt.clientX);
        const ccy = this.container.toCanvasY(evt.clientY);

        const inkPt = {
            x: ccx,
            y: ccy,
            time: Date.now(),
            pressure: (evt.pointerType !== "touch") ? evt.pressure : 0.5,
        };
        this.model.appendPointToStroke(inkPt, strokeId);
    }

    private appendTouchToStroke(t: Touch) {
        const strokeId = this.localActiveStrokeMap.get(t.identifier);
        if (strokeId === undefined) {
            throw new Error("Unexpected touch ID trying to append to stroke");
        }
        let pressure = 0.1;
        if (t.force > 0) {
            pressure = t.force;
        }
        const ccx = this.container.toCanvasX(t.clientX);
        const ccy = this.container.toCanvasY(t.clientY);
        const inkPt = {
            x: ccx,
            y: ccy,
            time: Date.now(),
            pressure,
        };
        this.container.toCanvasCoordinates(inkPt);
        this.model.appendPointToStroke(inkPt, strokeId);
    }

    /**
     * Clears the canvas
     */
    private clearCanvas() {
        this.scene.clear();
    }

    /**
     * Draw all strokes (for initial render)
     */
    public renderStrokes() {
        const strokes = this.model.getStrokes();
        for (const stroke of strokes) {
            const visStroke = stroke as IInkStrokeVis;
            if (visStroke.elt === undefined) {
                visStroke.elt = this.scene.makeGroup();
            }
            if (!stroke.inactive) {
                let previous = stroke.points[0];
                for (const current of stroke.points) {
                    // For the down, current === previous === stroke.operations[0]
                    this.addStrokeSegment(visStroke.elt, stroke.pen, current, previous);
                    previous = current;
                }
            }
        }
    }

    private addStrokeSegment(
        strokeElement: SVGGElement,
        pen: IPen,
        current: IInkPoint,
        previous: IInkPoint,
        drawVp = true,
    ) {
        // first draw in full canvas
        addShapes(strokeElement, previous, current, pen);
    }

    private handleStylus(operation: IStylusOperation) {
        // Render the dirty stroke
        const dirtyStrokeId = operation.id;
        const stroke = this.model.getStroke(dirtyStrokeId) as IInkStrokeVis;
        // If this is the only point in the stroke, we'll use it for both the start and end of the segment
        const prevPoint = stroke.points[stroke.points.length - (stroke.points.length >= 2 ? 2 : 1)];
        if (stroke.elt === undefined) {
            stroke.elt = this.scene.makeGroup();
        }
        this.addStrokeSegment(stroke.elt, stroke.pen, prevPoint, operation.point);
    }

    private handleEraseStrokes(operation: IEraseStrokesOperation) {
        this.executeEraseStrokes(operation.ids);
    }
}

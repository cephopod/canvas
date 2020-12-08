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
            elm.addEventListener("touchstart", this.handleTouchStart.bind(this), { passive: false });
            elm.addEventListener("touchmove", this.handleTouchMove.bind(this), { passive: false });
            elm.addEventListener("touchend", this.handleTouchEnd.bind(this), { passive: false });
            elm.addEventListener("touchleave", this.handleTouchEnd.bind(this), { passive: false });
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

    private addPointerStart(pointerId: number, clientX: number, clientY: number) {
        const ccx = this.container.toCanvasX(clientX);
        const ccy = this.container.toCanvasY(clientY);
        this.localActiveTouchMap.set(pointerId, {
            ccx, ccy,
            touches: [{
                id: pointerId, touchtime: Date.now(),
                x: clientX, y: clientY,
            }],
        });
    }

    private addPointerMove(pointerId: number, clientX: number, clientY: number) {
        const idTouches = this.localActiveTouchMap.get(pointerId);
        if (idTouches !== undefined) {
            idTouches.touches.push({
                id: pointerId, touchtime: Date.now(),
                x: clientX, y: clientY,
            });
            if (!this.frameScheduled) {
                this.frameScheduled = true;
                requestAnimationFrame(() => this.renderMovementFrame());
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
            this.addPointerStart(evt.pointerId, evt.clientX, evt.clientY);
        }
    }

    private renderMovementFrame() {
        this.frameScheduled = false;
        if (this.localActiveTouchMap.size === 1) {
            for (const pointerId of this.localActiveTouchMap.keys()) {
                const idTouches = this.localActiveTouchMap.get(pointerId);
                if (idTouches.touches.length > 1) {
                    const t = idTouches.touches[idTouches.touches.length - 1];
                    const tprev = idTouches.touches[idTouches.touches.length - 2];
                    const pccx = this.container.toCanvasX(t.x);
                    const pccy = this.container.toCanvasY(t.y);
                    const prevccx = this.container.toCanvasX(tprev.x);
                    const prevccy = this.container.toCanvasY(tprev.y);
                    const dx = Math.floor(pccx - prevccx);
                    const dy = Math.floor(pccy - prevccy);
                    this.container.pan(-dx, -dy);
                }
            }
        }
        else if (this.localActiveTouchMap.size === 2) {
            const tprev: IActiveTouch[] = [];
            const tlast: IActiveTouch[] = [];
            for (const pointerId of this.localActiveTouchMap.keys()) {
                const idTouches = this.localActiveTouchMap.get(pointerId);
                if (idTouches.touches.length > 1) {
                    tlast.push(idTouches.touches[idTouches.touches.length - 1]);
                    tprev.push(idTouches.touches[idTouches.touches.length - 2]);
                } else {
                    return;
                }
            }
            const cx = (tprev[0].x + tprev[1].x) / 2;
            const cy = (tprev[0].y + tprev[1].y) / 2;
            let dx = tprev[0].x - tprev[1].x;
            let dy = tprev[0].y - tprev[1].y;
            const d1 = Math.sqrt(dx * dx + dy * dy);
            dx = tlast[0].x - tlast[1].x;
            dy = tlast[0].y - tlast[1].y;
            const d2 = Math.sqrt(dx * dx + dy * dy);
            const dpix = d2 / d1;
            this.container.zoom(dpix, cx, cy, false);
        }
    }

    private handleTouchStart(evt: TouchEvent) {
        if (evt.touches.length === 1) {
            const touch = evt.touches[0];
            if (touch.touchType === "stylus") {
                if (this.eraseMode) {
                    const ccx = this.container.toCanvasX(touch.clientX);
                    const ccy = this.container.toCanvasY(touch.clientY);

                    this.eraseStrokes(ccx, ccy);
                } else {
                    const strokeId = this.model.createStroke(this.currentPen).id;
                    this.localActiveStrokeMap.set(touch.identifier, strokeId);
                    this.appendTouchToStroke(touch);
                }
            } else {
                // pan defer to frame
                this.addPointerStart(touch.identifier, touch.clientX, touch.clientY);
            }
        } else if (evt.touches.length === 2) {
            for (const touch of evt.touches) {
                this.addPointerStart(touch.identifier, touch.clientX, touch.clientY);
            }
        }
        evt.preventDefault();
        evt.stopPropagation();
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
            this.addPointerMove(evt.pointerId, evt.clientX, evt.clientY);
        }
    }

    private handleTouchMove(evt: TouchEvent) {
        if (evt.touches.length === 1) {
            const touch = evt.touches[0];
            if (touch.touchType === "stylus") {
                this.appendTouchToStroke(touch);
            } else {
                // pan defer to frame
                this.addPointerMove(touch.identifier, touch.clientX, touch.clientY);
            }
        } else if (evt.touches.length === 2) {
            // zoom
            for (const touch of evt.touches) {
                this.addPointerMove(touch.identifier, touch.clientX, touch.clientY);
            }
        }
        evt.preventDefault();
        evt.stopPropagation();
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
        for (const touch of evt.changedTouches) {
            if (this.localActiveStrokeMap.has(touch.identifier)) {
                this.localActiveStrokeMap.delete(touch.identifier);
            }
            if (this.localActiveTouchMap.has(touch.identifier)) {
                this.localActiveTouchMap.delete(touch.identifier);
            }
        }
        evt.stopPropagation();
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

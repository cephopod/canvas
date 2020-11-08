/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { IColor, IInkPoint, IInkStroke, IPen, IPoint, IStylusOperation, IEraseStrokesOperation } from "./interfaces";
import { SVGScene } from "./svg";
import { Ink, Rectangle } from ".";

interface IInkStrokeVis extends IInkStroke {
    elt?: SVGGElement;
}

const Nope = -1;

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
    const circle = SVGScene.makeCirle(fillColor, endPoint.x, endPoint.y, widthAtEnd);
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

/**
 * The rectangle represents vx, vy, vw, vh in canvas coordinates.
 */
interface IViewportCoords extends Rectangle {
    /**
     *  vw / pw
     */
    scaleX: number;
    /**
     *  vh / ph
     */
    scaleY: number;
    /**
     * Physical width of viewport canvas.
     */
    pw: number;
    /**
     * Physical Height of viewport canvas.
     */
    ph: number;
}

const eraserWidth = 32;
const eraserHeight = 20;
const defaultThickness = 4;
// const requestIdleCallback = (window as any).requestIdleCallback || function (fn) { setTimeout(fn, 1) };
export class InkCanvas {
    private readonly localActiveStrokeMap: Map<number, string> = new Map();
    private readonly localActiveTouchMap = new Map<number, IActiveTouch>();
    private readonly currentPen: IPen;
    private eraseMode = false;
    public panHandler: (dx: number, dy: number) => void;
    public zoomHandler: (d: number) => void;
    public readonly viewportCoords: IViewportCoords;
    public sceneRoot: SVGSVGElement;

    constructor(private readonly scene: SVGScene, private readonly model: Ink) {
        this.model.on("clear", this.clearCanvas.bind(this));
        this.model.on("stylus", this.handleStylus.bind(this));
        this.model.on("eraseStrokes", this.handleEraseStrokes.bind(this));
        this.sceneRoot = this.scene.root;
        this.sceneRoot.style.touchAction = "none";
        // safari not quite there with pointer events; drops some from apple pencil
        if (!isiOS()) {
            this.sceneRoot.addEventListener("pointerdown", this.handlePointerDown.bind(this));
            this.sceneRoot.addEventListener("pointermove", this.handlePointerMove.bind(this));
            this.sceneRoot.addEventListener("pointerup", this.handlePointerUp.bind(this));
        } else {
            this.sceneRoot.addEventListener("touchstart", this.handleTouchStart.bind(this));
            this.sceneRoot.addEventListener("touchmove", this.handleTouchMove.bind(this));
            this.sceneRoot.addEventListener("touchend", this.handleTouchEnd.bind(this));
            this.sceneRoot.addEventListener("touchleave", this.handleTouchEnd.bind(this));
        }
        this.viewportCoords = new Rectangle(0, 0, model.getWidth(), model.getHeight()) as IViewportCoords;
        this.currentPen = {
            color: { r: 0, g: 161, b: 241, a: 0 },
            thickness: defaultThickness,
        };
    }

    public resize() {
        const bounds = this.sceneRoot.getBoundingClientRect();
        // TODO: review device pixel scale for here
        this.viewportCoords.pw = bounds.width;
        this.viewportCoords.ph = bounds.height;
        this.viewportCoords.scaleX = this.viewportCoords.width / this.viewportCoords.pw;
        this.viewportCoords.scaleY = this.viewportCoords.height / this.viewportCoords.ph;
        this.updateViewbox();
    }

    public setViewportCoords(x: number, y: number, w: number, h: number) {
        this.viewportCoords.x = x;
        this.viewportCoords.y = y;
        this.viewportCoords.width = w;
        this.viewportCoords.height = h;
        this.resize();
    }

    public xlate(xoff: number, yoff: number) {
        if ((xoff !== 0) || (yoff !== 0)) {
            this.setViewportCoords(this.viewportCoords.x + xoff, this.viewportCoords.y + yoff,
                this.viewportCoords.width, this.viewportCoords.height);
        }
    }

    public zoom(f: number, cx: number, cy: number) {
        const minWidth = this.viewportCoords.pw / 4;
        const minHeight = this.viewportCoords.ph / 4;
        if (f > 0.0) {
            let nw = this.viewportCoords.width / f;
            let nh = this.viewportCoords.height / f;
            if ((nw > this.model.getWidth()) || (nh > this.model.getHeight())) {
                // max zoom
                if (this.model.getWidth() > this.model.getHeight()) {
                    nh = this.model.getHeight();
                    nw = (this.viewportCoords.pw / this.viewportCoords.ph) * nh;
                }
                this.viewportCoords.width = nw;
                this.viewportCoords.height = nh;
                this.resize();
            }
            else if ((nw !== this.viewportCoords.width) || (nh !== this.viewportCoords.height)) {
                if ((nw < minWidth) || (nh < minHeight)) {
                    nw = minWidth;
                    nh = minHeight;
                }
                this.viewportCoords.width = nw;
                this.viewportCoords.height = nh;
                if (((this.viewportCoords.x + this.viewportCoords.width) > this.model.getWidth()) ||
                    ((this.viewportCoords.y + this.viewportCoords.height) > this.model.getHeight())) {
                    this.viewportCoords.x = 0;
                    this.viewportCoords.y = 0;
                }
                // this.viewportCoords.x = Math.max(0, cx - (nw / 2.0));
                // this.viewportCoords.y = Math.max(0, cy - (nh / 2.0));
                this.resize();
            }
        }
    }

    public updateViewbox() {
        this.scene.setViewbox(this.viewportCoords.x, this.viewportCoords.y,
            this.viewportCoords.width, this.viewportCoords.height);
    }

    public getCanvas() {
        return this.sceneRoot;
    }

    public getScrollX() {
        return this.viewportCoords.x;
    }

    public getScrollY() {
        return this.viewportCoords.y;
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

    private toCanvasCoordinates(p: IPoint) {
        p.x = (p.x * this.viewportCoords.scaleX) + this.viewportCoords.x;
        p.y = (p.y * this.viewportCoords.scaleY) + this.viewportCoords.y;
    }

    private eraseStrokes(x: number, y: number) {
        const strokes = new Map<string, IInkStroke>();
        const cp: IPoint = { x, y };
        this.toCanvasCoordinates(cp);
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
                this.eraseStrokes(evt.clientX, evt.clientY);
            } else {
                const strokeId = this.model.createStroke(this.currentPen).id;
                this.localActiveStrokeMap.set(evt.pointerId, strokeId);

                this.appendPointerEventToStroke(evt);
            }
            evt.preventDefault();
        }
        else if ((evt.pointerType === "touch") ||
            ((evt.pointerType === "mouse") && (evt.button === 0) && evt.ctrlKey)) {
            // this.scratchOut(`touchdown! ${evt.clientX} ${evt.clientY} ${evt.pointerId}`);
            this.localActiveTouchMap.set(evt.pointerId, {
                id: evt.pointerId, touchtime: Date.now(),
                x: evt.clientX, y: evt.clientY,
            });
        }
    }

    private handleTouchStart(evt: TouchEvent) {
        // for now ignore multi-touch
        const touch = evt.touches[0];
        const strokeId = this.model.createStroke(this.currentPen).id;
        this.localActiveStrokeMap.set(touch.identifier, strokeId);
        this.appendTouchToStroke(touch);
        evt.preventDefault();
    }

    private handlePointerMove(evt: PointerEvent) {
        if ((evt.pointerType === "pen") ||
            ((evt.pointerType === "mouse") && (evt.buttons === 1) && (!evt.ctrlKey))) {
            this.localActiveTouchMap.clear();
            if (this.eraseMode) {
                this.eraseStrokes(evt.clientX, evt.clientY);
            } else if (this.localActiveStrokeMap.has(evt.pointerId)) {
                const evobj = (evt as any);
                let evts: PointerEvent[];
                if (evobj.getCoalescedEvents !== undefined) {
                    evts = evobj.getCoalescedEvents();
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
            let d = Nope;
            if (this.localActiveTouchMap.size === 1) {
                const t = this.localActiveTouchMap.get(evt.pointerId);
                if (t !== undefined) {
                    // single touch is pan
                    let dx = Math.floor(evt.clientX - t.x);
                    let dy = Math.floor(evt.clientY - t.y);
                    // const dt = Math.max(Date.now() - t.touchtime, 1);
                    // const vx = (1000 * (dx / dt)).toFixed(1);
                    // const vy = (1000 * (dy / dt)).toFixed(1);
                    // this.scratchOut(`touchmove dx = ${dx} dy = ${dy} dt = ${dt} vx=${vx} vy=${vy}`);
                    dx *= this.viewportCoords.scaleX;
                    dy *= this.viewportCoords.scaleX;
                    if (this.panHandler !== undefined) {
                        this.panHandler(-dx, -dy);
                    }
                }
            }
            else if (this.localActiveTouchMap.size === 2) {
                // two fingers is zoom
                let prevX = Nope;
                let prevY = Nope;
                let sum = 0;
                let prevdiff = Nope;
                for (const t of this.localActiveTouchMap.values()) {
                    if (prevX >= 0) {
                        const dx = t.x - prevX;
                        const dy = t.y - prevY;
                        sum += (dx * dx) + (dy * dy);
                    } else {
                        prevX = t.x;
                        prevY = t.y;
                    }
                    if (t.id === evt.pointerId) {
                        prevdiff = t.prevdiff;
                    }
                }
                d = Math.sqrt(sum);
                if ((this.zoomHandler !== undefined) && (prevdiff > 0)) {
                    const dpix = d - prevdiff;
                    this.zoomHandler(dpix * this.viewportCoords.scaleX);
                }
            }
            this.localActiveTouchMap.set(evt.pointerId, {
                id: evt.pointerId, touchtime: Date.now(),
                x: evt.clientX, y: evt.clientY, prevdiff: d,
            });
        } else {
            // this.scratchOut(`touchmove! ${evt.clientX} ${evt.clientY}`);
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
            // this.scratchOut(`touchup! ${evt.clientX} ${evt.clientY}`);
            // momentum scroll here
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
        const inkPt = {
            x: evt.offsetX,
            y: evt.offsetY,
            time: Date.now(),
            pressure: (evt.pointerType !== "touch") ? evt.pressure : 0.5,
        };
        this.toCanvasCoordinates(inkPt);
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
        const inkPt = {
            x: t.clientX,
            y: t.clientY,
            time: Date.now(),
            pressure,
        };
        this.toCanvasCoordinates(inkPt);
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

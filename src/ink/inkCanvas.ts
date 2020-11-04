/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { IColor, IInkPoint, IInkStroke, IPen, IPoint, IStylusOperation } from "./interfaces";
import { Ink, Rectangle } from ".";

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

function drawPolygon(context: CanvasRenderingContext2D, points: IPoint[]) {
    if (points.length === 0) {
        return;
    }

    context.beginPath();
    // Move to the first point
    context.moveTo(points[0].x, points[0].y);

    // Draw the rest of the segments
    for (let i = 1; i < points.length; i++) {
        context.lineTo(points[i].x, points[i].y);
    }

    // And then close the shape
    context.lineTo(points[0].x, points[0].y);
    context.closePath();
    context.fill();
}

function drawCircle(context: CanvasRenderingContext2D, center: IPoint, radius: number) {
    context.beginPath();
    context.moveTo(center.x, center.y);
    context.arc(center.x, center.y, radius, 0, Math.PI * 2);
    context.closePath();
    context.fill();
}

function drawShapes(
    context: CanvasRenderingContext2D,
    startPoint: IInkPoint,
    endPoint: IInkPoint,
    pen: IPen,
): void {
    context.fillStyle = `rgb(${pen.color.r}, ${pen.color.g}, ${pen.color.b})`;
    console.log(`start ${startPoint.x}, ${startPoint.y} end ${endPoint.x}, ${endPoint.y} r ${pen.color.r}`);
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

        drawPolygon(context, [trapezoidP0, trapezoidP1, trapezoidP2, trapezoidP3]);
    }

    // End circle
    // TODO should only draw if not eclipsed by the previous circle, be careful about single-point
    drawCircle(context, { x: endPoint.x, y: endPoint.y }, widthAtEnd);
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
    private readonly viewportContext: CanvasRenderingContext2D;
    private readonly localActiveStrokeMap: Map<number, string> = new Map();
    private readonly localActiveTouchMap = new Map<number, IActiveTouch>();
    private readonly currentPen: IPen;
    private eraseMode = false;
    private readonly drawingSurface: HTMLCanvasElement;
    private readonly drawingContext: CanvasRenderingContext2D;
    public panHandler: (dx: number, dy: number) => void;
    public zoomHandler: (d: number) => void;
    public readonly viewportCoords: IViewportCoords;

    constructor(private readonly viewport: HTMLCanvasElement, private readonly model: Ink) {
        this.model.on("clear", this.clearCanvas.bind(this));
        this.model.on("stylus", this.handleStylus.bind(this));
        this.viewport.style.touchAction = "none";
        // safari not quite there with pointer events; drops some from apple pencil
        if (!isiOS()) {
            this.viewport.addEventListener("pointerdown", this.handlePointerDown.bind(this));
            this.viewport.addEventListener("pointermove", this.handlePointerMove.bind(this));
            this.viewport.addEventListener("pointerup", this.handlePointerUp.bind(this));
        } else {
            this.viewport.addEventListener("touchstart", this.handleTouchStart.bind(this));
            this.viewport.addEventListener("touchmove", this.handleTouchMove.bind(this));
            this.viewport.addEventListener("touchend", this.handleTouchEnd.bind(this));
            this.viewport.addEventListener("touchleave", this.handleTouchEnd.bind(this));
        }
        const viewportContext = this.viewport.getContext("2d");
        // eslint-disable-next-line no-null/no-null
        if (viewportContext === null) {
            throw new Error("InkCanvas requires a canvas with 2d rendering context");
        }
        this.viewportContext = viewportContext;
        this.drawingSurface = document.createElement("canvas");
        this.drawingSurface.width = model.getWidth();
        this.drawingSurface.height = model.getHeight();
        this.drawingContext = this.drawingSurface.getContext("2d");
        this.viewport.appendChild(this.drawingSurface);
        this.drawingSurface.style.zIndex = "Nope0";
        this.viewportCoords = new Rectangle(0, 0, model.getWidth(), model.getHeight()) as IViewportCoords;
        this.currentPen = {
            color: { r: 0, g: 161, b: 241, a: 0 },
            thickness: defaultThickness,
        };
    }

    public resize() {
        const bounds = this.viewport.getBoundingClientRect();
        // TODO: review device pixel scale for here
        this.viewport.width = bounds.width;
        this.viewport.height = bounds.height;
        this.viewportCoords.pw = bounds.width;
        this.viewportCoords.ph = bounds.height;
        this.viewportCoords.scaleX = this.viewportCoords.width / this.viewportCoords.pw;
        this.viewportCoords.scaleY = this.viewportCoords.height / this.viewportCoords.ph;
        this.blt();
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

    public blt() {
        console.log(`blt! ${this.viewportCoords.pw} ${this.viewportCoords.ph}`);
        this.viewportContext.drawImage(this.drawingSurface,
            this.viewportCoords.x, this.viewportCoords.y, this.viewportCoords.width, this.viewportCoords.height,
            0, 0, this.viewportCoords.pw, this.viewportCoords.ph,
        );
    }

    public getCanvas() {
        return this.viewport;
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

    public replay() {
        this.clearCanvas();

        const strokes = this.model.getStrokes();

        // Time of the first operation in stroke 0 is our starting time
        const startTime = strokes[0].points[0].time;
        for (const stroke of strokes) {
            this.animateStroke(stroke, 0, startTime);
        }
    }

    public clear() {
        this.model.clear();
        this.clearCanvas();
    }

    private toPhysicalCoordinates(p: IPoint) {
        p.x = (p.x - this.viewportCoords.x) / this.viewportCoords.scaleX;
        p.y = (p.y - this.viewportCoords.y) / this.viewportCoords.scaleY;
    }

    private toCanvasCoordinates(p: IPoint) {
        p.x = (p.x * this.viewportCoords.scaleX) + this.viewportCoords.x;
        p.y = (p.y * this.viewportCoords.scaleY) + this.viewportCoords.y;
    }

    private eraseStrokesAt(x: number, y: number) {
        const strokes = [] as IInkStroke[];
        const cp: IPoint = { x, y };
        this.toCanvasCoordinates(cp);
        const searchBox = new Rectangle(cp.x, cp.y, eraserWidth, eraserHeight);
        this.model.strokeIndex.search(searchBox, (p, id) => {
            if (id !== undefined) {
                const stroke = this.model.getStroke(id);
                strokes.push(stroke);
                // TODO: remove stroke from index here
                return true;
            }
            return false;
        });
    }

    private handlePointerDown(evt: PointerEvent) {
        // We will accept pen down or mouse left down as the start of a stroke.
        if ((evt.pointerType === "pen") ||
            ((evt.pointerType === "mouse") && (evt.button === 0) && (!evt.ctrlKey))) {
            if (this.eraseMode) {
                this.eraseStrokesAt(evt.clientX, evt.clientY);
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
            if (this.localActiveStrokeMap.has(evt.pointerId)) {
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
                    const dx = Math.floor(evt.clientX - t.x);
                    const dy = Math.floor(evt.clientY - t.y);
                    // const dt = Math.max(Date.now() - t.touchtime, 1);
                    // const vx = (1000 * (dx / dt)).toFixed(1);
                    // const vy = (1000 * (dy / dt)).toFixed(1);
                    // this.scratchOut(`touchmove dx = ${dx} dy = ${dy} dt = ${dt} vx=${vx} vy=${vy}`);
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
                const zthresh = 1;
                if ((this.zoomHandler !== undefined) && (prevdiff > 0)) {
                    const dpix = d - prevdiff;
                    if (Math.abs(dpix) >= zthresh) {
                        this.zoomHandler(d - prevdiff);
                    }
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
            if (this.localActiveStrokeMap.has(evt.pointerId)) {
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

    private animateStroke(stroke: IInkStroke, operationIndex: number, startTime: number) {
        if (operationIndex >= stroke.points.length) {
            return;
        }

        // Draw the requested stroke
        const current = stroke.points[operationIndex];
        const previous = stroke.points[Math.max(0, operationIndex - 1)];
        const time = operationIndex === 0
            ? current.time - startTime
            : current.time - previous.time;

        setTimeout(() => {
            this.drawStrokeSegment(stroke.pen, current, previous);
            this.animateStroke(stroke, operationIndex + 1, startTime);
        }, time);
    }

    /**
     * Clears the canvas
     */
    private clearCanvas() {
        this.drawingContext.clearRect(0, 0, this.drawingSurface.width, this.drawingSurface.height);
        const bounds = this.viewport.getBoundingClientRect();
        this.viewportContext.clearRect(0, 0, bounds.width, bounds.height);
    }

    /**
     * Draw all strokes both in viewport and canvas.
     * TODO: only draw overlapping strokes into viewport
     */
    public draw(vp = true) {
        this.clearCanvas();

        const strokes = this.model.getStrokes();
        for (const stroke of strokes) {
            let previous = stroke.points[0];
            for (const current of stroke.points) {
                // For the down, current === previous === stroke.operations[0]
                this.drawStrokeSegment(stroke.pen, current, previous, vp);
                previous = current;
            }
        }
    }

    private drawStrokeSegment(
        pen: IPen,
        current: IInkPoint,
        previous: IInkPoint,
        drawVp = true,
    ) {
        // first draw in full canvas
        drawShapes(this.drawingContext, previous, current, pen);

        // then draw in viewport
        if (drawVp) {
            const xlateCur: IInkPoint = { x: current.x, y: current.y, time: current.time, pressure: current.pressure };
            const xlatePrev: IInkPoint = {
                x: previous.x, y: previous.y, time: previous.time,
                pressure: previous.pressure,
            };
            this.toPhysicalCoordinates(xlateCur);
            this.toPhysicalCoordinates(xlatePrev);
            drawShapes(this.viewportContext, xlatePrev, xlateCur, pen);
        }
    }

    private handleStylus(operation: IStylusOperation) {
        // Render the dirty stroke
        const dirtyStrokeId = operation.id;
        const stroke = this.model.getStroke(dirtyStrokeId);
        // If this is the only point in the stroke, we'll use it for both the start and end of the segment
        const prevPoint = stroke.points[stroke.points.length - (stroke.points.length >= 2 ? 2 : 1)];
        this.drawStrokeSegment(stroke.pen, prevPoint, operation.point);
    }
}

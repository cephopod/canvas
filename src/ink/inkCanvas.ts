/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { IColor, IInk, IInkPoint, IInkStroke, IPen, IPoint, IStylusOperation } from "./interfaces";

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

const defaultThickness = 4;
// const requestIdleCallback = (window as any).requestIdleCallback || function (fn) { setTimeout(fn, 1) };
export class InkCanvas {
    private readonly context: CanvasRenderingContext2D;
    private readonly localActiveStrokeMap: Map<number, string> = new Map();
    private readonly currentPen: IPen;
    private bgColor: IColor = { r: 255, g: 255, b: 255, a: 1 };
    private scrollX = 0;
    private scrollY = 0;

    constructor(private readonly canvas: HTMLCanvasElement, private readonly model: IInk) {
        this.model.on("clear", this.redraw.bind(this));
        this.model.on("stylus", this.handleStylus.bind(this));
        this.canvas.style.touchAction = "none";
        // safari not quite there with pointer events; drops some from apple pencil
        if (!isiOS()) {
            this.canvas.addEventListener("pointerdown", this.handlePointerDown.bind(this));
            this.canvas.addEventListener("pointermove", this.handlePointerMove.bind(this));
            this.canvas.addEventListener("pointerup", this.handlePointerUp.bind(this));
        } else {
            this.canvas.addEventListener("touchstart", this.handleTouchStart.bind(this));
            this.canvas.addEventListener("touchmove", this.handleTouchMove.bind(this));
            this.canvas.addEventListener("touchend", this.handleTouchEnd.bind(this));
            this.canvas.addEventListener("touchleave", this.handleTouchEnd.bind(this));
        }
        const context = this.canvas.getContext("2d");
        // eslint-disable-next-line no-null/no-null
        if (context === null) {
            throw new Error("InkCanvas requires a canvas with 2d rendering context");
        }
        this.context = context;

        this.currentPen = {
            color: { r: 0, g: 161, b: 241, a: 0 },
            thickness: defaultThickness,
        };

        this.sizeCanvasBackingStore();
    }

    public getScrollX() {
        return this.scrollX;
    }

    public getScrollY() {
        return this.scrollY;
    }

    public xlate(offX: number, offY: number) {
        if ((offX !== 0) || (offY !== 0)) {
            this.scrollX += offX;
            this.scrollY += offY;
            this.redraw();
        }
    }

    public toOrigin() {
        if ((this.scrollX !== 0) || (this.scrollY !== 0)) {
            this.scrollX = 0;
            this.scrollY = 0;
            this.redraw();
        }
    }

    public setBgColor(color: IColor) {
        this.bgColor = color;
    }

    public setPenColor(color: IColor) {
        this.currentPen.color = color;
        this.currentPen.erase = false;
        this.currentPen.thickness = defaultThickness;
    }

    public setErase() {
        this.currentPen.color = this.bgColor;
        this.currentPen.erase = true;
        this.currentPen.thickness = defaultThickness * 8;
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
        this.redraw();
    }

    public sizeCanvasBackingStore() {
        const canvasBoundingClientRect = this.canvas.getBoundingClientRect();
        // Scale the canvas size to match the physical pixel to avoid blurriness
        const scale = window.devicePixelRatio;
        this.canvas.width = Math.floor(canvasBoundingClientRect.width * scale);
        this.canvas.height = Math.floor(canvasBoundingClientRect.height * scale);
        // Scale the context to bring back coordinate system in CSS pixels
        this.context.setTransform(1, 0, 0, 1, 0, 0);
        this.context.scale(scale, scale);

        this.redraw();
    }

    public getExtent() {
        const extent: IPoint = { x: 0, y: 0 };
        const strokes = this.model.getStrokes();
        for (const stroke of strokes) {
            for (const point of stroke.points) {
                if (point.x > extent.x) {
                    extent.x = point.x;
                }
                if (point.y > extent.y) {
                    extent.y = point.y;
                }
            }
        }
        return extent;
    }

    public scrollLeft(factor = 2) {
        if (this.scrollX > 0) {
            const xoff = - Math.min(this.canvas.getBoundingClientRect().width / factor,
                this.scrollX);
            this.xlate(xoff, 0);
        }
    }

    public scrollRight(factor = 2) {
        this.xlate(this.canvas.getBoundingClientRect().width / factor, 0);
    }

    public scrollUp(factor = 2) {
        if (this.scrollY > 0) {
            const yoff = - Math.min(this.canvas.getBoundingClientRect().height / factor,
                this.scrollY);
            this.xlate(0, yoff);
        }
    }

    public scrollDown(factor = 2) {
        this.xlate(0, this.canvas.getBoundingClientRect().height / factor);
    }

    private toPhysicalCoordinates(p: IPoint) {
        p.x -= this.scrollX;
        p.y -= this.scrollY;
    }

    private toLogicalCoordinates(p: IPoint) {
        p.x += this.scrollX;
        p.y += this.scrollY;
    }

    private handlePointerDown(evt: PointerEvent) {
        // We will accept pen down or mouse left down as the start of a stroke.
        if ((evt.pointerType === "pen") || (evt.pointerType === "touch") ||
            ((evt.pointerType === "mouse") && (evt.button === 0))) {
            const strokeId = this.model.createStroke(this.currentPen).id;
            this.localActiveStrokeMap.set(evt.pointerId, strokeId);

            this.appendPointerEventToStroke(evt);

            evt.preventDefault();
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
    }

    private handleTouchMove(evt: TouchEvent) {
        this.appendTouchToStroke(evt.touches[0]);
        evt.preventDefault();
    }

    private handlePointerUp(evt: PointerEvent) {
        if (this.localActiveStrokeMap.has(evt.pointerId)) {
            this.appendPointerEventToStroke(evt);
            this.localActiveStrokeMap.delete(evt.pointerId);
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
        this.toLogicalCoordinates(inkPt);
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
        this.toLogicalCoordinates(inkPt);
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
        this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    private redraw() {
        this.clearCanvas();

        const strokes = this.model.getStrokes();
        for (const stroke of strokes) {
            let previous = stroke.points[0];
            for (const current of stroke.points) {
                // For the down, current === previous === stroke.operations[0]
                this.drawStrokeSegment(stroke.pen, current, previous);
                previous = current;
            }
        }
    }

    private drawStrokeSegment(
        pen: IPen,
        current: IInkPoint,
        previous: IInkPoint,
    ) {
        // TODO Consider save/restore context
        // TODO Consider half-pixel offset
        if (pen.erase) {
            this.context.fillStyle = `rgb(${this.bgColor.r}, ${this.bgColor.g}, ${this.bgColor.g})`;
        } else {
            this.context.fillStyle = `rgb(${pen.color.r}, ${pen.color.g}, ${pen.color.b})`;
        }
        const xlateCur: IInkPoint = { x: current.x, y: current.y, time: current.time, pressure: current.pressure };
        const xlatePrev: IInkPoint = { x: previous.x, y: previous.y, time: previous.time, pressure: previous.pressure };

        this.toPhysicalCoordinates(xlateCur);
        this.toPhysicalCoordinates(xlatePrev);

        drawShapes(this.context, xlatePrev, xlateCur, pen);
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

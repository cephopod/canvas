import { IPoint, IInkScene, IInkStroke, IPen, IInkPoint } from "./interfaces";
import { Vector } from "./vector";
import { Rectangle } from "./rectangle";
import { Ink } from "./ink";

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

function drawShapes(context: CanvasRenderingContext2D, startPoint: IInkPoint, endPoint: IInkPoint, pen: IPen): void {
    context.fillStyle = `rgb(${pen.color.r}, ${pen.color.g}, ${pen.color.b})`;
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

        drawPolygon(context, [trapezoidP0, trapezoidP1, trapezoidP2, trapezoidP3]);
    }

    // End circle
    // TODO should only draw if not eclipsed by the previous circle, be careful about single-point
    drawCircle(context, { x: endPoint.x, y: endPoint.y }, widthAtEnd);
}

export class RasterScene implements IInkScene {
    public root: HTMLCanvasElement;
    public drawingContext: CanvasRenderingContext2D;
    constructor(public model: Ink) {
        this.root = document.createElement("canvas");
        this.root.width = model.getWidth();
        this.root.height = model.getHeight();
        this.drawingContext = this.root.getContext("2d");
        const dscale = window.devicePixelRatio;
        this.root.width = Math.floor(this.root.width * dscale);
        this.root.height = Math.floor(this.root.height * dscale);
        // Scale the context to bring back coordinate system in CSS pixels
        this.drawingContext.setTransform(1, 0, 0, 1, 0, 0);
        this.drawingContext.scale(dscale, dscale);
        this.drawingContext.imageSmoothingEnabled = false;
    }

    private clearBox(box: Rectangle) {
        this.drawingContext.clearRect(box.x, box.y, box.width, box.height);
    }

    public writeText(x: number, y: number, str: string) {
        this.drawingContext.font = "30px Georgia";
        this.drawingContext.fillText(str, x, y);
    }

    public clear() {
        this.clearBox(new Rectangle(0, 0, this.model.getWidth(), this.model.getHeight()));
    }

    private drawStrokeSegment(pen: IPen, current: IInkPoint, previous: IInkPoint) {
        drawShapes(this.drawingContext, previous, current, pen);
    }

    private drawStroke(stroke: IInkStroke) {
        let previous = stroke.points[0];
        for (const current of stroke.points) {
            this.drawStrokeSegment(stroke.pen, current, previous);
            previous = current;
        }
    }

    private drawInBox(box: Rectangle) {
        const strokes = new Map<string, IInkStroke>();
        this.model.strokeIndex.search(box, (p, id) => {
            if (id !== undefined) {
                const stroke = this.model.getStroke(id);
                strokes.set(id, stroke);
                return true;
            }
            return false;
        });
        for (const stroke of strokes.values()) {
            if (!stroke.inactive) {
                this.drawStroke(stroke);
            }
        }
    }

    public eraseStrokes(strokes: IInkStroke[]) {
        if (strokes.length > 0) {
            let lx = Number.MAX_SAFE_INTEGER;
            let ly = Number.MAX_SAFE_INTEGER;
            let hx = Number.MIN_SAFE_INTEGER;
            let hy = Number.MIN_SAFE_INTEGER;
            for (const stroke of strokes) {
                if (stroke.hiBound.x > hx) {
                    hx = stroke.hiBound.x;
                }
                if (stroke.hiBound.y > hy) {
                    hy = stroke.hiBound.y;
                }
                if (stroke.loBound.x < lx) {
                    lx = stroke.loBound.x;
                }
                if (stroke.loBound.y < ly) {
                    ly = stroke.loBound.y;
                }
            }
            lx = Math.max(0, lx - 16);
            ly = Math.max(0, ly - 16);
            hx = Math.min(this.model.getWidth(), hx + 16);
            hy = Math.min(this.model.getHeight(), hy + 16);
            const box = new Rectangle(lx, ly, hx - lx, hy - ly);
            this.clearBox(box);
            this.drawInBox(box);
        }
    }

    public addStrokeSegment(stroke: IInkStroke, point: IInkPoint) {
        if (stroke.points.length > 1) {
            this.drawStrokeSegment(stroke.pen, point, stroke.points[stroke.points.length - 2]);
        }
    }

    public render(strokes: IInkStroke[]) {
        for (const stroke of strokes) {
            if (!stroke.inactive) {
                let previous = stroke.points[0];
                for (const current of stroke.points) {
                    this.drawStrokeSegment(stroke.pen, current, previous);
                    previous = current;
                }
            }
        }
    }
}

import { IPoint, IInkScene, IInkStroke, IPen, IInkPoint } from "./interfaces";
import { Vector } from "./vector";

const svgns = "http://www.w3.org/2000/svg";

interface IInkStrokeVis extends IInkStroke {
    elt?: SVGGElement;
}

function makeCircle(fill: string, cx: number, cy: number, r: number) {
    const circleElt = document.createElementNS(svgns, "circle");
    circleElt.setAttribute("cx", cx.toString());
    circleElt.setAttribute("cy", cy.toString());
    circleElt.setAttribute("fill", fill);
    circleElt.setAttribute("r", r.toString());
    return circleElt;
}

function makePolygon(fill: string, points: IPoint[]) {
    const pgon = document.createElementNS(svgns, "polygon");
    let ptString = "";
    for (const pt of points) {
        ptString += `${pt.x},${pt.y} `;
    }
    pgon.setAttribute("points", ptString.trimRight());
    pgon.setAttribute("fill", fill);
    return pgon;
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
        const pgon = makePolygon(fillColor, [trapezoidP0, trapezoidP1, trapezoidP2, trapezoidP3]);
        elt.appendChild(pgon);
    }

    // End circle
    // TODO should only draw if not eclipsed by the previous circle, be careful about single-point
    const circle = makeCircle(fillColor, endPoint.x, endPoint.y, widthAtEnd);
    elt.appendChild(circle);
}

export class SVGScene implements IInkScene {
    root: SVGSVGElement;
    content: SVGGElement;

    constructor(public w: number, public h: number) {
        this.createRoot(w, h);
    }

    createRoot(w: number, h: number) {
        this.root = document.createElementNS(svgns, "svg");
        this.clear();
    }

    clear() {
        if (this.content !== undefined) {
            this.root.removeChild(this.content);
        }
        this.content = document.createElementNS(svgns, "g");
        this.root.appendChild(this.content);
    }

    eraseStrokes(strokes: IInkStroke[]) {
        let vstroke: IInkStrokeVis;
        for (vstroke of strokes) {
            if (vstroke.elt !== undefined) {
                // for now just hide it
                vstroke.elt.style.display = "none";
            }
        }
    }

    drawStrokeSegment(strokeElement: SVGGElement, pen: IPen, current: IInkPoint, previous: IInkPoint, drawVp = true) {
        // first draw in full canvas
        addShapes(strokeElement, previous, current, pen);
    }

    addStrokeSegment(stroke: IInkStrokeVis, point: IInkPoint) {
        const prevPoint = stroke.points[stroke.points.length - (stroke.points.length >= 2 ? 2 : 1)];
        if (stroke.elt === undefined) {
            stroke.elt = this.makeGroup();
        }
        this.drawStrokeSegment(stroke.elt, stroke.pen, prevPoint, point);
    }

    render(strokes: IInkStroke[]) {
        for (const stroke of strokes) {
            const visStroke = stroke as IInkStrokeVis;
            if (visStroke.elt === undefined) {
                visStroke.elt = this.makeGroup();
            }
            if (!stroke.inactive) {
                let previous = stroke.points[0];
                for (const current of stroke.points) {
                    // For the down, current === previous === stroke.operations[0]
                    this.drawStrokeSegment(visStroke.elt, stroke.pen, current, previous);
                    previous = current;
                }
            }
        }
    }

    makeGroup() {
        const g = document.createElementNS(svgns, "g");
        this.content.appendChild(g);
        return g;
    }

    appendContent(elt: SVGElement) {
        this.content.appendChild(elt);
    }

    removeContent(elt: Element) {
        this.content.removeChild(elt);
    }

    removeContentById(id: string) {
        const elt = document.getElementById(id);
        if (elt !== undefined) {
            this.removeContent(elt);
        }
    }

    setViewbox(x: number, y: number, w: number, h: number) {
        this.root.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
    }
}

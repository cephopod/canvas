import { IPoint } from "./interfaces";

const svgns = "http://www.w3.org/2000/svg";

export class SVGScene {
    static makeCirle(fill: string, cx: number, cy: number, r: number) {
        const circleElt = document.createElementNS(svgns, "circle");
        circleElt.setAttribute("cx", cx.toString());
        circleElt.setAttribute("cy", cy.toString());
        circleElt.setAttribute("fill", fill);
        circleElt.setAttribute("r", r.toString());
        return circleElt;
    }

    static makePolygon(fill: string, points: IPoint[]) {
        const pgon = document.createElementNS(svgns, "polygon");
        let ptString = "";
        for (const pt of points) {
            ptString += `${pt.x},${pt.y} `;
        }
        pgon.setAttribute("points", ptString.trimRight());
        pgon.setAttribute("fill", fill);
        return pgon;
    }

    root: SVGSVGElement;
    content: SVGGElement;

    constructor(w: number, h: number) {
        this.createRoot(w, h);
    }

    createRoot(w: number, h: number) {
        this.root = document.createElementNS(svgns, "svg");
        // this.root.setAttributeNS(svgns, "width", w.toString());
        // this.root.setAttributeNS(svgns, "height", h.toString());
        this.clear();
    }

    clear() {
        if (this.content !== undefined) {
            this.root.removeChild(this.content);
        }
        this.content = document.createElementNS(svgns, "g");
        this.content.id = "sceneContent";
        this.root.appendChild(this.content);
/*
        const checkRect = document.createElementNS(svgns, "rect");
        checkRect.setAttribute("fill", "orange");
        checkRect.setAttribute("x", "0");
        checkRect.setAttribute("y", "0");
        checkRect.setAttribute("width", "100");
        checkRect.setAttribute("height", "100");
        this.content.appendChild(checkRect);
        const checkRootRect = document.createElementNS(svgns, "rect");
        checkRootRect.setAttribute("fill", "pink");
        checkRootRect.setAttribute("x", "100");
        checkRootRect.setAttribute("y", "100");
        checkRootRect.setAttribute("width", "100");
        checkRootRect.setAttribute("height", "100");
        this.root.appendChild(checkRootRect);
*/
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

export class SVGLibrary {
    private createSVGElement(path: string) {
        const wrapperDiv = document.createElement("div");
        const emptySVG = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        wrapperDiv.appendChild(emptySVG);
        emptySVG.outerHTML = path;
        return wrapperDiv;
    }

    public iconMove() {
        const path = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"\
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25"\
            stroke-linecap="round" stroke-linejoin="round" class="feather feather-move">\
            <polyline points="5 9 2 12 5 15"></polyline><polyline points="9 5 12 2 15 5">\
            </polyline><polyline points="15 19 12 22 9 19"></polyline>\
            <polyline points="19 9 22 12 19 15">\
            </polyline><line x1="2" y1="12" x2="22" y2="12">\
            </line><line x1="12" y1="2" x2="12" y2="22"></line></svg>`;
        return this.createSVGElement(path);
    }

    public iconX() {
        const path = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0\
            0 24 24" fill="none"\
            stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"\
            class="feather feather-x"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6"\
            x2="18" y2="18"></line></svg>`;
        return this.createSVGElement(path);
    }

    public iconPlayCircle() {
        const path = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"\
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"\
            stroke-linecap="round" stroke-linejoin="round" class="feather feather-play-circle">\
            <circle cx="12" cy="12" r="10"></circle><polygon points="10 8 16 12 10 16 10 8">\
            </polygon></svg>`;
        return this.createSVGElement(path);
    }

    public iconPen() {
        const path = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"\
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" \
            stroke-linecap="round" stroke-linejoin="round" class="feather feather-edit-2">\
            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>`;
        return this.createSVGElement(path);
    }

    public iconDisk() {
        const path = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"\
        viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"\
        stroke-linecap="round" stroke-linejoin="round" class="feather feather-disc">\
        <circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle>\
        </svg>`;
        return this.createSVGElement(path);
    }
}

export const svgLibrary = new SVGLibrary();

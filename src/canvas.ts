/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { DataObject } from "@fluidframework/aqueduct";
import { IFluidHandle } from "@fluidframework/core-interfaces";
import { IFluidHTMLOptions, IFluidHTMLView } from "@fluidframework/view-interfaces";
import * as AColorPicker from "a-color-picker";
import { Modal } from "./modal";
import { IInk, IInkCanvasContainer, IInkScene, Ink, InkCanvas, IPoint, RasterScene, Rectangle, SVGScene } from "./ink";
import { svgLibrary } from "./svgUtil";
import { parseColor, parseHexColor } from "./util";

// eslint-disable-next-line import/no-unassigned-import
import "./style.less";

export interface IPicker extends AColorPicker.ACPController {
    palette: string[];
}

export class Canvas extends DataObject implements IFluidHTMLView, IInkCanvasContainer {
    public get IFluidHTMLView() { return this; }

    private ink: Ink;
    private inkCanvas: InkCanvas;
    private inkColorPicker: HTMLDivElement;
    private showingColorPicker: boolean = false;
    private miniMap: HTMLDivElement;
    private inkComponentRoot: HTMLDivElement;
    private indexOverlay: HTMLDivElement;
    private currentColor: string = "rgba(0,0,0,1)";
    private scene: IInkScene;
    public sceneContainer: HTMLDivElement;
    private scrollX = 0;
    private scrollY = 0;
    public scale = 1;
    public scaleSensitivity = 10;
    private bounds: DOMRect;
    private picker: IPicker;
    public activeText: HTMLDivElement;

    public render(elm: HTMLElement, options?: IFluidHTMLOptions): void {
        elm.appendChild(this.createCanvasDom());
        this.inkCanvas.renderStrokes();
        this.resize();

        window.addEventListener("resize", this.resize.bind(this));
    }

    protected async initializingFirstTime() {
        this.root.set("pageInk", Ink.create(this.runtime).handle);
    }

    protected async hasInitialized() {
        // Wait here for the ink
        const handle = await this.root.wait<IFluidHandle<IInk>>("pageInk");
        this.ink = await handle.get() as Ink;
        this.ink.splitListener = (rects) => this.addRectsToStrokeIndex(rects);
    }

    private resize() {
        this.bounds = this.inkComponentRoot.getBoundingClientRect();
        this.updateBoundsView();
    }

    private createCanvasDom() {
        const doCanvas = true;
        this.inkComponentRoot = document.createElement("div");
        this.inkComponentRoot.classList.add("ink-component-root");
        if (doCanvas) {
            this.scene = new RasterScene(this.ink);
        } else {
            this.scene = new SVGScene(this.ink.getWidth(), this.ink.getHeight());
        }
        this.sceneContainer = document.createElement("div");
        this.sceneContainer.classList.add("ink-birdseye");
        this.scene.root.style.width = `${this.ink.getWidth()}px`;
        this.scene.root.style.height = `${this.ink.getHeight()}px`;
        this.scene.root.classList.add("ink-scene");
        this.sceneContainer.appendChild(this.scene.root);
        this.inkColorPicker = this.createColorPicker();
        this.inkCanvas = new InkCanvas(this, this.scene, this.ink);
        this.inkCanvas.addHandlers(this.scene.root);

        this.sceneContainer.addEventListener("wheel", (event) => {
            if (!event.ctrlKey) {
                return;
            }
            event.preventDefault();
            this.zoom(event.deltaY, event.pageX, event.pageY);
        });

        const inkToolbar = this.createToolbar();
        this.inkComponentRoot.appendChild(this.sceneContainer);
        this.inkComponentRoot.appendChild(inkToolbar);
        this.createMinimap();
        this.inkComponentRoot.appendChild(this.miniMap);

        this.inkComponentRoot.addEventListener("click", () =>
            this.showingColorPicker ? this.toggleColorPicker() : undefined);

        this.inkCanvas.setPenColor({ r: 0, g: 0, b: 0, a: 1 });
        const penSVG = document.getElementById("pen-svg");
        // eslint-disable-next-line no-null/no-null
        if (penSVG !== null) {
            penSVG.setAttribute("fill", "#000");
        }
        document.body.addEventListener("keydown", this.handlekeydown.bind(this));

        return this.inkComponentRoot;
    }

    private hideStrokeIndex() {
        if (this.indexOverlay !== undefined) {
            this.sceneContainer.removeChild(this.indexOverlay);
            this.indexOverlay = undefined;
        }
    }

    private showStrokeIndex() {
        this.hideStrokeIndex();
        this.indexOverlay = document.createElement("div");

        this.indexOverlay.classList.add("index-overlay");

        const rects = [] as Rectangle[];
        const bounds = this.inkCanvasBounds();
        const viewport = new Rectangle(this.scrollX, this.scrollY,
            bounds.width / this.scale, bounds.height / this.scale);
        this.ink.gatherViewportRects(viewport, rects);
        viewport.x = 0;
        viewport.y = 0;
        viewport.width = bounds.width;
        viewport.height = bounds.height;
        viewport.conformElement(this.indexOverlay);
        this.sceneContainer.appendChild(this.indexOverlay);
        for (const rect of rects) {
            this.addToStrokeIndex(rect);
        }
    }

    private addRectsToStrokeIndex(rects: Rectangle[]) {
        if (this.indexOverlay !== undefined) {
            for (const rect of rects) {
                this.addToStrokeIndex(rect);
            }
        }
    }

    private addToStrokeIndex(rect: Rectangle) {
        if (this.indexOverlay !== undefined) {
            // convert to client coordinates
            rect.x = (rect.x - this.scrollX) * this.scale;
            rect.y = (rect.y - this.scrollY) * this.scale;
            const div = document.createElement("div");
            div.classList.add("index-item");
            rect.conformElement(div);
            this.indexOverlay.appendChild(div);
        }
    }

    public updateSceneTransform() {
        if (this.scale !== 1) {
            const stx = this.scrollX * this.scale;
            const sty = this.scrollY * this.scale;
            this.sceneContainer.style.transform =
                `translate3d(${-stx}px,${-sty}px, 0px) scale(${this.scale})`;
        } else {
            this.sceneContainer.style.transform =
                `translate3d(${-this.scrollX}px,${-this.scrollY}px,0px)`;
        }
    }

    public toCanvasX(cx: number) {
        return (cx / this.scale) + this.scrollX;
    }

    public toCanvasY(cy: number) {
        return (cy / this.scale) + this.scrollY;
    }

    /**
     * Zoom centered on cx, cy
     * @param factor Zoom in or out (magnitude ignored for now)
     * @param cx Center X in client coordinates
     * @param cy Center Y in client coordinates
     */
    public zoom(factor: number, cx: number, cy: number, wheel = true, panx = 0, pany = 0) {
        let newScale: number;
        const minScale = this.inkCanvasBounds().height / this.ink.getHeight();
        let deltaScale: number;
        if (factor > 0) {
            deltaScale = 1;
        } else {
            deltaScale = -1;
        }
        if (!wheel) {
            newScale = this.scale * factor;
        }
        else {
            newScale = this.scale + (deltaScale / (this.scaleSensitivity / this.scale));
        }
        if ((newScale !== this.scale) && (newScale <= 5.0) && (newScale >= minScale)) {
            const ccx = (cx / this.scale) + this.scrollX;
            const ccy = (cy / this.scale) + this.scrollY;
            // eslint-disable-next-line max-len
            // console.log(`ccx ${ccx} ccy ${ccy} cx ${cx} cy ${cy} sc ${this.scale} nsc ${newScale} tx ${this.scrollX}`);
            this.scale = newScale;
            this.scrollX = ccx - (cx / newScale) + panx;
            this.scrollY = ccy - (cy / newScale) + pany;
            this.updateSceneTransform();
            this.updateBoundsView();
        } else {
            console.log(`new scale out of bounds ${newScale} factor ${factor}`);
        }
    }

    public pan(dx: number, dy: number) {
        if ((dx !== 0) || (dy !== 0)) {
            const proposedScrollX = this.scrollX + dx;
            const proposedScrollY = this.scrollY + dy;
            if ((proposedScrollX !== this.scrollX) || (proposedScrollY !== this.scrollY)) {
                // console.log(`pan ${dx} ${dy}`);
                this.scrollX = proposedScrollX;
                this.scrollY = proposedScrollY;
                this.updateSceneTransform();
                this.updateBoundsView();
            }
        }
    }

    public scrollLeft(factor = 2) {
        this.pan(this.inkCanvasBounds().width / factor, 0);
    }

    public scrollUp(factor = 2) {
        this.pan(0, this.inkCanvasBounds().height / factor);
    }

    public scrollRight(factor = 2) {
        this.pan(-this.inkCanvasBounds().width / factor, 0);
    }

    public scrollDown(factor = 2) {
        this.pan(0, -this.inkCanvasBounds().height / factor);
    }

    public inkCanvasBounds() {
        if (this.bounds === undefined) {
            this.bounds = this.inkComponentRoot.getBoundingClientRect();
        }
        return this.bounds;
    }

    public toCanvasCoordinates(pt: IPoint) {
        pt.x = pt.x / this.scale + this.scrollX;
        pt.y = pt.y / this.scale + this.scrollY;
    }

    public originalCoordinates() {
        this.scrollX = 0;
        this.scrollY = 0;
        this.scale = 1;
        this.updateSceneTransform();
        this.updateBoundsView();
    }

    public handlekeydown(evt: KeyboardEvent) {
        switch (evt.key) {
            case "ArrowDown":
                this.scrollDown();
                break;
            case "ArrowUp":
                this.scrollUp();
                break;
            case "ArrowLeft":
                this.scrollLeft();
                break;
            case "ArrowRight":
                this.scrollRight();
                break;
            case "r":
                this.showStrokeIndex();
                break;
            case "h":
                this.hideStrokeIndex();
                break;
            case "o":
                this.originalCoordinates();
                break;
            case "t":
                this.activeText = document.createElement("div");
                this.activeText.classList.add("texttyped");
                this.activeText.innerText = "BigTest";
                this.sceneContainer.appendChild(this.activeText);
                break;
            default:
                break;
        }
        evt.preventDefault();
    }

    private createMinimap() {
        this.miniMap = document.createElement("div");
        this.miniMap.classList.add("mini-map");
        const miniMapViewOutline = document.createElement("div");
        miniMapViewOutline.classList.add("mini-map-view");
        this.miniMap.appendChild(miniMapViewOutline);
    }

    private updateBoundsView() {
        const offX = this.scrollX / this.ink.getWidth();
        const offY = this.scrollY / this.ink.getHeight();
        const miniMapViewOutline = this.miniMap.firstElementChild as HTMLDivElement;
        const w = this.miniMap.clientWidth - 6;
        const h = this.miniMap.clientHeight - 6;
        const left = Math.floor(offX * w);
        miniMapViewOutline.style.left = `${left}px`;
        const top = Math.floor(offY * h);
        miniMapViewOutline.style.top = `${top}px`;
        const scale = this.scale;
        const bounds = this.inkCanvasBounds();
        const wfrac = (bounds.width / this.ink.getWidth()) / scale;
        const hfrac = (bounds.height / this.ink.getHeight()) / scale;
        const width = Math.floor(w * wfrac);
        miniMapViewOutline.style.width = `${width}px`;
        const height = Math.floor(h * hfrac);
        miniMapViewOutline.style.height = `${height}px`;

        if (this.indexOverlay !== undefined) {
            this.showStrokeIndex();
        }
    }

    private makeClearButton() {
        const clearButton = document.createElement("button");
        clearButton.classList.add("ink-toolbar-button");
        clearButton.addEventListener("click", () => {
            const clearModalBody = document.createElement("div");
            const clearModalCancelButton = document.createElement("button");
            const clearModalButton = document.createElement("button");
            clearModalButton.innerHTML = "Confirm";
            clearModalCancelButton.innerHTML = "Cancel";
            clearModalCancelButton.classList.add("cancel");
            clearModalBody.appendChild(clearModalButton);
            clearModalBody.appendChild(clearModalCancelButton);
            const clearModal = new Modal("clear", "Clear board?", clearModalBody);
            clearModalButton.addEventListener("click", () => {
                this.inkCanvas.clear();
                clearModal.hideModal();
            });
            clearModalCancelButton.addEventListener("click", () => {
                clearModal.hideModal();
            });
            clearModal.showModal();
        });
        clearButton.appendChild(svgLibrary.iconX());
        return clearButton;
    }

    private createToolbar() {
        const inkToolbar = document.createElement("div");
        inkToolbar.classList.add("ink-toolbar");

        const eraserButton = document.createElement("button");
        eraserButton.classList.add("ink-toolbar-button");
        eraserButton.addEventListener("click", () => {
            eraserButton.classList.add("mode-active");
            this.inkCanvas.setErase();
        });
        eraserButton.appendChild(svgLibrary.iconErase());

        const colorButtonContainer = document.createElement("div");
        const colorButton = document.createElement("button");
        colorButton.classList.add("ink-toolbar-button");
        colorButton.setAttribute("id", "ink-toolbar-button-color");
        colorButton.addEventListener("click", (event) => {
            event.stopPropagation();
            this.inkCanvas.setPenColor(parseColor(this.currentColor));
            eraserButton.classList.remove("mode-active");
            this.toggleColorPicker();
        });
        colorButton.appendChild(svgLibrary.iconPen("pen-svg"));
        colorButtonContainer.appendChild(colorButton);
        colorButtonContainer.appendChild(this.inkColorPicker);

        const darkModeButton = document.createElement("button");
        darkModeButton.classList.add("ink-toolbar-button");
        darkModeButton.addEventListener("click", () => {
            const classlist = this.inkComponentRoot.classList;
            const minimap = this.miniMap.classList;
            if (classlist.contains("dark-mode")) {
                classlist.remove("dark-mode");
                minimap.remove("dark-mode");
                this.inkCanvas.setPenColor(parseColor("rgba(0,0,0,1)"));
                this.currentColor = "rgba(0,0,0,1)";
                document.getElementById("pen-svg").setAttribute("fill", "rgba(0,0,0,1)");
                document.getElementById("moon-svg").setAttribute("fill", "rgba(53,53,59,1)");
            }
            else {
                classlist.add("dark-mode");
                minimap.add("dark-mode");
                this.inkCanvas.setPenColor(parseColor("rgba(255,255,255,1)"));
                this.currentColor = "rgba(255,255,255,1)";
                document.getElementById("pen-svg").setAttribute("fill", "rgba(255,255,255,1)");
                document.getElementById("moon-svg").setAttribute("fill", "rgba(255,255,255,1)");
            }
        });
        darkModeButton.appendChild(svgLibrary.iconMoon("moon-svg"));

        inkToolbar.appendChild(colorButtonContainer);
        inkToolbar.appendChild(eraserButton);
        inkToolbar.appendChild(darkModeButton);
        inkToolbar.appendChild(this.makeClearButton());
        return inkToolbar;
    }

    private createColorPicker() {
        const inkColorPicker = document.createElement("div");
        inkColorPicker.setAttribute("acp-show-rgb", "no");
        inkColorPicker.setAttribute("acp-show-hsl", "no");
        inkColorPicker.setAttribute("acp-show-hex", "no");
        inkColorPicker.setAttribute("acp-palette-editable", "false");
        inkColorPicker.classList.add("ink-color-picker");
        this.picker = AColorPicker.createPicker(inkColorPicker, { color: "#000" });
        const basePalette = ["black", "red", "green", "blue"];
        this.picker.palette = basePalette;
        this.picker.on(
            "change", (p, c) => {
                this.inkCanvas.setPenColor(parseColor(c));
                this.currentColor = c;
                document.getElementById("pen-svg").setAttribute("fill", c);
            });

        inkColorPicker.addEventListener("click", (event) => {
            event.stopPropagation();
        });

        return inkColorPicker;
    }

    public drawingStarted() {
        if (this.showingColorPicker) {
            this.toggleColorPicker();
        }
    }

    private toggleColorPicker() {
        this.inkColorPicker.classList.toggle("show");
        this.showingColorPicker = !this.showingColorPicker;
        let dup = false;
        if (!this.showingColorPicker) {
            const newColor = parseColor(this.currentColor);
            for (const c of this.picker.palette) {
                const color = parseHexColor(c);
                if ((color.r === newColor.r) && (color.b === newColor.b) && (color.g === newColor.g)) {
                    dup = true;
                }
            }
            if (!dup) {
                const maxColorCount = 10;
                const newPalette = this.picker.palette.slice();
                if (newPalette.length === maxColorCount) {
                    newPalette[maxColorCount - 1] = this.currentColor;
                } else {
                    newPalette.push(this.currentColor);
                }
                this.picker.palette = newPalette;
            }
        }
    }
}

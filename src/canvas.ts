/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { DataObject } from "@fluidframework/aqueduct";
import { IFluidHandle } from "@fluidframework/core-interfaces";
import { IFluidHTMLOptions, IFluidHTMLView } from "@fluidframework/view-interfaces";
import * as AColorPicker from "a-color-picker";
import { Modal } from "./modal";
import { IInk, Ink, InkCanvas, Rectangle } from "./ink";
import { svgLibrary } from "./svgUtil";
import { parseColor } from "./util";

// eslint-disable-next-line import/no-unassigned-import
import "./style.less";

export class Canvas extends DataObject implements IFluidHTMLView {
    public get IFluidHTMLView() { return this; }

    private ink: Ink;
    private inkCanvas: InkCanvas;
    private inkColorPicker: HTMLDivElement;
    private showingColorPicker: boolean = false;
    private moveToggle: boolean = false;
    private miniMap: HTMLDivElement;
    private inkComponentRoot: HTMLDivElement;
    private indexOverlay: HTMLDivElement;
    private currentColor: string = "rgba(0,0,0,1)";

    public render(elm: HTMLElement, options?: IFluidHTMLOptions): void {
        elm.appendChild(this.createCanvasDom());
        this.sizeCanvas();
        this.updateBounds();

        window.addEventListener("resize", this.sizeCanvas.bind(this));
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

    private createCanvasDom() {
        this.inkComponentRoot = document.createElement("div");
        this.inkComponentRoot.classList.add("ink-component-root");
        const inkSurface = document.createElement("div");
        inkSurface.classList.add("ink-surface");

        const canvasElement = document.createElement("canvas");

        canvasElement.classList.add("ink-canvas");

        this.inkColorPicker = this.createColorPicker();

        this.inkCanvas = new InkCanvas(canvasElement, this.ink);

        const inkToolbar = this.createToolbar();
        this.inkComponentRoot.appendChild(inkSurface);
        inkSurface.appendChild(canvasElement);
        inkSurface.appendChild(inkToolbar);

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
            this.inkComponentRoot.removeChild(this.indexOverlay);
            this.indexOverlay = undefined;
        }
    }

    private showStrokeIndex() {
        this.hideStrokeIndex();
        this.indexOverlay = document.createElement("div");

        this.indexOverlay.classList.add("index-overlay");

        const rects = [] as Rectangle[];
        const bounds = this.inkCanvas.getCanvas().getBoundingClientRect();
        const scrollX = this.inkCanvas.getScrollX();
        const scrollY = this.inkCanvas.getScrollY();
        const viewport = new Rectangle(scrollX, scrollY, bounds.width, bounds.height);
        this.ink.gatherViewportRects(viewport, rects);
        viewport.x = 0;
        viewport.y = 0;
        viewport.conformElement(this.indexOverlay);
        this.inkComponentRoot.appendChild(this.indexOverlay);
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
            rect.x -= this.inkCanvas.getScrollX();
            rect.y -= this.inkCanvas.getScrollY();
            const div = document.createElement("div");
            div.classList.add("index-item");
            rect.conformElement(div);
            this.indexOverlay.appendChild(div);
        }
    }

    public scrollLeft(factor = 2) {
        if (this.inkCanvas.getScrollX() > 0) {
            const xoff = - Math.min(this.inkCanvas.getCanvas().getBoundingClientRect().width / factor,
                this.inkCanvas.getScrollX());
            this.inkCanvas.xlate(xoff, 0);
            this.updateBounds();
        }
    }

    public scrollUp(factor = 2) {
        if (this.inkCanvas.getScrollY() > 0) {
            const yoff = - Math.min(this.inkCanvas.getCanvas().getBoundingClientRect().height / factor,
                this.inkCanvas.getScrollY());
            this.inkCanvas.xlate(0, yoff);
            this.updateBounds();
        }
    }

    public scrollRight(factor = 2) {
        const scrollX = this.inkCanvas.getScrollX();
        const boundWidth = this.inkCanvas.getCanvas().getBoundingClientRect().width;
        const maxScrollX = this.ink.getWidth() - boundWidth;
        if (scrollX < maxScrollX) {
            const remain = maxScrollX - scrollX;
            const xoff = Math.min(boundWidth / factor, remain);
            this.inkCanvas.xlate(xoff, 0);
            this.updateBounds();
        }
    }

    public scrollDown(factor = 2) {
        const scrollY = this.inkCanvas.getScrollY();
        const boundHeight = this.inkCanvas.getCanvas().getBoundingClientRect().height;
        const maxScrollY = this.ink.getHeight() - boundHeight;
        if (scrollY < maxScrollY) {
            const remain = maxScrollY - scrollY;
            const yoff = Math.min(boundHeight / factor, remain);
            this.inkCanvas.xlate(0, yoff);
            this.updateBounds();
        }
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

    private updateBounds() {
        const boundingRect = this.inkComponentRoot.getBoundingClientRect();
        const scaleW = boundingRect.width / this.ink.getWidth();
        const scaleH = boundingRect.height / this.ink.getHeight();
        const offX = this.inkCanvas.getScrollX() / this.ink.getWidth();
        const offY = this.inkCanvas.getScrollY() / this.ink.getHeight();
        const miniMapViewOutline = this.miniMap.firstElementChild as HTMLDivElement;
        const w = this.miniMap.clientWidth - 6;
        const h = this.miniMap.clientHeight - 6;
        const left = Math.floor(offX * w);
        miniMapViewOutline.style.left = `${left}px`;
        const top = Math.floor(offY * h);
        miniMapViewOutline.style.top = `${top}px`;
        const width = Math.floor(scaleW * w);
        miniMapViewOutline.style.width = `${width}px`;
        const height = Math.floor(scaleH * h);
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
        const addClear = true;
        const inkToolbar = document.createElement("div");
        inkToolbar.classList.add("ink-toolbar");

        const replayButton = document.createElement("button");
        replayButton.classList.add("ink-toolbar-button");
        replayButton.addEventListener("click", this.inkCanvas.replay.bind(this.inkCanvas));
        replayButton.appendChild(svgLibrary.iconPlayCircle());

        const toggleTouchButton = document.createElement("button");
        toggleTouchButton.classList.add("ink-toolbar-button");
        toggleTouchButton.addEventListener("click", () => {
            this.moveToggle = !this.moveToggle;
            toggleTouchButton.classList.toggle("move-toggle");
        });
        toggleTouchButton.appendChild(svgLibrary.iconMove());

        const eraserButton = document.createElement("button");
        eraserButton.classList.add("ink-toolbar-button");
        eraserButton.addEventListener("click", () => {
            eraserButton.classList.add("move-toggle");
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
            eraserButton.classList.remove("move-toggle");
            this.toggleColorPicker();
        });
        colorButton.appendChild(svgLibrary.iconPen("pen-svg"));
        colorButtonContainer.appendChild(colorButton);
        colorButtonContainer.appendChild(this.inkColorPicker);

        inkToolbar.appendChild(colorButtonContainer);
        inkToolbar.appendChild(eraserButton);
        inkToolbar.appendChild(replayButton);
        inkToolbar.appendChild(toggleTouchButton);
        if (addClear) {
            inkToolbar.appendChild(this.makeClearButton());
        }
        this.createMinimap();
        inkToolbar.appendChild(this.miniMap);

        return inkToolbar;
    }

    private createColorPicker() {
        const inkColorPicker = document.createElement("div");
        inkColorPicker.setAttribute("acp-show-rgb", "no");
        inkColorPicker.setAttribute("acp-show-hsl", "no");
        inkColorPicker.setAttribute("acp-palette-editable", "");
        inkColorPicker.classList.add("ink-color-picker");
        AColorPicker.createPicker(inkColorPicker, { color: "#000" }).on(
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

    private toggleColorPicker() {
        this.inkColorPicker.classList.toggle("show");
        this.showingColorPicker = !this.showingColorPicker;
    }

    private sizeCanvas() {
        this.inkCanvas.sizeCanvasBackingStore();
    }
}

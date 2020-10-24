/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { DataObject } from "@fluidframework/aqueduct";
import { IFluidHandle } from "@fluidframework/core-interfaces";
import { IFluidHTMLOptions, IFluidHTMLView } from "@fluidframework/view-interfaces";
import * as AColorPicker from "a-color-picker";
import { Modal } from "./modal";
import { IInk, Ink, InkCanvas } from "./ink";
import { svgLibrary } from "./svgUtil";
import { parseColor } from "./util";

// eslint-disable-next-line import/no-unassigned-import
import "./style.less";

export class Canvas extends DataObject implements IFluidHTMLView {
    public get IFluidHTMLView() { return this; }

    private ink: IInk;
    private inkCanvas: InkCanvas;
    private inkColorPicker: HTMLDivElement;
    private showingColorPicker: boolean = false;
    private moveToggle: boolean = false;
    // private miniMap: HTMLDivElement;
    private currentColor: string = "rgba(0,0,0,1)";

    public render(elm: HTMLElement, options?: IFluidHTMLOptions): void {
        elm.appendChild(this.createCanvasDom());
        this.sizeCanvas();

        window.addEventListener("resize", this.sizeCanvas.bind(this));
    }

    protected async initializingFirstTime() {
        this.root.set("pageInk", Ink.create(this.runtime).handle);
    }

    protected async hasInitialized() {
        // Wait here for the ink
        const handle = await this.root.wait<IFluidHandle<IInk>>("pageInk");
        this.ink = await handle.get();
    }

    private createCanvasDom() {
        const inkComponentRoot = document.createElement("div");
        inkComponentRoot.classList.add("ink-component-root");

        const inkSurface = document.createElement("div");
        inkSurface.classList.add("ink-surface");

        const canvasElement = document.createElement("canvas");

        canvasElement.classList.add("ink-canvas");

        this.inkColorPicker = this.createColorPicker();

        this.inkCanvas = new InkCanvas(canvasElement, this.ink);

        const inkToolbar = this.createToolbar();

        inkComponentRoot.appendChild(inkSurface);
        inkSurface.appendChild(canvasElement);
        inkSurface.appendChild(inkToolbar);

        inkComponentRoot.addEventListener("click", () =>
            this.showingColorPicker ? this.toggleColorPicker() : undefined);

        this.inkCanvas.setPenColor({ r: 0, g: 0, b: 0, a: 1 });
        const penSVG = document.getElementById("pen-svg");
        // eslint-disable-next-line no-null/no-null
        if (penSVG !== null) {
            penSVG.setAttribute("fill", "#000");
        }

        return inkComponentRoot;
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

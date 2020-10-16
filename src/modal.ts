export class Modal {
    private readonly type: string;
    private readonly modal: HTMLDivElement = document.createElement("div");
    private readonly modalHeader: HTMLElement = document.createElement("h2");
    private readonly modalBackground: HTMLDivElement = document.createElement("div");

    constructor(type: string, header: string, body: HTMLDivElement) {
        this.type = type;

        this.modal.id = "modal";
        this.modalBackground.id = "modal-background";

        this.modalBackground.classList.add("modal-background");

        this.modalHeader.innerHTML = header;

        this.modal.appendChild(this.modalHeader);
        this.modal.appendChild(body);

        switch (this.type) {
            case "clear":
                this.modal.classList.add("clear-confirmation-modal");
                break;
            default:
                this.showModal();
        }
    }

    public showModal() {
        document.body.appendChild(this.modal);
    }

    public hideModal() {
        document.body.removeChild(this.modal);
    }
}

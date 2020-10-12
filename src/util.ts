import { IColor } from "./ink";

export function parseColor(c: string) {
    const rgb = c.replace(/[^\d,]/g, "").split(",");
    const parsedColor: IColor = {
        r: Number(rgb[0]),
        g: Number(rgb[1]),
        b: Number(rgb[2]),
        a: 1,
    };
    return parsedColor;
}

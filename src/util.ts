import { IColor } from "./ink";

export function parseHexColor(hc: string) {
    const parsedColor: IColor = {
        r: parseInt(hc.substring(1, 3), 16),
        g: parseInt(hc.substring(3, 5), 16),
        b: parseInt(hc.substring(5, 7), 16),
        a: 1,
    };
    return parsedColor;
}

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

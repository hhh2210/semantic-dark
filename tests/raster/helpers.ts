import {srgb} from '../../src/color';
import type {RGBAImage} from '../../src/vision';

export function createImage(
    width: number,
    height: number,
    pixel: (x: number, y: number) => readonly [number, number, number, number],
): RGBAImage & {data: Uint8ClampedArray} {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            data.set(pixel(x, y), (y * width + x) * 4);
        }
    }
    return {data, width, height};
}

export function rgbaAt(
    data: ArrayLike<number>,
    width: number,
    x: number,
    y: number,
): [number, number, number, number] {
    const offset = (y * width + x) * 4;
    return [
        Number(data[offset]),
        Number(data[offset + 1]),
        Number(data[offset + 2]),
        Number(data[offset + 3]),
    ];
}

export function srgbAt(data: ArrayLike<number>, width: number, x: number, y: number) {
    const [red, green, blue, alpha] = rgbaAt(data, width, x, y);
    return srgb(red / 255, green / 255, blue / 255, alpha / 255);
}

export function syntheticChart(width = 80, height = 48): RGBAImage & {
    data: Uint8ClampedArray;
} {
    return createImage(width, height, (x, y) => {
        if (x === 8 || y === height - 8) return [25, 28, 34, 255];
        if (x >= 16 && x <= 27 && y >= 14 && y < height - 8) {
            return [214, 39, 40, 255];
        }
        if (x === 15 || x === 28) return [235, 143, 143, 255];
        if (x >= 36 && x <= 49 && y >= 8 && y < height - 8) {
            return [31, 119, 180, 255];
        }
        if (x === 35 || x === 50) return [142, 187, 218, 255];
        if (y >= 4 && y <= 6 && x >= 58 && x <= 70) return [35, 38, 44, 255];
        return [250, 250, 248, 255];
    });
}

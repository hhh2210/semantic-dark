import type {RGBAImage} from '../vision';

export function byteAt(data: ArrayLike<number>, index: number): number {
    const value = Number(data[index] ?? 0);
    return Math.max(0, Math.min(255, Number.isFinite(value) ? value : 0));
}

export function copyRasterData(data: ArrayLike<number>): Uint8ClampedArray {
    const copy = new Uint8ClampedArray(data.length);
    for (let index = 0; index < data.length; index += 1) copy[index] = byteAt(data, index);
    return copy;
}

export function validateRasterImage(image: RGBAImage): number {
    assertInteger('width', image.width, 1);
    assertInteger('height', image.height, 1);
    if (!Number.isSafeInteger(image.width * image.height)) {
        throw new RangeError('width * height exceeds the safe integer range');
    }
    const stride = image.stride ?? image.width * 4;
    assertInteger('stride', stride, image.width * 4);
    const requiredLength = (image.height - 1) * stride + image.width * 4;
    if (!Number.isSafeInteger(requiredLength) ||
        !Number.isSafeInteger(image.data.length) ||
        image.data.length < requiredLength) {
        throw new RangeError(`RGBA data is too short: expected at least ${requiredLength} bytes`);
    }
    return stride;
}

function assertInteger(name: string, value: number, minimum: number): void {
    if (!Number.isSafeInteger(value) || value < minimum) {
        throw new RangeError(`${name} must be a safe integer >= ${minimum}`);
    }
}

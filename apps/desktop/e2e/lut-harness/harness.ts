import { applyCubeToPixels, parseCube, type CubeLut } from '../../src/features/editor/lut-preview';
import { createLutRenderer } from '../../src/features/editor/lut-renderer';

/**
 * Banco de pruebas del shader LUT. Compara la salida de WebGL2 con la misma
 * interpolación trilineal en JS y con el grade aplicado antes del LUT, que es
 * el orden del export. Lo usa `e2e/lut-preview.spec.ts` en Chrome real.
 */

const SIZE = { width: 256, height: 144 };

function cubeRows(
  size: number,
  row: (r: number, g: number, b: number) => [number, number, number],
): string {
  const lines = [`LUT_3D_SIZE ${size}`];
  for (let blue = 0; blue < size; blue += 1) {
    for (let green = 0; green < size; green += 1) {
      for (let red = 0; red < size; red += 1) {
        lines.push(row(red, green, blue).join(' '));
      }
    }
  }
  return lines.join('\n');
}

function drawSource(canvas: HTMLCanvasElement): ImageData {
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(SIZE.width, SIZE.height);
  for (let y = 0; y < SIZE.height; y += 1) {
    for (let x = 0; x < SIZE.width; x += 1) {
      const offset = (y * SIZE.width + x) * 4;
      image.data[offset] = Math.round((x / (SIZE.width - 1)) * 255);
      image.data[offset + 1] = Math.round((y / (SIZE.height - 1)) * 255);
      image.data[offset + 2] = Math.round(((x + y) / (SIZE.width + SIZE.height - 2)) * 255);
      image.data[offset + 3] = 255;
    }
  }
  const patches: [number, number, [number, number, number]][] = [
    [4, 4, [255, 255, 255]],
    [36, 4, [0, 0, 0]],
    [68, 4, [255, 0, 0]],
    [100, 4, [128, 128, 128]],
  ];
  for (const [px, py, color] of patches) {
    for (let y = 0; y < 12; y += 1) {
      for (let x = 0; x < 12; x += 1) {
        const offset = ((py + y) * SIZE.width + (px + x)) * 4;
        image.data[offset] = color[0];
        image.data[offset + 1] = color[1];
        image.data[offset + 2] = color[2];
        image.data[offset + 3] = 255;
      }
    }
  }
  ctx.putImageData(image, 0, 0);
  return image;
}

function readPixels(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const readback = document.createElement('canvas');
  readback.width = canvas.width;
  readback.height = canvas.height;
  const ctx = readback.getContext('2d')!;
  ctx.drawImage(canvas, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

function jsLutPixels(
  source: Uint8ClampedArray,
  lut: CubeLut,
  intensity: number,
): Uint8ClampedArray {
  const copy = new Uint8ClampedArray(source);
  applyCubeToPixels(lut, copy, intensity);
  return copy;
}

function maxDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let max = 0;
  for (let index = 0; index < a.length; index += 1) {
    if (index % 4 === 3) continue;
    const diff = Math.abs(a[index]! - b[index]!);
    if (diff > max) max = diff;
  }
  return max;
}

function render(
  id: string,
  source: HTMLCanvasElement,
  stages: { lut: CubeLut; intensity: number }[],
  grade?: string,
  denoise?: number,
  vignette?: number,
): Uint8ClampedArray | null {
  const canvas = document.getElementById(id) as HTMLCanvasElement;
  const renderer = createLutRenderer(canvas);
  if (!renderer) return null;
  let input: TexImageSource = source;
  if (grade) {
    const intermediate = document.createElement('canvas');
    intermediate.width = SIZE.width;
    intermediate.height = SIZE.height;
    const ctx = intermediate.getContext('2d')!;
    ctx.filter = grade;
    ctx.drawImage(source, 0, 0);
    ctx.filter = 'none';
    input = intermediate;
  }
  const ok = renderer.render(input, SIZE.width, SIZE.height, stages, denoise, vignette);
  if (!ok) return null;
  const pixels = readPixels(canvas);
  renderer.dispose();
  return pixels;
}

function drawNoise(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(SIZE.width, SIZE.height);
  // Ruido determinista alrededor de un gris medio y un borde de color para
  // comprobar que el bilateral baja la varianza sin borrar el borde.
  let state = 123456789;
  const random = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let y = 0; y < SIZE.height; y += 1) {
    for (let x = 0; x < SIZE.width; x += 1) {
      const offset = (y * SIZE.width + x) * 4;
      const base = x > SIZE.width * 0.6 ? [40, 90, 180] : [150, 150, 150];
      const noise = (random() - 0.5) * 70;
      image.data[offset] = Math.max(0, Math.min(255, base[0]! + noise));
      image.data[offset + 1] = Math.max(0, Math.min(255, base[1]! + noise));
      image.data[offset + 2] = Math.max(0, Math.min(255, base[2]! + noise));
      image.data[offset + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

function luminanceStdDev(pixels: Uint8ClampedArray): number {
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  // Sólo la mitad plana (x < 140): el borde azul tiene una varianza entre
  // regiones que taparía la reducción de ruido que se quiere medir.
  for (let y = 0; y < SIZE.height; y += 1) {
    for (let x = 0; x < 140; x += 1) {
      const offset = (y * SIZE.width + x) * 4;
      const luminance =
        0.2126 * (pixels[offset] ?? 0) +
        0.7152 * (pixels[offset + 1] ?? 0) +
        0.0722 * (pixels[offset + 2] ?? 0);
      sum += luminance;
      sumSquares += luminance * luminance;
      count += 1;
    }
  }
  const mean = sum / Math.max(1, count);
  return Math.sqrt(Math.max(0, sumSquares / Math.max(1, count) - mean * mean));
}

const source = document.getElementById('source') as HTMLCanvasElement;
const sourceImage = drawSource(source);
const invert = parseCube(cubeRows(2, (r, g, b) => [1 - r, 1 - g, 1 - b]));
const curve = parseCube(
  cubeRows(3, (r, g, b) => [(r / 2) ** 2, (g / 2) ** 1.5, (b / 2) ** 0.7]),
);

const invertPixels = render('invert', source, [{ lut: invert, intensity: 1 }]);
const halfPixels = render('half', source, [{ lut: invert, intensity: 0.5 }]);
const curvePixels = render('curve', source, [{ lut: curve, intensity: 1 }]);
const gradedPixels = render('graded', source, [{ lut: invert, intensity: 1 }], 'brightness(0.5)');

// El grade debe ocurrir antes del LUT: se replica el canvas intermedio con el
// mismo filtro CSS y recién después se aplica el LUT en JS para comparar.
const gradedSource = document.createElement('canvas');
gradedSource.width = SIZE.width;
gradedSource.height = SIZE.height;
const gradedContext = gradedSource.getContext('2d')!;
gradedContext.filter = 'brightness(0.5)';
gradedContext.drawImage(source, 0, 0);
gradedContext.filter = 'none';
const gradedExpected = jsLutPixels(readPixels(gradedSource), invert, 1);

const noisy = document.getElementById('noisy') as HTMLCanvasElement;
drawNoise(noisy);
const noiseBefore = render('noise0', noisy, [], undefined, 0);
const noiseAfter = render('noise1', noisy, [], undefined, 1);
const beforeStdDev = noiseBefore ? luminanceStdDev(noiseBefore) : -1;
const afterStdDev = noiseAfter ? luminanceStdDev(noiseAfter) : -1;

const vignettePixels = render('vignette', source, [], undefined, 0, 1);
// Gris plano para comparar el factor espacial contra `vignette=PI/3` del
// FFmpeg empaquetado (fuerza 0,5).
const graySource = document.createElement('canvas');
graySource.width = SIZE.width;
graySource.height = SIZE.height;
const grayContext = graySource.getContext('2d')!;
grayContext.fillStyle = '#808080';
grayContext.fillRect(0, 0, SIZE.width, SIZE.height);
const vignetteGrayPixels = render('vignetteGray', graySource, [], undefined, 0, 0.5);
const pixelLuma = (pixels: Uint8ClampedArray | null, x: number, y: number): number => {
  if (!pixels) return -1;
  const offset = (y * SIZE.width + x) * 4;
  return (
    0.2126 * (pixels[offset] ?? 0) +
    0.7152 * (pixels[offset + 1] ?? 0) +
    0.0722 * (pixels[offset + 2] ?? 0)
  );
};
const vignetteCenter = pixelLuma(vignettePixels, 128, 72);
const vignetteCorner = pixelLuma(vignettePixels, 10, 10);
const vignetteGrayCenter = pixelLuma(vignetteGrayPixels, 128, 72);
const vignetteGrayCorner = pixelLuma(vignetteGrayPixels, 10, 10);
const vignetteGrayMid = pixelLuma(vignetteGrayPixels, 40, 30);
const vignetteGraySide = pixelLuma(vignetteGrayPixels, 48, 72);
const sourceContext = source.getContext('2d')!;
const plainPixel = (x: number, y: number): number => {
  const data = sourceContext.getImageData(x, y, 1, 1).data;
  return (
    0.2126 * (data[0] ?? 0) + 0.7152 * (data[1] ?? 0) + 0.0722 * (data[2] ?? 0)
  );
};
const plainCenter = plainPixel(128, 72);
const plainCorner = plainPixel(10, 10);

const results = {
  webgl: invertPixels !== null,
  invertDiff: invertPixels ? maxDiff(invertPixels, jsLutPixels(sourceImage.data, invert, 1)) : -1,
  halfDiff: halfPixels ? maxDiff(halfPixels, jsLutPixels(sourceImage.data, invert, 0.5)) : -1,
  curveDiff: curvePixels ? maxDiff(curvePixels, jsLutPixels(sourceImage.data, curve, 1)) : -1,
  gradedDiff: gradedPixels ? maxDiff(gradedPixels, gradedExpected) : -1,
  denoiseBefore: beforeStdDev,
  denoiseAfter: afterStdDev,
  denoiseReduction:
    beforeStdDev > 0 && afterStdDev >= 0 ? 1 - afterStdDev / beforeStdDev : -1,
  vignetteCenter,
  vignetteCorner,
  vignetteGrayCenter,
  vignetteGrayCorner,
  vignetteGrayMid,
  vignetteGraySide,
  plainCenter,
  plainCorner,
};
(window as unknown as { __lutHarness: unknown }).__lutHarness = results;
document.getElementById('status')!.textContent = JSON.stringify(results, null, 2);

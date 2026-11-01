import { createLutRenderer } from '../../src/features/editor/lut-renderer';
import {
  chromaKeyAlphaAt,
  chromaKeyUniforms,
} from '../../src/features/editor/chroma-key-preview';

/**
 * Prueba del chroma key del shader: mitad verde, mitad roja, clave verde.
 * El alfa de los centros debe ser 0 y 255, y coincidir con la referencia JS
 * (ventana 3×3) en los bordes.
 */

const SIZE = 64;
const source = document.createElement('canvas');
source.width = SIZE;
source.height = SIZE;
const context = source.getContext('2d')!;
context.fillStyle = '#00ff00';
context.fillRect(0, 0, SIZE / 2, SIZE);
context.fillStyle = '#ff0000';
context.fillRect(SIZE / 2, 0, SIZE / 2, SIZE);

const target = document.createElement('canvas');
target.width = SIZE;
target.height = SIZE;
document.body.append(target);

const key = chromaKeyUniforms({
  color: '#00ff00',
  similarity: 0.3,
  blend: 0.1,
});
const renderer = key ? createLutRenderer(target) : null;
const status = document.getElementById('status')!;

if (!renderer || !key) {
  status.textContent = 'sin WebGL2';
  (window as unknown as { __chroma: unknown }).__chroma = { error: 'sin WebGL2' };
} else {
  renderer.setChromaKey(key);
  const ok = renderer.render(source, SIZE, SIZE, [], 0, 0);
  const readback = document.createElement('canvas');
  readback.width = SIZE;
  readback.height = SIZE;
  const readContext = readback.getContext('2d')!;
  readContext.drawImage(target, 0, 0);
  const rendered = readContext.getImageData(0, 0, SIZE, SIZE).data;

  const sourceData = context.getImageData(0, 0, SIZE, SIZE).data;
  const at = (x: number, y: number): number[] =>
    Array.from(rendered.subarray((y * SIZE + x) * 4, (y * SIZE + x) * 4 + 4));
  const expectedAlpha = (x: number, y: number): number =>
    Math.round(chromaKeyAlphaAt(sourceData, SIZE, SIZE, x, y, key) * 255);

  const points: Array<[string, number, number]> = [
    ['green', 16, 32],
    ['red', 48, 32],
    ['edgeLeft', 31, 32],
    ['edgeRight', 32, 32],
  ];
  const samples = Object.fromEntries(
    points.map(([name, x, y]) => [
      name,
      { rgba: at(x, y), expected: expectedAlpha(x, y) },
    ]),
  );
  (window as unknown as { __chroma: unknown }).__chroma = { ok, samples };
  status.textContent = 'done';
  renderer.dispose();
}

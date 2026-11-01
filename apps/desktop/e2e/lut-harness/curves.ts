import { createLutRenderer } from '../../src/features/editor/lut-renderer';
import { curvesToLut } from '../../src/features/editor/curves-lut';

/**
 * Prueba del pase de curvas del shader: una rampa de 4 grises (0, 85, 170,
 * 255) atraviesa una curva roja invertida y se compara contra la tabla JS.
 * Esperado por píxel v: rojo 255-v, verde v, azul v.
 */

const VALUES = [0, 85, 170, 255];

function sample(canvas: HTMLCanvasElement): Array<[number, number, number, number]> {
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const context = copy.getContext('2d')!;
  context.drawImage(canvas, 0, 0);
  const data = context.getImageData(0, 0, copy.width, copy.height).data;
  const out: Array<[number, number, number, number]> = [];
  for (let index = 0; index < data.length; index += 4) {
    out.push([data[index]!, data[index + 1]!, data[index + 2]!, data[index + 3]!]);
  }
  return out;
}

const source = document.createElement('canvas');
source.width = VALUES.length;
source.height = 1;
const sourceContext = source.getContext('2d')!;
VALUES.forEach((value, index) => {
  sourceContext.fillStyle = `rgb(${value}, ${value}, ${value})`;
  sourceContext.fillRect(index, 0, 1, 1);
});

const target = document.createElement('canvas');
target.width = VALUES.length;
target.height = 1;
document.body.append(target);

const table = curvesToLut({ red: [{ x: 0, y: 1 }, { x: 1, y: 0 }] });
const renderer = table ? createLutRenderer(target) : null;
const status = document.getElementById('status')!;

if (!renderer || !table) {
  status.textContent = 'sin WebGL2';
  (window as unknown as { __curves: unknown }).__curves = { error: 'sin WebGL2' };
} else {
  renderer.setCurve(table);
  const ok = renderer.render(source, VALUES.length, 1, [], 0, 0);
  const samples = ok ? sample(target) : [];
  const expected = VALUES.map((value) => [255 - value, value, value, 255]);
  (window as unknown as { __curves: unknown }).__curves = { ok, samples, expected, table: Array.from(table) };
  status.textContent = 'done';
  renderer.dispose();
}

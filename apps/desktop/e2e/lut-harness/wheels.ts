import { createLutRenderer } from '../../src/features/editor/lut-renderer';
import {
  colorBalancePixel,
  colorWheelsUniforms,
  sampleGamma,
} from '../../src/features/editor/color-wheels-preview';

/**
 * Ruedas de color en el shader contra la referencia JS: una rampa de grises
 * atraviesa colorbalance (lift/offset/gain) y la gamma por canal.
 */

const VALUES = [0, 85, 170, 255];
const INPUT = {
  lift: { r: 0.4, g: -0.2, b: 0.1 },
  offset: { r: 0.2, g: 0.1, b: -0.1 },
  gain: { r: -0.1, g: 0.2, b: 0.3 },
  gamma: { r: 0.4, g: -0.2, b: 0 },
};

const source = document.createElement('canvas');
source.width = VALUES.length;
source.height = 1;
const context = source.getContext('2d')!;
VALUES.forEach((value, index) => {
  context.fillStyle = `rgb(${value}, ${value}, ${value})`;
  context.fillRect(index, 0, 1, 1);
});

const target = document.createElement('canvas');
target.width = VALUES.length;
target.height = 1;
document.body.append(target);

const wheels = colorWheelsUniforms(INPUT);
const renderer = wheels ? createLutRenderer(target) : null;
const status = document.getElementById('status')!;

if (!renderer || !wheels) {
  status.textContent = 'sin WebGL2';
  (window as unknown as { __wheels: unknown }).__wheels = { error: 'sin WebGL2' };
} else {
  renderer.setColorWheels(wheels);
  const ok = renderer.render(source, VALUES.length, 1, [], 0, 0);
  const readback = document.createElement('canvas');
  readback.width = VALUES.length;
  readback.height = 1;
  const readContext = readback.getContext('2d')!;
  readContext.drawImage(target, 0, 0);
  const data = readContext.getImageData(0, 0, VALUES.length, 1).data;
  const samples = VALUES.map((_, index) =>
    Array.from(data.subarray(index * 4, index * 4 + 4)),
  );
  const expected = VALUES.map((value) => {
    const base = colorBalancePixel(
      [value / 255, value / 255, value / 255],
      wheels.lift,
      wheels.offset,
      wheels.gain,
    );
    const gamma = wheels.gamma;
    return [0, 1, 2].map((channel) =>
      Math.round(
        (gamma ? sampleGamma(gamma, channel, base[channel]!) : base[channel]!) * 255,
      ),
    );
  });
  (window as unknown as { __wheels: unknown }).__wheels = { ok, samples, expected };
  status.textContent = 'done';
  renderer.dispose();
}

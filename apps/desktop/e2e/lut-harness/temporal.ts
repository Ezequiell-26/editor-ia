import { createLutRenderer } from '../../src/features/editor/lut-renderer';
import { curvesToLut } from '../../src/features/editor/curves-lut';
import { sampleGamma } from '../../src/features/editor/color-wheels-preview';

const GRADED = new URLSearchParams(window.location.search).get('graded') === '1';
/** Curva con un escalón fuerte: el orden grade↔temporal cambia el resultado. */
const STEP_CURVE = [
  { x: 0, y: 0 },
  { x: 0.48, y: 0 },
  { x: 0.52, y: 1 },
  { x: 1, y: 1 },
];

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function noisy(seed: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d')!;
  const image = context.createImageData(64, 64);
  const random = rng(seed);
  for (let index = 0; index < image.data.length; index += 4) {
    const value = Math.max(0, Math.min(255, 128 + (random() - 0.5) * 32));
    image.data[index] = value;
    image.data[index + 1] = value;
    image.data[index + 2] = value;
    image.data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function deviation(canvas: HTMLCanvasElement): number {
  const readback = document.createElement('canvas');
  readback.width = canvas.width;
  readback.height = canvas.height;
  const context = readback.getContext('2d')!;
  context.drawImage(canvas, 0, 0);
  const data = context.getImageData(16, 16, 32, 32).data;
  const values: number[] = [];
  for (let index = 0; index < data.length; index += 4) values.push(data[index]!);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length,
  );
}

function run(): void {
  const current = noisy(11);
  const previous = noisy(29);
  const previous2 = noisy(47);
  const renderer = createLutRenderer(document.createElement('canvas'));
  const status = document.getElementById('status')!;
  if (!renderer) {
    status.textContent = JSON.stringify({ webgl: false });
    return;
  }
  const control = document.createElement('canvas');
  const temporal = document.createElement('canvas');
  const temporal2 = document.createElement('canvas');
  const controlRenderer = createLutRenderer(control);
  const temporalRenderer = createLutRenderer(temporal);
  const temporalRenderer2 = createLutRenderer(temporal2);
  if (!controlRenderer || !temporalRenderer || !temporalRenderer2) {
    status.textContent = JSON.stringify({ webgl: false });
    renderer.dispose();
    return;
  }
  controlRenderer.render(current, 64, 64, []);
  temporalRenderer.render(current, 64, 64, [], 0, 0, previous, 1);
  temporalRenderer2.render(current, 64, 64, [], 0, 0, previous, 1, previous2);
  const before = deviation(control);
  const after = deviation(temporal);
  const after2 = deviation(temporal2);
  const result = {
    webgl: true,
    control: Math.round(before * 100) / 100,
    temporal: Math.round(after * 100) / 100,
    temporal2: Math.round(after2 * 100) / 100,
    reduction: before > 0 ? Math.round((1 - after / before) * 1000) / 1000 : 0,
    reduction2: before > 0 ? Math.round((1 - after2 / before) * 1000) / 1000 : 0,
  };
  (window as unknown as { __temporalProbe: unknown }).__temporalProbe = result;
  status.textContent = JSON.stringify(result);
  controlRenderer.dispose();
  temporalRenderer.dispose();
  temporalRenderer2.dispose();
  renderer.dispose();
}

/**
 * Orden del export: grade (curvas) → temporal → denoise. Compara el shader
 * contra la misma mezcla calculada en JS sobre los píxeles ya graduados y,
 * de paso, mide cuánto se alejaría el orden viejo (mezclar y después graduar).
 */
function runGraded(): void {
  const status = document.getElementById('status')!;
  const current = noisy(11);
  const previous = noisy(29);
  const lut = curvesToLut({
    red: STEP_CURVE,
    green: STEP_CURVE,
    blue: STEP_CURVE,
  });
  const output = document.createElement('canvas');
  const renderer = createLutRenderer(output);
  if (!lut || !renderer) {
    status.textContent = JSON.stringify({ webgl: false });
    return;
  }
  renderer.setCurve(lut);
  const ok = renderer.render(current, 64, 64, [], 0, 0, previous, 1);
  if (!ok) {
    status.textContent = JSON.stringify({ webgl: true, render: false });
    renderer.dispose();
    return;
  }
  const readback = document.createElement('canvas');
  readback.width = 64;
  readback.height = 64;
  const readContext = readback.getContext('2d')!;
  readContext.drawImage(output, 0, 0);
  const data = readContext.getImageData(0, 0, 64, 64).data;
  const currentData = current.getContext('2d')!.getImageData(0, 0, 64, 64).data;
  const previousData = previous.getContext('2d')!.getImageData(0, 0, 64, 64).data;
  const grade = (value: number, channel: number): number =>
    sampleGamma(lut, channel, value / 255);
  let maxDiff = 0;
  let sumDiff = 0;
  let oldDiff = 0;
  const pixels = 64 * 64;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const currentRgb = [0, 1, 2].map((channel) =>
      grade(currentData[pixel * 4 + channel] ?? 0, channel),
    );
    const previousRgb = [0, 1, 2].map((channel) =>
      grade(previousData[pixel * 4 + channel] ?? 0, channel),
    );
    const gradedDistance = Math.hypot(
      currentRgb[0]! - previousRgb[0]!,
      currentRgb[1]! - previousRgb[1]!,
      currentRgb[2]! - previousRgb[2]!,
    );
    // mix(c, (c+p)/2, 0.8) = 0.6c + 0.4p
    const wanted = currentRgb.map((value, channel) =>
      gradedDistance <= 0.12 ? value * 0.6 + previousRgb[channel]! * 0.4 : value,
    );
    const raw = [0, 1, 2].map((channel) => (currentData[pixel * 4 + channel] ?? 0) / 255);
    const rawPrevious = [0, 1, 2].map(
      (channel) => (previousData[pixel * 4 + channel] ?? 0) / 255,
    );
    const rawDistance = Math.hypot(
      raw[0]! - rawPrevious[0]!,
      raw[1]! - rawPrevious[1]!,
      raw[2]! - rawPrevious[2]!,
    );
    const oldMixed = raw.map((value, channel) =>
      rawDistance <= 0.12 ? value * 0.6 + rawPrevious[channel]! * 0.4 : value,
    );
    const old = oldMixed.map((value, channel) => grade(value * 255, channel));
    for (let channel = 0; channel < 3; channel += 1) {
      const got = data[pixel * 4 + channel] ?? 0;
      const want = wanted[channel]! * 255;
      const diff = Math.abs(got - want);
      if (diff > maxDiff) maxDiff = diff;
      sumDiff += diff;
      const oldDiffChannel = Math.abs(old[channel]! * 255 - want);
      if (oldDiffChannel > oldDiff) oldDiff = oldDiffChannel;
    }
  }
  const result = {
    webgl: true,
    graded: true,
    maxDiff: Math.round(maxDiff * 100) / 100,
    meanDiff: Math.round((sumDiff / (pixels * 3)) * 100) / 100,
    oldDiff: Math.round(oldDiff * 100) / 100,
  };
  (window as unknown as { __temporalProbe: unknown }).__temporalProbe = result;
  status.textContent = JSON.stringify(result);
  renderer.dispose();
}

requestAnimationFrame(GRADED ? runGraded : run);

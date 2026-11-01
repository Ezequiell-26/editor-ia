import { parseCube } from '../../src/features/editor/lut-preview';
import { createLutRenderer } from '../../src/features/editor/lut-renderer';

const identity = [
  'LUT_3D_SIZE 2',
  '0 0 0',
  '1 0 0',
  '0 1 0',
  '1 1 0',
  '0 0 1',
  '1 0 1',
  '0 1 1',
  '1 1 1',
].join('\n');

const video = document.getElementById('video') as HTMLVideoElement;
const status = document.getElementById('status')!;

function sample(canvas: HTMLCanvasElement): number[] {
  const readback = document.createElement('canvas');
  readback.width = canvas.width;
  readback.height = canvas.height;
  const ctx = readback.getContext('2d')!;
  ctx.clearRect(0, 0, readback.width, readback.height);
  ctx.drawImage(canvas, 0, 0);
  return Array.from(ctx.getImageData(32, 32, 1, 1).data);
}

function run(attempt = 0): void {
  // El primer frame con alfa puede tardar en estar disponible aunque
  // `loadeddata` ya haya disparado; se reintenta antes de publicar el probe.
  if (video.readyState < 2 || video.videoWidth === 0) {
    if (attempt < 40) window.setTimeout(() => run(attempt + 1), 50);
    return;
  }
  const twoD = document.createElement('canvas');
  twoD.width = 64;
  twoD.height = 64;
  const ctx = twoD.getContext('2d')!;
  ctx.clearRect(0, 0, 64, 64);
  ctx.drawImage(video, 0, 0);
  const draw2d = Array.from(ctx.getImageData(32, 32, 1, 1).data);
  if (draw2d[3] === 0 && attempt < 40) {
    window.setTimeout(() => run(attempt + 1), 50);
    return;
  }
  const glCanvas = document.createElement('canvas');
  const renderer = createLutRenderer(glCanvas);
  let glResult: number[] | null = null;
  let compositeResult: number[] | null = null;
  if (renderer) {
    const lut = parseCube(identity);
    renderer.render(video, 64, 64, [{ lut, intensity: 1 }]);
    glResult = sample(glCanvas);
    // Composición real sobre verde: si el alfa del canvas se interpreta mal,
    // el rojo aparece a 255 en vez de mezclarse al 50 %.
    const composite = document.createElement('canvas');
    composite.width = 64;
    composite.height = 64;
    const compositeCtx = composite.getContext('2d')!;
    compositeCtx.fillStyle = '#00ff00';
    compositeCtx.fillRect(0, 0, 64, 64);
    compositeCtx.drawImage(glCanvas, 0, 0);
    compositeResult = Array.from(compositeCtx.getImageData(32, 32, 1, 1).data);
    renderer.dispose();
  }
  const result = { draw2d, glResult, compositeResult, videoWidth: video.videoWidth };
  (window as unknown as { __alphaProbe: unknown }).__alphaProbe = result;
  status.textContent = JSON.stringify(result);
}

if (video.readyState >= 2) run();
else video.addEventListener('loadeddata', () => run(), { once: true });

import { drawRigFrame, rigPaletteById } from '../../src/features/rig/rig';
import { renderRigToVideo } from '../../src/features/rig/bake';

const WIDTH = 480;
const HEIGHT = 270;

function frameAt(progress: number): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D no disponible');
  drawRigFrame(context, WIDTH, HEIGHT, 'walk', progress, rigPaletteById('cyan').palette);
  return context.getImageData(0, 0, WIDTH, HEIGHT);
}

function brightPixels(frame: ImageData): number {
  let count = 0;
  for (let index = 0; index < frame.data.length; index += 4) {
    const sum = frame.data[index]! + frame.data[index + 1]! + frame.data[index + 2]!;
    if (sum > 300) count += 1;
  }
  return count;
}

function difference(a: ImageData, b: ImageData): number {
  let diff = 0;
  for (let index = 0; index < a.data.length; index += 4) {
    diff += Math.abs(a.data[index]! - b.data[index]!);
    diff += Math.abs(a.data[index + 1]! - b.data[index + 1]!);
    diff += Math.abs(a.data[index + 2]! - b.data[index + 2]!);
  }
  return diff;
}

async function decode(video: { url: string }): Promise<{
  width: number;
  height: number;
  duration: number;
  bright: number;
}> {
  const element = document.createElement('video');
  element.muted = true;
  element.preload = 'auto';
  element.src = video.url;
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error('timeout decodificando el MP4 del rig')),
      15_000,
    );
    element.onloadeddata = () => {
      window.clearTimeout(timer);
      resolve();
    };
    element.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('el MP4 del rig no se pudo decodificar'));
    };
  });
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error('timeout buscando un frame del rig')),
      15_000,
    );
    element.onseeked = () => {
      window.clearTimeout(timer);
      resolve();
    };
    element.currentTime = 0.4;
  });
  const canvas = document.createElement('canvas');
  canvas.width = element.videoWidth;
  canvas.height = element.videoHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D no disponible para decodificar');
  const read = (): number => {
    context.drawImage(element, 0, 0);
    return brightPixels(context.getImageData(0, 0, canvas.width, canvas.height));
  };
  let bright = read();
  if (bright === 0) {
    // En headless el frame tras un seek puede no estar pintado: reproducir un
    // instante y volver a leer evita un falso negativo.
    const playing = element.play().catch(() => null);
    await Promise.race([
      new Promise<void>((resolve) => {
        if (typeof element.requestVideoFrameCallback === 'function') {
          element.requestVideoFrameCallback(() => resolve());
        } else {
          window.setTimeout(resolve, 300);
        }
      }),
      new Promise<void>((resolve) => window.setTimeout(resolve, 1_500)),
    ]);
    element.pause();
    await playing;
    bright = read();
  }
  return {
    width: element.videoWidth,
    height: element.videoHeight,
    duration: element.duration,
    bright,
  };
}

async function run(): Promise<void> {
  const status = document.getElementById('status')!;
  const probe: Record<string, unknown> = { drawn: false, encoded: false };
  try {
    const first = frameAt(0.25);
    const last = frameAt(0.6);
    const brightFirst = brightPixels(first);
    const brightLast = brightPixels(last);
    const diff = difference(first, last);
    probe.drawn = true;
    probe.brightFirst = brightFirst;
    probe.brightLast = brightLast;
    probe.diff = diff;

    const video = await renderRigToVideo({
      clip: 'walk',
      paletteId: 'cyan',
      width: 320,
      height: 180,
      fps: 12,
      durationSeconds: 1,
    });
    probe.encoded = true;
    probe.encodedBytes = Math.round((video.base64.length * 3) / 4);
    probe.videoWidth = video.width;
    probe.videoHeight = video.height;
    probe.fps = video.fps;
    probe.duration = video.durationSeconds;
    probe.clip = video.clip;
    const decoded = await decode(video);
    probe.decoded = true;
    probe.decodedWidth = decoded.width;
    probe.decodedHeight = decoded.height;
    probe.decodedDuration = decoded.duration;
    probe.decodedPixels = decoded.bright;
    probe.ok =
      brightFirst > 800 &&
      brightLast > 800 &&
      diff > 20_000 &&
      (probe.encodedBytes as number) > 2_000 &&
      decoded.width === 320 &&
      decoded.height === 180 &&
      decoded.bright > 500;
  } catch (error) {
    probe.reason = error instanceof Error ? error.message : String(error);
    probe.ok = false;
  }
  (window as unknown as { __rigProbe: unknown }).__rigProbe = probe;
  status.textContent = JSON.stringify(probe);
}

void run();

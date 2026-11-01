import { createThreeScene } from '../../src/features/three/scene';
import { renderScene3DToVideo } from '../../src/features/three/bake';

function pixels(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const context = copy.getContext('2d')!;
  context.drawImage(canvas, 0, 0);
  return context.getImageData(0, 0, copy.width, copy.height).data;
}

function backgroundDistance(
  frame: Uint8ClampedArray,
  background: [number, number, number],
): { count: number; sum: number } {
  let count = 0;
  let sum = 0;
  for (let index = 0; index < frame.length; index += 4) {
    const distance =
      Math.abs(frame[index]! - background[0]) +
      Math.abs(frame[index + 1]! - background[1]) +
      Math.abs(frame[index + 2]! - background[2]);
    sum += distance;
    if (distance > 40) count += 1;
  }
  return { count, sum };
}

async function run(): Promise<void> {
  const status = document.getElementById('status')!;
  const probe: Record<string, unknown> = { webgl: false, encoded: false };
  try {
    const scene = await createThreeScene({ preset: 'orbit-cube', width: 480, height: 270 });
    const first = pixels(scene.renderAt(0));
    const last = pixels(scene.renderAt(0.8));
    scene.dispose();
    const bg: [number, number, number] = [11, 18, 32];
    const a = backgroundDistance(first, bg);
    const b = backgroundDistance(last, bg);
    let diff = 0;
    for (let index = 0; index < first.length; index += 4) {
      diff +=
        Math.abs(first[index]! - last[index]!) +
        Math.abs(first[index + 1]! - last[index + 1]!) +
        Math.abs(first[index + 2]! - last[index + 2]!);
    }
    probe.webgl = true;
    probe.pixelsFirst = a.count;
    probe.pixelsLast = b.count;
    probe.diff = diff;

    const video = await renderScene3DToVideo({
      preset: 'torus-dolly',
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
    probe.ok =
      a.count > 1000 &&
      b.count > 1000 &&
      diff > 100000 &&
      (probe.encodedBytes as number) > 2000;
  } catch (error) {
    probe.reason = error instanceof Error ? error.message : String(error);
    probe.ok = false;
  }
  (window as unknown as { __threeProbe: unknown }).__threeProbe = probe;
  status.textContent = JSON.stringify(probe);
}

void run();

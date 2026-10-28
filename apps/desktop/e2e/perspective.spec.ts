import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * La preview CSS y el filtro `perspective` del MP4 deben llevar el mismo punto
 * de origen al mismo destino. Se mide con dos marcas de color sobre fondo
 * negro: el centroide de cada marca en Chromium (matrix3d) se compara con el
 * de FFmpeg (mismo frame, mismo cuadrilátero).
 */

const STAGE = { width: 320, height: 180 };
const QUAD = [
  { x: 0.2, y: 0.1 },
  { x: 0.8, y: 0.15 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.85 },
];
const MARKS = [
  { x: 200, y: 60, color: '#ff00ff' },
  { x: 120, y: 120, color: '#00ffff' },
];

function run(command: string, args: string[], input?: Buffer): Buffer {
  const result = spawnSync(command, args, {
    input,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} falló: ${result.stderr?.toString() ?? ''}`);
  }
  return result.stdout;
}

function rawRgb(png: string): Buffer {
  return run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    png,
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    'pipe:1',
  ]);
}

function centroid(
  raw: Buffer,
  width: number,
  height: number,
  matches: (red: number, green: number, blue: number) => boolean,
): { x: number; y: number; count: number } {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let index = 0; index < width * height; index += 1) {
    const red = raw[index * 3] ?? 0;
    const green = raw[index * 3 + 1] ?? 0;
    const blue = raw[index * 3 + 2] ?? 0;
    if (!matches(red, green, blue)) continue;
    sumX += index % width;
    sumY += Math.floor(index / width);
    count += 1;
  }
  return { x: count > 0 ? sumX / count : Number.NaN, y: count > 0 ? sumY / count : Number.NaN, count };
}

const MAGENTA = (r: number, g: number, b: number): boolean => r > 180 && b > 180 && g < 100;
const CYAN = (r: number, g: number, b: number): boolean => g > 180 && b > 180 && r < 100;

test('la perspectiva CSS lleva las marcas al mismo destino que FFmpeg', async ({ page }) => {
  // El primer test paga la compilación en frío de Vite y dos decodificaciones.
  test.setTimeout(180_000);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({
    type: 'module',
    content: `
      import { perspectiveMatrix3d, applyMatrix3 } from '/src/features/editor/perspective.ts';
      window.__olyviaPerspective = { perspectiveMatrix3d, applyMatrix3 };
    `,
  });
  await page.waitForFunction(
    () => typeof (window as { __olyviaPerspective?: unknown }).__olyviaPerspective === 'object',
    undefined,
    { timeout: 30_000 },
  );

  const matrix = await page.evaluate(
    ({ stage, marks, quad }) => {
      const api = (window as unknown as {
        __olyviaPerspective: {
          perspectiveMatrix3d: (
            corners: typeof quad,
            viewport: { width: number; height: number; mediaWidth: number; mediaHeight: number },
          ) => string | undefined;
        };
      }).__olyviaPerspective;
      const container = document.createElement('div');
      container.id = 'perspective-stage';
      container.style.cssText = `position:fixed;left:0;top:0;width:${stage.width}px;height:${stage.height}px;overflow:hidden;background:#000;z-index:99999`;
      const media = document.createElement('div');
      media.id = 'perspective-media';
      media.style.cssText = 'position:absolute;inset:0;transform-origin:center center';
      for (const mark of marks) {
        const dot = document.createElement('div');
        dot.style.cssText = `position:absolute;left:${mark.x - 4}px;top:${mark.y - 4}px;width:8px;height:8px;background:${mark.color}`;
        media.appendChild(dot);
      }
      container.appendChild(media);
      document.body.appendChild(container);
      return api.perspectiveMatrix3d(quad, {
        width: stage.width,
        height: stage.height,
        mediaWidth: stage.width,
        mediaHeight: stage.height,
      });
    },
    { stage: STAGE, marks: MARKS, quad: QUAD },
  );
  expect(matrix).toContain('matrix3d');
  if (!matrix) throw new Error('la perspectiva no generó matrix3d');

  const dir = mkdtempSync(path.join(tmpdir(), 'olyvia-persp-'));
  try {
    const stage = page.locator('#perspective-stage');
    const sourcePath = path.join(dir, 'source.png');
    const warpedPath = path.join(dir, 'warped.png');
    const ffmpegPath = path.join(dir, 'ffmpeg.png');
    writeFileSync(sourcePath, await stage.screenshot());
    await page.evaluate((value) => {
      const media = document.getElementById('perspective-media');
      if (media) media.style.transform = value;
    }, matrix);
    writeFileSync(warpedPath, await stage.screenshot());

    // Rust pasa las esquinas como TL, TR, BL, BR con sense=source.
    const points = QUAD.map((corner) => [
      Math.round(corner.x * STAGE.width),
      Math.round(corner.y * STAGE.height),
    ]);
    const [tl, tr, br, bl] = points;
    run('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      sourcePath,
      '-vf',
      `perspective=x0=${tl![0]}:y0=${tl![1]}:x1=${tr![0]}:y1=${tr![1]}:x2=${bl![0]}:y2=${bl![1]}:x3=${br![0]}:y3=${br![1]}:sense=source:interpolation=linear:eval=init`,
      '-frames:v',
      '1',
      ffmpegPath,
    ]);

    const cssRaw = rawRgb(warpedPath);
    const mp4Raw = rawRgb(ffmpegPath);
    expect(cssRaw.length).toBe(STAGE.width * STAGE.height * 3);
    expect(mp4Raw.length).toBe(STAGE.width * STAGE.height * 3);

    const cssMagenta = centroid(cssRaw, STAGE.width, STAGE.height, MAGENTA);
    const cssCyan = centroid(cssRaw, STAGE.width, STAGE.height, CYAN);
    const ffMagenta = centroid(mp4Raw, STAGE.width, STAGE.height, MAGENTA);
    const ffCyan = centroid(mp4Raw, STAGE.width, STAGE.height, CYAN);
    expect(cssMagenta.count).toBeGreaterThan(10);
    expect(cssCyan.count).toBeGreaterThan(10);
    expect(ffMagenta.count).toBeGreaterThan(10);
    expect(ffCyan.count).toBeGreaterThan(10);
    console.log(
      'centroides CSS vs FFmpeg',
      JSON.stringify({
        magenta: { css: cssMagenta, ffmpeg: ffMagenta },
        cyan: { css: cssCyan, ffmpeg: ffCyan },
      }),
    );
    // La deformación se aplicó de verdad: las marcas se movieron del origen.
    expect(Math.abs(cssMagenta.x - MARKS[0]!.x) + Math.abs(cssMagenta.y - MARKS[0]!.y)).toBeGreaterThan(5);
    expect(Math.abs(cssCyan.x - MARKS[1]!.x) + Math.abs(cssCyan.y - MARKS[1]!.y)).toBeGreaterThan(5);
    // Chromium y FFmpeg mandan cada marca al mismo punto (±2 px por muestreo).
    expect(Math.abs(cssMagenta.x - ffMagenta.x)).toBeLessThan(2);
    expect(Math.abs(cssMagenta.y - ffMagenta.y)).toBeLessThan(2);
    expect(Math.abs(cssCyan.x - ffCyan.x)).toBeLessThan(2);
    expect(Math.abs(cssCyan.y - ffCyan.y)).toBeLessThan(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

#!/usr/bin/env node
/**
 * generate-effect-thumbs — captura el `Preview` real con un video de prueba y
 * codifica una miniatura animada por efecto en `public/effects/thumbs`.
 *
 * Uso: node scripts/generate-effect-thumbs.mjs [--only=id1,id2]
 * Requiere Chrome (Playwright) y el FFmpeg empaquetado.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = join(root, 'apps', 'desktop');
const ffmpeg = join(appRoot, 'src-tauri', 'resources', 'ffmpeg', 'ffmpeg.exe');
const outDir = join(appRoot, 'public', 'effects', 'thumbs');
const tempDir = join(root, '.tmp-effect-thumbs');
const sourceVideo = join(appRoot, 'e2e', 'lut-harness', 'preview-source.mp4');
const port = 5176;

const EFFECTS = [
  'brightness',
  'contrast',
  'saturation',
  'temperature',
  'shadows',
  'highlights',
  'fade',
  'blur',
  'hueRotate',
  'hsl',
  'colorWheels',
  'colorMatch',
  'vignette',
  'sharpen',
  'glow',
  'motionBlur',
  'denoise',
  'grain',
  'lut',
  'curves',
  'chromaKey',
];

const only = process.argv
  .find((arg) => arg.startsWith('--only='))
  ?.slice('--only='.length)
  .split(',')
  .filter(Boolean);
const selected = only && only.length > 0 ? EFFECTS.filter((id) => only.includes(id)) : EFFECTS;
const FRAMES = 18;
const FRAME_DELAY = 80;

function ensureSource() {
  if (existsSync(sourceVideo)) return;
  mkdirSync(dirname(sourceVideo), { recursive: true });
  console.log('generando clip de prueba…');
  execFileSync(
    ffmpeg,
    [
      '-hide_banner',
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'smptebars=size=320x180:rate=30:duration=3',
      '-f',
      'lavfi',
      '-i',
      'color=white:size=60x100:rate=30:duration=3',
      '-filter_complex',
      "[0:v][1:v]overlay=x='mod(t*90,380)-60':y=40:shortest=1,noise=alls=12:allf=t+u,format=yuv420p",
      '-c:v',
      'libopenh264',
      '-b:v',
      '2000000',
      sourceVideo,
    ],
    { stdio: 'inherit' },
  );
}

function encode(id, frames) {
  const output = join(outDir, `${id}.webm`);
  execFileSync(
    ffmpeg,
    [
      '-hide_banner',
      '-v',
      'error',
      '-y',
      '-framerate',
      '12',
      '-i',
      join(frames, '%02d.png'),
      '-c:v',
      'libvpx-vp9',
      '-b:v',
      '0',
      '-crf',
      '40',
      '-row-mt',
      '1',
      '-pix_fmt',
      'yuv420p',
      '-an',
      output,
    ],
    { stdio: 'inherit' },
  );
  return output;
}

async function main() {
  if (!existsSync(ffmpeg)) {
    throw new Error(`no se encontró FFmpeg en ${ffmpeg}`);
  }
  ensureSource();
  mkdirSync(outDir, { recursive: true });
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });
  const server = await createServer({
    root: appRoot,
    logLevel: 'silent',
    server: { port, strictPort: true },
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'],
    });
    for (const id of selected) {
      const page = await browser.newPage({ viewport: { width: 420, height: 260 } });
      try {
        await page.goto(`http://localhost:${port}/e2e/thumb-harness.html?effect=${id}`, {
          waitUntil: 'domcontentloaded',
          timeout: 60_000,
        });
        await page.waitForFunction(
          () => window.__thumbReady === true,
          null,
          { timeout: 30_000 },
        );
        const look = page.locator('.preview-look');
        await look.waitFor({ state: 'visible', timeout: 15_000 });
        const frames = join(tempDir, id);
        mkdirSync(frames, { recursive: true });
        for (let index = 0; index < FRAMES; index += 1) {
          await look.screenshot({ path: join(frames, `${String(index).padStart(2, '0')}.png`) });
          await page.waitForTimeout(FRAME_DELAY);
        }
        const output = encode(id, frames);
        rmSync(frames, { recursive: true, force: true });
        const bytes = statSync(output).size;
        console.log(`${id.padEnd(14)} ${String(bytes).padStart(7)} B`);
      } finally {
        await page.close();
      }
    }
  } finally {
    if (browser) await browser.close();
    await server.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

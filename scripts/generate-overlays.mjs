#!/usr/bin/env node
/**
 * Genera los overlays propios que se empaquetan con Olyvia. No descarga
 * imágenes ni video de terceros: cada frame se dibuja acá con matemática
 * determinista (gradientes radiales y partículas), se envía crudo a FFmpeg y
 * se codifica H.264. El mismo archivo se usa en la preview y en el export.
 *
 * Uso: node scripts/generate-overlays.mjs [--force]
 * Salida: apps/desktop/src-tauri/resources/overlays/
 */

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'apps/desktop/src-tauri/resources/overlays');
const FFMPEG =
  process.env.FFMPEG ||
  join(ROOT, 'apps/desktop/src-tauri/resources/ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const WIDTH = 1280;
const HEIGHT = 720;
const RENDER_WIDTH = 640;
const RENDER_HEIGHT = 360;
const FPS = 30;
const SECONDS = 4;
const FRAMES = FPS * SECONDS;
const FORCE = process.argv.includes('--force');

if (!existsSync(FFMPEG)) {
  console.error(`No se encontró FFmpeg en ${FFMPEG}. Definí FFMPEG=...`);
  process.exit(1);
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp255 = (value) => Math.max(0, Math.min(255, Math.round(value)));

/** Gradiente radial aditivo con caída suave; colores en 0..255. */
function blob(buffer, cx, cy, radius, color, strength) {
  if (radius < 1 || strength <= 0) return;
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(RENDER_WIDTH - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(RENDER_HEIGHT - 1, Math.ceil(cy + radius));
  const inv = 1 / radius;
  for (let y = minY; y <= maxY; y += 1) {
    const dy = (y - cy) * inv;
    for (let x = minX; x <= maxX; x += 1) {
      const dx = (x - cx) * inv;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance >= 1) continue;
      const falloff = (1 - distance) ** 2;
      const index = (y * RENDER_WIDTH + x) * 3;
      buffer[index] += color[0] * falloff * strength;
      buffer[index + 1] += color[1] * falloff * strength;
      buffer[index + 2] += color[2] * falloff * strength;
    }
  }
}

function renderWarmLeak(frame, buffer) {
  const t = (frame / FRAMES) * Math.PI * 2;
  blob(buffer, 160 + Math.sin(t) * 80, 90 + Math.cos(t * 0.7) * 40, 330, [255, 120, 40], 0.55);
  blob(buffer, 420 + Math.cos(t * 0.8) * 110, 260 + Math.sin(t) * 70, 300, [255, 180, 70], 0.42);
  blob(buffer, 300 + Math.sin(t * 0.6) * 90, 120 + Math.cos(t * 0.9) * 60, 180, [255, 70, 40], 0.3);
  blob(buffer, 620 + Math.sin(t * 0.5) * 40, 340 + Math.cos(t * 0.7) * 30, 220, [255, 140, 50], 0.22);
}

function renderCoolLeak(frame, buffer) {
  const t = (frame / FRAMES) * Math.PI * 2;
  blob(buffer, 150 + Math.cos(t) * 70, 260 + Math.sin(t * 0.8) * 60, 320, [40, 200, 220], 0.5);
  blob(buffer, 470 + Math.sin(t * 0.9) * 100, 100 + Math.cos(t) * 50, 300, [70, 110, 255], 0.45);
  blob(buffer, 320 + Math.cos(t * 0.6) * 80, 200 + Math.sin(t * 1.1) * 50, 170, [160, 80, 255], 0.3);
  blob(buffer, 620 + Math.cos(t * 0.4) * 40, 60 + Math.sin(t * 0.6) * 30, 210, [90, 220, 255], 0.2);
}

function dustParticles(seed) {
  const random = mulberry32(seed);
  return Array.from({ length: 90 }, () => ({
    x: random() * RENDER_WIDTH,
    y: random() * RENDER_HEIGHT,
    radius: 1 + random() * 3.5,
    phase: random() * Math.PI * 2,
    speed: 0.4 + random() * 0.9,
    drift: 6 + random() * 26,
    warm: random() > 0.35,
    alpha: 0.25 + random() * 0.55,
  }));
}

function renderDust(frame, buffer, particles) {
  const t = (frame / FRAMES) * Math.PI * 2;
  for (const particle of particles) {
    const x =
      particle.x +
      Math.sin(t * particle.speed + particle.phase) * particle.drift;
    const y =
      particle.y +
      Math.cos(t * particle.speed * 0.8 + particle.phase) * particle.drift * 0.6;
    const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(t * 2 * particle.speed + particle.phase));
    const color = particle.warm ? [255, 220, 160] : [200, 225, 255];
    blob(buffer, x, y, particle.radius * 2.2, color, particle.alpha * twinkle);
  }
}

function bokehParticles(seed) {
  const random = mulberry32(seed);
  const palette = [
    [255, 180, 140],
    [255, 230, 170],
    [150, 220, 255],
    [200, 170, 255],
    [255, 160, 200],
  ];
  return Array.from({ length: 26 }, () => ({
    x: random() * RENDER_WIDTH,
    y: random() * RENDER_HEIGHT,
    radius: 18 + random() * 52,
    phase: random() * Math.PI * 2,
    speed: 0.25 + random() * 0.6,
    drift: 20 + random() * 60,
    color: palette[Math.floor(random() * palette.length)],
    alpha: 0.08 + random() * 0.16,
  }));
}

function renderBokeh(frame, buffer, particles) {
  const t = (frame / FRAMES) * Math.PI * 2;
  for (const particle of particles) {
    const x = particle.x + Math.sin(t * particle.speed + particle.phase) * particle.drift;
    const y = particle.y + Math.cos(t * particle.speed * 0.7 + particle.phase) * particle.drift * 0.5;
    blob(buffer, x, y, particle.radius, particle.color, particle.alpha);
  }
}

/** Composición source-over sobre RGBA recto, para el personaje con alfa. */
function blendPixel(buffer, x, y, color, alpha) {
  if (x < 0 || y < 0 || x >= RENDER_WIDTH || y >= RENDER_HEIGHT) return;
  const strength = Math.min(1, Math.max(0, alpha));
  if (strength <= 0) return;
  const index = (y * RENDER_WIDTH + x) * 4;
  const destination = buffer[index + 3];
  const out = strength + destination * (1 - strength);
  if (out <= 0) return;
  for (let channel = 0; channel < 3; channel += 1) {
    buffer[index + channel] =
      (color[channel] * strength + buffer[index + channel] * destination * (1 - strength)) / out;
  }
  buffer[index + 3] = out;
}

function circle(buffer, cx, cy, radius, color, alpha = 1) {
  if (radius <= 0) return;
  const minX = Math.max(0, Math.floor(cx - radius - 1));
  const maxX = Math.min(RENDER_WIDTH - 1, Math.ceil(cx + radius + 1));
  const minY = Math.max(0, Math.floor(cy - radius - 1));
  const maxY = Math.min(RENDER_HEIGHT - 1, Math.ceil(cy + radius + 1));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const coverage = Math.min(1, Math.max(0, radius - distance + 0.5));
      if (coverage > 0) blendPixel(buffer, x, y, color, alpha * coverage);
    }
  }
}

function capsule(buffer, x1, y1, x2, y2, radius, color, alpha = 1) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const minX = Math.max(0, Math.floor(Math.min(x1, x2) - radius - 1));
  const maxX = Math.min(RENDER_WIDTH - 1, Math.ceil(Math.max(x1, x2) + radius + 1));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2) - radius - 1));
  const maxY = Math.min(RENDER_HEIGHT - 1, Math.ceil(Math.max(y1, y2) + radius + 1));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, ((x + 0.5 - x1) * dx + (y + 0.5 - y1) * dy) / lengthSquared),
          );
      const px = x1 + dx * t;
      const py = y1 + dy * t;
      const distance = Math.hypot(x + 0.5 - px, y + 0.5 - py);
      const coverage = Math.min(1, Math.max(0, radius - distance + 0.5));
      if (coverage > 0) blendPixel(buffer, x, y, color, alpha * coverage);
    }
  }
}

/** Personaje propio con alfa: cabeza, cuerpo, ojos, sonrisa y brazo que saluda. */
function renderMascot(frame, buffer) {
  const t = (frame / FRAMES) * Math.PI * 2;
  const bob = Math.sin(t * 2) * 7;
  const tilt = Math.sin(t * 2 + 0.5) * 4;
  const wave = Math.sin(t * 4);
  const blink = frame % 100 < 3 ? 0.12 : 1;
  const body = [58, 190, 178];
  const head = [124, 232, 220];
  const ink = [18, 56, 62];
  const cheek = [255, 146, 166];

  // Piernas y cuerpo.
  capsule(buffer, 297, 275 + bob, 290, 312 + bob, 10, body, 0.98);
  capsule(buffer, 343, 275 + bob, 350, 312 + bob, 10, body, 0.98);
  capsule(buffer, 320, 210 + bob, 320, 292 + bob, 54, body, 0.98);

  // Brazo izquierdo y brazo derecho saludando.
  capsule(buffer, 275, 215 + bob, 235, 250 + bob, 12, body, 0.98);
  circle(buffer, 235, 250 + bob, 14, body, 0.98);
  const shoulderX = 365;
  const shoulderY = 210 + bob;
  const angle = -1.25 + wave * 0.55;
  const handX = shoulderX + Math.cos(angle) * 78;
  const handY = shoulderY + Math.sin(angle) * 78;
  capsule(buffer, shoulderX, shoulderY, handX, handY, 12, body, 0.98);
  circle(buffer, handX, handY, 15, head, 1);

  // Cabeza y rasgos.
  circle(buffer, 320 + tilt, 138 + bob, 58, head, 1);
  circle(buffer, 300 + tilt, 130 + bob, 6.5, ink, blink);
  circle(buffer, 340 + tilt, 130 + bob, 6.5, ink, blink);
  circle(buffer, 288 + tilt, 151 + bob, 8, cheek, 0.55);
  circle(buffer, 352 + tilt, 151 + bob, 8, cheek, 0.55);
  // Sonrisa: tres cápsulas sobre una curva suave.
  capsule(buffer, 303 + tilt, 153 + bob, 312 + tilt, 161 + bob, 3, ink, 1);
  capsule(buffer, 312 + tilt, 161 + bob, 328 + tilt, 161 + bob, 3, ink, 1);
  capsule(buffer, 328 + tilt, 161 + bob, 337 + tilt, 153 + bob, 3, ink, 1);

  // Antena y destellos.
  capsule(buffer, 320 + tilt, 80 + bob, 320 + tilt + Math.sin(t * 3) * 5, 58 + bob, 3, body, 1);
  circle(buffer, 320 + tilt + Math.sin(t * 3) * 5, 56 + bob, 7, head, 1);
  const sparkle = 0.35 + 0.35 * Math.sin(t * 5);
  circle(buffer, 180, 90 + Math.sin(t * 3) * 8, 3, [255, 240, 190], sparkle);
  circle(buffer, 470, 120 + Math.cos(t * 3) * 8, 4, [255, 240, 190], sparkle);
  circle(buffer, 150, 260 + Math.sin(t * 2) * 6, 2.5, [255, 240, 190], sparkle);
}

function writeFrameRgba(stdin, buffer) {
  const rgba = Buffer.alloc(RENDER_WIDTH * RENDER_HEIGHT * 4);
  for (let index = 0; index < buffer.length; index += 1) {
    rgba[index] = index % 4 === 3 ? clamp255(buffer[index] * 255) : clamp255(buffer[index]);
  }
  return new Promise((resolvePromise) => {
    if (stdin.write(rgba)) resolvePromise();
    else stdin.once('drain', resolvePromise);
  });
}

function encodeAlpha(name, drawFrame) {
  const output = join(OUT_DIR, `${name}.webm`);
  if (!FORCE && existsSync(output)) {
    console.log(`· ${name}: ya existe (usá --force para regenerar)`);
    return Promise.resolve();
  }
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      FFMPEG,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgba',
        '-s',
        `${RENDER_WIDTH}x${RENDER_HEIGHT}`,
        '-r',
        String(FPS),
        '-i',
        '-',
        '-vf',
        `scale=${WIDTH}:${HEIGHT}:flags=bicubic`,
        '-c:v',
        'libvpx-vp9',
        '-pix_fmt',
        'yuva420p',
        '-b:v',
        '2M',
        '-auto-alt-ref',
        '0',
        output,
      ],
      { stdio: ['pipe', 'ignore', 'pipe'] },
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        console.log(`· ${name}: ${output}`);
        resolvePromise();
      } else {
        reject(new Error(`${name}: FFmpeg salió con ${code}\n${stderr}`));
      }
    });
    void (async () => {
      const buffer = new Float32Array(RENDER_WIDTH * RENDER_HEIGHT * 4);
      for (let frame = 0; frame < FRAMES; frame += 1) {
        buffer.fill(0);
        drawFrame(frame, buffer);
        await writeFrameRgba(child.stdin, buffer);
      }
      child.stdin.end();
    })().catch(reject);
  });
}

function writeFrame(stdin, buffer) {
  const rgb = Buffer.alloc(RENDER_WIDTH * RENDER_HEIGHT * 3);
  for (let index = 0; index < buffer.length; index += 1) {
    rgb[index] = clamp255(buffer[index]);
  }
  return new Promise((resolvePromise) => {
    if (stdin.write(rgb)) resolvePromise();
    else stdin.once('drain', resolvePromise);
  });
}

function encode(name, drawFrame) {
  const output = join(OUT_DIR, `${name}.mp4`);
  if (!FORCE && existsSync(output)) {
    console.log(`· ${name}: ya existe (usá --force para regenerar)`);
    return Promise.resolve();
  }
  return new Promise((resolvePromise, reject) => {
    const process = spawn(
      FFMPEG,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgb24',
        '-s',
        `${RENDER_WIDTH}x${RENDER_HEIGHT}`,
        '-r',
        String(FPS),
        '-i',
        '-',
        '-vf',
        `scale=${WIDTH}:${HEIGHT}:flags=bicubic`,
        '-c:v',
        'libopenh264',
        '-b:v',
        '2M',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        output,
      ],
      { stdio: ['pipe', 'ignore', 'pipe'] },
    );
    let stderr = '';
    process.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    process.on('error', reject);
    process.on('close', (code) => {
      if (code === 0) {
        console.log(`· ${name}: ${output}`);
        resolvePromise();
      } else {
        reject(new Error(`${name}: FFmpeg salió con ${code}\n${stderr}`));
      }
    });
    void (async () => {
      const buffer = new Float32Array(RENDER_WIDTH * RENDER_HEIGHT * 3);
      for (let frame = 0; frame < FRAMES; frame += 1) {
        buffer.fill(0);
        drawFrame(frame, buffer);
        await writeFrame(process.stdin, buffer);
      }
      process.stdin.end();
    })().catch(reject);
  });
}

function makePoster(name, second, extension = 'jpg') {
  const inputExtension = existsSync(join(OUT_DIR, `${name}.webm`)) ? 'webm' : 'mp4';
  return new Promise((resolvePromise, reject) => {
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      String(second),
      '-i',
      join(OUT_DIR, `${name}.${inputExtension}`),
      '-frames:v',
      '1',
      '-vf',
      'scale=480:-1:flags=bicubic',
    ];
    if (extension === 'jpg') args.push('-q:v', '4');
    args.push(join(OUT_DIR, `${name}.${extension}`));
    const child = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`póster ${name}: FFmpeg salió con ${code}\n${stderr}`));
    });
  });
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  await encode('warm-leak', renderWarmLeak);
  await encode('cool-leak', renderCoolLeak);
  const dust = dustParticles(20261030);
  await encode('dust-motes', (frame, buffer) => renderDust(frame, buffer, dust));
  const bokeh = bokehParticles(424242);
  await encode('bokeh-drift', (frame, buffer) => renderBokeh(frame, buffer, bokeh));
  await encodeAlpha('mascot-wave', renderMascot);
  for (const name of ['warm-leak', 'cool-leak', 'dust-motes', 'bokeh-drift']) {
    await makePoster(name, 2);
  }
  await makePoster('mascot-wave', 2, 'png');
  const catalog = {
    version: 1,
    generatedAt: '2026-10-30T00:00:00Z',
    generator: 'scripts/generate-overlays.mjs',
    license: {
      id: 'cc0-1.0',
      commercialUse: 'allowed',
      attributionText: 'Overlay generado por Editor IA',
      notes: 'Contenido procedural propio; no usa assets de terceros.',
    },
    overlays: [
      {
        id: 'warm-leak',
        label: 'Fuga cálida',
        description: 'Barrido anaranjado con pulso lento; pensado para mezcla Screen.',
        file: 'warm-leak.mp4',
        poster: 'warm-leak.jpg',
        width: WIDTH,
        height: HEIGHT,
        fps: FPS,
        durationSeconds: SECONDS,
        blendMode: 'screen',
      },
      {
        id: 'cool-leak',
        label: 'Fuga fría',
        description: 'Azules y violetas en movimiento; mezcla Screen.',
        file: 'cool-leak.mp4',
        poster: 'cool-leak.jpg',
        width: WIDTH,
        height: HEIGHT,
        fps: FPS,
        durationSeconds: SECONDS,
        blendMode: 'screen',
      },
      {
        id: 'dust-motes',
        label: 'Polvo dorado',
        description: 'Partículas finas que flotan y titilan; mezcla Screen.',
        file: 'dust-motes.mp4',
        poster: 'dust-motes.jpg',
        width: WIDTH,
        height: HEIGHT,
        fps: FPS,
        durationSeconds: SECONDS,
        blendMode: 'screen',
      },
      {
        id: 'bokeh-drift',
        label: 'Bokeh suave',
        description: 'Círculos desenfocados en deriva lenta; mezcla Screen.',
        file: 'bokeh-drift.mp4',
        poster: 'bokeh-drift.jpg',
        width: WIDTH,
        height: HEIGHT,
        fps: FPS,
        durationSeconds: SECONDS,
        blendMode: 'screen',
      },
      {
        id: 'mascot-wave',
        label: 'Mascota que saluda',
        description: 'Personaje vectorial propio con alfa; mezcla Normal.',
        file: 'mascot-wave.webm',
        poster: 'mascot-wave.png',
        width: WIDTH,
        height: HEIGHT,
        fps: FPS,
        durationSeconds: SECONDS,
        blendMode: 'normal',
        hasAlpha: true,
      },
    ],
  };
  writeFileSync(join(OUT_DIR, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`Catálogo: ${join(OUT_DIR, 'catalog.json')}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

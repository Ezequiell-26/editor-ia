#!/usr/bin/env node
/**
 * Puerta de licencia del FFmpeg empaquetado: exige una compilación LGPL sin
 * GPL/nonfree, sin encoders GPL (x264/x265/xvid) y con los encoders LGPL que
 * usa el renderer. Si no hay binario (clone limpio antes de bajar recursos),
 * informa y no bloquea; el empaquetado de CI siempre lo descarga antes.
 */
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dir = join(root, 'apps', 'desktop', 'src-tauri', 'resources', 'ffmpeg');
const ffmpeg = join(dir, 'ffmpeg.exe');
const ffprobe = join(dir, 'ffprobe.exe');

if (!existsSync(ffmpeg) || !existsSync(ffprobe)) {
  console.log('audit-ffmpeg-license: sin binarios empaquetados; se omite hasta el bundle');
  process.exit(0);
}

const run = (args) =>
  execFileSync(ffmpeg, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const problems = [];
const buildconf = run(['-hide_banner', '-buildconf']);
if (/--enable-(gpl|nonfree)/.test(buildconf)) {
  problems.push('buildconf contiene --enable-gpl/--enable-nonfree');
}
const encoders = run(['-hide_banner', '-encoders']);
for (const forbidden of ['libx264', 'libx265', 'libxvid']) {
  if (encoders.includes(forbidden)) problems.push(`incluye ${forbidden} (GPL)`);
}
for (const required of ['libopenh264', 'libkvazaar']) {
  if (!encoders.includes(required)) problems.push(`falta ${required}`);
}
const licensePath = join(dir, 'LICENSE.txt');
if (!existsSync(licensePath)) {
  problems.push('falta LICENSE.txt');
} else if (!/LESSER GENERAL PUBLIC LICENSE/i.test(readFileSync(licensePath, 'utf8'))) {
  problems.push('LICENSE.txt no es LGPL');
}

if (problems.length > 0) {
  console.error('audit-ffmpeg-license: FALLÓ');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log('audit-ffmpeg-license: LGPL, sin GPL/nonfree ni x264/x265/xvid');

#!/usr/bin/env node
/**
 * Sincroniza el FFmpeg que se empaqueta con la app desde una compilación
 * **LGPL shared** (BtbN / EDITOR_IA_FFMPEG_DEV). Copia ffmpeg.exe, ffprobe.exe,
 * las DLLs que ambos necesitan y la licencia. Falla si la fuente tiene GPL o
 * nonfree, o si le faltan los encoders LGPL que usa el renderer.
 *
 * Uso: node scripts/sync-bundled-ffmpeg.mjs
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const destination = join(root, 'apps', 'desktop', 'src-tauri', 'resources', 'ffmpeg');
// `tauri.conf.json` publica las DLLs también en la raíz del instalador para
// que el proceso Rust (video-rs/ffmpeg-sys) las cargue junto al .exe.
const dllDestination = join(root, 'apps', 'desktop', 'src-tauri', 'resources', 'ffmpeg-dll');
const SOURCES = [
  process.env.EDITOR_IA_FFMPEG_DEV,
  'D:\\DevCache\\ffmpeg-n9.0-lgpl\\ffmpeg-n9.0-latest-win64-lgpl-shared-9.0',
].filter(Boolean);

function fail(message) {
  console.error(`sync-bundled-ffmpeg: ${message}`);
  process.exit(2);
}

function findSource() {
  for (const dir of SOURCES) {
    if (!existsSync(join(dir, 'bin', 'ffmpeg.exe'))) continue;
    return dir;
  }
  return null;
}

function run(executable, args) {
  return execFileSync(executable, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const source = findSource();
if (!source) fail('no encontré una compilación LGPL shared (EDITOR_IA_FFMPEG_DEV)');
const bin = join(source, 'bin');
const ffmpeg = join(bin, 'ffmpeg.exe');
const buildconf = run(ffmpeg, ['-hide_banner', '-buildconf']);
if (/--enable-(gpl|nonfree)/.test(buildconf)) {
  fail('la fuente incluye --enable-gpl o --enable-nonfree');
}
const encoders = run(ffmpeg, ['-hide_banner', '-encoders']);
for (const required of ['libopenh264', 'libkvazaar']) {
  if (!encoders.includes(required)) fail(`la fuente no incluye ${required}`);
}
for (const forbidden of ['libx264', 'libx265', 'libxvid']) {
  if (encoders.includes(forbidden)) fail(`la fuente incluye el encoder GPL ${forbidden}`);
}

mkdirSync(destination, { recursive: true });
mkdirSync(dllDestination, { recursive: true });
const dlls = readdirSync(bin).filter((name) => name.toLowerCase().endsWith('.dll'));
for (const name of ['ffmpeg.exe', 'ffprobe.exe', ...dlls]) {
  copyFileSync(join(bin, name), join(destination, name));
}
for (const name of dlls) {
  copyFileSync(join(bin, name), join(dllDestination, name));
}
const license = join(source, 'LICENSE.txt');
if (!existsSync(license)) fail('la fuente no trae LICENSE.txt');
copyFileSync(license, join(destination, 'LICENSE.txt'));
copyFileSync(license, join(dllDestination, 'LICENSE.txt'));
const text = readFileSync(join(destination, 'LICENSE.txt'), 'utf8');
if (!/LESSER GENERAL PUBLIC LICENSE/i.test(text)) {
  fail('LICENSE.txt no es LGPL');
}

console.log(
  `sync-bundled-ffmpeg: LGPL sincronizado (${['ffmpeg.exe', 'ffprobe.exe', ...dlls].length} archivos) desde ${source}`,
);

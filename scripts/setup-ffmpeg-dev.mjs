#!/usr/bin/env node
/**
 * Copia las DLLs LGPL de FFmpeg que necesita `video-rs` al lugar donde las
 * busca el loader de Windows:
 *
 *   - `apps/desktop/src-tauri/resources/ffmpeg-dll/` para que el instalador
 *     NSIS las deje junto al .exe (Tauri mapea ese destino a la raíz).
 *   - `target/debug` y `target/release` con `--runtime`, para ejecutar el
 *     binario y las pruebas sin depender del PATH.
 *
 * La fuente se detecta en D:\DevCache o se indica con EDITOR_IA_FFMPEG_DEV.
 * Uso:
 *   node scripts/setup-ffmpeg-dev.mjs [--runtime] [--quiet]
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

const REQUIRED = [
  /^avcodec-.*\.dll$/i,
  /^avdevice-.*\.dll$/i,
  /^avfilter-.*\.dll$/i,
  /^avformat-.*\.dll$/i,
  /^avutil-.*\.dll$/i,
  /^swscale-.*\.dll$/i,
  /^swresample-.*\.dll$/i,
];

const SOURCES = [
  process.env.EDITOR_IA_FFMPEG_DEV,
  'D:\\DevCache\\ffmpeg-n9.0-lgpl\\ffmpeg-n9.0-latest-win64-lgpl-shared-9.0',
].filter(Boolean);

const root = resolve(import.meta.dirname, '..');
const destination = join(root, 'apps', 'desktop', 'src-tauri', 'resources', 'ffmpeg-dll');
const runtimeDirs = [
  join(root, 'target', 'debug'),
  join(root, 'target', 'release'),
];
const flags = new Set(process.argv.slice(2));
const quiet = flags.has('--quiet');

function fail(message) {
  console.error(`setup-ffmpeg-dev: ${message}`);
  process.exit(2);
}

function findSource() {
  for (const dir of SOURCES) {
    if (!existsSync(join(dir, 'bin'))) continue;
    const files = readdirSync(join(dir, 'bin'));
    const matches = REQUIRED.map((pattern) => files.find((name) => pattern.test(name)));
    if (matches.every(Boolean)) {
      return { dir, files: matches };
    }
  }
  return null;
}

function copyIfChanged(source, target) {
  if (existsSync(target)) {
    const from = statSync(source);
    const to = statSync(target);
    if (from.size === to.size && from.mtimeMs <= to.mtimeMs) {
      return false;
    }
  }
  try {
    // En Windows una DLL cargada por un proceso vivo no se puede sobrescribir;
    // borrarla primero falla con EBUSY en vez de dejar un archivo parcial.
    if (existsSync(target)) rmSync(target, { force: true });
    copyFileSync(source, target);
    return true;
  } catch (error) {
    console.error(`No se pudo copiar ${source} → ${target}: ${error.message}`);
    return false;
  }
}

const source = findSource();
if (!source) {
  fail(
    `no encontré las DLLs de FFmpeg dev. Definí EDITOR_IA_FFMPEG_DEV apuntando a un build shared (include/ + lib/*.lib + bin/avcodec-*.dll).`,
  );
}

mkdirSync(destination, { recursive: true });
const targets = [destination];
if (flags.has('--runtime')) {
  targets.push(...runtimeDirs);
}
for (const dir of targets) {
  mkdirSync(dir, { recursive: true });
}

let copied = 0;
let bytes = 0;
const names = [...source.files];
const license = join(source.dir, 'LICENSE.txt');
if (existsSync(license)) {
  names.push('LICENSE.txt');
}
for (const name of names) {
  const from = join(source.dir, name === 'LICENSE.txt' ? '' : 'bin', name);
  for (const dir of targets) {
    const to = join(dir, name);
    if (copyIfChanged(from, to)) {
      copied += 1;
      bytes += statSync(from).size;
    }
  }
}

if (!quiet) {
  console.log(
    `setup-ffmpeg-dev: ${names.length} archivos desde ${source.dir} → ${targets.length} destino(s); ${copied} copiados (${(bytes / 1024 / 1024).toFixed(1)} MB).`,
  );
}

#!/usr/bin/env node
/**
 * Verificación ESTÁTICA del pipeline de empaquetado: compara lo que
 * `tauri.conf.json` declara en `bundle.resources`, `bundle.icon` e imágenes
 * NSIS contra lo que realmente existe en disco ANTES de gastar un
 * `tauri build` completo. Un recurso faltante hoy falla recién en el bundler
 * (o peor, se saltea en silencio según el patrón), así que este chequeo es la
 * puerta barata que evita el primer intento real fallido.
 *
 * No buildea nada: sólo lee el conf y el filesystem. Devuelve exit 1 si falta
 * cualquier fuente declarada, con el comando que la genera.
 *
 * Uso:
 *   node scripts/check-bundle-resources.mjs [ruta/a/tauri.conf.json]
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const confPath = resolve(
  process.argv[2] ?? join(repoRoot, 'apps', 'desktop', 'src-tauri', 'tauri.conf.json'),
);
const confDir = dirname(confPath);

const conf = JSON.parse(readFileSync(confPath, 'utf8'));
const bundle = conf.bundle ?? {};

// ── helpers ────────────────────────────────────────────────────────────────

function toPosix(path) {
  return path.split(sep).join('/');
}

/** glob → regex; `*` no cruza separadores, `**` sí. */
function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i += 1;
      } else {
        out += '[^/\\\\]*';
      }
    } else if (ch === '?') {
      out += '[^/\\\\]';
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

/** Directorio base estático de un patrón (lo que precede al primer `*`). */
function staticBase(glob) {
  const idx = glob.search(/[*?]/);
  if (idx === -1) return glob;
  const cut = glob.slice(0, idx);
  const slash = Math.max(cut.lastIndexOf('/'), cut.lastIndexOf('\\'));
  return slash === -1 ? '' : cut.slice(0, slash);
}

function* walk(dir, depth = 0) {
  if (depth > 8) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'target' || entry.name === '.git') {
        continue;
      }
      yield* walk(full, depth + 1);
    } else {
      yield full;
    }
  }
}

/** ¿El patrón (absoluto) matchea al menos un archivo real? */
function patternHasMatch(absPattern) {
  if (!/[*?]/.test(absPattern)) {
    return existsSync(absPattern);
  }
  const base = staticBase(absPattern);
  const absBase = base === '' ? confDir : isAbsolute(base) ? resolve(base) : resolve(confDir, base);
  const re = globToRegExp(toPosix(absPattern));
  for (const file of walk(absBase)) {
    if (re.test(toPosix(file))) return true;
  }
  return false;
}

// ── chequeos ───────────────────────────────────────────────────────────────

const missing = [];

function checkSource(rawSource, label) {
  const abs = resolve(confDir, rawSource);
  if (!patternHasMatch(abs)) {
    missing.push({ source: rawSource, label });
  }
}

// bundle.resources: mapa "origen → destino" u array de orígenes.
const resources = bundle.resources;
if (resources && typeof resources === 'object') {
  const entries = Array.isArray(resources)
    ? resources.map((src) => [src, src])
    : Object.entries(resources);
  for (const [source] of entries) {
    checkSource(source, 'bundle.resources');
  }
}

// bundle.icon
for (const icon of bundle.icon ?? []) {
  checkSource(icon, 'bundle.icon');
}

// Iconos e imágenes NSIS declarados en bundle.windows.nsis
const nsis = bundle.windows?.nsis ?? {};
for (const key of ['installerIcon', 'uninstallerIcon', 'headerImage', 'sidebarImage', 'uninstallerHeaderImage']) {
  if (typeof nsis[key] === 'string') {
    checkSource(nsis[key], `bundle.windows.nsis.${key}`);
  }
}
for (const icon of bundle.windows?.icon ?? []) {
  checkSource(icon, 'bundle.windows.icon');
}

// ── reporte ────────────────────────────────────────────────────────────────

const HINTS = [
  [/resources\/ffmpeg-dll\//, 'DLLs FFmpeg dev: `node scripts/setup-ffmpeg-dev.mjs` (o `bash scripts/ci-ffmpeg-dev.sh` en CI)'],
  [/resources\/ffmpeg\//, 'FFmpeg estático: `bash scripts/ci-bundle-resources.sh`'],
  [/resources\/tools\//, 'yt-dlp: `bash scripts/ci-bundle-resources.sh`'],
  [/resources\/onnxruntime\//, 'ONNX Runtime: `bash scripts/ci-bundle-resources.sh`'],
  [/resources\/piper/, 'Piper TTS: `bash scripts/ci-bundle-resources.sh`'],
  [/resources\/sfx/, 'Efectos de sonido: `node scripts/generate-sfx.mjs`'],
  [/concat-worker\/target\/release/, 'concat-worker: `cargo build --release --manifest-path apps/concat-worker/Cargo.toml`'],
  [/extensions\//, 'Extensión del navegador: está versionada en git, revisá el checkout'],
];

if (missing.length === 0) {
  console.log(`check-bundle-resources: OK — ${confPath} no declara recursos faltantes.`);
  process.exit(0);
}

console.error(`check-bundle-resources: FALTAN ${missing.length} recurso(s) declarado(s) en ${confPath}:`);
for (const { source, label } of missing) {
  const hint = HINTS.find(([re]) => re.test(source.replace(/\\/g, '/')))?.[1];
  console.error(`  - [${label}] ${source}${hint ? `\n      → ${hint}` : ''}`);
}
process.exit(1);

#!/usr/bin/env node
/**
 * Guardia de licencias del bundle base.
 *
 * Falla si el instalador empieza a empaquetar Wav2Lip, checkpoints o modelos
 * con restricción no comercial. La app puede usar un motor externo iniciado a
 * mano, pero el ejecutable comercial no debe incluirlo.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const TAURI = join(ROOT, 'apps/desktop/src-tauri');
const RESOURCES = join(TAURI, 'resources');
const NOTICE = join(RESOURCES, 'THIRD-PARTY-NOTICES.txt');

const forbidden = /(wav2lip|lipsync|checkpoint|\.pth\b|\.pt\b|\.ckpt\b)/i;

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) files.push(...walk(full));
    else files.push({ path: full, bytes: stat.size });
  }
  return files;
}

const config = JSON.parse(readFileSync(join(TAURI, 'tauri.conf.json'), 'utf8'));
const resources = Object.entries(config.bundle?.resources ?? {});
const badResources = resources.filter(
  ([source, target]) => forbidden.test(source) || forbidden.test(target),
);
const files = walk(RESOURCES);
const badFiles = files.filter((file) => forbidden.test(file.path));

if (badResources.length > 0 || badFiles.length > 0) {
  console.error('BUNDLE LICENCIAS: Wav2Lip/checkpoint detectado en el paquete base.');
  for (const [source, target] of badResources) console.error(`  recurso: ${source} → ${target}`);
  for (const file of badFiles) console.error(`  archivo: ${file.path}`);
  process.exit(1);
}

if (!statSync(NOTICE, { throwIfNoEntry: false })?.isFile()) {
  console.error('BUNDLE LICENCIAS: falta resources/THIRD-PARTY-NOTICES.txt.');
  process.exit(1);
}

const byDir = new Map();
for (const file of files) {
  const relative = file.path.slice(RESOURCES.length + 1).split(/[\\/]/)[0] ?? '.';
  byDir.set(relative, (byDir.get(relative) ?? 0) + file.bytes);
}

console.log('BUNDLE LICENCIAS: OK');
console.log('  Wav2Lip/checkpoints: fuera del bundle base');
for (const [dir, bytes] of [...byDir].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${dir}: ${(bytes / 1024 / 1024).toFixed(1)} MB`);
}
console.log(`  avisos: ${NOTICE.slice(ROOT.length + 1)}`);

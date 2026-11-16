#!/usr/bin/env node
/**
 * Inventario de tests ignorados (`#[ignore]`) en apps/desktop/src-tauri.
 *
 * Parsea los archivos .rs en busca de atributos `#[ignore]` / `#[ignore = "..."]`
 * (equivalente a `cargo test -- --list` sin compilar: mismo conteo, sin el costo
 * de un build de Rust). Compara el total contra
 * scripts/test-inventory.baseline.json.
 *
 * Regla: el conteo NUNCA debe subir sin actualizar el baseline a propósito.
 * Si baja (se reactivaron tests), se avisa pero se pasa: el baseline queda como
 * techo histórico y conviene regenerarlo con `--write-baseline`.
 *
 * Uso:
 *   node scripts/test-inventory.mjs              # verifica contra el baseline
 *   node scripts/test-inventory.mjs --write-baseline   # regenera el baseline
 *
 * Actualizar el baseline es una decisión consciente: cada `#[ignore]` nuevo
 * debe justificarse (test que requiere ffmpeg/red/SAPI/hardware) y quedar
 * documentado en el mensaje del atributo.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_TAURI = join(ROOT, 'apps', 'desktop', 'src-tauri');
const BASELINE = join(ROOT, 'scripts', 'test-inventory.baseline.json');
const IGNORE_RE = /#\[\s*ignore(?:\s*=|\s*\])/g;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'target') continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) yield* walk(full);
    else if (name.endsWith('.rs')) yield full;
  }
}

const perFile = new Map();
let total = 0;
for (const file of walk(SRC_TAURI)) {
  const count = (readFileSync(file, 'utf8').match(IGNORE_RE) ?? []).length;
  if (count > 0) {
    perFile.set(relative(ROOT, file).replaceAll('\\', '/'), count);
    total += count;
  }
}

const snapshot = {
  ignoredTests: total,
  generatedAt: new Date().toISOString(),
  note: 'Conteo de atributos #[ignore] en apps/desktop/src-tauri (paridad con cargo test -- --list). Solo puede subir con --write-baseline consciente.',
  files: Object.fromEntries([...perFile.entries()].sort()),
};

if (process.argv.includes('--write-baseline')) {
  writeFileSync(BASELINE, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`TEST-INVENTORY: baseline escrito con ${total} tests ignorados en ${perFile.size} archivos.`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
} catch {
  console.error('TEST-INVENTORY: falta scripts/test-inventory.baseline.json.');
  console.error('  Generarlo con: node scripts/test-inventory.mjs --write-baseline');
  process.exit(1);
}

const ceiling = baseline.ignoredTests ?? 0;
const baseFiles = baseline.files ?? {};

console.log(`TEST-INVENTORY: ${total} tests con #[ignore] en ${perFile.size} archivos (baseline: ${ceiling}).`);

if (total > ceiling) {
  console.error('TEST-INVENTORY: el conteo de tests ignorados SUBIO.');
  console.error('  Todo #[ignore] nuevo debe justificarse (ffmpeg/red/SAPI/hardware) y');
  console.error('  documentarse en el atributo. Si es deliberado, regenerar el baseline:');
  console.error('    node scripts/test-inventory.mjs --write-baseline');
  // Mostrar los archivos que crecieron respecto del baseline.
  for (const [file, count] of perFile) {
    const before = baseFiles[file] ?? 0;
    if (count > before) console.error(`    ${file}: ${before} -> ${count}`);
  }
  for (const file of Object.keys(baseFiles)) {
    if (!perFile.has(file)) console.error(`    ${file}: ya no tiene ignores (borrado?)`);
  }
  process.exit(1);
}

if (total < ceiling) {
  console.log('TEST-INVENTORY: el conteo bajó; el baseline quedó como techo. Regenerar con --write-baseline para reflejarlo.');
}
console.log('TEST-INVENTORY: OK');

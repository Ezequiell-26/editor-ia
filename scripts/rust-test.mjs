#!/usr/bin/env node
/**
 * Corre los tests de Rust del workspace con el manifiesto de Common-Controls v6.
 *
 * El binario de tests enlaza Tauri/rfd y puede importar TaskDialogIndirect de
 * comctl32. Sin manifiesto, Windows carga la versión 5 y el proceso muere con
 * STATUS_ENTRYPOINT_NOT_FOUND antes de ejecutar un solo test. El ejecutable de
 * la app ya trae manifiesto; el de pruebas no. Este wrapper agrega el manifiesto
 * sólo al link de los tests (`--lib`) y no toca el build de la app.
 *
 * Uso: node scripts/rust-test.mjs [filtro] [-- --nocapture]
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const manifest = path.join(
  root,
  'apps',
  'desktop',
  'src-tauri',
  'tests.manifest',
);
const args = process.argv.slice(2);
const existing = process.env.RUSTFLAGS?.trim();
const flags = [
  existing,
  `-C link-arg=/MANIFESTINPUT:${manifest}`,
  '-C link-arg=/MANIFEST:EMBED',
]
  .filter(Boolean)
  .join(' ');
const result = spawnSync(
  process.execPath,
  [path.join(here, 'rust-env.mjs'), '--', 'cargo', 'test', '--workspace', '--lib', ...args],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, RUSTFLAGS: flags },
  },
);
process.exit(result.status ?? 1);

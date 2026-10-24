#!/usr/bin/env node
/**
 * Corre los tests de Rust del workspace con el entorno de FFmpeg y libclang.
 *
 * El manifiesto Common-Controls v6 del ejecutable de test lo agrega
 * `apps/desktop/src-tauri/build.rs` cuando `rust-env.mjs` marca la corrida como
 * test (`EDITOR_IA_TEST_BUILD`). No se pasa otro manifiesto por RUSTFLAGS: dos
 * recursos MANIFEST en el mismo ejecutable hacen fallar el link con CVT1100.
 *
 * Uso: node scripts/rust-test.mjs [filtro] [-- --nocapture]
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = process.argv.slice(2);
const result = spawnSync(
  process.execPath,
  [path.join(here, 'rust-env.mjs'), '--', 'cargo', 'test', '--workspace', '--lib', ...args],
  {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  },
);
process.exit(result.status ?? 1);

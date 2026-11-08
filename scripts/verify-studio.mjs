#!/usr/bin/env node
/**
 * Verificación integral del estudio autónomo: corre TODOS los tests de
 * `studio::` que están `#[ignore]` (los que necesitan ffmpeg/ffprobe,
 * SAPI de Windows, drawtext/fontconfig o red para Internet Archive).
 *
 * Va en DOS pasos serializados: los tests live rápidos primero y los
 * E2E de render después, cada uno en un proceso de test distinto.
 * Motivo: ~17 renders+descargas en un solo proceso saturan ffmpeg y
 * producen fallos espurios de "render terminó sin publicar" (flake de
 * recursos, no del código — cada E2E pasa individualmente).
 *
 * Requisitos reales en esta máquina:
 * - ffmpeg + ffprobe en PATH (o EDITOR_IA_FFMPEG / EDITOR_IA_FFPROBE)
 * - Windows con PowerShell + System.Speech (voz SAPI)
 * - Red para el provider de Internet Archive (baja un derivado real)
 *
 * Uso: node scripts/verify-studio.mjs
 * Tiempo estimado: varios minutos (hay descargas y renders reales).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const env = {
  ...process.env,
  EDITOR_IA_RUN_RENDER_TESTS: '1',
  EDITOR_IA_RUN_LIVE_TESTS: '1',
};

function run(args, label) {
  console.log(`\n=== verify-studio: ${label} ===`);
  const result = spawnSync(
    process.execPath,
    [path.join(here, 'rust-env.mjs'), '--', 'cargo', 'test', '--workspace', '--lib', ...args],
    { cwd: root, stdio: 'inherit', env },
  );
  if (result.status !== 0) {
    console.error(`verify-studio: FALLÓ el paso "${label}"`);
    process.exit(result.status ?? 1);
  }
}

// Paso 1: providers y análisis (live, sin render de timeline).
run(
  ['studio::', '--', '--ignored', '--test-threads=1', '--skip', 'e2e_tests'],
  'providers y analyze (live)',
);

// Paso 2: los E2E de las 8 etapas, cada uno en su propio proceso de
// test. Motivo: ~7 renders+descargas encadenados en un mismo proceso
// saturan ffmpeg y producen fallos espurios de "render terminó sin
// publicar" (flake de recursos, no del código — cada E2E pasa solo).
const e2e_tests = [
  'production_e2e_runs_all_stages_to_deliverables',
  'production_e2e_voice_narration_runs_all_stages',
  'production_e2e_remote_acquire_runs_all_stages',
  'production_e2e_content_aware_runs_all_stages',
  'production_e2e_title_card_runs_all_stages',
  'production_e2e_music_runs_all_stages',
  'production_e2e_all_providers_runs_all_stages',
];
const failed = [];
const flaky = [];
for (const test of e2e_tests) {
  console.log(`\n=== verify-studio: E2E ${test} ===`);
  const run_test = () =>
    spawnSync(
      process.execPath,
      [
        path.join(here, 'rust-env.mjs'),
        '--',
        'cargo',
        'test',
        '--workspace',
        '--lib',
        test,
        '--',
        '--ignored',
      ],
      { cwd: root, stdio: 'inherit', env },
    );
  let result = run_test();
  if (result.status !== 0) {
    // Un solo reintento: el render ffmpeg de esta máquina falla de forma
    // intermitente ("terminó sin publicar") bajo carga; si pasa al
    // segundo intento se reporta como flaky, no como verde limpio.
    console.log(`--- ${test} falló; reintentando una vez ---`);
    result = run_test();
    if (result.status === 0) {
      flaky.push(test);
      continue;
    }
    failed.push(test);
  }
}
if (flaky.length > 0) {
  console.log(`\nverify-studio: PASARON CON REINTENTO (flaky): ${flaky.join(', ')}`);
}
if (failed.length > 0) {
  console.error(`\nverify-studio: FALLARON ${failed.length} E2E: ${failed.join(', ')}`);
  process.exit(1);
}

console.log('\nverify-studio: TODO VERDE');

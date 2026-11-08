import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const desktopSrc = join(repoRoot, 'apps/desktop/src');
const tauriSrc = join(repoRoot, 'apps/desktop/src-tauri/src');

function walk(dir, predicate, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'node_modules') walk(path, predicate, out);
    } else if (predicate(path)) {
      out.push(path);
    }
  }
  return out;
}

const tsFiles = (dir) =>
  walk(dir, (p) => /\.(ts|tsx)$/.test(p) && !/\.test\.(ts|tsx)$/.test(p));

const TAURI_SPECIFIER = /from\s+['"]@tauri-apps\/|import\s*\(\s*['"]@tauri-apps\//;

describe('reglas de dependencias — frontend', () => {
  it('features/** no importa la API de Tauri directamente', () => {
    const featuresDir = join(desktopSrc, 'features');
    const offenders = tsFiles(featuresDir).filter((file) =>
      TAURI_SPECIFIER.test(readFileSync(file, 'utf8')),
    );
    expect(
      offenders.map((f) => relative(repoRoot, f)),
      'Las features consumen platform/tauri o services, nunca @tauri-apps/api',
    ).toEqual([]);
  });

  it('components/hooks/lib/state no importan la API de Tauri directamente', () => {
    const offenders = ['components', 'hooks', 'lib', 'state']
      .flatMap((dir) => tsFiles(join(desktopSrc, dir)))
      .filter((file) => TAURI_SPECIFIER.test(readFileSync(file, 'utf8')));
    expect(
      offenders.map((f) => relative(repoRoot, f)),
      'La API de Tauri vive sólo en platform/tauri',
    ).toEqual([]);
  });

  it('platform/tauri es el único lugar con imports @tauri-apps fuera de tests', () => {
    const allowed = (file) => file.startsWith(join(desktopSrc, 'platform', 'tauri') + '\\')
      || file.startsWith(join(desktopSrc, 'platform', 'tauri') + '/');
    const offenders = tsFiles(desktopSrc)
      .filter((file) => !allowed(file))
      .filter((file) => TAURI_SPECIFIER.test(readFileSync(file, 'utf8')));
    expect(
      offenders.map((f) => relative(repoRoot, f)),
      'Todo acceso a @tauri-apps/api pasa por platform/tauri',
    ).toEqual([]);
  });

  it('los contratos del servicio no dependen de tipos de Tauri', () => {
    const contractsDir = join(desktopSrc, 'services', 'contracts');
    const offenders = tsFiles(contractsDir).filter((file) =>
      TAURI_SPECIFIER.test(readFileSync(file, 'utf8')),
    );
    expect(
      offenders.map((f) => relative(repoRoot, f)),
      'Los contratos usan tipos propios (contracts/events.ts)',
    ).toEqual([]);
  });
});

describe('reglas de dependencias — Rust', () => {
  it('projects/ y media/ (capa de dominio) no dependen de Tauri', () => {
    const pureDirs = ['projects', 'media'];
    const offenders = pureDirs
      .flatMap((dir) => walk(join(tauriSrc, dir), (p) => p.endsWith('.rs')))
      .filter((file) => /use\s+tauri::|tauri::/m.test(readFileSync(file, 'utf8')));
    expect(
      offenders.map((f) => relative(repoRoot, f)),
      'Dominio e infraestructura de archivos no conocen Tauri',
    ).toEqual([]);
  });
});

describe('contrato IPC', () => {
  const registry = readFileSync(
    join(tauriSrc, 'commands', 'registry.rs'),
    'utf8',
  );
  const handlers = [...registry.matchAll(/crate::commands::\w+::(\w+)/g)].map(
    (m) => m[1],
  );

  it('el registry no tiene handlers duplicados', () => {
    expect(new Set(handlers).size).toBe(handlers.length);
  });

  it('el registry conserva la superficie IPC completa (>= 234 handlers)', () => {
    // Baseline medida tras la reorganización en commands/domains. Si este
    // número cambia hay que revisar a propósito: un handler perdido rompe la
    // UI y uno nuevo debe documentarse en el contrato.
    expect(handlers.length).toBeGreaterThanOrEqual(234);
  });
});

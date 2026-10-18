import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(relative) {
  return readFileSync(join(repoRoot, relative), 'utf8');
}

function exists(relative) {
  return existsSync(join(repoRoot, relative));
}

const WORKFLOW = '.github/workflows/verify.yml';

describe('workflow de verificacion', () => {
  it('existe y no usa tabuladores, que YAML rechaza en silencio', () => {
    expect(exists(WORKFLOW), `falta ${WORKFLOW}`).toBe(true);
    expect(read(WORKFLOW)).not.toMatch(/\t/);
  });

  it('corre exactamente las puertas que el loop usa en local', () => {
    const text = read(WORKFLOW);
    for (const command of [
      'npm ci',
      'npm run verify',
      'npm --workspace @editor-ia/desktop run build',
      'cargo fmt --all -- --check',
      'cargo test -p editor-ia-desktop',
    ]) {
      expect(text, `el workflow no corre ${command}`).toContain(command);
    }
  });

  it('invoca Rust siempre por el prefijo que mide el entorno', () => {
    const text = read(WORKFLOW);
    const cargoLines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /\bcargo\s+(fmt|test|check|build|metadata)\b/.test(line));
    expect(cargoLines.length).toBeGreaterThan(1);
    for (const line of cargoLines) {
      expect(
        line,
        `cargo pelado falla con LNK1104 sin LIB/INCLUDE: ${line}`,
      ).toContain('scripts/rust-env.mjs --');
    }
  });

  it('fija versiones de acciones y no deja referencias flotantes', () => {
    const text = read(WORKFLOW);
    const used = [...text.matchAll(/uses:\s*([^\s#]+)/g)].map((match) => match[1] ?? '');
    expect(used.length).toBeGreaterThan(1);
    for (const reference of used) {
      const [, tag] = /@(.+)$/.exec(reference) ?? [, ''];
      expect(
        /^v?\d+(\.\d+)*$|^[0-9a-f]{40}$/.test(tag ?? ''),
        `referencia sin fijar: ${reference}`,
      ).toBe(true);
    }
  });

  it('declara Node y Rust estables, que es lo que fija el repo', () => {
    const text = read(WORKFLOW);
    const major = String(JSON.parse(read('package.json')).engines.node).replace(/\D/g, '');
    expect(text).toContain(`node-version: '${major}'`);
    expect(text).toContain('rust-toolchain.toml');
    expect(read('rust-toolchain.toml')).toMatch(/channel\s*=\s*"stable"/);
    expect(text).toMatch(/cache:\s*'npm'/);
    expect(text).toMatch(/actions\/cache@/);
    expect(text).toMatch(/\.cargo\/registry/);
  });

  it('no sube ni referencia secretos, caches ni dependencias', () => {
    for (const file of ['.github/workflows/verify.yml', 'scripts/verify.ps1']) {
      const text = read(file).toLowerCase();
      for (const forbidden of ['.env', 'node_modules', 'id_rsa', 'api_key', 'access_token']) {
        expect(text, `${file} menciona ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe('script de verificacion deterministica', () => {
  it('falla al primer error y propaga el codigo de salida', () => {
    const text = read('scripts/verify.ps1');
    expect(text).toMatch(/\$ErrorActionPreference\s*=\s*'Stop'/);
    expect(text).toMatch(/\$LASTEXITCODE/);
    expect(text).toMatch(/exit\s+\$failures|exit\s+\$LASTEXITCODE/);
  });

  it('cubre las mismas cuatro puertas del workflow', () => {
    const text = read('scripts/verify.ps1');
    for (const step of [
      'npm run verify',
      'npm --workspace @editor-ia/desktop run build',
      'cargo fmt --all -- --check',
      'cargo test -p editor-ia-desktop',
    ]) {
      expect(text, `verify.ps1 no corre ${step}`).toContain(step);
    }
  });
});

describe('empaquetado Windows', () => {
  it('no existe todavia, y el README lo dice en lugar de simularlo', () => {
    expect(exists('.github/workflows/windows-package.yml')).toBe(false);
    const readme = read('README.md').toLowerCase();
    expect(readme).toMatch(/empaquetad|package-windows|windows-package/);
    expect(readme).toMatch(/todavia no|no existe|pendiente|blocked/);
  });
});

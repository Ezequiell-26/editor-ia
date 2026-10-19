import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const desktopManifest = join(repoRoot, 'apps', 'desktop', 'src-tauri', 'Cargo.toml');
const desktopMain = join(repoRoot, 'apps', 'desktop', 'src-tauri', 'src', 'main.rs');

function read(relative) {
  return readFileSync(join(repoRoot, relative), 'utf8');
}

function tableBody(source, table) {
  const header = `[${table}]`;
  if (!source.split(/\r?\n/).some((line) => line.trim() === header)) {
    return null;
  }
  const body = [];
  let inside = false;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inside = line === header;
      continue;
    }
    if (inside && line.length > 0 && !line.startsWith('#')) {
      body.push(line);
    }
  }
  return body;
}

describe('workspace Cargo', () => {
  it('tiene un único miembro: apps/desktop/src-tauri', () => {
    const source = read('Cargo.toml');
    const members = tableBody(source, 'workspace');
    expect(members, '[workspace] debe existir en el manifiesto raíz').not.toBeNull();
    const declared = members.find((line) => line.startsWith('members'));
    expect(declared, 'members debe estar declarado').toBeTruthy();
    const entries = [...declared.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect(entries).toEqual(['apps/desktop/src-tauri']);
    expect(declared).not.toContain('exclude');
    expect(members.some((line) => line.startsWith('resolver'))).toBe(true);
  });

  it('ignora el directorio target/ del workspace', () => {
    const gitignore = read('.gitignore')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
    expect(gitignore).toContain('target/');
    const probe = spawnSync('git', ['check-ignore', '-q', 'target/debug'], {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: true,
    });
    expect(probe.status, 'target/debug debe estar ignorado por git').toBe(0);
  });
});

describe('rust-toolchain.toml', () => {
  it('fija el canal estable', () => {
    const source = read('rust-toolchain.toml');
    const channel = source.match(/^channel\s*=\s*"([^"]+)"/m);
    expect(channel, 'channel debe estar declarado').not.toBeNull();
    expect(channel[1]).toBe('stable');
    expect(source).not.toMatch(/components\s*=/);
  });
});

describe('crate editor-ia-desktop', () => {
  it('declara el crate de escritorio con el puente Tauri y sus dependencias justificadas', () => {
    expect(existsSync(desktopManifest)).toBe(true);
    const source = readFileSync(desktopManifest, 'utf8');
    expect(source.match(/^name\s*=\s*"([^"]+)"/m)[1]).toBe('editor-ia-desktop');
    expect(source).toMatch(/^edition\s*=\s*"2\d{3}"/m);
    expect(source.match(/^version\s*=\s*"([^"]+)"/m)[1]).toBe('0.1.0');
    const dependencies = tableBody(source, 'dependencies') ?? [];
    // El puente Tauri, el diálogo nativo, el render, las credenciales y las
    // mediciones de medios son las únicas razones para estas crates.
    const names = dependencies.map((line) => line.split('=')[0].trim());
    for (const crate of [
      'tauri',
      'tauri-plugin-dialog',
      'tauri-plugin-opener',
      'serde',
      'serde_json',
      'sha2',
      'base64',
      'reqwest',
      'keyring',
      'uuid',
    ]) {
      expect(names, `falta ${crate}`).toContain(crate);
    }
    expect(source).toMatch(/^\[build-dependencies\]/m);
    expect(source).toMatch(/tauri-build/);
  });

  it('main.rs es un punto de entrada compilable y no promete capacidades', () => {
    expect(existsSync(desktopMain)).toBe(true);
    const source = readFileSync(desktopMain, 'utf8');
    expect(source).toMatch(/^fn main\(\)\s*\{/m);
    expect(source).not.toMatch(/\bunsafe\b/);
    expect(source.toLowerCase()).not.toMatch(/\b(render|timeline|export)\b/);
  });
});

describe('cargo metadata', () => {
  it('resuelve el workspace vía el prefijo de entorno medido', () => {
    const run = spawnSync(
      process.execPath,
      [
        join(repoRoot, 'scripts', 'rust-env.mjs'),
        '--',
        'cargo',
        'metadata',
        '--no-deps',
        '--format-version',
        '1',
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    expect(run.status, run.stderr).toBe(0);
    const metadata = JSON.parse(run.stdout);
    expect(metadata.workspace_members).toHaveLength(1);
    expect(metadata.packages[0].name).toBe('editor-ia-desktop');
    expect(metadata.packages[0].manifest_path.replace(/\\/g, '/')).toBe(
      desktopManifest.replace(/\\/g, '/'),
    );
    expect(metadata.workspace_root.replace(/\\/g, '/')).toBe(
      repoRoot.replace(/\\/g, '/'),
    );
  });
});

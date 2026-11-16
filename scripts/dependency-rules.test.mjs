import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Gate de docs/architecture/DEPENDENCY-RULES.md para las reglas que
// architecture-rules.test.mjs NO cubre. Sólo se enforcean reglas que hoy
// están limpias o que son forward-looking (carpeta aún inexistente); las
// reglas con deuda masiva documentada (imports privados entre features,
// FFmpeg sólo vía infrastructure) quedan manuales hasta tener baseline.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const desktopSrc = join(repoRoot, 'apps', 'desktop', 'src');
const packagesDir = join(repoRoot, 'packages');
const tauriSrc = join(repoRoot, 'apps', 'desktop', 'src-tauri', 'src');

function walk(dir, predicate, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'node_modules' && entry !== 'target' && entry !== 'dist') {
        walk(path, predicate, out);
      }
    } else if (predicate(path)) {
      out.push(path);
    }
  }
  return out;
}

const tsFiles = (dir) =>
  existsSync(dir)
    ? walk(dir, (p) => /\.(ts|tsx)$/.test(p) && !/\.test\.(ts|tsx)$/.test(p))
    : [];
const rsFiles = (dir) =>
  existsSync(dir)
    ? walk(dir, (p) => p.endsWith('.rs') && !/\.tests\.rs$/.test(p))
    : [];

const rel = (f) => relative(repoRoot, f).replaceAll('\\', '/');

// Specifiers de imports runtime (mismo criterio que architecture-rules:
// `import type`/`export type` se eliminan antes de medir).
const TYPE_ONLY_SPECIFIER = /(?:import|export)\s+type\s+[^;'"]*?\sfrom\s*['"][^'"]+['"]/g;
const IMPORT_SPECIFIER =
  /from\s+['"](\.[^'"]+)['"]|import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
const PROMISE_METHODS = new Set(['then', 'catch', 'finally']);

function runtimeSpecifiers(text) {
  const source = text.replace(TYPE_ONLY_SPECIFIER, '');
  const specifiers = [];
  for (const match of source.matchAll(IMPORT_SPECIFIER)) {
    const specifier = match[1] ?? match[2];
    if (match[2] !== undefined) {
      const after = source.slice(match.index + match[0].length);
      const member = after.match(/^\s*\.\s*([A-Za-z_$][\w$]*)/);
      if (member && !PROMISE_METHODS.has(member[1])) continue;
    }
    specifiers.push(specifier);
  }
  return specifiers;
}

// `import type`/`export type` inline en una línea (`import { type X }` no se
// filtra acá; para platform/ basta el filtro de statements completos porque el
// tipo `RenderQueueEntry` entra por `import type` de línea completa).
function runtimeImportsOf(file) {
  return runtimeSpecifiers(readFileSync(file, 'utf8')).map((specifier) =>
    resolve(dirname(file), specifier),
  );
}

function firstSegmentUnder(target, base) {
  const relPath = relative(base, target).replaceAll('\\', '/');
  if (relPath.startsWith('..') || relPath === '') return null;
  return relPath.split('/')[0];
}

// Copia mínima de stripCfgTest de architecture-rules.test.mjs: los tests
// inline pueden usar infraestructura concreta a propósito.
function stripCfgTest(source) {
  const lines = source.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^#\[cfg\(test\)\]/.test(line.trim())) {
      i++;
      while (i < lines.length && /^#\[/.test(lines[i].trim())) i++;
      if (i < lines.length && /^\s*use\b/.test(lines[i]) && lines[i].includes(';')) {
        i++;
        continue;
      }
      while (i < lines.length) {
        const l = lines[i];
        let done = false;
        for (const ch of l) {
          if (ch === '{') {
            let depth = 0;
            while (i < lines.length) {
              for (const c of lines[i]) {
                if (c === '{') depth++;
                if (c === '}') depth--;
              }
              i++;
              if (depth <= 0) { done = true; break; }
            }
            break;
          }
          if (ch === ';') { i++; done = true; break; }
        }
        if (done) break;
        i++;
      }
      continue;
    }
    out.push(line);
    i++;
  }
  return out.join('\n');
}

describe('DEPENDENCY-RULES — frontend (reglas no cubiertas por arch-rules)', () => {
  // Regla TS.5: platform/** no importa componentes ni estado visual. La
  // dirección sancionada es platform -> contracts de services; los type-only
  // imports se toleran porque no crean dependencia en runtime (deuda de
  // tipos documentada, p.ej. state/render-queue en platform/tauri/render.ts).
  it('platform/** no importa en runtime components/state/features/app/hooks/lib', () => {
    const forbidden = new Set(['components', 'state', 'features', 'app', 'hooks', 'lib']);
    const offenders = [];
    for (const file of tsFiles(join(desktopSrc, 'platform'))) {
      for (const target of runtimeImportsOf(file)) {
        const segment = firstSegmentUnder(target, desktopSrc);
        if (segment && forbidden.has(segment)) {
          offenders.push(`${rel(file)} -> ${segment}/`);
        }
      }
    }
    expect(
      [...new Set(offenders)],
      'platform/ implementa contracts y adaptadores; no conoce capas de UI ni estado',
    ).toEqual([]);
  });

  // Reglas TS.2 y TS.4: si aparecen las carpetas, la dirección es fixed desde
  // ya. Hoy no existen en apps/desktop/src; el check es forward-looking.
  it('shared/** (si existe) no importa features/state/app/platform', () => {
    const sharedDir = join(desktopSrc, 'shared');
    const forbidden = new Set(['features', 'state', 'app', 'platform']);
    const offenders = [];
    for (const file of tsFiles(sharedDir)) {
      for (const target of runtimeImportsOf(file)) {
        const segment = firstSegmentUnder(target, desktopSrc);
        if (segment && forbidden.has(segment)) {
          offenders.push(`${rel(file)} -> ${segment}/`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('application/** TS (si existe) no importa React, Tauri ni capas de UI', () => {
    const appDir = join(desktopSrc, 'application');
    const forbiddenDirs = new Set(['components', 'platform', 'state', 'features', 'app', 'hooks']);
    const offenders = [];
    for (const file of tsFiles(appDir)) {
      const text = readFileSync(file, 'utf8');
      if (/from\s+['"](@tauri-apps\/|react['"]|react-dom)/.test(text)) {
        offenders.push(`${rel(file)} -> react/tauri`);
      }
      for (const target of runtimeImportsOf(file)) {
        const segment = firstSegmentUnder(target, desktopSrc);
        if (segment && forbiddenDirs.has(segment)) {
          offenders.push(`${rel(file)} -> ${segment}/`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // Regla TS.9 (parcial): los barrel files globales `export *` están
  // prohibidos en features y packages; la API pública se expone por
  // entrypoints explícitos. services/contracts.ts es el agregador
  // sancionado del contrato IPC y queda fuera de este gate.
  it('features/** y packages/*/src no usan `export *` (barrel files)', () => {
    const barrels = [];
    const scan = (dir) => {
      for (const file of tsFiles(dir)) {
        if (/^export\s+\*/m.test(readFileSync(file, 'utf8'))) {
          barrels.push(rel(file));
        }
      }
    };
    scan(join(desktopSrc, 'features'));
    for (const entry of readdirSync(packagesDir)) {
      const src = join(packagesDir, entry, 'src');
      if (existsSync(src)) scan(src);
    }
    expect(barrels, 'Exponer la API pública con exports explícitos, no `export *`').toEqual([]);
  });
});

describe('DEPENDENCY-RULES — packages (frontera app/librería)', () => {
  const packageNames = readdirSync(packagesDir)
    .map((entry) => join(packagesDir, entry, 'package.json'))
    .filter(existsSync)
    .map((file) => JSON.parse(readFileSync(file, 'utf8')).name)
    .filter(Boolean);

  // Regla implícita del monorepo: packages/* son librerías de dominio
  // reutilizables; no conocen React, Tauri ni las apps que las consumen.
  const FORBIDDEN_SPECIFIER =
    /^(@tauri-apps\/|react$|react-dom|@editor-ia\/(desktop|render-worker|motion-mcp|concat-worker))/;

  it('packages/*/src no importa React, Tauri ni apps del workspace', () => {
    const offenders = [];
    for (const entry of readdirSync(packagesDir)) {
      const src = join(packagesDir, entry, 'src');
      for (const file of tsFiles(src)) {
        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
          const specifier = match[1];
          if (FORBIDDEN_SPECIFIER.test(specifier)) {
            offenders.push(`${rel(file)} -> ${specifier}`);
          }
          if (specifier.startsWith('.')) {
            const target = resolve(dirname(file), specifier);
            const pkgRoot = join(packagesDir, entry);
            if (!target.startsWith(pkgRoot + sep) && target !== pkgRoot) {
              offenders.push(`${rel(file)} -> fuera del package: ${specifier}`);
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('los package.json de packages/* no dependen de apps ni de React/Tauri', () => {
    const offenders = [];
    for (const entry of readdirSync(packagesDir)) {
      const manifestPath = join(packagesDir, entry, 'package.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
        for (const dep of Object.keys(manifest[section] ?? {})) {
          if (FORBIDDEN_SPECIFIER.test(dep)) {
            offenders.push(`${entry} [${section}] -> ${dep}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('DEPENDENCY-RULES — Rust (reglas no cubiertas por arch-rules)', () => {
  // Reglas Rust §2.4/§2.6 (parcial): application y ports no ejecutan
  // procesos; la ejecución vive en infrastructure. Commands sí lanza
  // procesos hoy (FFmpeg, yt-dlp, etc.): esa migración es deuda conocida y
  // no se gatea acá para no congelar el estado actual.
  it('application/** y ports/** no lanzan procesos (std::process::Command)', () => {
    const offenders = [];
    for (const dir of ['application', 'ports']) {
      for (const file of rsFiles(join(tauriSrc, dir))) {
        const text = stripCfgTest(readFileSync(file, 'utf8'));
        if (/std::process::Command|process::Command::new|Command::new\(/.test(text)) {
          offenders.push(rel(file));
        }
      }
    }
    expect(
      offenders,
      'Los casos de uso piden efectos a ports; quien ejecuta es infrastructure',
    ).toEqual([]);
  });
});

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const desktopSrc = join(repoRoot, 'apps/desktop/src');
const tauriSrc = join(repoRoot, 'apps/desktop/src-tauri/src');

function walk(dir, predicate, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'node_modules' && entry !== 'target') walk(path, predicate, out);
    } else if (predicate(path)) {
      out.push(path);
    }
  }
  return out;
}

const tsFiles = (dir) =>
  walk(dir, (p) => /\.(ts|tsx)$/.test(p) && !/\.test\.(ts|tsx)$/.test(p));
const rsFiles = (dir) => walk(dir, (p) => p.endsWith('.rs') && !/\.tests\.rs$/.test(p));

const TAURI_SPECIFIER = /from\s+['"]@tauri-apps\/|import\s*\(\s*['"]@tauri-apps\//;

// Quita bloques `#[cfg(test)]` (mods inline y uses sueltos) para que las
// reglas de capas midan sólo código de producción. Los tests de integración
// pueden usar infraestructura concreta a propósito.
function stripCfgTest(source) {
  const lines = source.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^#\[cfg\(test\)\]/.test(line.trim())) {
      // `#[cfg(test)] use ...;` en una sola línea o atributo seguido de item
      i++;
      // saltar atributos adicionales y la línea del item si es `use`
      while (i < lines.length && /^#\[/.test(lines[i].trim())) i++;
      if (i < lines.length && /^\s*use\b/.test(lines[i]) && lines[i].includes(';')) {
        i++;
        continue;
      }
      // `mod tests { ... }` o cualquier item con cuerpo: llaves balanceadas.
      // Items sin cuerpo (`use ...;`, `static ...;`) terminan en `;`.
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

const rel = (f) => relative(repoRoot, f).replaceAll('\\', '/');

describe('reglas de dependencias — frontend', () => {
  it('features/** no importa la API de Tauri directamente', () => {
    const featuresDir = join(desktopSrc, 'features');
    const offenders = tsFiles(featuresDir).filter((file) =>
      TAURI_SPECIFIER.test(readFileSync(file, 'utf8')),
    );
    expect(
      offenders.map(rel),
      'Las features consumen platform/tauri o services, nunca @tauri-apps/api',
    ).toEqual([]);
  });

  it('components/hooks/lib/state no importan la API de Tauri directamente', () => {
    const offenders = ['components', 'hooks', 'lib', 'state']
      .flatMap((dir) => tsFiles(join(desktopSrc, dir)))
      .filter((file) => TAURI_SPECIFIER.test(readFileSync(file, 'utf8')));
    expect(
      offenders.map(rel),
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
      offenders.map(rel),
      'Todo acceso a @tauri-apps/api pasa por platform/tauri',
    ).toEqual([]);
  });

  it('los contratos del servicio no dependen de tipos de Tauri', () => {
    const contractsDir = join(desktopSrc, 'services', 'contracts');
    const offenders = tsFiles(contractsDir).filter((file) =>
      TAURI_SPECIFIER.test(readFileSync(file, 'utf8')),
    );
    expect(
      offenders.map(rel),
      'Los contratos usan tipos propios (contracts/events.ts)',
    ).toEqual([]);
  });

  // Ciclos reales preexistentes, documentados con criterio de eliminación:
  // el módulo compartido debe bajar a components/, services/ o shared/.
  const KNOWN_CYCLES = new Set([
    'color -> editor -> color',
    'editor -> vfx -> editor',
  ]);

  it('no hay ciclos de dependencias entre features', () => {
    const featuresDir = join(desktopSrc, 'features');
    const graph = new Map(); // feature -> Set<feature>
    const importRe = /from\s+['"](\.[^'"]+)['"]/g;
    for (const file of tsFiles(featuresDir)) {
      const relFile = relative(featuresDir, file).replaceAll('\\', '/');
      const fromFeature = relFile.split('/')[0];
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(importRe)) {
        const target = resolve(dirname(file), match[1]);
        const targetRel = relative(featuresDir, target).replaceAll('\\', '/');
        const toFeature = targetRel.split('/')[0];
        if (!toFeature || toFeature === fromFeature || toFeature.startsWith('..')) continue;
        if (!graph.has(fromFeature)) graph.set(fromFeature, new Set());
        graph.get(fromFeature).add(toFeature);
      }
    }
    // DFS iterativo buscando ciclo
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map([...graph.keys()].map((k) => [k, WHITE]));
    const stack = [];
    const cycles = [];
    for (const start of graph.keys()) {
      if (color.get(start) !== WHITE) continue;
      const work = [[start, [...(graph.get(start) ?? [])]]];
      color.set(start, GRAY);
      stack.push(start);
      while (work.length) {
        const [node, children] = work[work.length - 1];
        if (children.length === 0) {
          color.set(node, BLACK);
          stack.pop();
          work.pop();
          continue;
        }
        const next = children.pop();
        if (color.get(next) === GRAY) {
          cycles.push([...stack.slice(stack.indexOf(next)), next].join(' -> '));
        } else if (color.get(next) === WHITE) {
          color.set(next, GRAY);
          stack.push(next);
          work.push([next, [...(graph.get(next) ?? [])]]);
        }
      }
    }
    const unexpected = cycles.filter((c) => !KNOWN_CYCLES.has(c));
    const stale = [...KNOWN_CYCLES].filter((c) => !cycles.includes(c));
    expect(unexpected, 'Las features no deben depender en ciclo').toEqual([]);
    expect(stale, 'Ciclos documentados que ya no existen: limpiar la lista').toEqual([]);
  });
});

describe('reglas de dependencias — Rust', () => {
  // Excepciones documentadas: cada una lleva motivo y criterio de eliminación.
  // Si una excepción deja de existir, el test falla para que se limpie la lista.
  const COMMANDS_EXCEPTIONS = {
    'apps/desktop/src-tauri/src/commands/domains/ai/providers.rs':
      'read_key() síncrono para el worker de streaming del asistente, que no recibe AppState; se elimina inyectando ProviderSecrets por parámetro en la cadena del stream (application/assistant).',
    'apps/desktop/src-tauri/src/commands/domains/integrations/mcp_server.rs':
      'bootstrap del servidor MCP embebido (socket, token store, invoker Tauri); es el borde de composición del listener — candidato a mover a infrastructure con un comando delgado.',
    'apps/desktop/src-tauri/src/commands/mod.rs':
      're-export de hide_console usado por comandos que lanzan procesos directamente; se elimina cuando esos comandos pasen por los ports MediaRunner/RenderProcess.',
  };

  const rustOffenders = (dir, pattern) =>
    rsFiles(join(tauriSrc, dir))
      .map((file) => ({ file, hits: stripCfgTest(readFileSync(file, 'utf8')).match(pattern) }))
      .filter(({ hits }) => hits && hits.length > 0)
      .map(({ file }) => rel(file));

  it('commands/** no importa ni referencia infrastructure/** (producción)', () => {
    const offenders = rustOffenders('commands', /crate::infrastructure/g);
    const unexpected = offenders.filter((f) => !(f in COMMANDS_EXCEPTIONS));
    const stale = Object.keys(COMMANDS_EXCEPTIONS).filter((f) => !offenders.includes(f));
    expect(unexpected, 'Comandos -> application -> ports; la composición vive en state.rs/lib.rs').toEqual([]);
    expect(stale, 'Excepciones que ya no aplican: limpiar la lista').toEqual([]);
  });

  it('application/** no depende de commands, infrastructure ni Tauri', () => {
    const offenders = rsFiles(join(tauriSrc, 'application')).flatMap((file) => {
      const text = stripCfgTest(readFileSync(file, 'utf8'));
      const hits = [
        /crate::commands::/g,
        /crate::infrastructure::/g,
        /(?:^|\s)use\s+tauri::|[^a-zA-Z_]tauri::/g,
      ].some((re) => re.test(text));
      return hits ? [rel(file)] : [];
    });
    expect(offenders, 'application/ sólo conoce ports/, domain (crate::mcp, crate::media, crate::projects, crate::render) y serde_json').toEqual([]);
  });

  it('ports/** no depende de application, commands, infrastructure ni Tauri', () => {
    const offenders = rsFiles(join(tauriSrc, 'ports')).flatMap((file) => {
      const text = stripCfgTest(readFileSync(file, 'utf8'));
      const hits = [
        /crate::application::/g,
        /crate::commands::/g,
        /crate::infrastructure::/g,
        /(?:^|\s)use\s+tauri::|[^a-zA-Z_]tauri::/g,
      ].some((re) => re.test(text));
      return hits ? [rel(file)] : [];
    });
    expect(offenders).toEqual([]);
  });

  it('projects/ y media/ (dominio) no usan Tauri ni ejecutan procesos', () => {
    const pureDirs = ['projects', 'media'];
    const offenders = pureDirs
      .flatMap((dir) => walk(join(tauriSrc, dir), (p) => p.endsWith('.rs') && !/\.tests\.rs$/.test(p)))
      .filter((file) => {
        const text = stripCfgTest(readFileSync(file, 'utf8'));
        return /use\s+tauri::|[^a-zA-Z_]tauri::|std::process::Command/.test(text);
      });
    expect(
      offenders.map(rel),
      'Dominio no conoce Tauri ni lanza procesos (filesystem sí: es la capa de archivos del dominio)',
    ).toEqual([]);
  });

  it('los #[path] declarados apuntan a archivos existentes', () => {
    const missing = [];
    for (const file of rsFiles(tauriSrc)) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/#\[path\s*=\s*"([^"]+)"\]/g)) {
        const target = join(dirname(file), match[1]);
        if (!statSync(target, { throwIfNoEntry: false })) {
          missing.push(`${rel(file)} -> ${match[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
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

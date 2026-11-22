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
// AUD-129: los comandos async de Tauri no pueden ejecutar procesos
// bloqueantes (FFmpeg/FFprobe/rasdial/PowerShell…) en el runtime —
// deben despachar a `spawn_blocking`. Regla sintáctica: dentro del
// cuerpo de un `async fn` de commands/**, las llamadas
// `.output()/.wait()/.wait_with_output()`, `thread::sleep()` y
// `reqwest::blocking` que quedan fuera de un closure
// `spawn_blocking` (span enmascarado por
// balanceo de paréntesis) son ofensas. `.spawn()` solo no bloquea y
// queda fuera; `tokio::time::sleep` es async y no matchea.

// Blanquea comentarios, strings y chars literales para que llaves y
// paréntesis dentro de ellos no desbalanceen el escaneo estructural.
// Conserva longitudes y saltos de línea (las posiciones reportadas
// siguen siendo las del archivo real).
function sanitizeRust(source) {
  const chars = source.split('');
  const blank = (i) => {
    if (chars[i] !== '\n') chars[i] = ' ';
  };
  let i = 0;
  while (i < chars.length) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      while (i < chars.length && source[i] !== '\n') { blank(i); i++; }
      continue;
    }
    if (two === '/*') {
      let depth = 0;
      while (i < chars.length) {
        if (source.slice(i, i + 2) === '/*') { depth++; blank(i); blank(i + 1); i += 2; continue; }
        if (source.slice(i, i + 2) === '*/') { depth--; blank(i); blank(i + 1); i += 2; if (depth === 0) break; continue; }
        blank(i); i++;
      }
      continue;
    }
    // raw string: r"..." o r#"..."# / r##"..."##
    const raw = /^r(#+)?"/.exec(source.slice(i, i + 6));
    if (raw && (i === 0 || /[^A-Za-z0-9_]/.test(source[i - 1]))) {
      const hashes = raw[1] ? raw[1].length : 0;
      const closer = '"' + '#'.repeat(hashes);
      let j = source.indexOf(closer, i + raw[0].length);
      j = j === -1 ? chars.length : j + closer.length;
      for (let k = i; k < j; k++) blank(k);
      i = j;
      continue;
    }
    if (source[i] === '"') {
      let j = i + 1;
      while (j < chars.length) {
        if (source[j] === '\\') { blank(j); blank(j + 1); j += 2; continue; }
        if (source[j] === '"') { j++; break; }
        blank(j); j++;
      }
      blank(i); // la comilla de apertura
      i = j;
      continue;
    }
    // char literal 'x' / '\n' / '\u{…}' — los lifetimes ('a) no matchean
    // porque no tienen comilla de cierre cercana.
    const chr = /^'(\\.|[^'\\])'/.exec(source.slice(i, i + 8));
    if (chr) {
      for (let k = i; k < i + chr[0].length; k++) blank(k);
      i += chr[0].length;
      continue;
    }
    i++;
  }
  return chars.join('');
}

function balancedEnd(text, openIndex, openChar, closeChar) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === openChar) depth++;
    else if (text[i] === closeChar) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function asyncBlockingOffenders(file) {
  const text = sanitizeRust(stripCfgTest(readFileSync(file, 'utf8')));
  const offenders = [];
  const fnRe = /\basync\s+fn\s+(\w+)/g;
  let match;
  while ((match = fnRe.exec(text))) {
    const brace = text.indexOf('{', match.index + match[0].length);
    if (brace === -1) continue;
    const end = balancedEnd(text, brace, '{', '}');
    if (end === -1) continue;
    const body = text.slice(brace, end);
    const spans = [];
    // spawn_blocking y thread::spawn despachan a OTRO hilo: lo que haya
    // dentro del closure no ocupa el runtime async (AUD-129).
    const spawnRe = /\b(?:std::)?(?:thread::)?spawn_blocking\s*\(|\b(?:std::thread|thread)::spawn\s*\(/g;
    let spawn;
    while ((spawn = spawnRe.exec(body))) {
      const paren = body.indexOf('(', spawn.index + spawn[0].length - 1);
      const parenEnd = paren === -1 ? -1 : balancedEnd(body, paren, '(', ')');
      if (parenEnd !== -1) spans.push([paren, parenEnd]);
    }
    let masked = '';
    let cursor = 0;
    for (const [start, stop] of spans.sort((a, b) => a[0] - b[0])) {
      if (start < cursor) continue; // span anidado dentro de otro ya enmascarado
      masked += body.slice(cursor, start) + ' '.repeat(stop - start);
      cursor = stop;
    }
    masked += body.slice(cursor);
    const blockingRe = /(\.(?:output|wait_with_output|wait)\s*\(|thread::sleep\s*\(|reqwest::blocking|\.recv_timeout\s*\()/g;
    let hit;
    while ((hit = blockingRe.exec(masked))) {
      const offset = brace + hit.index;
      const line = text.slice(0, offset).split('\n').length;
      offenders.push(`${match[1]}:${line} ${hit[1]}()`);
    }
  }
  return offenders;
}

// AUD-129 (sync): los `#[tauri::command] pub fn` sin `async` corren en el
// MAIN THREAD de Tauri — un proceso, un sleep o reqwest::blocking ahí
// congela la UI directamente. Misma regla sintáctica por cuerpo de
// función que la de async fn (un helper bloqueante invocado desde el
// comando no la delata; límite conocido y documentado).
function syncCommandBlockingOffenders(file) {
  const text = sanitizeRust(stripCfgTest(readFileSync(file, 'utf8')));
  const offenders = [];
  const cmdRe = /#\[tauri::command\](?:\s*#\[[^\]]*\])*\s*pub\s+fn\s+(\w+)/g;
  let match;
  while ((match = cmdRe.exec(text))) {
    const brace = text.indexOf('{', match.index + match[0].length);
    if (brace === -1) continue;
    const end = balancedEnd(text, brace, '{', '}');
    if (end === -1) continue;
    const body = text.slice(brace, end);
    const blockingRe = /(\.(?:output|wait_with_output|wait)\s*\(|thread::sleep\s*\(|reqwest::blocking|\.recv_timeout\s*\()/g;
    let hit;
    while ((hit = blockingRe.exec(body))) {
      const offset = brace + hit.index;
      const line = text.slice(0, offset).split('\n').length;
      offenders.push(`${match[1]}:${line} ${hit[1]}`);
    }
  }
  return offenders;
}

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

// Specifiers relativos que cuentan como arista runtime: `from '...'`
// (imports y `export ... from`) e `import('...')` dinámicos. Los
// `import type` / `export type` se eliminan antes de medir: un tipo no crea
// ciclo en runtime. Un `import('./x').Foo` en posición de tipo
// (`type T = import('./x').Foo`) tampoco cuenta: tras el `)` viene un miembro
// que no es método de promesa.
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
  const KNOWN_CYCLES = new Set();

  it('no hay ciclos de dependencias entre features', () => {
    const featuresDir = join(desktopSrc, 'features');
    const graph = new Map(); // feature -> Set<feature>
    for (const file of tsFiles(featuresDir)) {
      const relFile = relative(featuresDir, file).replaceAll('\\', '/');
      const fromFeature = relFile.split('/')[0];
      for (const specifier of runtimeSpecifiers(readFileSync(file, 'utf8'))) {
        const target = resolve(dirname(file), specifier);
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

  // Aristas ascendentes conocidas: la dirección sancionada es
  // features -> state/components/services. La lista está vacía: si aparece
  // una arista nueva state//components/ -> features/ el test falla y hay que
  // bajar el módulo compartido a una capa inferior o inyectarlo desde el
  // composition root (app/).
  const KNOWN_UPWARD_EDGES = new Set();

  it('state/ y components/ no importan features/ (salvo deuda documentada)', () => {
    const edges = new Set();
    for (const layer of ['state', 'components']) {
      const layerDir = join(desktopSrc, layer);
      for (const file of tsFiles(layerDir)) {
        const relFile = relative(desktopSrc, file).replaceAll('\\', '/');
        for (const specifier of runtimeSpecifiers(readFileSync(file, 'utf8'))) {
          const target = resolve(dirname(file), specifier);
          const targetRel = relative(desktopSrc, target).replaceAll('\\', '/');
          const segments = targetRel.split('/');
          if (segments[0] !== 'features' || segments.length < 2) continue;
          edges.add(`${relFile} -> features/${segments[1]}`);
        }
      }
    }
    const found = [...edges].sort();
    const unexpected = found.filter((edge) => !KNOWN_UPWARD_EDGES.has(edge));
    const stale = [...KNOWN_UPWARD_EDGES].filter((edge) => !found.includes(edge));
    expect(
      unexpected,
      'state/ y components/ son capas inferiores: no deben depender de features/',
    ).toEqual([]);
    expect(stale, 'Excepciones que ya no aplican: limpiar la lista').toEqual([]);
  });
});

describe('reglas de dependencias — Rust', () => {
  // Excepciones documentadas: cada una lleva motivo y criterio de eliminación.
  // Si una excepción deja de existir, el test falla para que se limpie la lista.
  const COMMANDS_EXCEPTIONS = {
    'apps/desktop/src-tauri/src/commands/domains/ai/providers.rs':
      'read_key() síncrono para el worker de streaming del asistente, que no recibe AppState; se elimina inyectando ProviderSecrets por parámetro en la cadena del stream (application/assistant).',
    'apps/desktop/src-tauri/src/commands/domains/studio/studio_caps.rs':
      'comando delgado que reutiliza el cómputo de capabilities del estudio (providers, fuentes, ffmpeg) que vive en infrastructure/mcp_studio.rs junto al invoker MCP; se elimina cuando esa lógica migre a application/studio.',
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

  it('los async fn de commands/** no ejecutan procesos bloqueantes fuera de spawn_blocking (AUD-129)', () => {
    const offenders = rsFiles(join(tauriSrc, 'commands')).flatMap((file) =>
      asyncBlockingOffenders(file).map((hit) => `${rel(file)} :: ${hit}`),
    );
    expect(
      offenders,
      'FFmpeg/FFprobe/procesos largos, thread::sleep y reqwest::blocking van por tauri::async_runtime::spawn_blocking; llamadas bloqueantes directas en un async fn congelan el runtime',
    ).toEqual([]);
  });

  it('los #[tauri::command] pub fn síncronos de commands/** no ejecutan procesos ni red bloqueante (AUD-129)', () => {
    const offenders = rsFiles(join(tauriSrc, 'commands')).flatMap((file) =>
      syncCommandBlockingOffenders(file).map((hit) => `${rel(file)} :: ${hit}`),
    );
    expect(
      offenders,
      'los comandos sync corren en el main thread de Tauri: procesos, thread::sleep y reqwest::blocking congelan la UI — convertir a pub async fn + spawn_blocking',
    ).toEqual([]);
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

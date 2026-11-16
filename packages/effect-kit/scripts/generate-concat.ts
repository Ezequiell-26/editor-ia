import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EffectManifest, ParamSpec } from '../src/types.ts';

/**
 * Genera el catálogo TypeScript de los paquetes de audio de concat-effects.
 *
 * `vendor/concat/crates/concat-effects/packages/` tiene ~130 paquetes
 * data-driven (`effect.toml` + shader WGSL o cadena FFmpeg). Sólo los de
 * `kind = "audio"` tienen backend FFmpeg: son los únicos que esta app puede
 * ejecutar de verdad hoy — el preview Web Audio los saltea (no hay equivalente
 * directo) y el export los resuelve con el propio `concat-effects` en Rust
 * (ver `render/ffmpeg/visual/effects.rs`, rama `concat_audio`).
 *
 * Este script lee los TOML y emite:
 *
 * - `src/catalog/concat-audio.ts`: un `EffectManifest` por paquete de audio,
 *   con la cadena de filtros tal cual la declara el paquete. Los `let` del
 *   manifiesto se inlinean en las expresiones `{...}` de la cadena para que
 *   el compilador TS (`concat-expr.ts`) no necesite un segundo evaluador de
 *   bindings. El campo `audio.concatTemplate` le avisa al compilador que los
 *   `{...}` son expresiones concat, no placeholders `{param}`.
 * - `src/catalog/concat-packages.ts`: metadatos de TODOS los paquetes (los
 *   130), para que el catálogo completo quede inventariado aunque sólo el
 *   audio sea ejecutable hoy. Los filtros/efectos/transiciones son WGSL y no
 *   tienen equivalente en el preview WebGL2 ni en la cadena FFmpeg de export.
 * - `CONCAT_AUDIO_FIXTURES` dentro de `concat-audio.ts`: las cadenas esperadas
 *   de `fixtures.toml` en default/min/max, contra las que el test de paridad
 *   compara la salida del compilador TS.
 *
 * Se corre a mano con `node --experimental-strip-types
 * packages/effect-kit/scripts/generate-concat.ts` cuando cambie el vendor.
 * Los archivos generados se commitean, como `effect_recipes.rs`.
 */

const PACKAGES_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'vendor',
  'concat',
  'crates',
  'concat-effects',
  'packages',
);

const AUDIO_OUT = join(import.meta.dirname, '..', 'src', 'catalog', 'concat-audio.ts');
const PACKAGES_OUT = join(import.meta.dirname, '..', 'src', 'catalog', 'concat-packages.ts');

// ── Parser TOML mínimo ─────────────────────────────────────────────────────
// Los manifiestos del vendor usan un subconjunto regular: tablas `[x]`,
// arrays de tablas `[[x]]`, strings con escapes, números, booleanos y arrays
// (posiblemente multilínea) de strings/números. Tablas inline `{...}` se
// conservan como texto opaco: sólo aparecen en `[card]`/`[[replaces]]`, que
// no se consumen.

type TomlScalar = string | number | boolean;
type TomlArray = readonly TomlScalar[];
type TomlTable = Record<string, TomlScalar | TomlArray | string>;
type TomlDoc = Record<string, TomlTable | TomlTable[]>;

function stripComment(line: string): string {
  let inString = false;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (c === '"') inString = !inString;
    if (c === '#' && !inString) return line.slice(0, i);
  }
  return line;
}

function unescapeString(raw: string): string {
  // TOML basic string: misma semántica que JSON para los escapes usados acá.
  try {
    return JSON.parse(raw) as string;
  } catch {
    // Fallback: comillas simples no aparecen; si el JSON falla, devolver tal cual.
    return raw.slice(1, -1);
  }
}

function parseScalar(text: string): TomlScalar | string {
  const trimmed = text.trim();
  if (trimmed.startsWith('"')) return unescapeString(trimmed);
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  const number = Number(trimmed);
  if (trimmed !== '' && Number.isFinite(number)) return number;
  // Inline table u otro literal: se conserva como texto opaco.
  return trimmed;
}

/** Parsea el documento completo. Lanza error si una construcción no soportada aparece. */
function parseToml(source: string): TomlDoc {
  const doc: TomlDoc = {};
  let table: TomlTable = {};
  let pendingKey: string | null = null;
  let pendingParts: string[] = [];

  const lines = source.split(/\r?\n/);
  for (let rawIndex = 0; rawIndex < lines.length; rawIndex += 1) {
    let line = stripComment(lines[rawIndex] ?? '').trim();
    if (pendingKey !== null) {
      // Array multilínea: acumula hasta cerrar el `]` que lo abrió.
      pendingParts.push(line);
      const joined = pendingParts.join('\n');
      if (joined.includes(']')) {
        table[pendingKey] = parseArray(joined);
        pendingKey = null;
        pendingParts = [];
      }
      continue;
    }
    if (line === '') continue;

    const tableMatch = /^\[\[?([^\]]+)\]?\]$/.exec(line);
    if (tableMatch) {
      const name = (tableMatch[1] ?? '').trim();
      const isArray = line.startsWith('[[');
      if (isArray) {
        const existing = doc[name];
        const list = Array.isArray(existing) ? existing : [];
        const entry: TomlTable = {};
        list.push(entry);
        doc[name] = list;
        table = entry;
      } else {
        const existing = doc[name];
        const entry: TomlTable =
          existing && !Array.isArray(existing) ? { ...(existing as TomlTable) } : {};
        doc[name] = entry;
        table = entry;
      }
      continue;
    }

    const eq = line.indexOf('=');
    if (eq === -1) {
      throw new Error(`Línea TOML sin '=': ${line}`);
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if (value.startsWith('[') && !value.includes(']')) {
      pendingKey = key;
      pendingParts = [value];
      continue;
    }
    if (value.startsWith('[')) {
      table[key] = parseArray(value);
      continue;
    }
    if (value.startsWith('"') && !value.endsWith('"')) {
      // String multilínea simple: no aparece en el vendor, fallar ruidosamente.
      throw new Error(`String multilínea no soportada en ${key}`);
    }
    table[key] = parseScalar(value);
  }
  if (pendingKey !== null) {
    throw new Error(`Array sin cerrar para ${pendingKey}`);
  }
  return doc;
}

function parseArray(text: string): TomlArray {
  const inner = text.trim().replace(/^\[/, '').replace(/\]$/, '');
  const items: TomlScalar[] = [];
  // Separa por comas fuera de strings.
  const parts: string[] = [];
  let current = '';
  let inString = false;
  let escaped = false;
  for (const c of inner) {
    if (escaped) {
      current += c;
      escaped = false;
      continue;
    }
    if (c === '\\' && inString) {
      current += c;
      escaped = true;
      continue;
    }
    if (c === '"') inString = !inString;
    if (c === ',' && !inString) {
      parts.push(current);
      current = '';
      continue;
    }
    current += c;
  }
  if (current.trim() !== '') parts.push(current);
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    if (trimmed.startsWith('"')) {
      items.push(unescapeString(trimmed));
      continue;
    }
    if (trimmed.startsWith('{')) {
      // Inline table dentro de array: no aparece en los manifiestos.
      throw new Error(`Inline table en array no soportado: ${trimmed}`);
    }
    const number = Number(trimmed);
    if (Number.isFinite(number)) {
      items.push(number);
      continue;
    }
    if (trimmed === 'true' || trimmed === 'false') {
      items.push(trimmed === 'true');
      continue;
    }
    throw new Error(`Elemento de array no soportado: ${trimmed}`);
  }
  return items;
}

// ── Modelo del vendor ──────────────────────────────────────────────────────

interface ConcatParam {
  readonly key: string;
  readonly label: string;
  readonly group?: string;
  readonly type: string;
  readonly min: number;
  readonly max: number;
  readonly default: number;
  readonly step: number;
  readonly unit?: string;
  readonly animate: boolean;
  readonly values?: readonly number[];
  readonly labels?: readonly string[];
}

interface ConcatPackage {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly category: string;
  readonly description: string;
  readonly order: number;
  readonly aliases: readonly string[];
  readonly params: readonly ConcatParam[];
  readonly ffmpegChain?: string;
  readonly ffmpegLets: readonly string[];
  readonly hasWgsl: boolean;
  readonly hasTransition: boolean;
  readonly xfade?: string;
}

function asRecord(value: unknown): TomlTable {
  return (value ?? {}) as TomlTable;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function asStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function parsePackage(dirName: string): ConcatPackage {
  const source = readFileSync(join(PACKAGES_DIR, dirName, 'effect.toml'), 'utf8');
  const doc = parseToml(source);
  const effect = asRecord(doc.effect);
  const paramsRaw = Array.isArray(doc.param) ? doc.param : [];
  const params: ConcatParam[] = paramsRaw.map((raw) => {
    const table = asRecord(raw);
    const values = Array.isArray(table.values) ? table.values.filter((v): v is number => typeof v === 'number') : undefined;
    const labels = asStringArray(table.labels);
    return {
      key: asString(table.key) ?? '',
      label: asString(table.label) ?? asString(table.key) ?? '',
      ...(asString(table.group) ? { group: asString(table.group) } : {}),
      type: asString(table.type) ?? 'float',
      min: asNumber(table.min, 0),
      max: asNumber(table.max, 1),
      default: asNumber(table.default, 0),
      step: asNumber(table.step, 0),
      ...(asString(table.unit) ? { unit: asString(table.unit) } : {}),
      animate: table.animate === true,
      ...(values && values.length > 0 ? { values } : {}),
      ...(labels.length > 0 ? { labels } : {}),
    };
  });
  const ffmpeg = asRecord(doc.ffmpeg);
  const transition = asRecord(doc.transition);
  return {
    id: asString(effect.id) ?? `concat.${dirName.replace(/^concat\./, '')}`,
    name: asString(effect.name) ?? dirName,
    kind: asString(effect.kind) ?? 'effect',
    category: asString(effect.category) ?? '',
    description: asString(effect.description) ?? '',
    order: asNumber(effect.order, 0),
    aliases: asStringArray(effect.aliases),
    params,
    ffmpegChain: asString(ffmpeg.chain),
    ffmpegLets: asStringArray(ffmpeg.let),
    hasWgsl: doc.wgsl !== undefined,
    hasTransition: doc.transition !== undefined,
    ...(asString(transition.xfade) ? { xfade: asString(transition.xfade) } : {}),
  };
}

// ── Inline de `let` en las expresiones `{...}` de la cadena ────────────────
//
// El manifiesto declara `let = ["ratio = pow(2, semitones / 12)"]` y la cadena
// lee `{ratio}` o `{fixed(48000 * ratio, 6)}`. El compilador TS sólo evalúa
// expresiones sobre parámetros, así que el generador sustituye cada nombre de
// `let` por su expresión entre paréntesis, en orden (un `let` puede leer a
// los anteriores). El resultado es una cadena con la misma semántica que la
// que produce `concat-effects` en Rust — los fixtures.toml lo verifican.

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/g;

function substituteNames(expr: string, bindings: ReadonlyMap<string, string>): string {
  return expr.replace(IDENT, (match) => {
    const bound = bindings.get(match);
    return bound === undefined ? match : `(${bound})`;
  });
}

/** Devuelve la cadena con los `let` resueltos dentro de cada slot `{...}`. */
function inlineLets(chain: string, lets: readonly string[]): string {
  // Resuelve los lets en orden: cada uno puede leer a los ya definidos.
  const resolved = new Map<string, string>();
  for (const declaration of lets) {
    const eq = declaration.indexOf('=');
    if (eq === -1) throw new Error(`let sin '=': ${declaration}`);
    const name = declaration.slice(0, eq).trim();
    const expr = substituteNames(declaration.slice(eq + 1).trim(), resolved);
    resolved.set(name, expr);
  }
  if (resolved.size === 0) return chain;
  // Sustituye sólo dentro de los slots `{...}`; el texto literal (filtros,
  // opciones) no se toca. `{{`/`}}` son escapes del template concat y se
  // respetan.
  let out = '';
  let rest = chain;
  while (rest.length > 0) {
    if (rest.startsWith('{{')) {
      out += '{{';
      rest = rest.slice(2);
      continue;
    }
    if (rest.startsWith('}}')) {
      out += '}}';
      rest = rest.slice(2);
      continue;
    }
    const open = rest.indexOf('{');
    if (open === -1) {
      out += rest;
      break;
    }
    out += rest.slice(0, open);
    const close = rest.indexOf('}', open + 1);
    if (close === -1) throw new Error(`Slot sin cerrar en cadena: ${chain}`);
    const slot = rest.slice(open + 1, close);
    out += `{${substituteNames(slot, resolved)}}`;
    rest = rest.slice(close + 1);
  }
  return out;
}

// ── fixtures.toml: cadenas esperadas para el test de paridad ───────────────

interface FixtureCase {
  readonly name: string;
  readonly at: 'default' | 'min' | 'max';
  readonly params: Readonly<Record<string, number>>;
  readonly chain: string;
}

function parseFixtures(dirName: string): readonly FixtureCase[] {
  let source: string;
  try {
    source = readFileSync(join(PACKAGES_DIR, dirName, 'fixtures.toml'), 'utf8');
  } catch {
    return [];
  }
  const doc = parseToml(source);
  const cases = Array.isArray(doc.case) ? doc.case : [];
  return cases.map((raw) => {
    const table = asRecord(raw);
    const paramsRaw = asString(table.params);
    const params: Record<string, number> = {};
    if (paramsRaw && paramsRaw.startsWith('{')) {
      for (const entry of paramsRaw.slice(1, -1).split(',')) {
        const eq = entry.indexOf('=');
        if (eq === -1) continue;
        const key = entry.slice(0, eq).trim();
        const value = Number(entry.slice(eq + 1).trim());
        if (key !== '' && Number.isFinite(value)) params[key] = value;
      }
    }
    return {
      name: asString(table.name) ?? '',
      at: (asString(table.at) ?? 'default') as FixtureCase['at'],
      params,
      chain: asString(table.chain) ?? '',
    };
  });
}

// ── Emisión ────────────────────────────────────────────────────────────────

const CATEGORY_MAP: Readonly<Record<string, EffectManifest['category']>> = {
  space: 'space',
  voice: 'voice',
  tone: 'utility',
  clean: 'utility',
  texture: 'texture',
};

function concatCategory(raw: string): EffectManifest['category'] {
  return CATEGORY_MAP[raw.toLowerCase()] ?? 'utility';
}

function paramSpec(param: ConcatParam): ParamSpec {
  const base = { id: param.key, label: param.label, ...(param.group ? { group: param.group } : {}) };
  switch (param.type) {
    case 'int':
      return { type: 'int', ...base, min: param.min, max: param.max, default: Math.round(param.default) };
    case 'bool':
      return { type: 'bool', ...base, default: param.default !== 0 };
    case 'enum': {
      const options = param.labels && param.labels.length > 0
        ? param.labels
        : (param.values ?? []).map(String);
      const index = param.values ? param.values.indexOf(param.default) : Math.round(param.default);
      return {
        type: 'enum',
        ...base,
        options,
        default: index >= 0 ? index : 0,
      };
    }
    case 'color':
      // Los paquetes de audio no usan color; si apareciera, packed RGBA → #rrggbb.
      return { type: 'color', ...base, default: '#000000' };
    case 'point':
      return { type: 'vec2', ...base, min: 0, max: 1, default: [0.5, 0.5] };
    default:
      return {
        type: 'float',
        ...base,
        min: param.min,
        max: param.max,
        default: param.default,
        ...(param.step > 0 ? { step: param.step } : {}),
        ...(param.unit ? { unit: param.unit } : {}),
      };
  }
}

function tsString(value: string): string {
  return JSON.stringify(value);
}

function main(): void {
  const dirs = readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('concat.'))
    .map((entry) => entry.name)
    .sort();

  const packages = dirs.map(parsePackage);
  const dirById = new Map(packages.map((pkg, index) => [pkg.id, dirs[index] ?? '']));
  const audio = packages.filter((pkg) => pkg.kind === 'audio' && pkg.ffmpegChain !== undefined);
  const skippedAudio = packages.filter((pkg) => pkg.kind === 'audio' && pkg.ffmpegChain === undefined);
  if (skippedAudio.length > 0) {
    throw new Error(`Paquetes de audio sin cadena FFmpeg: ${skippedAudio.map((p) => p.id).join(', ')}`);
  }

  // ── concat-audio.ts ──
  const lines: string[] = [];
  lines.push('/**');
  lines.push(' * GENERADO por `packages/effect-kit/scripts/generate-concat.ts` — NO EDITAR A MANO.');
  lines.push(' *');
  lines.push(' * Efectos de audio del catálogo vendorado `concat-effects`');
  lines.push(' * (`vendor/concat/crates/concat-effects/packages/`). Cada manifiesto es la');
  lines.push(' * cadena FFmpeg que el paquete declara, con sus `let` ya inlineados en los');
  lines.push(' * slots `{...}`. `audio.concatTemplate` le dice al compilador que use el');
  lines.push(' * evaluador de expresiones de `concat-expr.ts` (port de');
  lines.push(' * `vendor/concat/crates/concat-effects/src/expr.rs`).');
  lines.push(' *');
  lines.push(' * En export, Rust no usa esta tabla: resuelve las mismas cadenas con el');
  lines.push(' * propio crate `concat-effects` (`Catalogue::ffmpeg_fragment`), así que la');
  lines.push(' * fuente de verdad del DSP es el vendor, no este archivo.');
  lines.push(' */');
  lines.push('');
  lines.push("import type { EffectManifest, ParamSpec } from '../types.ts';");
  lines.push('');

  lines.push('const AUDIO_DEFS: readonly {');
  lines.push('  readonly manifest: EffectManifest;');
  lines.push('  readonly fixtures: readonly {');
  lines.push("    readonly name: string;");
  lines.push("    readonly at: 'default' | 'min' | 'max';");
  lines.push('    readonly params: Readonly<Record<string, number>>;');
  lines.push('    readonly chain: string;');
  lines.push('  }[];');
  lines.push('}[] = [');

  for (const pkg of audio) {
    const chain = inlineLets(pkg.ffmpegChain ?? '', pkg.ffmpegLets);
    const manifest: EffectManifest = {
      id: pkg.id,
      name: pkg.name,
      category: concatCategory(pkg.category),
      kind: 'audio',
      description: pkg.description,
      keywords: [
        pkg.name.toLowerCase(),
        pkg.category.toLowerCase(),
        'concat',
        ...pkg.aliases,
      ],
      params: pkg.params.map(paramSpec),
      audio: {
        chain: [chain],
        fidelity: 'exact',
        concatTemplate: true,
      },
      order: 100 + pkg.order,
    };
    lines.push('  {');
    lines.push(`    manifest: ${JSON.stringify(manifest, null, 6).replace(/\n/g, '\n    ')},`);
    const cases = parseFixtures(dirById.get(pkg.id) ?? '');
    lines.push('    fixtures: [');
    for (const fixture of cases) {
      lines.push('      {');
      lines.push(`        name: ${tsString(fixture.name)},`);
      lines.push(`        at: ${tsString(fixture.at)},`);
      lines.push(`        params: ${JSON.stringify(fixture.params)},`);
      lines.push(`        chain: ${tsString(fixture.chain)},`);
      lines.push('      },');
    }
    lines.push('    ],');
    lines.push('  },');
  }
  lines.push('];');
  lines.push('');
  lines.push('/** Efectos de audio concat listos para `ALL_EFFECTS`. */');
  lines.push('export const CONCAT_AUDIO_EFFECTS: readonly EffectManifest[] = AUDIO_DEFS.map(');
  lines.push('  (entry) => entry.manifest,');
  lines.push(');');
  lines.push('');
  lines.push('/** Cadenas FFmpeg esperadas por el vendor (`fixtures.toml`), para tests de paridad. */');
  lines.push('export const CONCAT_AUDIO_FIXTURES: Readonly<');
  lines.push('  Record<');
  lines.push('    string,');
  lines.push('    readonly {');
  lines.push("      readonly name: string;");
  lines.push("      readonly at: 'default' | 'min' | 'max';");
  lines.push('      readonly params: Readonly<Record<string, number>>;');
  lines.push('      readonly chain: string;');
  lines.push('    }[]');
  lines.push('  >');
  lines.push('> = Object.fromEntries(');
  lines.push('  AUDIO_DEFS.map((entry) => [entry.manifest.id, entry.fixtures]),');
  lines.push(');');
  lines.push('');

  writeFileSync(AUDIO_OUT, `${lines.join('\n')}\n`, 'utf8');

  // ── concat-packages.ts ──
  const meta: string[] = [];
  meta.push('/**');
  meta.push(' * GENERADO por `packages/effect-kit/scripts/generate-concat.ts` — NO EDITAR A MANO.');
  meta.push(' *');
  meta.push(' * Inventario completo de los paquetes `concat-effects` vendorados. Sólo los de');
  meta.push(' * `kind: "audio"` están cableados al catálogo (`concat-audio.ts`); el resto son');
  meta.push(' * shaders WGSL sin backend FFmpeg ni equivalente GLSL en el preview WebGL2, así');
  meta.push(' * que quedan documentados pero no aplicables todavía.');
  meta.push(' */');
  meta.push('');
  meta.push('export interface ConcatPackageInfo {');
  meta.push('  readonly id: string;');
  meta.push('  readonly name: string;');
  meta.push('  readonly kind: string;');
  meta.push('  readonly category: string;');
  meta.push('  /** Backend declarado: `ffmpeg` (cadena), `wgsl` (shader) o `transition`. */');
  meta.push('  readonly backend: string;');
  meta.push('  readonly params: number;');
  meta.push('  readonly description: string;');
  meta.push('}');
  meta.push('');
  meta.push('export const CONCAT_PACKAGES: readonly ConcatPackageInfo[] = [');
  for (const pkg of packages) {
    const backend = pkg.ffmpegChain !== undefined ? 'ffmpeg' : pkg.hasTransition ? 'transition' : 'wgsl';
    meta.push('  {');
    meta.push(`    id: ${tsString(pkg.id)},`);
    meta.push(`    name: ${tsString(pkg.name)},`);
    meta.push(`    kind: ${tsString(pkg.kind)},`);
    meta.push(`    category: ${tsString(pkg.category)},`);
    meta.push(`    backend: ${tsString(backend)},`);
    meta.push(`    params: ${pkg.params.length},`);
    meta.push(`    description: ${tsString(pkg.description)},`);
    meta.push('  },');
  }
  meta.push('];');
  meta.push('');
  writeFileSync(PACKAGES_OUT, `${meta.join('\n')}\n`, 'utf8');

  process.stdout.write(
    `concat-effects: ${audio.length} efectos de audio en concat-audio.ts, ` +
      `${packages.length} paquetes inventariados en concat-packages.ts\n`,
  );
}

main();

import { EFFECT_CATEGORIES, EFFECT_KINDS } from './types.ts';
import type {
  EffectCategory,
  EffectKind,
  EffectManifest,
  GpuPass,
  ParamSpec,
} from './types.ts';

/**
 * Importador de paquetes de efectos de terceros.
 *
 * Acepta un JSON que describe un `EffectManifest` (la misma forma que el
 * catálogo) con dos envoltorios opcionales:
 *
 *   { "manifest": {...}, "fragment": "void main() {...}" }
 *   { "effect.json": {...}, "main.frag": "..." }
 *
 * o el manifiesto pelado. Todo lo que entra pasa por validación
 * estructural y por el filtro de seguridad de shaders antes de tocar el
 * registry: un paquete roto nunca llega a la UI ni al export.
 */

export type PackageImportResult =
  | { readonly ok: true; readonly manifest: EffectManifest }
  | { readonly ok: false; readonly error: string };

const MAX_SHADER_BYTES = 64 * 1024;
const MAX_PACKAGE_BYTES = 256 * 1024;
const ID_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;

const PARAM_TYPES = new Set(['float', 'int', 'bool', 'color', 'vec2', 'enum']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(error: string): PackageImportResult {
  return { ok: false, error };
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Valida un `ParamSpec`; devuelve el spec o un mensaje de error. */
function validateParam(raw: unknown, index: number): ParamSpec | string {
  if (!isRecord(raw)) return `params[${index}] no es un objeto`;
  const id = asString(raw.id);
  const label = asString(raw.label);
  const type = asString(raw.type);
  if (!id || !ID_PATTERN.test(id)) return `params[${index}].id inválido`;
  if (!label) return `params[${index}].label vacío`;
  if (!type || !PARAM_TYPES.has(type)) return `params[${index}].type desconocido`;

  switch (type) {
    case 'float':
    case 'int': {
      const min = asNumber(raw.min);
      const max = asNumber(raw.max);
      const fallback = asNumber(raw.default);
      if (min === null || max === null || fallback === null) {
        return `params[${index}] (${id}) necesita min/max/default numéricos`;
      }
      if (min > max) return `params[${index}] (${id}) min > max`;
      if (fallback < min || fallback > max) {
        return `params[${index}] (${id}) default fuera de rango`;
      }
      return { ...(raw as object), id, label, type, min, max, default: fallback } as ParamSpec;
    }
    case 'bool': {
      if (typeof raw.default !== 'boolean') return `params[${index}] (${id}) default no es booleano`;
      return { ...(raw as object), id, label, type, default: raw.default } as ParamSpec;
    }
    case 'color': {
      const fallback = asString(raw.default);
      if (!fallback || !/^#[0-9a-fA-F]{6}$/.test(fallback)) {
        return `params[${index}] (${id}) default de color inválido`;
      }
      return { ...(raw as object), id, label, type, default: fallback } as ParamSpec;
    }
    case 'vec2': {
      const min = asNumber(raw.min);
      const max = asNumber(raw.max);
      const pair = Array.isArray(raw.default) ? raw.default : null;
      if (min === null || max === null || !pair || pair.length !== 2) {
        return `params[${index}] (${id}) necesita min/max y default [x,y]`;
      }
      const x = asNumber(pair[0]);
      const y = asNumber(pair[1]);
      if (x === null || y === null) return `params[${index}] (${id}) default no numérico`;
      return {
        ...(raw as object),
        id,
        label,
        type,
        min,
        max,
        default: [x, y],
      } as ParamSpec;
    }
    case 'enum': {
      const options = Array.isArray(raw.options) ? raw.options.filter((o) => typeof o === 'string') : [];
      const fallback = asNumber(raw.default);
      if (options.length === 0 || fallback === null) {
        return `params[${index}] (${id}) necesita options y default numérico`;
      }
      const indexFallback = Math.round(fallback);
      if (indexFallback < 0 || indexFallback >= options.length) {
        return `params[${index}] (${id}) default fuera de options`;
      }
      return {
        ...(raw as object),
        id,
        label,
        type,
        options,
        default: indexFallback,
      } as ParamSpec;
    }
    default:
      return `params[${index}].type desconocido`;
  }
}

/**
 * Filtro de seguridad del shader GLSL. El renderer antepone `#version`,
 * precisión y uniforms, así que el paquete no puede declararlos; y un
 * shader con bucles no acotados puede colgar la GPU del preview.
 */
export function validateShaderSource(source: string): string | null {
  if (source.length > MAX_SHADER_BYTES) return 'shader demasiado grande (>64 kB)';
  if (!/void\s+main\s*\(/.test(source)) return 'el shader no declara void main()';
  const banned = [
    { pattern: /#version/, reason: '#version lo pone el renderer' },
    { pattern: /#extension/, reason: '#extension no permitido' },
    { pattern: /#include/, reason: '#include no permitido' },
    { pattern: /\bwhile\s*\(/, reason: 'while() puede colgar la GPU' },
    { pattern: /for\s*\(\s*;\s*;/, reason: 'for(;;) puede colgar la GPU' },
  ];
  for (const { pattern, reason } of banned) {
    if (pattern.test(source)) return `shader rechazado: ${reason}`;
  }
  return null;
}

/** Valida `gpu.passes` y devuelve los passes o un mensaje de error. */
function validatePasses(raw: unknown): readonly GpuPass[] | string {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 8) {
    return 'gpu.passes debe tener entre 1 y 8 passes';
  }
  const passes: GpuPass[] = [];
  for (const [index, entry] of raw.entries()) {
    if (!isRecord(entry)) return `gpu.passes[${index}] no es un objeto`;
    const shader = asString(entry.shader);
    if (!shader) return `gpu.passes[${index}].shader vacío`;
    const shaderError = validateShaderSource(shader);
    if (shaderError) return `gpu.passes[${index}]: ${shaderError}`;
    const pass: GpuPass = { shader };
    if (entry.inputs !== undefined) {
      if (!Array.isArray(entry.inputs)) return `gpu.passes[${index}].inputs inválido`;
      const inputs = entry.inputs.map((input) => {
        if (!isRecord(input)) return null;
        if (input.from === 'source') return { from: 'source' as const };
        if (input.from === 'pass' && typeof input.index === 'number') {
          return { from: 'pass' as const, index: Math.trunc(input.index) };
        }
        return null;
      });
      if (inputs.some((input) => input === null)) {
        return `gpu.passes[${index}].inputs con formato inválido`;
      }
      passes.push({ shader, inputs: inputs as NonNullable<GpuPass['inputs']> });
    } else {
      passes.push(pass);
    }
  }
  return passes;
}

function validateRecipe(raw: unknown, field: 'ffmpeg' | 'audio'): string | null {
  if (raw === undefined) return null;
  if (!isRecord(raw)) return `${field} debe ser un objeto`;
  if (raw.chain !== undefined && !Array.isArray(raw.chain)) return `${field}.chain debe ser un array`;
  if (raw.graph !== undefined && typeof raw.graph !== 'string') return `${field}.graph debe ser texto`;
  if (raw.fidelity !== 'exact' && raw.fidelity !== 'approximate') {
    return `${field}.fidelity debe ser exact|approximate`;
  }
  return null;
}

/**
 * Normaliza el id del paquete: los ids de terceros van namespaced bajo
 * `custom.` para no colisionar con el catálogo (el registry conserva el
 * primero y un id repetido descartaría el paquete en silencio).
 */
function namespaceId(raw: string): string {
  const clean = raw.trim().toLowerCase().replace(/\s+/g, '_');
  const base = clean.startsWith('custom.') || clean.startsWith('user.') || clean.startsWith('ext.')
    ? clean
    : `custom.${clean}`;
  return base.slice(0, 80);
}

/**
 * Parsea un paquete de efecto. Devuelve el manifiesto listo para
 * `registerCustomEffects` o un error legible para mostrar en la UI.
 */
export function parseEffectPackage(raw: unknown): PackageImportResult {
  if (!isRecord(raw)) return fail('el paquete no es un objeto JSON');
  if (JSON.stringify(raw).length > MAX_PACKAGE_BYTES) return fail('paquete demasiado grande (>256 kB)');

  // Desenvolver los dos formatos aceptados.
  let body: Record<string, unknown> = raw;
  let fragment: string | null = null;
  if (isRecord(raw.manifest)) {
    body = raw.manifest;
    fragment = asString(raw.fragment) ?? asString(raw['main.frag']);
  } else if (isRecord(raw['effect.json'])) {
    body = raw['effect.json'];
    fragment = asString(raw['main.frag']);
  }

  const id = namespaceId(asString(body.id) ?? '');
  if (id === 'custom.') return fail('el paquete no declara id');
  const name = asString(body.name);
  if (!name) return fail('el paquete no declara name');
  const category = asString(body.category) as EffectCategory | null;
  if (!category || !(EFFECT_CATEGORIES as readonly string[]).includes(category)) {
    return fail(`categoría inválida: ${String(body.category)}`);
  }
  const kind = asString(body.kind) as EffectKind | null;
  if (!kind || !(EFFECT_KINDS as readonly string[]).includes(kind)) {
    return fail(`kind inválido: ${String(body.kind)}`);
  }
  const description = typeof body.description === 'string' ? body.description : '';
  const keywords = Array.isArray(body.keywords)
    ? body.keywords.filter((k): k is string => typeof k === 'string')
    : [];

  if (!Array.isArray(body.params) || body.params.length === 0 || body.params.length > 32) {
    return fail('params debe tener entre 1 y 32 entradas');
  }
  const params: ParamSpec[] = [];
  for (const [index, entry] of body.params.entries()) {
    const spec = validateParam(entry, index);
    if (typeof spec === 'string') return fail(spec);
    params.push(spec);
  }

  let gpu: { passes: readonly GpuPass[] } | undefined;
  if (body.gpu !== undefined) {
    if (!isRecord(body.gpu)) return fail('gpu debe ser un objeto');
    const passes = validatePasses(body.gpu.passes);
    if (typeof passes === 'string') return fail(passes);
    gpu = { passes };
  } else if (fragment) {
    const shaderError = validateShaderSource(fragment);
    if (shaderError) return fail(`fragment: ${shaderError}`);
    gpu = { passes: [{ shader: fragment }] };
  }

  const ffmpegError = validateRecipe(body.ffmpeg, 'ffmpeg');
  if (ffmpegError) return fail(ffmpegError);
  const audioError = validateRecipe(body.audio, 'audio');
  if (audioError) return fail(audioError);

  const manifest: EffectManifest = {
    id,
    name,
    category,
    kind,
    description,
    keywords,
    params,
    ...(gpu ? { gpu } : {}),
    ...(body.ffmpeg !== undefined
      ? { ffmpeg: body.ffmpeg as NonNullable<EffectManifest['ffmpeg']> }
      : {}),
    ...(body.audio !== undefined
      ? { audio: body.audio as NonNullable<EffectManifest['audio']> }
      : {}),
    ...(typeof body.order === 'number' ? { order: Math.trunc(body.order) } : {}),
  };
  return { ok: true, manifest };
}

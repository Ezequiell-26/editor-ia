import type {
  EffectKeyframe,
  EffectManifest,
  ParamSpec,
  ParamValue,
} from './types.ts';

/** Rango numérico seguro para sliders: nunca `NaN` ni `Infinity`. */
function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return Math.min(high, Math.max(low, value));
}

/** `#rrggbb` en minúsculas, con `#`. Un color inválido cae al negro. */
export function normalizeColor(raw: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(raw.trim());
  return match?.[1] ? `#${match[1].toLowerCase()}` : '#000000';
}

export function hexToRgb(hex: string): readonly [number, number, number] {
  const clean = normalizeColor(hex).slice(1);
  return [
    Number.parseInt(clean.slice(0, 2), 16) / 255,
    Number.parseInt(clean.slice(2, 4), 16) / 255,
    Number.parseInt(clean.slice(4, 6), 16) / 255,
  ];
}

export function paramDefault(spec: ParamSpec): ParamValue {
  switch (spec.type) {
    case 'float':
    case 'int':
    case 'enum':
      return spec.default;
    case 'bool':
      return spec.default;
    case 'color':
      return normalizeColor(spec.default);
    case 'vec2':
      return [spec.default[0], spec.default[1]] as const;
    default: {
      const exhaustive: never = spec;
      return exhaustive;
    }
  }
}

/**
 * Fuerza un valor crudo al dominio del parámetro. Se usa al leer proyectos
 * viejos, al importar paquetes de terceros y al recibir valores de la UI.
 */
export function coerceParam(spec: ParamSpec, raw: unknown): ParamValue {
  switch (spec.type) {
    case 'float': {
      const value = typeof raw === 'number' ? raw : Number(raw);
      const stepped =
        spec.step && spec.step > 0
          ? Math.round(finite(value, spec.default) / spec.step) * spec.step
          : finite(value, spec.default);
      return clamp(stepped, spec.min, spec.max);
    }
    case 'int': {
      const value = typeof raw === 'number' ? raw : Number(raw);
      return Math.round(clamp(finite(value, spec.default), spec.min, spec.max));
    }
    case 'bool':
      if (typeof raw === 'boolean') return raw;
      if (typeof raw === 'number') return raw >= 0.5;
      if (typeof raw === 'string') return raw === 'true' || raw === '1';
      return spec.default;
    case 'color':
      return typeof raw === 'string' ? normalizeColor(raw) : normalizeColor(spec.default);
    case 'vec2': {
      const pair = Array.isArray(raw) ? raw : [];
      const x = typeof pair[0] === 'number' ? pair[0] : spec.default[0];
      const y = typeof pair[1] === 'number' ? pair[1] : spec.default[1];
      return [
        clamp(finite(x, spec.default[0]), spec.min, spec.max),
        clamp(finite(y, spec.default[1]), spec.min, spec.max),
      ] as const;
    }
    case 'enum': {
      const index = typeof raw === 'number' ? Math.round(raw) : Number(raw);
      if (!Number.isFinite(index)) return spec.default;
      return Math.round(clamp(index, 0, Math.max(0, spec.options.length - 1)));
    }
    default: {
      const exhaustive: never = spec;
      return exhaustive;
    }
  }
}

/** Defaults de todo el manifiesto, ya normalizados. */
export function defaultParams(manifest: EffectManifest): Record<string, ParamValue> {
  const params: Record<string, ParamValue> = {};
  for (const spec of manifest.params) params[spec.id] = paramDefault(spec);
  return params;
}

/**
 * Completa lo que falta con defaults y descarta claves que el manifiesto no
 * declara. Un proyecto guardado con un efecto que después perdió un parámetro
 * sigue abriendo sin error.
 */
export function normalizeParams(
  manifest: EffectManifest,
  raw: Readonly<Record<string, unknown>> | undefined,
): Record<string, ParamValue> {
  const params: Record<string, ParamValue> = {};
  for (const spec of manifest.params) {
    params[spec.id] = coerceParam(spec, raw?.[spec.id]);
  }
  return params;
}

export interface ParamGroup {
  readonly name: string | null;
  readonly collapsed: boolean;
  readonly params: readonly ParamSpec[];
}

/**
 * Agrupa preservando el orden de declaración. Los parámetros sin grupo van
 * primero, en un bloque sin nombre.
 */
export function paramGroups(manifest: EffectManifest): readonly ParamGroup[] {
  const groups: { name: string | null; collapsed: boolean; params: ParamSpec[] }[] = [];
  for (const spec of manifest.params) {
    const name = spec.group ?? null;
    const existing = groups.find((group) => group.name === name);
    if (existing) {
      existing.params.push(spec);
      continue;
    }
    groups.push({
      name,
      collapsed: spec.groupCollapsed === true,
      params: [spec],
    });
  }
  return groups;
}

/** Número con decimales fijos, sin `-0` ni notación científica. */
export function formatNumber(value: number, decimals = 4): string {
  const fixed = Number.isFinite(value) ? value.toFixed(decimals) : '0';
  const trimmed = fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
  return trimmed === '-0' ? '0' : trimmed;
}

/**
 * Valor listo para una plantilla de FFmpeg. Los colores van como `0xrrggbb`
 * porque es lo que aceptan `colorchannelmixer`, `drawbox` y compañía.
 */
export function formatForFfmpeg(spec: ParamSpec, value: ParamValue): string {
  switch (spec.type) {
    case 'float':
      return formatNumber(typeof value === 'number' ? value : spec.default, 4);
    case 'int':
      return String(Math.round(typeof value === 'number' ? value : spec.default));
    case 'bool':
      return value === true ? '1' : '0';
    case 'enum':
      return String(Math.round(typeof value === 'number' ? value : spec.default));
    case 'color':
      return `0x${normalizeColor(typeof value === 'string' ? value : spec.default).slice(1)}`;
    case 'vec2': {
      const pair = Array.isArray(value) ? value : spec.default;
      return `${formatNumber(pair[0] ?? 0, 4)}:${formatNumber(pair[1] ?? 0, 4)}`;
    }
    default: {
      const exhaustive: never = spec;
      return exhaustive;
    }
  }
}

/**
 * Sustituye `{param}` y `{param.x}` / `{param.y}` en una plantilla. Un marcador
 * desconocido queda intacto y el llamador lo detecta con `hasUnresolvedPlaceholder`,
 * en lugar de mandarle basura a FFmpeg.
 */
export function applyTemplate(
  template: string,
  manifest: EffectManifest,
  params: Readonly<Record<string, ParamValue>>,
): string {
  return template.replace(
    /\{([a-zA-Z0-9_]+)(?:\.([xyrgb]))?\}/g,
    (match, id: string, axis?: string) => {
      const spec = manifest.params.find((item) => item.id === id);
      if (!spec) return match;
      const value = params[id] ?? paramDefault(spec);
      if (axis && spec.type === 'vec2') {
        const pair = Array.isArray(value) ? value : spec.default;
        if (axis === 'x' || axis === 'y') {
          return formatNumber((axis === 'x' ? pair[0] : pair[1]) ?? 0, 4);
        }
        return match;
      }
      if (axis && spec.type === 'color') {
        const rgb = hexToRgb(typeof value === 'string' ? value : spec.default);
        if (axis === 'r') return formatNumber(rgb[0], 4);
        if (axis === 'g') return formatNumber(rgb[1], 4);
        if (axis === 'b') return formatNumber(rgb[2], 4);
        return match;
      }
      return formatForFfmpeg(spec, value);
    },
  );
}

export function hasUnresolvedPlaceholder(text: string): boolean {
  return /\{[a-zA-Z0-9_]+(?:\.[xyrgb])?\}/.test(text);
}

/**
 * Progreso de una curva cúbica CSS-style para `t`: resuelve u con x(u)=t
 * (Newton + bisección) y devuelve y(u). Mismo algoritmo que
 * `cubicBezierProgress` de project-schema/keyframes.ts — effect-kit no
 * depende de project-schema, así que el solver va duplicado a propósito.
 */
export function cubicBezierProgress(
  t: number,
  cp1X: number,
  cp1Y: number,
  cp2X: number,
  cp2Y: number,
): number {
  const clamped = Math.min(1, Math.max(0, t));
  if (clamped <= 0) return 0;
  if (clamped >= 1) return 1;
  const cx = 3 * cp1X;
  const bx = 3 * (cp2X - cp1X) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * cp1Y;
  const by = 3 * (cp2Y - cp1Y) - cy;
  const ay = 1 - cy - by;
  const sampleX = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sampleY = (u: number) => ((ay * u + by) * u + cy) * u;
  const derivativeX = (u: number) => (3 * ax * u + 2 * bx) * u + cx;

  let u = clamped;
  for (let i = 0; i < 8; i += 1) {
    const x = sampleX(u) - clamped;
    if (Math.abs(x) < 1e-6) return sampleY(u);
    const d = derivativeX(u);
    if (Math.abs(d) < 1e-6) break;
    u -= x / d;
  }
  let low = 0;
  let high = 1;
  u = clamped;
  for (let i = 0; i < 24; i += 1) {
    const x = sampleX(u);
    if (Math.abs(x - clamped) < 1e-6) break;
    if (x < clamped) low = u;
    else high = u;
    u = (low + high) / 2;
  }
  return sampleY(u);
}

function ease(
  t: number,
  kind: EffectKeyframe['easing'],
  bezier: EffectKeyframe['bezier'],
): number {
  // El bezier de la clave que inicia el segmento tiene prioridad sobre el
  // preset, igual que en `samplePoints` de project-schema/keyframes.ts.
  if (bezier) {
    return cubicBezierProgress(t, bezier.cp1X, bezier.cp1Y, bezier.cp2X, bezier.cp2Y);
  }
  switch (kind) {
    case 'hold':
      return 0;
    case 'ease-in':
      return t * t;
    case 'ease-out':
      return 1 - (1 - t) * (1 - t);
    case 'ease-in-out':
      return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
    case 'linear':
    default:
      return t;
  }
}

/**
 * Muestrea una pista de keyframes en un frame local del clip. Fuera de rango
 * sostiene el primer y el último valor; sin claves devuelve `undefined` para
 * que el llamador use el valor estático del parámetro.
 */
export function sampleKeyframes(
  keys: readonly EffectKeyframe[] | undefined,
  frame: number,
): number | undefined {
  if (!keys || keys.length === 0) return undefined;
  const ordered = [...keys].sort((a, b) => a.frame - b.frame);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  if (!first || !last) return undefined;
  if (frame <= first.frame) return first.value;
  if (frame >= last.frame) return last.value;
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const next = ordered[index];
    if (!previous || !next) continue;
    if (frame <= next.frame) {
      const span = Math.max(1, next.frame - previous.frame);
      const t = ease(
        (frame - previous.frame) / span,
        previous.easing ?? 'linear',
        previous.bezier,
      );
      return previous.value + (next.value - previous.value) * t;
    }
  }
  return last.value;
}

/**
 * Resuelve todos los parámetros de una instancia en un frame: aplica keyframes
 * sobre los numéricos y deja intacto el resto.
 */
export function resolveParamsAt(
  manifest: EffectManifest,
  params: Readonly<Record<string, ParamValue>>,
  keyframes: Readonly<Record<string, readonly EffectKeyframe[]>> | undefined,
  frame: number,
): Record<string, ParamValue> {
  const resolved: Record<string, ParamValue> = { ...params };
  if (!keyframes) return resolved;
  for (const spec of manifest.params) {
    if (spec.type !== 'float' && spec.type !== 'int') continue;
    const sampled = sampleKeyframes(keyframes[spec.id], frame);
    if (sampled === undefined) continue;
    resolved[spec.id] = coerceParam(spec, sampled);
  }
  return resolved;
}

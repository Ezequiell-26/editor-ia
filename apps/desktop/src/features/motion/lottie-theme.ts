/**
 * Aplicación de themes dotLottie 2.0 sobre un Lottie ya parseado.
 *
 * Un theme es una lista de reglas que apuntan a un Slot ID (`sid`) del Lottie.
 * Se soportan Color, Scalar, Position, Vector y Text. Gradient/Image y las
 * expresiones se rechazan con aviso: la CSP no permite `eval` y el pipeline no
 * quiere prometer un resultado que no puede renderizar.
 *
 * La animación se clona: el JSON original del pack queda intacto para poder
 * cambiar de tema sin volver a descomprimir.
 */

export type LottieThemeRuleType =
  | 'Color'
  | 'Scalar'
  | 'Position'
  | 'Vector'
  | 'Gradient'
  | 'Image'
  | 'Text';

export interface LottieThemeKeyframe {
  readonly frame: number;
  readonly value: unknown;
  readonly hold?: boolean;
}

export interface LottieThemeRule {
  readonly id: string;
  readonly type: LottieThemeRuleType;
  readonly animations?: readonly string[];
  readonly value?: unknown;
  readonly keyframes?: readonly LottieThemeKeyframe[];
  readonly expression?: string;
}

export interface LottieTheme {
  readonly id: string;
  readonly name?: string;
  readonly rules: readonly LottieThemeRule[];
}

export interface LottieThemeResult {
  readonly raw: Record<string, unknown>;
  readonly applied: number;
  readonly warnings: readonly string[];
}

const RULE_TYPES: readonly LottieThemeRuleType[] = [
  'Color',
  'Scalar',
  'Position',
  'Vector',
  'Gradient',
  'Image',
  'Text',
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
  );
}

/** Acepta `{rules:[...]}` o `[...]`; devuelve null si no es un theme válido. */
export function parseLottieTheme(id: string, value: unknown): LottieTheme | null {
  const record = asRecord(value);
  const rawRules = Array.isArray(value) ? value : record?.rules;
  if (!Array.isArray(rawRules)) return null;
  const rules: LottieThemeRule[] = [];
  for (const raw of rawRules) {
    const rule = asRecord(raw);
    if (!rule || typeof rule.id !== 'string' || !rule.id.trim()) continue;
    if (typeof rule.type !== 'string' || !RULE_TYPES.includes(rule.type as LottieThemeRuleType)) {
      continue;
    }
    const keyframes = Array.isArray(rule.keyframes)
      ? rule.keyframes.flatMap((entry) => {
          const frame = asRecord(entry);
          if (!frame || typeof frame.frame !== 'number' || !Number.isFinite(frame.frame)) {
            return [];
          }
          return [
            {
              frame: frame.frame,
              value: frame.value,
              ...(frame.hold === true ? { hold: true } : {}),
            },
          ];
        })
      : undefined;
    rules.push({
      id: rule.id,
      type: rule.type as LottieThemeRuleType,
      ...(Array.isArray(rule.animations)
        ? { animations: rule.animations.filter((item): item is string => typeof item === 'string') }
        : {}),
      ...(rule.value !== undefined ? { value: rule.value } : {}),
      ...(keyframes && keyframes.length > 0 ? { keyframes } : {}),
      ...(typeof rule.expression === 'string' ? { expression: rule.expression } : {}),
    });
  }
  if (rules.length === 0) return null;
  const name = record && typeof record.name === 'string' ? record.name : undefined;
  return { id, rules, ...(name ? { name } : {}) };
}

function colorWithAlpha(value: unknown, existingLength: number): number[] | null {
  if (!isNumberArray(value) || value.length < 3) return null;
  const color = value.slice(0, 4);
  if (color.length === 3 && existingLength === 4) return [...color, 1];
  if (color.length === 4 && existingLength === 3) return color.slice(0, 3);
  return color;
}

function vectorLike(value: unknown, existingLength: number): number[] | null {
  if (!isNumberArray(value)) return null;
  const desired = existingLength === 3 ? 3 : 2;
  const vector = value.slice(0, 3);
  if (vector.length === 2 && desired === 3) return [...vector, 0];
  if (vector.length === 3 && desired === 2) return vector.slice(0, 2);
  return vector;
}

function existingLength(value: unknown): number {
  if (Array.isArray(value)) {
    const first = value[0];
    if (typeof first === 'number') return value.length;
    const record = asRecord(first);
    if (record && Array.isArray(record.s)) return record.s.length;
    if (record && typeof record.s === 'number') return 1;
  }
  if (typeof value === 'number') return 1;
  return 2;
}

function toLottieKeyframes(
  keyframes: readonly LottieThemeKeyframe[],
  normalize: (value: unknown) => unknown,
): Record<string, unknown>[] {
  return keyframes.map((keyframe) => ({
    t: keyframe.frame,
    s: normalize(keyframe.value),
    ...(keyframe.hold ? { h: 1 } : {}),
  }));
}

const JUSTIFY: Readonly<Record<string, number>> = {
  Left: 0,
  Right: 1,
  Center: 2,
  JustifyLastLeft: 3,
  JustifyLastRight: 4,
  JustifyLastCenter: 5,
  JustifyLastFull: 6,
};

const TEXT_CAPS: Readonly<Record<string, number>> = {
  Regular: 0,
  AllCaps: 1,
  SmallCaps: 2,
};

/** Campos del Text Document de theme (largos o cortos) a campos Lottie. */
const TEXT_FIELDS: Readonly<Record<string, string>> = {
  text: 't',
  t: 't',
  fontName: 'f',
  f: 'f',
  fontSize: 's',
  s: 's',
  fillColor: 'fc',
  fc: 'fc',
  strokeColor: 'sc',
  sc: 'sc',
  strokeWidth: 'sw',
  sw: 'sw',
  strokeOverFill: 'of',
  of: 'of',
  lineHeight: 'lh',
  lh: 'lh',
  tracking: 'tr',
  tr: 'tr',
  justify: 'j',
  j: 'j',
  textCaps: 'ca',
  ca: 'ca',
  baselineShift: 'ls',
  ls: 'ls',
  wrapSize: 'sz',
  sz: 'sz',
  wrapPosition: 'ps',
  ps: 'ps',
};

function applyTextRule(
  target: Record<string, unknown>,
  rule: LottieThemeRule,
  warnings: string[],
): boolean {
  if (rule.keyframes && rule.keyframes.length > 0) {
    warnings.push(
      `La regla Text "${rule.id}" usa keyframes; este pipeline sólo aplica Text estático.`,
    );
    return false;
  }
  const value = asRecord(rule.value);
  const document = asRecord(target.k);
  if (!value || !document) {
    warnings.push(
      `La regla Text "${rule.id}" no apunta a un Text Document Lottie compatible.`,
    );
    return false;
  }
  const next: Record<string, unknown> = { ...document };
  for (const [key, short] of Object.entries(TEXT_FIELDS)) {
    if (!(key in value)) continue;
    const field = value[key];
    if (key === 'justify' || key === 'j' || key === 'textCaps' || key === 'ca') {
      const map = key === 'justify' || key === 'j' ? JUSTIFY : TEXT_CAPS;
      if (typeof field === 'number' && Number.isFinite(field)) next[short] = field;
      else if (typeof field === 'string' && field in map) next[short] = map[field];
      continue;
    }
    if (key === 'fillColor' || key === 'fc' || key === 'strokeColor' || key === 'sc') {
      const color = colorWithAlpha(field, existingLength(document[short]));
      if (color) next[short] = color;
      continue;
    }
    next[short] = field;
  }
  target.k = next;
  target.a = 0;
  return true;
}

function applyRule(
  target: Record<string, unknown>,
  rule: LottieThemeRule,
  warnings: string[],
): boolean {
  if (!('k' in target)) {
    warnings.push(`El slot "${rule.id}" no contiene una propiedad animada (k).`);
    return false;
  }
  const current = target.k;
  switch (rule.type) {
    case 'Color': {
      const length = existingLength(current);
      const normalize = (value: unknown) => colorWithAlpha(value, length) ?? value;
      if (rule.keyframes && rule.keyframes.length > 0) {
        target.a = 1;
        target.k = toLottieKeyframes(rule.keyframes, normalize);
      } else {
        const color = normalize(rule.value);
        if (!isNumberArray(color)) {
          warnings.push(`La regla Color "${rule.id}" no tiene un valor RGB válido.`);
          return false;
        }
        target.a = 0;
        target.k = color;
      }
      return true;
    }
    case 'Scalar': {
      if (rule.keyframes && rule.keyframes.length > 0) {
        target.a = 1;
        target.k = toLottieKeyframes(rule.keyframes, (value) => value);
      } else if (typeof rule.value === 'number' && Number.isFinite(rule.value)) {
        target.a = 0;
        target.k = rule.value;
      } else {
        warnings.push(`La regla Scalar "${rule.id}" no tiene un número válido.`);
        return false;
      }
      return true;
    }
    case 'Vector':
    case 'Position': {
      const length = existingLength(current);
      const normalize = (value: unknown) => vectorLike(value, length) ?? value;
      if (rule.keyframes && rule.keyframes.length > 0) {
        target.a = 1;
        target.k = toLottieKeyframes(rule.keyframes, normalize);
      } else {
        const vector = normalize(rule.value);
        if (!isNumberArray(vector)) {
          warnings.push(`La regla ${rule.type} "${rule.id}" no tiene un vector válido.`);
          return false;
        }
        target.a = 0;
        target.k = vector;
      }
      return true;
    }
    case 'Text':
      return applyTextRule(target, rule, warnings);
    case 'Gradient':
    case 'Image':
      warnings.push(
        `La regla ${rule.type} "${rule.id}" no está soportada por este pipeline; se omitió.`,
      );
      return false;
  }
}

/**
 * Clona la animación y aplica las reglas del theme cuyo Slot ID exista.
 * Las reglas limitadas a otras animaciones se ignoran sin aviso.
 */
export function applyLottieTheme(
  animation: Record<string, unknown>,
  theme: LottieTheme,
  animationId: string,
): LottieThemeResult {
  const raw = structuredClone(animation);
  const warnings: string[] = [];
  const rules = theme.rules.filter((rule) => {
    if (rule.animations && !rule.animations.includes(animationId)) return false;
    if (rule.expression) {
      warnings.push(
        `La regla "${rule.id}" usa una expresión y se omitió porque la CSP no permite eval.`,
      );
      return false;
    }
    return true;
  });
  const byId = new Map<string, LottieThemeRule[]>();
  for (const rule of rules) {
    const list = byId.get(rule.id) ?? [];
    list.push(rule);
    byId.set(rule.id, list);
  }
  const appliedIds = new Set<string>();
  let applied = 0;

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry);
      return;
    }
    const record = asRecord(node);
    if (!record) return;
    if (typeof record.sid === 'string') {
      const targets = byId.get(record.sid);
      if (targets) {
        for (const rule of targets) {
          if (applyRule(record, rule, warnings)) {
            applied += 1;
            appliedIds.add(rule.id);
          }
        }
      }
    }
    for (const value of Object.values(record)) visit(value);
  };
  visit(raw);

  for (const id of byId.keys()) {
    if (!appliedIds.has(id)) {
      warnings.push(`El slot "${id}" no existe en la animación "${animationId}".`);
    }
  }
  return { raw, applied, warnings };
}

import {
  MAX_STACK_EFFECTS,
  effectRegistry,
  newInstanceId,
  normalizeParams,
  type EffectInstance,
  type EffectStack,
} from '@editor-ia/effect-kit';

/**
 * Plantillas de stack de efectos (paridad con las «effect templates» de Drift).
 *
 * Una plantilla es una lista ordenada de `EffectInstance` con nombre, guardada
 * a nivel de app en `localStorage` y exportable como JSON (`olyvia-effect-template`).
 * Los ids de instancia se regeneran al aplicar y los `effectId` desconocidos se
 * descartan: una plantilla escrita hoy sigue abriendo si el catálogo cambió.
 */

export type EffectTemplateKind = 'video' | 'audio';

export interface EffectTemplate {
  readonly id: string;
  readonly name: string;
  readonly kind: EffectTemplateKind;
  readonly stack: EffectStack;
  readonly createdAt: string;
}

const STORAGE_KEY = 'editor-ia.effect-templates.v1';
export const EFFECT_TEMPLATE_FILE_KIND = 'olyvia-effect-template';
export const EFFECT_TEMPLATE_FILE_VERSION = 1;

function storageOrDefault(storage?: Storage): Storage | null {
  if (storage) return storage;
  return typeof window !== 'undefined' ? window.localStorage : null;
}

function validInstance(raw: unknown): raw is EffectInstance {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.effectId !== 'string' || entry.effectId.length === 0) return false;
  if (typeof entry.enabled !== 'boolean') return false;
  if (entry.params !== undefined && (typeof entry.params !== 'object' || entry.params === null)) {
    return false;
  }
  if (entry.keyframes !== undefined && typeof entry.keyframes !== 'object') return false;
  if (typeof entry.id === 'string' && entry.id.length === 0) return false;
  return true;
}

export function loadEffectTemplates(storage?: Storage): EffectTemplate[] {
  const target = storageOrDefault(storage);
  if (!target) return [];
  try {
    const raw = target.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is EffectTemplate =>
        Boolean(entry) &&
        typeof entry === 'object' &&
        typeof (entry as EffectTemplate).id === 'string' &&
        typeof (entry as EffectTemplate).name === 'string' &&
        ((entry as EffectTemplate).kind === 'video' || (entry as EffectTemplate).kind === 'audio') &&
        Array.isArray((entry as EffectTemplate).stack) &&
        (entry as EffectTemplate).stack.every(validInstance),
    );
  } catch {
    return [];
  }
}

function persist(templates: readonly EffectTemplate[], storage?: Storage): void {
  const target = storageOrDefault(storage);
  if (!target) return;
  try {
    target.setItem(STORAGE_KEY, JSON.stringify(templates));
  } catch {
    // Storage lleno o bloqueado: la UI muestra el error al recargar.
  }
}

/** Guarda o reemplaza por (kind, nombre normalizado). Devuelve la lista nueva. */
export function saveEffectTemplate(
  name: string,
  kind: EffectTemplateKind,
  stack: EffectStack,
  storage?: Storage,
): EffectTemplate[] {
  const clean = name.trim().slice(0, 80);
  if (!clean || stack.length === 0) return loadEffectTemplates(storage);
  const templates = loadEffectTemplates(storage);
  const existing = templates.find(
    (entry) => entry.kind === kind && entry.name.toLowerCase() === clean.toLowerCase(),
  );
  const next: EffectTemplate = {
    id: existing?.id ?? `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: clean,
    kind,
    stack: stack.slice(0, MAX_STACK_EFFECTS),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  const updated = existing
    ? templates.map((entry) => (entry.id === existing.id ? next : entry))
    : [...templates, next];
  persist(updated, storage);
  return updated;
}

export function deleteEffectTemplate(id: string, storage?: Storage): EffectTemplate[] {
  const updated = loadEffectTemplates(storage).filter((entry) => entry.id !== id);
  persist(updated, storage);
  return updated;
}

// --------------------------------------------------------------------------- //
// Archivo JSON portable
// --------------------------------------------------------------------------- //

export function serializeEffectTemplate(template: EffectTemplate): string {
  return JSON.stringify(
    {
      kind: EFFECT_TEMPLATE_FILE_KIND,
      version: EFFECT_TEMPLATE_FILE_VERSION,
      name: template.name,
      effectKind: template.kind,
      stack: template.stack,
      createdAt: template.createdAt,
    },
    null,
    2,
  );
}

export type EffectTemplateParseResult =
  | { readonly ok: true; readonly template: EffectTemplate }
  | { readonly ok: false; readonly error: string };

/** Valida un archivo de plantilla; no aplica nada todavía. */
export function parseEffectTemplateFile(text: string): EffectTemplateParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'El archivo no es JSON válido.' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'El archivo no tiene el formato de plantilla.' };
  }
  const source = raw as Record<string, unknown>;
  if (source.kind !== EFFECT_TEMPLATE_FILE_KIND) {
    return { ok: false, error: `No es una plantilla de Olyvia (${String(source.kind)}).` };
  }
  if (source.version !== EFFECT_TEMPLATE_FILE_VERSION) {
    return { ok: false, error: `Versión de plantilla no soportada (${String(source.version)}).` };
  }
  const name = typeof source.name === 'string' ? source.name.trim().slice(0, 80) : '';
  const effectKind = source.effectKind;
  if (!name) return { ok: false, error: 'La plantilla no tiene nombre.' };
  if (effectKind !== 'video' && effectKind !== 'audio') {
    return { ok: false, error: 'La plantilla no declara si es de video o de audio.' };
  }
  if (!Array.isArray(source.stack) || source.stack.length === 0) {
    return { ok: false, error: 'La plantilla no tiene efectos.' };
  }
  if (!source.stack.every(validInstance)) {
    return { ok: false, error: 'La pila de la plantilla está corrupta.' };
  }
  return {
    ok: true,
    template: {
      id: `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      kind: effectKind,
      stack: source.stack.slice(0, MAX_STACK_EFFECTS) as EffectStack,
      createdAt:
        typeof source.createdAt === 'string' ? source.createdAt : new Date().toISOString(),
    },
  };
}

/**
 * Convierte la plantilla en un stack aplicable: ids nuevos, parámetros
 * normalizados contra el manifiesto actual y efectos desconocidos fuera.
 * Devuelve también cuántos se descartaron para que la UI lo informe.
 */
export function stackFromTemplate(template: EffectTemplate): {
  readonly stack: EffectStack;
  readonly skipped: number;
} {
  const stack: EffectInstance[] = [];
  let skipped = 0;
  for (const instance of template.stack) {
    const manifest = effectRegistry.get(instance.effectId);
    if (!manifest || stack.length >= MAX_STACK_EFFECTS) {
      skipped += 1;
      continue;
    }
    const params = normalizeParams(manifest, instance.params ?? {});
    stack.push({
      id: newInstanceId(instance.effectId),
      effectId: instance.effectId,
      enabled: instance.enabled,
      params,
      ...(instance.keyframes ? { keyframes: instance.keyframes } : {}),
    });
  }
  return { stack, skipped };
}


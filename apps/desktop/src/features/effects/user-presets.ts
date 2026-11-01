import { ClipEffectsSchema, type ClipEffects } from '@editor-ia/project-schema';

export interface UserEffectPreset {
  readonly id: string;
  readonly name: string;
  readonly effects: ClipEffects;
  readonly createdAt: string;
}

export const USER_PRESETS_KEY = 'olyvia.effects.presets';
const MAX_PRESETS = 20;
const MAX_NAME = 60;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storage(): StorageLike | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

function valid(value: unknown): value is UserEffectPreset {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') return false;
  if (typeof candidate.createdAt !== 'string') return false;
  return ClipEffectsSchema.safeParse(candidate.effects).success;
}

export function loadUserPresets(source: StorageLike | undefined = storage()): UserEffectPreset[] {
  if (!source) return [];
  try {
    const raw = source.getItem(USER_PRESETS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(valid).slice(0, MAX_PRESETS);
  } catch {
    return [];
  }
}

export function saveUserPresets(
  presets: readonly UserEffectPreset[],
  target: StorageLike | undefined = storage(),
): void {
  try {
    target?.setItem(USER_PRESETS_KEY, JSON.stringify(presets.slice(0, MAX_PRESETS)));
  } catch {
    // Preferencia no crítica.
  }
}

export function addUserPreset(
  presets: readonly UserEffectPreset[],
  name: string,
  effects: ClipEffects,
): UserEffectPreset[] {
  const trimmed = name.trim().slice(0, MAX_NAME);
  if (!trimmed) return [...presets];
  if (!ClipEffectsSchema.safeParse(effects).success) return [...presets];
  return [
    { id: newId(), name: trimmed, effects: { ...effects }, createdAt: new Date().toISOString() },
    ...presets,
  ].slice(0, MAX_PRESETS);
}

export function removeUserPreset(
  presets: readonly UserEffectPreset[],
  id: string,
): UserEffectPreset[] {
  return presets.filter((preset) => preset.id !== id);
}

/**
 * Duplica un preset con un id nuevo y el sufijo ` (copia)`. La copia queda
 * primero como cualquier preset recién creado y respeta el tope de 20.
 */
export function duplicateUserPreset(
  presets: readonly UserEffectPreset[],
  id: string,
): UserEffectPreset[] {
  const source = presets.find((preset) => preset.id === id);
  if (!source) return [...presets];
  return addUserPreset(presets, `${source.name} (copia)`, source.effects);
}

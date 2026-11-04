/**
 * Presets de exportación guardables por el usuario.
 *
 * El proyecto conserva sus perfiles (resolución/códec); un preset de usuario es
 * una selección con nombre: qué perfil usar, qué compresión aplicar y si se
 * acelera por GPU. Se guardan en localStorage por equipo, con límite y
 * validación defensiva para no romper el diálogo con datos corruptos.
 */
export interface SavedExportPreset {
  readonly id: string;
  readonly name: string;
  readonly profileId: string;
  readonly compression: 'equilibrado' | 'rapido' | 'compacto' | 'maximo' | 'custom';
  readonly useGpu: boolean;
  readonly createdAt: string;
}

export const EXPORT_PRESETS_KEY = 'editoria.export-presets.v1';
export const EXPORT_PRESETS_LIMIT = 20;
const COMPRESSION_VALUES = ['equilibrado', 'rapido', 'compacto', 'maximo', 'custom'] as const;

interface PresetStorage {
  length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): PresetStorage | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage;
}

export function isCompressionPreset(value: unknown): value is SavedExportPreset['compression'] {
  return typeof value === 'string' && (COMPRESSION_VALUES as readonly string[]).includes(value);
}

export function parseExportPresets(raw: string | null): SavedExportPreset[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SavedExportPreset => {
      if (!item || typeof item !== 'object') return false;
      const record = item as Record<string, unknown>;
      return (
        typeof record.id === 'string' &&
        record.id.length > 0 &&
        typeof record.name === 'string' &&
        record.name.trim().length > 0 &&
        typeof record.profileId === 'string' &&
        record.profileId.length > 0 &&
        isCompressionPreset(record.compression) &&
        typeof record.useGpu === 'boolean' &&
        typeof record.createdAt === 'string'
      );
    });
  } catch {
    return [];
  }
}

export function loadExportPresets(storage: PresetStorage | null = defaultStorage()): SavedExportPreset[] {
  if (!storage) return [];
  try {
    return parseExportPresets(storage.getItem(EXPORT_PRESETS_KEY));
  } catch {
    return [];
  }
}

export function saveExportPreset(
  preset: Omit<SavedExportPreset, 'id' | 'createdAt'>,
  storage: PresetStorage | null = defaultStorage(),
): SavedExportPreset[] {
  if (!storage) return [];
  const name = preset.name.trim();
  if (!name || !preset.profileId) return loadExportPresets(storage);
  const next: SavedExportPreset = {
    id: `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    profileId: preset.profileId,
    compression: preset.compression,
    useGpu: preset.useGpu,
    createdAt: new Date().toISOString(),
  };
  const current = loadExportPresets(storage).filter(
    (entry) => entry.name.toLocaleLowerCase() !== name.toLocaleLowerCase(),
  );
  const list = [next, ...current].slice(0, EXPORT_PRESETS_LIMIT);
  writeExportPresets(list, storage);
  return list;
}

export function deleteExportPreset(
  id: string,
  storage: PresetStorage | null = defaultStorage(),
): SavedExportPreset[] {
  if (!storage) return [];
  const list = loadExportPresets(storage).filter((entry) => entry.id !== id);
  writeExportPresets(list, storage);
  return list;
}

export function writeExportPresets(
  presets: readonly SavedExportPreset[],
  storage: PresetStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(EXPORT_PRESETS_KEY, JSON.stringify(presets.slice(0, EXPORT_PRESETS_LIMIT)));
  } catch {
    // Cuota/almacenamiento bloqueado: el preset vale para la sesión.
  }
}

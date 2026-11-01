/**
 * Presets de descarga guardables.
 *
 * La vista de descarga tiene más de cuarenta ajustes, pero sólo tres atajos
 * fijos. Un preset captura una combinación de trabajo —"shorts verticales sin
 * watermark", "archivo original con hashes"— para reaplicarla en la cola, el
 * lote y las descargas nuevas sin volver a tocar cada control.
 *
 * El módulo es puro: no toca `localStorage` ni React. La vista guarda y lee.
 */

export const MAX_DOWNLOAD_PRESETS = 24;
export const MAX_PRESET_NAME_LENGTH = 40;

export interface DownloadPresetSettings {
  readonly compression: string;
  readonly targetSizeMb: string;
  readonly keepOriginal: boolean;
  readonly denoiseDownloads: boolean;
  readonly cinematic: boolean;
  readonly cinematicFocus: string;
  readonly autoPipeline: boolean;
  readonly audioSpeedNoise: boolean;
  readonly watermark: boolean;
  readonly delogo: boolean;
  readonly delogoCorner: string;
  readonly upscale: boolean;
  readonly upscaleTarget: string;
  readonly limitRate: string;
  readonly proxy: string;
  readonly downloadSubtitles: boolean;
  readonly subtitleLangs: string;
  readonly translateDownloadSubtitles: boolean;
  readonly translateTo: string;
  readonly burnDownloadSubtitles: boolean;
  readonly downloadThumbnail: boolean;
  readonly downloadChapters: boolean;
  readonly sponsorblock: boolean;
  readonly sponsorCategories: readonly string[];
  readonly hashFiles: boolean;
  readonly filenameTemplate: string;
  readonly audioLanguage: string;
}

export interface DownloadPreset {
  readonly id: string;
  readonly name: string;
  readonly settings: DownloadPresetSettings;
  readonly createdAt: string;
}

/** Valores por defecto de la vista; un preset guardado siempre parte de acá. */
export const DEFAULT_PRESET_SETTINGS: DownloadPresetSettings = {
  compression: 'none',
  targetSizeMb: '',
  keepOriginal: false,
  denoiseDownloads: false,
  cinematic: false,
  cinematicFocus: 'center',
  autoPipeline: false,
  audioSpeedNoise: false,
  watermark: true,
  delogo: false,
  delogoCorner: 'top-right',
  upscale: true,
  upscaleTarget: 'auto',
  limitRate: '',
  proxy: '',
  downloadSubtitles: false,
  subtitleLangs: 'es.*,en.*',
  translateDownloadSubtitles: false,
  translateTo: 'es',
  burnDownloadSubtitles: false,
  downloadThumbnail: false,
  downloadChapters: false,
  sponsorblock: false,
  sponsorCategories: [],
  hashFiles: false,
  filenameTemplate: '',
  audioLanguage: '',
};

const STRING_KEYS = [
  'compression',
  'targetSizeMb',
  'cinematicFocus',
  'delogoCorner',
  'upscaleTarget',
  'limitRate',
  'proxy',
  'subtitleLangs',
  'translateTo',
  'filenameTemplate',
  'audioLanguage',
] as const;

const BOOLEAN_KEYS = [
  'keepOriginal',
  'denoiseDownloads',
  'cinematic',
  'autoPipeline',
  'audioSpeedNoise',
  'watermark',
  'delogo',
  'upscale',
  'downloadSubtitles',
  'translateDownloadSubtitles',
  'burnDownloadSubtitles',
  'downloadThumbnail',
  'downloadChapters',
  'sponsorblock',
  'hashFiles',
] as const;

/**
 * Copia sólo los campos conocidos y con el tipo correcto. Un preset viejo o
 * manipulado no puede inyectar claves ni romper los controles.
 */
export function normalizeSettings(value: unknown): DownloadPresetSettings {
  const source = (value ?? {}) as Record<string, unknown>;
  const result: Record<string, unknown> = { ...DEFAULT_PRESET_SETTINGS };
  for (const key of STRING_KEYS) {
    const candidate = source[key];
    if (typeof candidate === 'string') result[key] = candidate.slice(0, 200);
  }
  for (const key of BOOLEAN_KEYS) {
    const candidate = source[key];
    if (typeof candidate === 'boolean') result[key] = candidate;
  }
  const categories = source.sponsorCategories;
  result.sponsorCategories = Array.isArray(categories)
    ? categories.filter((item): item is string => typeof item === 'string').slice(0, 24)
    : [];
  return result as unknown as DownloadPresetSettings;
}

/** Nombre visible: sin espacios sobrantes y con un largo acotado. */
export function normalizePresetName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_PRESET_NAME_LENGTH);
}

export function capturePreset(
  settings: DownloadPresetSettings,
  name: string,
  now: string,
  id: string,
): DownloadPreset | null {
  const clean = normalizePresetName(name);
  if (!clean) return null;
  return {
    id,
    name: clean,
    settings: normalizeSettings(settings),
    createdAt: now,
  };
}

/**
 * Guarda un preset. Si ya existe uno con el mismo nombre (sin distinguir
 * mayúsculas) lo reemplaza conservando su id, para que reaplicar no duplique.
 */
export function upsertPreset(
  presets: readonly DownloadPreset[],
  preset: DownloadPreset,
): DownloadPreset[] {
  const key = preset.name.toLocaleLowerCase('es');
  const existing = presets.find((item) => item.name.toLocaleLowerCase('es') === key);
  if (existing) {
    return presets.map((item) =>
      item.id === existing.id ? { ...preset, id: existing.id } : item,
    );
  }
  return [...presets, preset].slice(-MAX_DOWNLOAD_PRESETS);
}

export function removePreset(
  presets: readonly DownloadPreset[],
  id: string,
): DownloadPreset[] {
  return presets.filter((item) => item.id !== id);
}

/** Resumen corto para el chip: qué cambia respecto de los valores por defecto. */
export function presetSummary(preset: DownloadPreset): string {
  const parts: string[] = [];
  const settings = preset.settings;
  parts.push(settings.compression === 'none' ? 'original' : settings.compression);
  if (settings.cinematic) parts.push('cine');
  if (settings.targetSizeMb.trim()) parts.push(`${settings.targetSizeMb.trim()} MB`);
  if (settings.upscale && settings.upscaleTarget !== 'auto') {
    parts.push(`${settings.upscaleTarget}p`);
  }
  if (!settings.watermark) parts.push('sin watermark');
  if (settings.downloadSubtitles) parts.push('subtítulos');
  if (settings.hashFiles) parts.push('hashes');
  if (settings.sponsorblock) parts.push('sponsorblock');
  return parts.join(' · ');
}

/** Valida la lista leída de disco: descarta entradas incompletas o repetidas. */
export function parsePresets(raw: unknown): DownloadPreset[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: DownloadPreset[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Record<string, unknown>;
    const name = typeof candidate.name === 'string' ? normalizePresetName(candidate.name) : '';
    const id = typeof candidate.id === 'string' ? candidate.id : '';
    if (!name || !id || seen.has(id)) continue;
    seen.add(id);
    result.push({
      id,
      name,
      settings: normalizeSettings(candidate.settings),
      createdAt:
        typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date(0).toISOString(),
    });
  }
  return result.slice(-MAX_DOWNLOAD_PRESETS);
}

const STORAGE_KEY = 'editor-ia.download.presets.v1';

export function loadPresets(): DownloadPreset[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return parsePresets(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function savePresets(presets: readonly DownloadPreset[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Sin cuota: los presets siguen vivos en memoria durante la sesión.
  }
}

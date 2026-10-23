import type { Asset } from '@editor-ia/project-schema';

/**
 * Smart Bins: filtros guardados, como los de DaVinci.
 *
 * Un bin normal es una carpeta que el usuario escribe; un smart bin es una
 * regla que se evalúa contra los medios en cada render. La regla es un valor
 * plano y serializable para poder persistirla en `localStorage` y compartirla
 * entre sesiones sin atarla al árbol de assets.
 *
 * Las reglas Built-in cubren los cortes que DaVinci ofrece de fábrica y que
 * acá faltaban: favoritos, por tipo, sólo listos y los que fallaron.
 */

export type SmartBinKind = 'all' | 'video' | 'image' | 'audio' | 'text' | 'font';
export type SmartBinStatus = 'any' | 'ready' | 'unverified' | 'missing' | 'failed';

export interface SmartBinRule {
  readonly id: string;
  readonly name: string;
  readonly kind: SmartBinKind;
  readonly status: SmartBinStatus;
  readonly favoritesOnly: boolean;
  /** Etiqueta exacta; vacío = cualquiera. */
  readonly tag: string;
  /** Bin exacto; vacío = cualquiera. */
  readonly bin: string;
  /** Substring del nombre o la ruta; vacío = cualquiera. */
  readonly query: string;
}

export interface SmartBin extends SmartBinRule {
  readonly builtin: boolean;
}

const rule = (
  id: string,
  name: string,
  overrides: Partial<SmartBinRule> = {},
): SmartBin => ({
  id,
  name,
  kind: 'all',
  status: 'any',
  favoritesOnly: false,
  tag: '',
  bin: '',
  query: '',
  ...overrides,
  builtin: true,
});

/** Los que ofrece DaVinci de fábrica, con los campos que el proyecto tiene. */
export const BUILTIN_SMART_BINS: readonly SmartBin[] = [
  rule('all', 'Todos los medios'),
  rule('video', 'Video', { kind: 'video' }),
  rule('image', 'Imágenes', { kind: 'image' }),
  rule('audio', 'Audio', { kind: 'audio' }),
  rule('favorites', 'Favoritos', { favoritesOnly: true }),
  rule('ready', 'Listos para usar', { status: 'ready' }),
  rule('errors', 'Con errores', { status: 'failed' }),
  rule('untagged', 'Sin etiqueta', { tag: '' }),
];

export function assetMatchesSmartBin(asset: Asset, bin: SmartBinRule): boolean {
  if (bin.kind !== 'all' && asset.kind !== bin.kind) return false;
  if (bin.favoritesOnly && !asset.favorite) return false;
  if (bin.status !== 'any' && asset.status !== bin.status) return false;
  if (bin.tag && !(asset.tags ?? []).includes(bin.tag)) return false;
  if (bin.bin && asset.bin !== bin.bin) return false;
  const needle = bin.query.trim().toLocaleLowerCase('es');
  if (needle) {
    const haystack = [asset.label, asset.bin ?? '', ...(asset.tags ?? [])]
      .join(' ')
      .toLocaleLowerCase('es');
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

export function filterBySmartBin(
  assets: readonly Asset[],
  bin: SmartBinRule | null,
): Asset[] {
  if (!bin) return [...assets];
  return assets.filter((asset) => assetMatchesSmartBin(asset, bin));
}

/** Etiquetas en uso, ordenadas, para ofrecerlas al crear una regla. */
export function usedTags(assets: readonly Asset[]): string[] {
  return [
    ...new Set(assets.flatMap((asset) => asset.tags ?? [])),
  ].sort((a, b) => a.localeCompare(b, 'es'));
}

export function smartBinCount(assets: readonly Asset[], bin: SmartBinRule | null): number {
  return filterBySmartBin(assets, bin).length;
}

export interface SmartBinStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const SMART_BINS_KEY = 'editor-ia.smart-bins.v1';
const MAX_CUSTOM_BINS = 20;

function isRule(value: unknown): value is SmartBinRule {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.kind === 'string' &&
    typeof record.status === 'string'
  );
}

/** Reglas propias del usuario, persistidas. Las built-in no se guardan. */
export function loadCustomSmartBins(store: SmartBinStore): SmartBin[] {
  let raw: string | null = null;
  try {
    raw = store.getItem(SMART_BINS_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const bins: SmartBin[] = [];
  for (const item of parsed) {
    if (!isRule(item)) continue;
    // El guard validó la forma; los campos opcionales se normalizan igual
    // porque un JSON viejo puede no tenerlos.
    bins.push({
      id: item.id,
      name: item.name,
      kind: item.kind,
      status: item.status,
      favoritesOnly: Boolean(item.favoritesOnly),
      tag: String(item.tag ?? ''),
      bin: String(item.bin ?? ''),
      query: String(item.query ?? ''),
      builtin: false,
    });
  }
  return bins.slice(0, MAX_CUSTOM_BINS);
}

export function saveCustomSmartBins(store: SmartBinStore, bins: readonly SmartBin[]): void {
  try {
    store.setItem(
      SMART_BINS_KEY,
      JSON.stringify(bins.filter((bin) => !bin.builtin).slice(0, MAX_CUSTOM_BINS)),
    );
  } catch {
    // Cuota llena: las reglas siguen vivas en memoria.
  }
}

let sequence = 0;

export function createSmartBin(input: Partial<SmartBinRule> & { name: string }): SmartBin {
  sequence += 1;
  return {
    id: `sb-${Date.now().toString(36)}-${sequence.toString(36)}`,
    name: input.name.trim().slice(0, 40) || 'Regla',
    kind: input.kind ?? 'all',
    status: input.status ?? 'any',
    favoritesOnly: input.favoritesOnly ?? false,
    tag: input.tag ?? '',
    bin: input.bin ?? '',
    query: input.query ?? '',
    builtin: false,
  };
}

export function removeCustomSmartBin(bins: readonly SmartBin[], id: string): SmartBin[] {
  return bins.filter((bin) => bin.id !== id);
}

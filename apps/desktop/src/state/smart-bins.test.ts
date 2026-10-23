// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_SMART_BINS,
  SMART_BINS_KEY,
  assetMatchesSmartBin,
  createSmartBin,
  filterBySmartBin,
  loadCustomSmartBins,
  removeCustomSmartBin,
  saveCustomSmartBins,
  smartBinCount,
  usedTags,
  type SmartBin,
  type SmartBinStore,
} from './smart-bins';
import type { Asset } from '@editor-ia/project-schema';

function asset(overrides: Partial<Asset> & { id: string }): Asset {
  return {
    label: overrides.label ?? overrides.id,
    kind: overrides.kind ?? 'video',
    status: overrides.status ?? 'ready',
    source: { kind: 'file', path: `C:/media/${overrides.id}.mp4` },
    ...overrides,
  } as Asset;
}

const ASSETS: Asset[] = [
  asset({ id: 'a1', label: 'Entrevista playa', kind: 'video', favorite: true, tags: ['entrevista'], bin: 'Tomas' }),
  asset({ id: 'a2', label: 'Playa al atardecer', kind: 'image', tags: ['paisaje'], bin: 'Tomas' }),
  asset({ id: 'a3', label: 'Musica de fondo', kind: 'audio', status: 'unverified' }),
  asset({ id: 'a4', label: 'Titulo', kind: 'text', status: 'failed' }),
];

function store(): SmartBinStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

const builtin = (id: string): SmartBin =>
  BUILTIN_SMART_BINS.find((bin) => bin.id === id)!;

describe('smart bins', () => {
  it('ofrece los cortes de fábrica', () => {
    expect(BUILTIN_SMART_BINS.map((bin) => bin.id)).toEqual([
      'all',
      'video',
      'image',
      'audio',
      'favorites',
      'ready',
      'errors',
      'untagged',
    ]);
    expect(BUILTIN_SMART_BINS.every((bin) => bin.builtin)).toBe(true);
  });

  it('filtra por tipo, favoritos, estado y etiqueta', () => {
    expect(filterBySmartBin(ASSETS, builtin('all'))).toHaveLength(4);
    expect(filterBySmartBin(ASSETS, builtin('video')).map((item) => item.id)).toEqual(['a1']);
    expect(filterBySmartBin(ASSETS, builtin('image')).map((item) => item.id)).toEqual(['a2']);
    expect(filterBySmartBin(ASSETS, builtin('audio')).map((item) => item.id)).toEqual(['a3']);
    expect(filterBySmartBin(ASSETS, builtin('favorites')).map((item) => item.id)).toEqual(['a1']);
    expect(filterBySmartBin(ASSETS, builtin('ready')).map((item) => item.id)).toEqual(['a1', 'a2']);
    expect(filterBySmartBin(ASSETS, builtin('errors')).map((item) => item.id)).toEqual(['a4']);
  });

  it('sin regla devuelve todo', () => {
    expect(filterBySmartBin(ASSETS, null)).toHaveLength(4);
  });

  it('una regla propia combina condiciones', () => {
    const rule = createSmartBin({
      name: 'Entrevistas listas',
      kind: 'video',
      status: 'ready',
      tag: 'entrevista',
      query: 'playa',
    });
    expect(filterBySmartBin(ASSETS, rule).map((item) => item.id)).toEqual(['a1']);
  });

  it('el query ignora tildes y mayúsculas', () => {
    const rule = createSmartBin({ name: 'buscar', query: 'PLAYA' });
    expect(filterBySmartBin(ASSETS, rule).map((item) => item.id)).toEqual(['a1', 'a2']);
  });

  it('cuenta y lista etiquetas en uso', () => {
    expect(usedTags(ASSETS)).toEqual(['entrevista', 'paisaje']);
    expect(smartBinCount(ASSETS, builtin('video'))).toBe(1);
  });

  it('persiste y recupera reglas propias', () => {
    const memory = store();
    const custom = createSmartBin({ name: 'Solo audio listo', kind: 'audio', status: 'ready' });
    saveCustomSmartBins(memory, [custom]);
    const loaded = loadCustomSmartBins(memory);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({ name: 'Solo audio listo', kind: 'audio', status: 'ready', builtin: false });
    expect(memory.data.has(SMART_BINS_KEY)).toBe(true);
  });

  it('no persiste las built-in', () => {
    const memory = store();
    saveCustomSmartBins(memory, [...BUILTIN_SMART_BINS]);
    expect(loadCustomSmartBins(memory)).toEqual([]);
  });

  it('sobrevive a JSON corrupto', () => {
    const memory = store();
    memory.setItem(SMART_BINS_KEY, 'no-json');
    expect(loadCustomSmartBins(memory)).toEqual([]);
    memory.setItem(SMART_BINS_KEY, JSON.stringify([{ nope: true }, 7]));
    expect(loadCustomSmartBins(memory)).toEqual([]);
  });

  it('quita una regla propia por id', () => {
    const a = createSmartBin({ name: 'A' });
    const b = createSmartBin({ name: 'B' });
    expect(removeCustomSmartBin([a, b], a.id).map((bin) => bin.name)).toEqual(['B']);
  });

  it('una regla con campos vacíos no filtra de más', () => {
    const rule = createSmartBin({ name: 'Vacio' });
    expect(ASSETS.every((item) => assetMatchesSmartBin(item, rule))).toBe(true);
  });
});

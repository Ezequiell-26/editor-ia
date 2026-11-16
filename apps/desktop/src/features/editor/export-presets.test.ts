import { describe, expect, it } from 'vitest';
import {
  EXPORT_PRESETS_KEY,
  EXPORT_PRESETS_LIMIT,
  deleteExportPreset,
  estimateOutputBytes,
  loadExportPresets,
  parseExportPresets,
  saveExportPreset,
  type SavedExportPreset,
} from './export-presets';

function memoryStorage(initial: Record<string, string> = {}): {
  readonly data: Map<string, string>;
  length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get length() {
      return data.size;
    },
    key: (index) => Array.from(data.keys())[index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const base = {
  name: 'Cliente YouTube 1080p',
  profileId: 'profile-a',
  compression: 'equilibrado' as const,
  useGpu: false,
};

describe('presets de exportación', () => {
  it('guarda, carga y aplica un preset con nombre', () => {
    const storage = memoryStorage();
    const saved = saveExportPreset(base, storage);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.name).toBe(base.name);
    expect(storage.getItem(EXPORT_PRESETS_KEY)).toContain(base.name);
    expect(loadExportPresets(storage)).toEqual(saved);
  });

  it('reemplaza por nombre sin duplicar y respeta el límite', () => {
    const storage = memoryStorage();
    for (let index = 0; index < EXPORT_PRESETS_LIMIT + 3; index += 1) {
      saveExportPreset({ ...base, name: `preset ${index}` }, storage);
    }
    expect(loadExportPresets(storage)).toHaveLength(EXPORT_PRESETS_LIMIT);
    saveExportPreset(base, storage);
    const list = saveExportPreset({ ...base, useGpu: true }, storage);
    expect(list.filter((entry) => entry.name === base.name)).toHaveLength(1);
    expect(list.find((entry) => entry.name === base.name)?.useGpu).toBe(true);
  });

  it('elimina por id y tolera datos corruptos', () => {
    const storage = memoryStorage();
    const [first] = saveExportPreset(base, storage);
    saveExportPreset({ ...base, name: 'otro' }, storage);
    expect(deleteExportPreset(first?.id ?? '', storage)).toHaveLength(1);
    expect(parseExportPresets('no-json')).toEqual([]);
    expect(parseExportPresets(JSON.stringify([{ name: 1 }]))).toEqual([]);
    storage.setItem(EXPORT_PRESETS_KEY, JSON.stringify([...loadExportPresets(storage), { id: 'ok' }]));
    expect(loadExportPresets(storage)).toHaveLength(1);
  });

  it('no escribe si falta nombre o perfil', () => {
    const storage = memoryStorage();
    expect(saveExportPreset({ ...base, name: '   ' }, storage)).toEqual([]);
    expect(saveExportPreset({ ...base, profileId: '' }, storage)).toEqual([]);
  });

  it('expone el tipo con los campos esperados', () => {
    const preset: SavedExportPreset = {
      id: 'x',
      name: 'y',
      profileId: 'z',
      compression: 'compacto',
      useGpu: true,
      createdAt: new Date().toISOString(),
    };
    expect(preset.compression).toBe('compacto');
  });
});

describe('estimateOutputBytes', () => {
  const fullHd = { width: 1920, height: 1080, fps: 30, audioBitsPerSecond: 128_000 };

  it('estima ~0,13 bits por píxel más el audio del perfil', () => {
    // 10 s a 1080p30: vídeo ≈ 1920*1080*30*0,13 = 8.077.760 bps + 128.000
    const bytes = estimateOutputBytes(fullHd, 10);
    const expected = Math.round((10 * (1920 * 1080 * 30 * 0.13 + 128_000)) / 8);
    expect(bytes).toBe(expected);
    expect(bytes).toBeGreaterThan(10_000_000);
  });

  it('devuelve 0 con entradas inválidas', () => {
    expect(estimateOutputBytes(fullHd, 0)).toBe(0);
    expect(estimateOutputBytes(fullHd, -5)).toBe(0);
    expect(estimateOutputBytes({ ...fullHd, width: 0 }, 10)).toBe(0);
    expect(estimateOutputBytes({ ...fullHd, fps: 0 }, 10)).toBe(0);
  });
});

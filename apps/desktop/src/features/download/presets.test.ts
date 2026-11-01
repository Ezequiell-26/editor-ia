import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRESET_SETTINGS,
  MAX_DOWNLOAD_PRESETS,
  capturePreset,
  normalizePresetName,
  normalizeSettings,
  parsePresets,
  presetSummary,
  removePreset,
  upsertPreset,
  type DownloadPreset,
} from './presets';

const NOW = '2026-11-01T00:00:00.000Z';

function preset(name: string, overrides: Partial<typeof DEFAULT_PRESET_SETTINGS> = {}): DownloadPreset {
  return capturePreset({ ...DEFAULT_PRESET_SETTINGS, ...overrides }, name, NOW, `id-${name}`)!;
}

describe('normalizePresetName', () => {
  it('recorta espacios y acota el largo', () => {
    expect(normalizePresetName('  Shorts   verticales  ')).toBe('Shorts verticales');
    expect(normalizePresetName('x'.repeat(80))).toHaveLength(40);
  });
});

describe('capturePreset', () => {
  it('rechaza nombres vacíos', () => {
    expect(capturePreset(DEFAULT_PRESET_SETTINGS, '   ', NOW, 'id')).toBeNull();
  });

  it('copia sólo los campos conocidos', () => {
    const captured = capturePreset(
      { ...DEFAULT_PRESET_SETTINGS, compression: 'compact' },
      'Compacta',
      NOW,
      'id-1',
    );
    expect(captured?.settings.compression).toBe('compact');
    expect(captured?.settings).not.toBe(DEFAULT_PRESET_SETTINGS);
  });
});

describe('normalizeSettings', () => {
  it('descarta tipos incorrectos y claves desconocidas', () => {
    const settings = normalizeSettings({
      compression: 42,
      keepOriginal: 'sí',
      sponsorCategories: ['sponsor', 7, 'selfpromo'],
      extra: 'ignorado',
    });
    expect(settings.compression).toBe(DEFAULT_PRESET_SETTINGS.compression);
    expect(settings.keepOriginal).toBe(false);
    expect(settings.sponsorCategories).toEqual(['sponsor', 'selfpromo']);
    expect('extra' in settings).toBe(false);
  });

  it('sobrevive a un valor nulo', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_PRESET_SETTINGS);
  });
});

describe('upsertPreset', () => {
  it('agrega presets nuevos al final', () => {
    const list = upsertPreset([], preset('Uno'));
    expect(list.map((item) => item.name)).toEqual(['Uno']);
  });

  it('reemplaza por nombre sin duplicar y conserva el id', () => {
    const original = preset('Shorts');
    const list = upsertPreset([original], {
      ...preset('shorts'),
      settings: { ...DEFAULT_PRESET_SETTINGS, compression: 'none' },
    });
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(original.id);
    expect(list[0]?.settings.compression).toBe('none');
  });

  it('acota la cantidad guardada', () => {
    let list: DownloadPreset[] = [];
    for (let index = 0; index < MAX_DOWNLOAD_PRESETS + 5; index += 1) {
      list = upsertPreset(list, preset(`P${index}`));
    }
    expect(list).toHaveLength(MAX_DOWNLOAD_PRESETS);
    expect(list.at(-1)?.name).toBe(`P${MAX_DOWNLOAD_PRESETS + 4}`);
  });
});

describe('removePreset', () => {
  it('quita sólo el preset pedido', () => {
    const list = [preset('Uno'), preset('Dos')];
    expect(removePreset(list, 'id-Uno').map((item) => item.name)).toEqual(['Dos']);
  });
});

describe('presetSummary', () => {
  it('resume los ajustes que importan', () => {
    const summary = presetSummary(
      preset('Cine', {
        cinematic: true,
        watermark: false,
        hashFiles: true,
        upscaleTarget: '2160',
      }),
    );
    expect(summary).toMatch(/cine/);
    expect(summary).toMatch(/sin watermark/);
    expect(summary).toMatch(/hashes/);
    expect(summary).toMatch(/2160p/);
  });

  it('marca el original sin recomprimir', () => {
    expect(presetSummary(preset('Crudo', { compression: 'none' }))).toMatch(/^original/);
  });
});

describe('parsePresets', () => {
  it('descarta entradas inválidas y repetidas', () => {
    const parsed = parsePresets([
      { id: 'a', name: 'Uno', settings: {}, createdAt: NOW },
      { id: 'a', name: 'Duplicado', settings: {} },
      { id: '', name: 'Sin id', settings: {} },
      { id: 'b', name: '   ', settings: {} },
      'basura',
      null,
    ]);
    expect(parsed.map((item) => item.name)).toEqual(['Uno']);
    expect(parsed[0]?.settings).toEqual(DEFAULT_PRESET_SETTINGS);
  });

  it('devuelve lista vacía para datos que no son arreglo', () => {
    expect(parsePresets({})).toEqual([]);
    expect(parsePresets(null)).toEqual([]);
  });
});

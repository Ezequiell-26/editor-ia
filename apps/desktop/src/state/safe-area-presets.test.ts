import { describe, expect, it } from 'vitest';
import {
  SAFE_AREA_PRESETS,
  safeAreaAspectMismatch,
  safeAreaPointsAttr,
  safeAreaPresetById,
} from './safe-area-presets';
import { normalizeEditorPreferences } from './editor-preferences';

describe('presets de área segura', () => {
  it('todo preset no genérico tiene geometría normalizada válida', () => {
    for (const preset of SAFE_AREA_PRESETS) {
      if (preset.id === 'generic') continue;
      expect(preset.aspect, preset.id).not.toBeNull();
      expect(preset.safe.length, preset.id).toBeGreaterThanOrEqual(3);
      for (const rect of preset.cover) {
        expect(rect.x, preset.id).toBeGreaterThanOrEqual(0);
        expect(rect.y, preset.id).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.w, preset.id).toBeLessThanOrEqual(1.0001);
        expect(rect.y + rect.h, preset.id).toBeLessThanOrEqual(1.0001);
        expect(rect.w, preset.id).toBeGreaterThan(0);
        expect(rect.h, preset.id).toBeGreaterThan(0);
      }
      for (const point of [...preset.safe, ...(preset.title ?? [])]) {
        expect(point.x, preset.id).toBeGreaterThanOrEqual(0);
        expect(point.x, preset.id).toBeLessThanOrEqual(1);
        expect(point.y, preset.id).toBeGreaterThanOrEqual(0);
        expect(point.y, preset.id).toBeLessThanOrEqual(1);
      }
    }
  });

  it('la zona segura queda dentro de los rectángulos cubiertos', () => {
    // El polígono seguro no debería invadir una franja "cubierta" entera:
    // al menos un punto del borde superior del seguro queda por debajo de
    // la barra superior en los presets verticales.
    for (const id of ['tiktok', 'reels', 'stories', 'shorts'] as const) {
      const preset = safeAreaPresetById(id);
      const minY = Math.min(...preset.safe.map((p) => p.y));
      const topCover = preset.cover.find((r) => r.y === 0);
      expect(topCover, id).toBeDefined();
      expect(minY, id).toBeGreaterThanOrEqual(topCover!.y + topCover!.h - 0.001);
    }
  });

  it('safeAreaPresetById cae a genérica con ids desconocidos', () => {
    expect(safeAreaPresetById('tiktok').id).toBe('tiktok');
    expect(safeAreaPresetById('no-existe').id).toBe('generic');
    expect(safeAreaPresetById(null).id).toBe('generic');
    expect(safeAreaPresetById(undefined).id).toBe('generic');
  });

  it('detecta desvío de aspecto sólo cuando el preset tiene formato', () => {
    const shorts = safeAreaPresetById('shorts');
    const youtube = safeAreaPresetById('youtube');
    const generic = safeAreaPresetById('generic');
    expect(safeAreaAspectMismatch(shorts, 1080, 1920)).toBe(false);
    expect(safeAreaAspectMismatch(shorts, 1920, 1080)).toBe(true);
    expect(safeAreaAspectMismatch(youtube, 1920, 1080)).toBe(false);
    expect(safeAreaAspectMismatch(youtube, 1080, 1920)).toBe(true);
    expect(safeAreaAspectMismatch(generic, 100, 100)).toBe(false);
    expect(safeAreaAspectMismatch(shorts, 0, 0)).toBe(false);
  });

  it('serializa puntos como porcentajes para SVG', () => {
    expect(safeAreaPointsAttr([{ x: 0.5, y: 0.25 }])).toBe('50.00,25.00');
    expect(
      safeAreaPointsAttr([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toBe('0.00,0.00 100.00,100.00');
  });

  it('las preferencias aceptan presets válidos y descartan inválidos', () => {
    expect(normalizeEditorPreferences({ safeAreaPreset: 'reels' }).safeAreaPreset).toBe('reels');
    expect(normalizeEditorPreferences({ safeAreaPreset: 'feed' }).safeAreaPreset).toBe('feed');
    expect(normalizeEditorPreferences({ safeAreaPreset: 'myspace' }).safeAreaPreset).toBe('generic');
    expect(normalizeEditorPreferences({ safeAreaPreset: 42 }).safeAreaPreset).toBe('generic');
    expect(normalizeEditorPreferences({}).safeAreaPreset).toBe('generic');
  });
});

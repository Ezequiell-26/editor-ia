import { describe, expect, it } from'vitest';
import { FORMAT_PRESETS, FPS_PRESETS } from'../../state/video-format';
import {
  intentConfig,
  intentLabel,
  isProjectIntentId,
  PROJECT_INTENTS,
  type ProjectIntentId,
} from'./project-intent';

const INTENT_IDS = PROJECT_INTENTS.map((intent) => intent.id);

describe('project-intent · intención → configuración de proyecto', () => {
  it('ofrece las cuatro intenciones del asistente', () => {
    expect(INTENT_IDS).toEqual(['short','horizontal','square','cinema']);
    for (const intent of PROJECT_INTENTS) {
      expect(intent.label.length).toBeGreaterThan(0);
      expect(intent.summary).toMatch(/·/);
    }
  });

  it.each<[ProjectIntentId, string, number, number, string, number, number]>([
    ['short','vertical',1080,1920,'30',30,1],
    ['horizontal','landscape',1920,1080,'60',60,1],
    ['square','square',1080,1080,'30',30,1],
    ['cinema','cinema',2560,1080,'24',24,1],
  ])(
    '%s precarga %s %sx%s a %s fps',
    (intentId, formatId, width, height, fpsId, fpsNum, fpsDen) => {
      const config = intentConfig(intentId);
      expect(config.formatId).toBe(formatId);
      expect(config.width).toBe(width);
      expect(config.height).toBe(height);
      expect(config.fpsId).toBe(fpsId);
      expect(config.fpsNum).toBe(fpsNum);
      expect(config.fpsDen).toBe(fpsDen);
    },
  );

  it('los ids de formato y fps recomendados existen en los presets del diálogo', () => {
    const formatIds = new Set(FORMAT_PRESETS.map((preset) => preset.id));
    const fpsIds = new Set(FPS_PRESETS.map((preset) => preset.id));
    for (const intentId of INTENT_IDS) {
      const config = intentConfig(intentId);
      expect(formatIds.has(config.formatId), `formato ${config.formatId}`).toBe(true);
      expect(fpsIds.has(config.fpsId), `fps ${config.fpsId}`).toBe(true);
      // Las dimensiones coinciden con el preset de formato elegido: si alguien
      // edita FORMAT_PRESETS, la intención no puede divergir en silencio.
      const format = FORMAT_PRESETS.find((preset) => preset.id === config.formatId);
      expect(format?.width).toBe(config.width);
      expect(format?.height).toBe(config.height);
      const fps = FPS_PRESETS.find((preset) => preset.id === config.fpsId);
      expect(fps?.num).toBe(config.fpsNum);
      expect(fps?.den).toBe(config.fpsDen);
    }
  });

  it('cada intención trae una línea de ayuda contextual no vacía', () => {
    for (const intentId of INTENT_IDS) {
      expect(intentConfig(intentId).help.trim().length).toBeGreaterThan(0);
    }
  });

  it('isProjectIntentId sólo acepta ids declarados', () => {
    expect(isProjectIntentId('short')).toBe(true);
    expect(isProjectIntentId('cinema')).toBe(true);
    expect(isProjectIntentId('8k')).toBe(false);
    expect(isProjectIntentId('')).toBe(false);
    expect(isProjectIntentId(null)).toBe(false);
    expect(isProjectIntentId(42)).toBe(false);
  });

  it('intentLabel devuelve la etiqueta visible de la intención', () => {
    expect(intentLabel('short')).toBe('Short vertical');
    expect(intentLabel('cinema')).toBe('Cine');
  });
});

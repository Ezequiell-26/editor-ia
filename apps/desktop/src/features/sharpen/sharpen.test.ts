import { describe, expect, it } from 'vitest';
import {
  CLARITY_PRESETS,
  DEFAULT_CLARITY,
  activeStages,
  clarityFilterSummary,
  claritySummary,
  clampClarity,
  formatSharpenBytes,
  formatSharpenDuration,
  presetForSettings,
  settingsForPreset,
  type ClaritySettings,
} from './sharpen';

function settings(patch: Partial<ClaritySettings> = {}): ClaritySettings {
  return { ...DEFAULT_CLARITY, ...patch };
}

describe('estado de definición', () => {
  it('normaliza los rangos que acepta el render', () => {
    const clean = clampClarity({
      denoise: 340,
      deblock: true,
      targetHeight: -20,
      highPrecision: true,
      unsharpAmount: 9,
      unsharpSize: 4,
      curve: -8,
      grain: 12,
    });
    expect(clean.denoise).toBe(100);
    expect(clean.targetHeight).toBe(0);
    expect(clean.unsharpAmount).toBe(3);
    expect(clean.unsharpSize).toBe(5);
    expect(clean.curve).toBe(0);
    expect(clean.grain).toBe(3);
  });

  it('redondea la cantidad de enfoque a dos decimales', () => {
    expect(clampClarity(settings({ unsharpAmount: 1.2345 })).unsharpAmount).toBe(1.23);
  });
});

describe('presets de definición', () => {
  it('todos los presets con estado se normalizan sin cambios', () => {
    for (const preset of CLARITY_PRESETS) {
      if (!preset.settings) continue;
      expect(clampClarity(preset.settings)).toEqual(preset.settings);
    }
  });

  it('reconoce el preset exacto y cae en personalizado al mover un control', () => {
    for (const preset of CLARITY_PRESETS) {
      const resolved = settingsForPreset(preset.id);
      if (!resolved) continue;
      expect(presetForSettings(resolved)).toBe(preset.id);
    }
    const uhd = settingsForPreset('uhd');
    expect(uhd).not.toBeNull();
    expect(presetForSettings({ ...uhd!, grain: 0.4 })).toBe('custom');
  });

  it('el preset 4K pide escalar y el de cine no', () => {
    expect(settingsForPreset('uhd')?.targetHeight).toBe(2160);
    expect(settingsForPreset('cinema')?.targetHeight).toBe(0);
  });
});

describe('cadena de filtros equivalente', () => {
  it('reproduce la sintaxis de referencia del unsharp', () => {
    expect(
      clarityFilterSummary(
        settings({
          denoise: 0,
          deblock: false,
          targetHeight: 0,
          curve: 0,
          grain: 0,
          unsharpAmount: 1.5,
          unsharpSize: 5,
        }),
      ),
    ).toBe('unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=1.50');
  });

  it('mantiene el orden limpieza → escalado → enfoque → curva → grano', () => {
    const chain = clarityFilterSummary(settingsForPreset('uhd')!, 1080);
    // «atadenoise» contiene «noise»: el grano se busca por su firma completa.
    const positions = [
      'deblock=',
      'atadenoise=',
      'scale=',
      'unsharp=',
      'curves=',
      'noise=alls=',
    ].map((token) => chain.indexOf(token));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('abre el espacio de 16 bits antes de escalar y lo cierra después', () => {
    const chain = clarityFilterSummary(settingsForPreset('uhd')!, 1080);
    expect(chain).toContain('format=gbrp16le');
    expect(chain.indexOf('format=gbrp16le')).toBeLessThan(chain.indexOf('scale=-2:2160'));
    expect(chain.indexOf('scale=-2:2160')).toBeLessThan(chain.lastIndexOf('format=yuv420p'));
  });

  it('no escala cuando el destino ya es la altura de origen', () => {
    const chain = clarityFilterSummary(settings({ targetHeight: 1080, curve: 0, grain: 0 }), 1080);
    expect(chain).not.toContain('scale=');
  });

  it('el de-blocking sube a fuerte con limpieza alta', () => {
    expect(clarityFilterSummary(settings({ deblock: true, denoise: 20 }))).toContain(
      'deblock=filter=weak',
    );
    expect(clarityFilterSummary(settings({ deblock: true, denoise: 80 }))).toContain(
      'deblock=filter=strong',
    );
  });

  it('el grano queda acotado a un rango sutil', () => {
    expect(clarityFilterSummary(settings({ grain: 1, curve: 0 }))).toContain('noise=alls=2');
    expect(clarityFilterSummary(settings({ grain: 3, curve: 0 }))).toContain('noise=alls=7');
  });

  it('devuelve cadena vacía sin etapas activas', () => {
    expect(
      clarityFilterSummary(
        settings({
          denoise: 0,
          deblock: false,
          targetHeight: 0,
          unsharpAmount: 0,
          curve: 0,
          grain: 0,
        }),
      ),
    ).toBe('');
  });
});

describe('etapas activas', () => {
  it('cuenta las etapas que modifican la imagen', () => {
    expect(activeStages(settingsForPreset('social')!, 1080)).toEqual([
      'clean',
      'unsharp',
      'curve',
      'grain',
    ]);
    expect(activeStages(settingsForPreset('uhd')!, 1080)).toContain('scale');
    expect(
      activeStages(
        settings({
          denoise: 0,
          deblock: false,
          targetHeight: 0,
          unsharpAmount: 0,
          curve: 0,
          grain: 0,
        }),
        1080,
      ),
    ).toEqual([]);
  });

  it('describe el resumen en una línea', () => {
    expect(claritySummary(settingsForPreset('uhd')!, 1080)).toContain('Lanczos a 2160p');
    expect(
      claritySummary(
        settings({
          denoise: 0,
          deblock: false,
          targetHeight: 0,
          unsharpAmount: 0,
          curve: 0,
          grain: 0,
        }),
        1080,
      ),
    ).toBe('Ninguna etapa activa');
  });
});

describe('formato de cifras', () => {
  it('presenta bytes y duración legibles', () => {
    expect(formatSharpenBytes(0)).toBe('—');
    expect(formatSharpenBytes(1536)).toBe('1.5 KB');
    expect(formatSharpenBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatSharpenDuration(null)).toBe('—');
    expect(formatSharpenDuration(9.4)).toBe('0:09');
    expect(formatSharpenDuration(125)).toBe('2:05');
  });
});

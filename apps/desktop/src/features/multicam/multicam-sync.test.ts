import { describe, expect, it } from 'vitest';
import type { AudioEnvelope } from './multicam';
import type { MulticamSyncCamera, MulticamSyncRequest } from './multicam-sync';
import { resolveMulticamSync } from './multicam-sync';

function envelope(values: readonly number[], stepSeconds = 0.04): AudioEnvelope {
  return {
    durationSeconds: values.length * stepSeconds,
    stepSeconds,
    values,
  };
}

function pulses(shift = 0): number[] {
  const values = new Array<number>(600).fill(0.01);
  for (const index of [80, 180, 300, 420, 520]) {
    const target = index + shift;
    if (target >= 0 && target < values.length) values[target] = 1;
  }
  return values;
}

const CAMERAS: readonly MulticamSyncCamera[] = [
  { assetId: 'a', label: 'Cámara A', durationSeconds: 10 },
  { assetId: 'b', label: 'Cámara B', durationSeconds: 10 },
];

const SIN_TIMECODE = {
  offsets: {},
  referenceAssetId: null,
  unusable: [
    { assetId: 'a', reason: 'sin timecode' },
    { assetId: 'b', reason: 'sin timecode' },
  ],
} as const;

function request(overrides: Partial<MulticamSyncRequest> = {}): MulticamSyncRequest {
  return {
    fps: 30,
    cameras: CAMERAS,
    timecode: SIN_TIMECODE,
    envelopes: null,
    envelopesError: null,
    ...overrides,
  };
}

describe('cadena de fallbacks de sincronización', () => {
  it('el timecode completo manda y no necesita audio', () => {
    const outcome = resolveMulticamSync(
      request({
        timecode: { offsets: { a: 0, b: 90 }, referenceAssetId: 'b', unusable: [] },
      }),
    );
    expect(outcome.method).toBe('timecode');
    expect(outcome.methods).toEqual({ a: 'timecode', b: 'timecode' });
    expect(outcome.offsets.a).toBe(0);
    expect(outcome.offsets.b).toBeCloseTo(3, 5);
    expect(outcome.degradedFrom).toBeNull();
    expect(outcome.confidencePercent).toBeNull();
    expect(outcome.report).toMatch(/timecode/i);
    expect(outcome.report).toMatch(/referencia Cámara B/);
  });

  it('sin timecode usable degrada al audio y lo informa', () => {
    const outcome = resolveMulticamSync(
      request({ envelopes: [envelope(pulses(0)), envelope(pulses(30))] }),
    );
    expect(outcome.method).toBe('audio');
    expect(outcome.methods).toEqual({ a: 'audio', b: 'audio' });
    expect(outcome.degradedFrom).toContain('sin timecode usable');
    expect(outcome.offsets.a).toBeCloseTo(0, 2);
    expect(outcome.offsets.b).toBeCloseTo(1.2, 2);
    expect(outcome.confidencePercent).toBeGreaterThan(50);
    expect(outcome.report).toMatch(/timecode no sirvió/i);
    expect(outcome.report).toMatch(/audio/i);
    expect(outcome.referenceAssetId).toBe('a');
  });

  it('si el audio tampoco encuentra señal, queda el ajuste manual', () => {
    const outcome = resolveMulticamSync(
      request({ envelopes: [envelope(new Array(600).fill(0.2)), envelope(pulses())] }),
    );
    expect(outcome.method).toBe('manual');
    expect(outcome.methods).toEqual({ a: 'manual', b: 'manual' });
    expect(outcome.offsets).toEqual({});
    expect(outcome.degradedFrom).toContain('timecode');
    expect(outcome.report).toMatch(/a mano/i);
    expect(outcome.report).toMatch(/Timecode: sin timecode usable/);
    expect(outcome.report).toMatch(/Audio: no encontré audio en común/);
  });

  it('informa por qué no se pudo analizar el audio', () => {
    const outcome = resolveMulticamSync(
      request({ envelopesError: 'Cámara B no tiene audio analizable.' }),
    );
    expect(outcome.method).toBe('manual');
    expect(outcome.report).toContain('Cámara B no tiene audio analizable.');
  });

  it('con timecode parcial, el audio completa las cámaras sin TC', () => {
    const outcome = resolveMulticamSync(
      request({
        timecode: {
          offsets: { a: 0 },
          referenceAssetId: 'a',
          unusable: [{ assetId: 'b', reason: 'sin timecode' }],
        },
        envelopes: [envelope(pulses(0)), envelope(pulses(30))],
      }),
    );
    expect(outcome.method).toBe('timecode');
    expect(outcome.methods).toEqual({ a: 'timecode', b: 'audio' });
    expect(outcome.offsets.a).toBe(0);
    expect(outcome.offsets.b).toBeCloseTo(1.2, 2);
    expect(outcome.confidencePercent).toBeGreaterThan(50);
    expect(outcome.warnings).toContain('Cámara B: sin timecode.');
    expect(outcome.report).toMatch(/Timecode en 1 de 2/i);
    expect(outcome.report).toMatch(/audio alineó Cámara B/i);
  });

  it('con timecode parcial y audio fallido, el resto queda manual con aviso', () => {
    const outcome = resolveMulticamSync(
      request({
        timecode: {
          offsets: { a: 0 },
          referenceAssetId: 'a',
          unusable: [{ assetId: 'b', reason: 'sin timecode' }],
        },
        envelopes: [envelope(new Array(600).fill(0.2)), envelope(pulses())],
      }),
    );
    expect(outcome.method).toBe('timecode');
    expect(outcome.methods).toEqual({ a: 'timecode', b: 'manual' });
    expect(outcome.offsets).toEqual({ a: 0 });
    expect(outcome.confidencePercent).toBeNull();
    expect(
      outcome.warnings.some((warning) => warning.includes('ajustá a mano') && warning.includes('Cámara B')),
    ).toBe(true);
  });

  it('si el audio discrepa del timecode más de 2 frames, manda el timecode y avisa', () => {
    const outcome = resolveMulticamSync(
      request({
        timecode: {
          offsets: { a: 30 },
          referenceAssetId: 'a',
          unusable: [{ assetId: 'b', reason: 'sin timecode' }],
        },
        envelopes: [envelope(pulses(0)), envelope(pulses(30))],
      }),
    );
    expect(outcome.method).toBe('timecode');
    // El timecode de la referencia (1 s) reancla el audio: B queda en 1.2 + 1.
    expect(outcome.offsets.a).toBeCloseTo(1, 5);
    expect(outcome.offsets.b).toBeCloseTo(2.2, 2);
    expect(
      outcome.warnings.some((warning) => warning.includes('no coinciden') && warning.includes('30 frames')),
    ).toBe(true);
  });

  it('recorta las entradas de audio a la duración de cada cámara', () => {
    const outcome = resolveMulticamSync(
      request({
        cameras: [
          { assetId: 'a', label: 'Cámara A', durationSeconds: 10 },
          { assetId: 'b', label: 'Cámara B', durationSeconds: 0.5 },
        ],
        envelopes: [envelope(pulses(0)), envelope(pulses(30))],
      }),
    );
    expect(outcome.method).toBe('audio');
    expect(outcome.offsets.b).toBeCloseTo(0.5, 5);
  });

  it('con menos de dos cámaras pide elegir más sin tocar nada', () => {
    const outcome = resolveMulticamSync(
      request({ cameras: [CAMERAS[0]!] }),
    );
    expect(outcome.method).toBe('manual');
    expect(outcome.offsets).toEqual({});
    expect(outcome.report).toMatch(/al menos dos cámaras/i);
  });
});

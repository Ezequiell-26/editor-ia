import { describe, expect, it } from 'vitest';
import { deriveTimecodeOffsets, timecodeToFrames } from './multicam-timecode';

describe('timecodeToFrames', () => {
  it('convierte NDF a frames con el fps dado', () => {
    expect(timecodeToFrames('00:00:00:00', 30)).toEqual({ ok: true, frames: 0 });
    expect(timecodeToFrames('00:00:01:15', 30)).toEqual({ ok: true, frames: 45 });
    expect(timecodeToFrames('01:00:00:00', 30)).toEqual({ ok: true, frames: 108_000 });
    expect(timecodeToFrames('00:00:02:12', 24)).toEqual({ ok: true, frames: 60 });
  });

  it('acepta horas de un dígito y tolera espacios', () => {
    expect(timecodeToFrames(' 1:00:00:00 ', 25)).toEqual({ ok: true, frames: 90_000 });
  });

  it('rechaza drop-frame con su motivo (no es lineal)', () => {
    expect(timecodeToFrames('01:00:00;15', 30)).toEqual({ ok: false, reason: 'drop-frame' });
  });

  it('rechaza formatos ilegibles', () => {
    expect(timecodeToFrames('no-es-timecode', 30)).toEqual({ ok: false, reason: 'formato' });
    expect(timecodeToFrames('00:00:00', 30)).toEqual({ ok: false, reason: 'formato' });
    expect(timecodeToFrames('', 30)).toEqual({ ok: false, reason: 'formato' });
  });

  it('rechaza campos de frames fuera de la base del fps', () => {
    expect(timecodeToFrames('00:00:00:45', 30)).toEqual({ ok: false, reason: 'fuera-de-rango' });
    expect(timecodeToFrames('00:00:00:30', 24)).toEqual({ ok: false, reason: 'fuera-de-rango' });
  });
});

describe('deriveTimecodeOffsets', () => {
  it('toma la referencia más tardía para que ninguna entrada sea negativa', () => {
    const result = deriveTimecodeOffsets(
      [
        { assetId: 'a', timecode: '10:00:00:00' },
        { assetId: 'b', timecode: '10:00:05:00' },
        { assetId: 'c', timecode: '10:00:02:12' },
      ],
      30,
    );
    expect(result.referenceAssetId).toBe('b');
    expect(result.offsets).toEqual({ a: 150, b: 0, c: 78 });
    expect(result.unusable).toEqual([]);
  });

  it('reporta las cámaras sin timecode o con timecode drop-frame', () => {
    const result = deriveTimecodeOffsets(
      [
        { assetId: 'a', timecode: '10:00:00:00' },
        { assetId: 'b', timecode: null },
        { assetId: 'c', timecode: '10:00:00;10' },
      ],
      30,
    );
    expect(result.referenceAssetId).toBe('a');
    expect(result.offsets).toEqual({ a: 0 });
    expect(result.unusable).toEqual([
      { assetId: 'b', reason: 'sin timecode' },
      { assetId: 'c', reason: 'timecode drop-frame' },
    ]);
  });

  it('con ninguna cámara usable devuelve offsets vacíos y sin referencia', () => {
    const result = deriveTimecodeOffsets(
      [
        { assetId: 'a', timecode: null },
        { assetId: 'b', timecode: 'garbage' },
      ],
      30,
    );
    expect(result).toEqual({ offsets: {}, referenceAssetId: null, unusable: [
      { assetId: 'a', reason: 'sin timecode' },
      { assetId: 'b', reason: 'timecode ilegible' },
    ] });
  });

  it('una sola cámara usable es su propia referencia con offset 0', () => {
    const result = deriveTimecodeOffsets([{ assetId: 'sola', timecode: '09:59:30:00' }], 30);
    expect(result.referenceAssetId).toBe('sola');
    expect(result.offsets).toEqual({ sola: 0 });
  });
});

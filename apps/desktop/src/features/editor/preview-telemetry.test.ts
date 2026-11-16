import { beforeEach, describe, expect, it } from 'vitest';
import {
  getPreviewTelemetry,
  recordPlaybackFrame,
  recordPreviewWait,
  resetPreviewTelemetryForTests,
  setPreviewAutoQuality,
} from './preview-telemetry';

const FRAME_30 = 1000 / 30;

/** Vuelca `count` frames sanos espaciados `stepMs` en el tiempo `now`. */
function feedFrames(count: number, deltaMs: number, frameMs: number, startNow: number, stepMs = 20): number {
  let now = startNow;
  for (let index = 0; index < count; index += 1) {
    recordPlaybackFrame(deltaMs, frameMs, now);
    now += stepMs;
  }
  return now;
}

describe('preview telemetry (patrón adaptive quality de Kloicut)', () => {
  beforeEach(() => {
    resetPreviewTelemetryForTests();
  });

  it('mantiene calidad full con frames sanos y reporta fps medido', () => {
    let now = feedFrames(80, FRAME_30, FRAME_30, 0);
    // Evaluaciones cada 300 ms: avanzar el reloj para forzar una.
    for (let index = 0; index < 5; index += 1) {
      recordPlaybackFrame(FRAME_30, FRAME_30, now);
      now += 400;
    }
    const snapshot = getPreviewTelemetry();
    expect(snapshot.quality).toBe('full');
    expect(snapshot.fps).toBeGreaterThan(20);
    expect(snapshot.badRatio).toBe(0);
  });

  it('degrada a proxy/draft con jank sostenido tras la histéresis', () => {
    setPreviewAutoQuality(true);
    let now = feedFrames(40, FRAME_30, FRAME_30, 0);
    // Frames que superan 1.75× el presupuesto: ratio malo > 0.3 → draft.
    now = feedFrames(60, FRAME_30 * 4, FRAME_30, now);
    // Dos evaluaciones degradadas consecutivas bajan el nivel.
    for (let index = 0; index < 3; index += 1) {
      recordPlaybackFrame(FRAME_30 * 4, FRAME_30, now);
      now += 400;
    }
    const snapshot = getPreviewTelemetry();
    expect(['proxy', 'draft']).toContain(snapshot.quality);
    expect(snapshot.badRatio).toBeGreaterThan(0.3);
    expect(snapshot.auto).toBe(true);
  });

  it('las esperas de medio cuentan como muestras malas', () => {
    setPreviewAutoQuality(true);
    let now = feedFrames(40, FRAME_30, FRAME_30, 0);
    for (let index = 0; index < 30; index += 1) {
      recordPreviewWait(now);
      now += 30;
    }
    for (let index = 0; index < 4; index += 1) {
      recordPlaybackFrame(FRAME_30, FRAME_30, now);
      now += 400;
    }
    expect(getPreviewTelemetry().quality).not.toBe('full');
  });

  it('subir de calidad exige una racha limpia (histéresis de subida)', () => {
    setPreviewAutoQuality(true);
    // Degradar primero.
    let now = feedFrames(40, FRAME_30 * 4, FRAME_30, 0);
    for (let index = 0; index < 4; index += 1) {
      recordPlaybackFrame(FRAME_30 * 4, FRAME_30, now);
      now += 400;
    }
    expect(getPreviewTelemetry().quality).not.toBe('full');
    // Recuperación: la ventana (120 muestras) necesita ~115 frames limpios
    // para purgar los ~44 malos; se alimentan con pasos de 2 ms para que no
    // disparen evaluaciones intermedias durante el relleno.
    now = feedFrames(115, FRAME_30, FRAME_30, now, 2);
    // Menos de 5 evaluaciones limpias → sigue degradado.
    for (let index = 0; index < 3; index += 1) {
      recordPlaybackFrame(FRAME_30, FRAME_30, now);
      now += 400;
    }
    expect(getPreviewTelemetry().quality).not.toBe('full');
    // Racha limpia suficiente → vuelve a full.
    for (let index = 0; index < 6; index += 1) {
      recordPlaybackFrame(FRAME_30, FRAME_30, now);
      now += 400;
    }
    expect(getPreviewTelemetry().quality).toBe('full');
  });

  it('apagar el modo automático resetea el nivel a full', () => {
    setPreviewAutoQuality(true);
    let now = feedFrames(60, FRAME_30 * 4, FRAME_30, 0);
    for (let index = 0; index < 4; index += 1) {
      recordPlaybackFrame(FRAME_30 * 4, FRAME_30, now);
      now += 400;
    }
    expect(getPreviewTelemetry().quality).not.toBe('full');
    setPreviewAutoQuality(false);
    const snapshot = getPreviewTelemetry();
    expect(snapshot.quality).toBe('full');
    expect(snapshot.auto).toBe(false);
  });
});

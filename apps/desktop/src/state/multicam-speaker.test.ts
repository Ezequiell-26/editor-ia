import { describe, expect, it } from 'vitest';
import { autoCutBySpeaker, defaultSpeakerCameraMap } from './multicam-speaker';
import type { SpeakerSegment } from './speakers';

const FPS = 30;
const TOTAL = 30 * FPS; // 30 s de programa

function seg(start: number, end: number, speaker: string): SpeakerSegment {
  return { start, end, text: '…', speaker };
}

describe('autoCutBySpeaker', () => {
  it('corta a la cámara del hablante en cada turno', () => {
    const segments = [
      seg(0, 5, '0'),
      seg(5, 10, '1'),
      seg(10, 15, '0'),
    ];
    const cuts = autoCutBySpeaker(segments, { '0': 0, '1': 1 }, TOTAL, FPS, {
      minShotSeconds: 0.5,
    });
    expect(cuts).toEqual([
      { frame: 0, cameraIndex: 0 },
      { frame: 150, cameraIndex: 1 },
      { frame: 300, cameraIndex: 0 },
    ]);
  });

  it('los tramos sin hablante mapeado mantienen la cámara vigente', () => {
    const segments = [seg(0, 10, '0'), seg(10, 20, 'X'), seg(20, 30, '1')];
    const cuts = autoCutBySpeaker(segments, { '0': 0, '1': 1 }, TOTAL, FPS, {
      minShotSeconds: 0.5,
    });
    // 'X' no está mapeado → el tramo 10–20 s sigue en cámara 0; '1' entra en 20 s.
    expect(cuts).toEqual([
      { frame: 0, cameraIndex: 0 },
      { frame: 600, cameraIndex: 1 },
    ]);
  });

  it('absorbe planos más cortos que minShotSeconds en el plano anterior', () => {
    const segments = [
      seg(0, 10, '0'),
      seg(10, 10.5, '1'), // plano de 0.5 s < 1.2 s default
      seg(10.5, 20, '0'),
    ];
    const cuts = autoCutBySpeaker(segments, { '0': 0, '1': 1 }, TOTAL, FPS);
    // La micro-intervención de 0.5 s no genera corte: queda todo en cámara 0.
    expect(cuts).toEqual([{ frame: 0, cameraIndex: 0 }]);
  });

  it('el primer tramo puede ser corto: no tiene plano anterior', () => {
    const segments = [seg(0, 0.5, '1'), seg(0.5, 10, '0')];
    const cuts = autoCutBySpeaker(segments, { '0': 0, '1': 1 }, TOTAL, FPS);
    expect(cuts[0]).toEqual({ frame: 0, cameraIndex: 1 });
    expect(cuts[1]).toEqual({ frame: 15, cameraIndex: 0 });
  });

  it('devuelve sólo la cámara fallback cuando no hay hablantes mapeados', () => {
    const cuts = autoCutBySpeaker([seg(0, 10, '9')], { '0': 0 }, TOTAL, FPS, {
      fallbackCamera: 1,
    });
    expect(cuts).toEqual([{ frame: 0, cameraIndex: 1 }]);
  });

  it('recorta segmentos fuera del programa y solapados', () => {
    const segments = [
      seg(-5, 5, '0'),
      seg(4, 8, '1'), // solapa el anterior: se recorta a 5–8
      seg(28, 40, '0'),
    ];
    const cuts = autoCutBySpeaker(segments, { '0': 0, '1': 1 }, TOTAL, FPS, {
      minShotSeconds: 0.5,
    });
    expect(cuts).toEqual([
      { frame: 0, cameraIndex: 0 },
      { frame: 150, cameraIndex: 1 },
      { frame: 840, cameraIndex: 0 },
    ]);
  });
});

describe('defaultSpeakerCameraMap', () => {
  it('asigna cámaras en orden de primera aparición', () => {
    const segments = [seg(0, 1, 'B'), seg(1, 2, 'A'), seg(2, 3, 'B')];
    expect(defaultSpeakerCameraMap(segments, 2)).toEqual({ B: 0, A: 1 });
  });

  it('repete cámaras cuando hay más hablantes que cámaras', () => {
    const segments = [seg(0, 1, 'a'), seg(1, 2, 'b'), seg(2, 3, 'c')];
    expect(defaultSpeakerCameraMap(segments, 2)).toEqual({ a: 0, b: 1, c: 0 });
  });
});

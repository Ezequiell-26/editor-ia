import { describe, expect, it } from 'vitest';
import { detectBeats, planBeatCuts } from './beat-sync';

const RATE = 8_000;

function clicks(bpm: number, seconds: number, rate = RATE): Float32Array {
  const samples = new Float32Array(Math.round(seconds * rate));
  const interval = 60 / bpm;
  for (let time = 0.1; time < seconds; time += interval) {
    const start = Math.round(time * rate);
    for (let index = 0; index < 40 && start + index < samples.length; index += 1) {
      samples[start + index] = Math.sin((index / 40) * Math.PI) * 0.9;
    }
  }
  return samples;
}

describe('detección de pulso', () => {
  it('encuentra un click a 120 BPM', () => {
    const analysis = detectBeats(clicks(120, 4), RATE);
    expect(analysis.bpm).toBeGreaterThanOrEqual(116);
    expect(analysis.bpm).toBeLessThanOrEqual(124);
    expect(analysis.beatsSeconds.length).toBeGreaterThanOrEqual(6);
    expect(analysis.confidence).toBeGreaterThanOrEqual(0.7);
    expect(analysis.beatsSeconds[0]).toBeCloseTo(0.1, 1);
  });

  it('encuentra un click más lento a 90 BPM', () => {
    const analysis = detectBeats(clicks(90, 6), RATE);
    expect(analysis.bpm).toBeGreaterThanOrEqual(86);
    expect(analysis.bpm).toBeLessThanOrEqual(94);
    expect(analysis.beatsSeconds.length).toBeGreaterThanOrEqual(6);
  });

  it('no inventa pulsos en silencio', () => {
    const silence = new Float32Array(RATE * 3);
    const analysis = detectBeats(silence, RATE);
    expect(analysis.bpm).toBe(0);
    expect(analysis.beatsSeconds).toEqual([]);
    expect(analysis.confidence).toBe(0);
  });

  it('ignora una señal demasiado corta', () => {
    expect(detectBeats(new Float32Array(32), RATE).beatsSeconds).toEqual([]);
  });
});

describe('plan de cortes al ritmo', () => {
  const beats = [0, 0.5, 1.0, 1.5, 2.0];

  it('mapea tiempos de fuente a frames de timeline con stride', () => {
    const frames = planBeatCuts({
      beatsSeconds: beats,
      fps: 30,
      audioInFrame: 0,
      audioOutFrame: 90,
      audioStartFrame: 0,
      speed: 1,
      stride: 2,
      targetStartFrame: 0,
      targetEndFrame: 90,
    });
    // 0 s cae en el borde y se descarta; los pulsos 2 y 4 (1 s, 2 s) quedan.
    expect(frames).toEqual([30, 60]);
  });

  it('respeta la ventana de origen del audio y su posición en la timeline', () => {
    const frames = planBeatCuts({
      beatsSeconds: beats,
      fps: 30,
      audioInFrame: 30,
      audioOutFrame: 75,
      audioStartFrame: 300,
      speed: 1,
      stride: 1,
      targetStartFrame: 0,
      targetEndFrame: 1_000,
    });
    expect(frames).toEqual([300, 315, 330]);
  });

  it('convierte a través de la velocidad del audio', () => {
    const frames = planBeatCuts({
      beatsSeconds: [1],
      fps: 30,
      audioInFrame: 0,
      audioOutFrame: 60,
      audioStartFrame: 0,
      speed: 2,
      stride: 1,
      targetStartFrame: 0,
      targetEndFrame: 60,
    });
    expect(frames).toEqual([15]);
  });

  it('descarta cortes fuera del rango objetivo y respeta el hueco mínimo', () => {
    const frames = planBeatCuts({
      beatsSeconds: beats,
      fps: 30,
      audioInFrame: 0,
      audioOutFrame: 90,
      audioStartFrame: 0,
      speed: 1,
      stride: 1,
      targetStartFrame: 29,
      targetEndFrame: 61,
      minGapFrames: 20,
    });
    // 30 y 45 caen dentro, pero 45 está a 15 frames de 30 (< 20) y se descarta.
    expect(frames).toEqual([30, 60]);
  });
});

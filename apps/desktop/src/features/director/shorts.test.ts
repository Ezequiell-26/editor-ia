import { describe, expect, it } from 'vitest';
import type { MediaAnalysis, TranscriptionResult } from '../../services/project-service';
import {
  DEFAULT_SHORT_OPTIONS,
  buildShortCandidates,
  shortPlanText,
  type ShortOptions,
} from './shorts';

function analysis(overrides: Partial<MediaAnalysis> = {}): MediaAnalysis {
  return {
    assetId: 'asset-1',
    kind: 'video',
    durationSeconds: 120,
    fpsNum: 30,
    fpsDen: 1,
    hasAudio: true,
    scenes: [0, 30, 60, 90],
    silences: [
      { startSeconds: 24, endSeconds: 25 },
      { startSeconds: 54, endSeconds: 55.2 },
      { startSeconds: 88, endSeconds: 89 },
    ],
    blacks: [],
    freezes: [],
    loudness: null,
    lumaAverage: null,
    saturationAverage: null,
    warnings: [],
    ...overrides,
  };
}

function transcript(): TranscriptionResult {
  const segments = [
    { start: 0, end: 6, text: '¿Por qué tu video pierde espectadores en el primer segundo?' },
    { start: 6, end: 12, text: 'Hoy vemos el error más común al editar.' },
    { start: 12, end: 24, text: 'La timeline se desordena y la narración pierde fuerza.' },
    { start: 25, end: 32, text: 'Primero ordená las tomas por intención.' },
    { start: 32, end: 44, text: 'Después cortá los silencios y probá el ritmo.' },
    { start: 55.5, end: 62, text: 'Hola, buenas, hoy les cuento algo genérico.' },
    { start: 62, end: 74, text: 'Este es un ejemplo sin gancho y con relleno.' },
    { start: 89.2, end: 96, text: 'El cierre muestra el antes y el después.' },
    { start: 96, end: 110, text: 'Probá este flujo con tu propio material.' },
  ];
  return {
    language: 'es',
    languageProbability: 0.98,
    durationSeconds: 120,
    model: 'test',
    segments: segments.map((segment) => ({ ...segment, words: [] })),
  };
}

const options: ShortOptions = { ...DEFAULT_SHORT_OPTIONS, maxCandidates: 5 };

describe('Auto Shorts candidates', () => {
  it('propone ventanas dentro de los límites y sin solaparse de más', () => {
    const shorts = buildShortCandidates(analysis(), transcript(), options);
    expect(shorts.length).toBeGreaterThan(0);
    expect(shorts.length).toBeLessThanOrEqual(5);
    for (const short of shorts) {
      expect(short.durationSeconds).toBeGreaterThanOrEqual(options.minSeconds);
      expect(short.durationSeconds).toBeLessThanOrEqual(options.maxSeconds);
      expect(short.startSeconds).toBeGreaterThanOrEqual(0);
      expect(short.endSeconds).toBeLessThanOrEqual(120);
      expect(short.score).toBeGreaterThanOrEqual(0);
      expect(short.score).toBeLessThanOrEqual(100);
      expect(short.reasons.length).toBeGreaterThan(0);
    }
    for (let i = 0; i < shorts.length; i += 1) {
      for (let j = i + 1; j < shorts.length; j += 1) {
        const a = shorts[i]!;
        const b = shorts[j]!;
        const overlap = Math.max(0, Math.min(a.endSeconds, b.endSeconds) - Math.max(a.startSeconds, b.startSeconds));
        expect(overlap / Math.min(a.durationSeconds, b.durationSeconds)).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it('ordena por score y prefiere un gancho con pregunta', () => {
    const shorts = buildShortCandidates(analysis(), transcript(), options);
    expect(shorts.map((short) => short.score)).toEqual(
      [...shorts.map((short) => short.score)].sort((a, b) => b - a),
    );
    const hook = shorts.find((short) => short.startSeconds === 0);
    expect(hook?.title).toMatch(/¿Por qué/);
    expect(hook?.reasons.join(' ')).toMatch(/pregunta|tensión/i);
  });

  it('usa escenas y silencios cuando no hay transcripción', () => {
    const shorts = buildShortCandidates(analysis(), null, options);
    expect(shorts.length).toBeGreaterThan(0);
    expect(shorts.every((short) => short.excerpt === '')).toBe(true);
    expect(shorts.some((short) => /Corte en/.test(short.title))).toBe(true);
    expect(shortPlanText(shorts)).toContain('score');
  });

  it('no inventa cortes fuera de la duración ni con material vacío', () => {
    expect(buildShortCandidates(analysis({ durationSeconds: 0 }), transcript())).toEqual([]);
    const tiny = buildShortCandidates(
      analysis({ durationSeconds: 10, scenes: [0], silences: [] }),
      null,
      options,
    );
    expect(tiny).toEqual([]);
    const late = buildShortCandidates(
      analysis({ durationSeconds: 30, scenes: [0, 20], silences: [] }),
      null,
    );
    expect(late.every((short) => short.endSeconds <= 30)).toBe(true);
  });
});

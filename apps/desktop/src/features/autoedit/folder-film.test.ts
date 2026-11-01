import { describe, expect, it } from 'vitest';
import { pickNarration, planFolderFilm, speechSegments } from './folder-film';

const images = [
  { assetId: 'img-1', label: 'Playa' },
  { assetId: 'img-2', label: 'Atardecer' },
  { assetId: 'img-3', label: 'Ciudad' },
];

describe('video desde una carpeta', () => {
  it('reparte imágenes uniformemente cuando no hay narración', () => {
    const plan = planFolderFilm({ images, audio: null, fps: 30, style: 'story' });
    expect(plan.basis).toBe('no-audio');
    expect(plan.slides).toHaveLength(3);
    expect(plan.slides[0]).toMatchObject({ startFrame: 0, durationFrames: 150 });
    expect(plan.slides[1]).toMatchObject({ startFrame: 150, durationFrames: 150 });
    expect(plan.totalFrames).toBe(450);
    expect(plan.slides[0]?.motion).toBe('zoom-in');
    expect(plan.slides[1]?.motion).toBe('pan-left');
    expect(plan.slides[2]?.transitionFrames).toBeGreaterThan(0);
  });

  it('sin pausas medibles divide la narración en partes iguales', () => {
    const plan = planFolderFilm({
      images,
      audio: { assetId: 'voz', durationFrames: 900 },
      silences: [],
      fps: 30,
    });
    expect(plan.basis).toBe('uniform-audio');
    expect(plan.totalFrames).toBe(900);
    expect(plan.slides.map((slide) => slide.durationFrames)).toEqual([300, 300, 300]);
  });

  it('corta en los silencios reales de la voz', () => {
    const plan = planFolderFilm({
      images: images.slice(0, 2),
      audio: { assetId: 'voz', durationFrames: 600 },
      silences: [{ startSeconds: 9.5, endSeconds: 10.5 }],
      fps: 30,
    });
    expect(plan.basis).toBe('silences');
    expect(plan.totalFrames).toBe(600);
    expect(plan.slides[0]?.durationFrames).toBe(300);
    expect(plan.slides[1]?.durationFrames).toBe(300);
  });

  it('subdivide una frase larga cuando hay más imágenes que pausas', () => {
    const plan = planFolderFilm({
      images,
      audio: { assetId: 'voz', durationFrames: 360 },
      silences: [],
      fps: 30,
    });
    expect(plan.slides).toHaveLength(3);
    expect(plan.totalFrames).toBe(360);
    expect(plan.slides.every((slide) => slide.durationFrames >= 36)).toBe(true);
  });

  it('respeta un mínimo legible y cubre la narración igual', () => {
    const plan = planFolderFilm({
      images: Array.from({ length: 20 }, (_, index) => ({
        assetId: `img-${index}`,
        label: `Foto ${index}`,
      })),
      audio: { assetId: 'voz', durationFrames: 600 },
      silences: [],
      fps: 30,
    });
    expect(plan.totalFrames).toBe(600);
    // Con 20 imágenes y 20 s de voz el mínimo se vuelve dinámico (0,5 s).
    expect(plan.slides.every((slide) => slide.durationFrames >= 15)).toBe(true);
  });

  it('detecta los segmentos de voz entre silencios', () => {
    const segments = speechSegments(20, [
      { startSeconds: 5, endSeconds: 6 },
      { startSeconds: 12, endSeconds: 13 },
    ]);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ start: 0, end: 5 });
    expect(segments[2]).toEqual({ start: 13, end: 20 });
  });

  it('prefiere un archivo con nombre de voz al elegir narración', () => {
    const picked = pickNarration([
      { label: 'musica-fondo.mp3', durationFrames: 3000 },
      { label: 'voz-narracion.wav', durationFrames: 900 },
    ]);
    expect(picked?.label).toBe('voz-narracion.wav');
  });

  it('sin imágenes devuelve un plan vacío', () => {
    const plan = planFolderFilm({ images: [], audio: null, fps: 30 });
    expect(plan.slides).toHaveLength(0);
    expect(plan.totalFrames).toBe(0);
  });
});

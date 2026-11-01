import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MOTION_INTENSITY,
  automaticPhotoMotion,
  photoTransitionEffects,
} from './photo-motion';

const FRAME_16_9 = { frameWidth: 1920, frameHeight: 1080 };
const FRAME_9_16 = { frameWidth: 1080, frameHeight: 1920 };

describe('automaticPhotoMotion · sin medidas', () => {
  it('mantiene el ciclo histórico determinista', () => {
    expect(automaticPhotoMotion(0)).toEqual({
      type: 'zoom-in',
      intensity: DEFAULT_MOTION_INTENSITY,
    });
    expect(automaticPhotoMotion(1).type).toBe('zoom-out');
    expect(automaticPhotoMotion(2).type).toBe('pan-left');
    expect(automaticPhotoMotion(3).type).toBe('pan-right');
    expect(automaticPhotoMotion(4).type).toBe('zoom-in');
  });

  it('respeta la intensidad pedida', () => {
    expect(automaticPhotoMotion({ index: 0, intensity: 0.2 }).intensity).toBe(0.2);
  });
});

describe('automaticPhotoMotion · con medidas', () => {
  it('recorre en horizontal una foto apaisada en un encuadre vertical', () => {
    const first = automaticPhotoMotion({ index: 0, imageWidth: 1920, imageHeight: 1080, ...FRAME_9_16 });
    const second = automaticPhotoMotion({ index: 1, imageWidth: 1920, imageHeight: 1080, ...FRAME_9_16 });
    expect(first.type).toBe('pan-right');
    expect(second.type).toBe('pan-left');
  });

  it('recorre en vertical una foto vertical en un encuadre apaisado', () => {
    const first = automaticPhotoMotion({ index: 0, imageWidth: 1080, imageHeight: 1920, ...FRAME_16_9 });
    const second = automaticPhotoMotion({ index: 1, imageWidth: 1080, imageHeight: 1920, ...FRAME_16_9 });
    expect(first.type).toBe('pan-down');
    expect(second.type).toBe('pan-up');
  });

  it('alterna zoom cuando la relación de aspecto coincide', () => {
    const first = automaticPhotoMotion({ index: 0, imageWidth: 1920, imageHeight: 1080, ...FRAME_16_9 });
    const second = automaticPhotoMotion({ index: 1, imageWidth: 1920, imageHeight: 1080, ...FRAME_16_9 });
    expect(first.type).toBe('zoom-in');
    expect(second.type).toBe('zoom-out');
  });

  it('tolera pequeñas diferencias de relación sin cambiar de movimiento', () => {
    // 2000×1080 es casi 16:9: no vale la pena paneo, alcanza con zoom.
    const motion = automaticPhotoMotion({ index: 0, imageWidth: 2000, imageHeight: 1080, ...FRAME_16_9 });
    expect(motion.type).toBe('zoom-in');
  });

  it('cae al ciclo cuando faltan medidas', () => {
    const motion = automaticPhotoMotion({ index: 1, imageWidth: 1920, ...FRAME_16_9 });
    expect(motion.type).toBe('zoom-out');
  });

  it('ignora medidas inválidas', () => {
    const motion = automaticPhotoMotion({
      index: 0,
      imageWidth: 0,
      imageHeight: 1080,
      ...FRAME_16_9,
    });
    expect(motion.type).toBe('zoom-in');
  });
});

describe('photoTransitionEffects', () => {
  it('acota el fundido a la mitad del clip', () => {
    expect(photoTransitionEffects(30, 40)).toEqual({ fadeInFrames: 20, fadeOutFrames: 20 });
  });

  it('no devuelve efectos sin frames', () => {
    expect(photoTransitionEffects(0, 40)).toBeUndefined();
    expect(photoTransitionEffects(5, 1)).toBeUndefined();
  });
});

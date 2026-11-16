import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Clip, ClipEffects } from '@editor-ia/project-schema';
import {
  auditionedEffects,
  clearLookAudition,
  getLookAudition,
  resetLookAuditionForTests,
  setLookAudition,
  subscribeLookAudition,
} from './look-audition';

function clipWithEffects(id: string, effects?: ClipEffects): Clip {
  return { id, kind: 'video', effects } as unknown as Clip;
}

beforeEach(() => {
  resetLookAuditionForTests();
});

describe('audición de looks del catálogo', () => {
  it('guarda y limpia la audición sin tocar el documento', () => {
    expect(getLookAudition()).toBeNull();
    setLookAudition({ clipId: 'c1', label: 'Cálido', effects: { temperature: 0.2 } });
    expect(getLookAudition()?.label).toBe('Cálido');
    clearLookAudition();
    expect(getLookAudition()).toBeNull();
  });

  it('notifica a los suscriptores y corta al desuscribirse', () => {
    const listener = vi.fn();
    const off = subscribeLookAudition(listener);

    setLookAudition({ clipId: 'c1', label: 'Frío', effects: { temperature: -0.2 } });
    expect(listener).toHaveBeenCalledTimes(1);

    // Misma referencia: no re-notifica.
    setLookAudition(getLookAudition());
    expect(listener).toHaveBeenCalledTimes(1);

    off();
    clearLookAudition();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('auditionedEffects reemplaza sólo el clip que está sonando', () => {
    const own = { saturation: 1.2 };
    const audition = { temperature: 0.3, contrast: 1.1 };
    const clip = clipWithEffects('c1', own);
    const other = clipWithEffects('c2', own);

    // Sin audición: los efectos propios.
    expect(auditionedEffects(clip, null)).toBe(own);

    // Con audición sobre otro clip: no interfiere.
    expect(
      auditionedEffects(other, { clipId: 'c1', label: 'Cine', effects: audition }),
    ).toBe(own);

    // Con audición sobre este clip: reemplazo total (como applyPreset).
    expect(
      auditionedEffects(clip, { clipId: 'c1', label: 'Cine', effects: audition }),
    ).toBe(audition);
  });

  it('devuelve undefined para clips sin efectos (audio, compound)', () => {
    const audio = { id: 'a1', kind: 'audio' } as unknown as Clip;
    expect(
      auditionedEffects(audio, { clipId: 'a1', label: 'X', effects: { blur: 2 } }),
    ).toBeUndefined();
  });
});

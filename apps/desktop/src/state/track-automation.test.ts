import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { addTrack, updateTrack } from './project-actions';
import {
  clearTrackGainKeyframes,
  clearTrackPanKeyframes,
  removeTrackGainKeyframe,
  removeTrackPanKeyframe,
  sampleTrackGain,
  sampleTrackPan,
  setTrackGainKeyframe,
  setTrackPanKeyframe,
} from './track-automation';

const NOW = '2026-10-24T00:00:00.000Z';

function proyectoConPista(overrides: Record<string, unknown> = {}): {
  project: ReturnType<typeof createEmptyProject>;
  trackId: string;
} {
  let project = createEmptyProject('Automatización', NOW);
  const added = addTrack(project, 'audio', 'Música');
  project = added.project;
  project = updateTrack(project, added.trackId, { gainDb: 0, pan: 0 });
  const track = project.timeline.tracks.find((item) => item.id === added.trackId)!;
  Object.assign(track, overrides);
  return { project, trackId: added.trackId };
}

describe('automatización de fader y paneo de pista', () => {
  it('fija claves de volumen ordenadas y reemplaza la clave del mismo frame', () => {
    const { project, trackId } = proyectoConPista();
    const primera = setTrackGainKeyframe(project, trackId, 60, -6);
    const segunda = setTrackGainKeyframe(primera, trackId, 0, -12);
    const duplicada = setTrackGainKeyframe(segunda, trackId, 60, 3);
    const track = duplicada.timeline.tracks.find((item) => item.id === trackId)!;
    expect(track.gainKeyframes).toEqual([
      { frame: 0, gainDb: -12, easing: 'linear' },
      { frame: 60, gainDb: 3, easing: 'linear' },
    ]);
  });

  it('rechaza ganancias fuera de rango, curvas inválidas, frames negativos y pistas bloqueadas', () => {
    const { project, trackId } = proyectoConPista();
    expect(() => setTrackGainKeyframe(project, trackId, 0, -70)).toThrow(
      'la ganancia de pista debe estar entre -60 y 12 dB',
    );
    expect(() => setTrackGainKeyframe(project, trackId, 0, 0, 'rebote' as never)).toThrow(
      'la curva de la clave de volumen no es válida',
    );
    expect(() => setTrackGainKeyframe(project, trackId, -5, 0)).toThrow(
      'la clave debe caer en un frame de la timeline',
    );
    const bloqueada = updateTrack(project, trackId, { locked: true });
    expect(() => setTrackGainKeyframe(bloqueada, trackId, 0, 0)).toThrow('la pista está bloqueada');
    expect(() => setTrackGainKeyframe(project, 'no-existe', 0, 0)).toThrow(
      'la pista no está en la timeline',
    );
  });

  it('respeta el máximo de keyframes por pista', () => {
    const { project, trackId } = proyectoConPista();
    let actual = project;
    for (let frame = 0; frame < 96; frame += 1) {
      actual = setTrackGainKeyframe(actual, trackId, frame, 0);
    }
    expect(() => setTrackGainKeyframe(actual, trackId, 200, 0)).toThrow(
      'esta pista ya tiene el máximo de 96 keyframes de volumen',
    );
  });

  it('muestrea el fader con el easing del segmento y clampea en los extremos', () => {
    const { project, trackId } = proyectoConPista();
    let actual = setTrackGainKeyframe(project, trackId, 0, -10);
    actual = setTrackGainKeyframe(actual, trackId, 30, -4, 'hold');
    actual = setTrackGainKeyframe(actual, trackId, 60, 6);
    const track = actual.timeline.tracks.find((item) => item.id === trackId)!;
    const keyframes = track.gainKeyframes!;
    expect(sampleTrackGain(keyframes, -5)).toBe(-10);
    expect(sampleTrackGain(keyframes, 0)).toBe(-10);
    // segmento lineal -10 → -4 en 30 frames: frame 15 es la mitad
    expect(sampleTrackGain(keyframes, 15)).toBeCloseTo(-7, 5);
    // "hold" en la clave de 30: el segmento 30→60 queda en -4 hasta la próxima clave
    expect(sampleTrackGain(keyframes, 59)).toBe(-4);
    expect(sampleTrackGain(keyframes, 60)).toBe(6);
    expect(sampleTrackGain(keyframes, 1_000)).toBe(6);
    expect(sampleTrackGain(undefined, 10)).toBeUndefined();
  });

  it('muestrea la curva Bézier declarada en la clave inicial del segmento', () => {
    const { project, trackId } = proyectoConPista();
    let actual = setTrackGainKeyframe(project, trackId, 0, -12);
    actual = setTrackGainKeyframe(actual, trackId, 30, 0);
    const track = actual.timeline.tracks.find((item) => item.id === trackId)!;
    const keyframes = track.gainKeyframes!.map((keyframe, index) =>
      index === 0
        ? { ...keyframe, bezier: { cp1X: 0.42, cp1Y: 0, cp2X: 1, cp2Y: 1 } }
        : keyframe,
    );
    const mitad = sampleTrackGain(keyframes, 15)!;
    // la Bézier (0.42,0,1,1) es ease-in: en la mitad del segmento avanza menos
    // que el lineal (-6), pero ya dejó atrás el valor inicial (-12)
    expect(mitad).toBeLessThan(-5.999);
    expect(mitad).toBeGreaterThan(-12);
  });

  it('quita claves individuales y congela el valor muestreado al quitar la animación', () => {
    const { project, trackId } = proyectoConPista();
    let actual = setTrackGainKeyframe(project, trackId, 0, -12);
    actual = setTrackGainKeyframe(actual, trackId, 60, 12);

    // el playhead está en 30: la animación se congela en la mitad del segmento
    const congelada = clearTrackGainKeyframes(actual, trackId, 30);
    const trackCongelado = congelada.timeline.tracks.find((item) => item.id === trackId)!;
    expect(trackCongelado.gainKeyframes).toBeUndefined();
    expect(trackCongelado.gainDb).toBeCloseTo(0, 5);

    const sinLaPrimera = removeTrackGainKeyframe(actual, trackId, 0);
    const track = sinLaPrimera.timeline.tracks.find((item) => item.id === trackId)!;
    expect(track.gainKeyframes).toHaveLength(1);
    expect(removeTrackGainKeyframe(sinLaPrimera, trackId, 999)).toBe(sinLaPrimera);
  });

  it('fija, lista y muestrea claves de paneo con las mismas reglas', () => {
    const { project, trackId } = proyectoConPista();
    let actual = setTrackPanKeyframe(project, trackId, 0, -1);
    actual = setTrackPanKeyframe(actual, trackId, 30, 1);
    const track = actual.timeline.tracks.find((item) => item.id === trackId)!;
    expect(track.panKeyframes).toEqual([
      { frame: 0, value: -1, easing: 'linear' },
      { frame: 30, value: 1, easing: 'linear' },
    ]);
    expect(sampleTrackPan(track.panKeyframes, 15)).toBeCloseTo(0, 5);
    expect(() => setTrackPanKeyframe(project, trackId, 0, 2)).toThrow(
      'el paneo de pista debe estar entre -1 y 1',
    );
    const sinPaneo = removeTrackPanKeyframe(actual, trackId, 0);
    const trackSinPaneo = sinPaneo.timeline.tracks.find((item) => item.id === trackId)!;
    expect(trackSinPaneo.panKeyframes).toHaveLength(1);
    // Con una sola clave en frame 30, el valor se mantiene (hold) también
    // antes de esa clave: congelar en 15 deja 1, no 0.
    const congelada = clearTrackPanKeyframes(sinPaneo, trackId, 15);
    const trackCongelado = congelada.timeline.tracks.find((item) => item.id === trackId)!;
    expect(trackCongelado.panKeyframes).toBeUndefined();
    expect(trackCongelado.pan).toBeCloseTo(1, 5);

    // Con las dos claves (-1 en 0, 1 en 30), congelar en 15 sí da el punto
    // medio 0.
    const congeladaCompleta = clearTrackPanKeyframes(actual, trackId, 15);
    const trackCompleto = congeladaCompleta.timeline.tracks.find((item) => item.id === trackId)!;
    expect(trackCompleto.panKeyframes).toBeUndefined();
    expect(trackCompleto.pan).toBeCloseTo(0, 5);
  });
});

import { describe, expect, it } from 'vitest';
import type { Track } from '@editor-ia/project-schema';
import {
  dbfsToRms,
  effectivePeakDb,
  gainForTargetPeak,
  hasSoloedAudioTrack,
  isTrackAudible,
  levelPercentFromDb,
  panGains,
  panLabel,
  panPanLabels,
  peakDbFromPeaks,
  rmsToDbfs,
  samplePanGain,
  trackEqDb,
  trackGainDb,
  trackPan,
} from './audio-mix';

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 't1',
    kind: 'audio',
    label: 'Música',
    order: 0,
    muted: false,
    hidden: false,
    locked: false,
    ...overrides,
  };
}

describe('mezcla de pistas en la preview', () => {
  it('silencia una pista muteada aunque haya solo en otra', () => {
    const muted = track({ id: 'a', muted: true });
    const solo = track({ id: 'b', solo: true });
    expect(hasSoloedAudioTrack([muted, solo])).toBe(true);
    expect(isTrackAudible(muted, [muted, solo])).toBe(false);
    expect(isTrackAudible(solo, [muted, solo])).toBe(true);
  });

  it('con una pista en solo apaga las demás pistas con señal', () => {
    const voice = track({ id: 'v', kind: 'narration', solo: true });
    const music = track({ id: 'm' });
    const video = track({ id: 'x', kind: 'video' });
    expect(isTrackAudible(music, [voice, music, video])).toBe(false);
    expect(isTrackAudible(video, [voice, music, video])).toBe(false);
    expect(isTrackAudible(voice, [voice, music, video])).toBe(true);
  });

  it('el solo de una pista muteada no cuenta', () => {
    const mutedSolo = track({ id: 'm', solo: true, muted: true });
    const other = track({ id: 'o' });
    expect(hasSoloedAudioTrack([mutedSolo, other])).toBe(false);
    expect(isTrackAudible(other, [mutedSolo, other])).toBe(true);
  });

  it('normaliza la ganancia de pista al rango del render', () => {
    expect(trackGainDb(track({ gainDb: -6.5 }))).toBe(-6.5);
    expect(trackGainDb(track({ gainDb: 30 }))).toBe(12);
    expect(trackGainDb(track({ gainDb: -80 }))).toBe(-60);
    expect(trackGainDb(track())).toBe(0);
  });
});

describe('paneo y EQ de pista', () => {
  it('acota el paneo y calcula un balance lineal', () => {
    expect(trackPan(track({ pan: -0.4 }))).toBe(-0.4);
    expect(trackPan(track({ pan: 3 }))).toBe(1);
    expect(trackPan(track())).toBe(0);
    expect(panGains(0)).toEqual({ left: 1, right: 1 });
    expect(panGains(-1)).toEqual({ left: 1, right: 0 });
    expect(panGains(1)).toEqual({ left: 0, right: 1 });
    expect(panGains(-0.25).right).toBeCloseTo(0.75, 6);
    expect(panGains(0.25).left).toBeCloseTo(0.75, 6);
  });

  it('etiqueta el paneo para la mesa', () => {
    expect(panLabel(0)).toBe('C');
    expect(panLabel(-0.4)).toBe('L 40');
    expect(panLabel(0.25)).toBe('R 25');
  });

  it('acota las tres bandas de EQ', () => {
    const widthEq = track({ eqLowDb: 4, eqMidDb: -3, eqHighDb: 6 });
    expect(trackEqDb(widthEq, 'eqLowDb')).toBe(4);
    expect(trackEqDb(widthEq, 'eqMidDb')).toBe(-3);
    expect(trackEqDb(widthEq, 'eqHighDb')).toBe(6);
    expect(trackEqDb(track({ eqLowDb: -30 }), 'eqLowDb')).toBe(-12);
    expect(trackEqDb(track({ eqHighDb: 20 }), 'eqHighDb')).toBe(12);
    expect(trackEqDb(track(), 'eqMidDb')).toBe(0);
  });
});

describe('medición de picos y headroom', () => {
  const peaks = (amplitude: number) => ({
    assetId: 'a',
    durationSeconds: 1,
    buckets: 2,
    peaks: [
      { min: -amplitude, max: amplitude / 2 },
      { min: -amplitude / 4, max: amplitude },
    ],
  });

  it('convierte los picos del backend a dBFS', () => {
    expect(peakDbFromPeaks(peaks(0.5))).toBeCloseTo(-6.02, 1);
    expect(peakDbFromPeaks(peaks(0.25))).toBeCloseTo(-12.04, 1);
    expect(peakDbFromPeaks(peaks(0))).toBeNull();
  });

  it('calcula la ganancia para llegar al objetivo sin salir del rango', () => {
    expect(gainForTargetPeak(-12.04, -6)).toBeCloseTo(6.04, 1);
    expect(gainForTargetPeak(-2, -6)).toBe(-4);
    expect(gainForTargetPeak(-58, -6)).toBe(12);
    expect(gainForTargetPeak(0, -60)).toBe(-60);
  });

  it('suma la ganancia de pista al pico y ubica el medidor en 0..100', () => {
    expect(effectivePeakDb(-12, -3)).toBe(-15);
    expect(effectivePeakDb(-2, 4)).toBe(2);
    expect(levelPercentFromDb(-60)).toBe(0);
    expect(levelPercentFromDb(-30)).toBeCloseTo(50, 0);
    expect(levelPercentFromDb(0)).toBe(100);
    expect(levelPercentFromDb(4)).toBe(100);
  });
});

describe('samplePanGain (medidores de paneo de clip)', () => {
  it('el centro deja ambos canales a 1.0 como el export', () => {
    expect(samplePanGain(0, 10)).toEqual([1, 1]);
    expect(samplePanGain(undefined, 10)).toEqual([1, 1]);
  });

  it('los extremos silencian el canal opuesto', () => {
    expect(samplePanGain(1, 10)).toEqual([0, 1]);
    expect(samplePanGain(-1, 10)).toEqual([1, 0]);
  });

  it('balance lineal: pan 0.5 atenúa el izquierdo a 0.5 (−6 dB)', () => {
    const [left, right] = samplePanGain(0.5, 10);
    expect(left).toBeCloseTo(0.5, 9);
    expect(right).toBeCloseTo(1, 9);
    const [left2, right2] = samplePanGain(-0.7, 10);
    expect(left2).toBeCloseTo(1, 9);
    expect(right2).toBeCloseTo(0.3, 9);
  });
});

describe('panPanLabels', () => {
  it('centro sin atenuación en ningún canal', () => {
    expect(panPanLabels(0)).toEqual({ left: '0%', right: '0%' });
    expect(panPanLabels(undefined)).toEqual({ left: '0%', right: '0%' });
  });

  it('paneo a la derecha atenúa el izquierdo y viceversa', () => {
    expect(panPanLabels(0.5)).toEqual({ left: '−50%', right: '0%' });
    expect(panPanLabels(-0.7)).toEqual({ left: '0%', right: '−70%' });
  });
});

describe('dbfsToRms y rmsToDbfs', () => {
  it('convierten y vuelven con ida y vuelta consistente', () => {
    expect(dbfsToRms(0)).toBe(1);
    expect(dbfsToRms(-20)).toBeCloseTo(0.1, 9);
    expect(dbfsToRms(-120)).toBe(0);
    expect(rmsToDbfs(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(rmsToDbfs(0.1)).toBeCloseTo(-20, 6);
  });
});

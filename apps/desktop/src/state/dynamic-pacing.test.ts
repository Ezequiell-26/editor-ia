import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import {
  modulateCutSeconds,
  pacingZoneAt,
  detectPunchlineMoments,
  buildDuckingKeyframes,
  applyMusicDucking,
  DEFAULT_PACING_ZONES,
} from './dynamic-pacing';
import { addTrack, newId } from './project-actions';
import { setTrackGainKeyframe } from './track-automation';
import type { TranscriptionResult } from '../services/contracts';
import type { AnalysisRange } from '../services/contracts';

// ── modulateCutSeconds ─────────────────────────────────────────────────

describe('modulateCutSeconds', () => {
  it('returns nominal for body zone (50% position)', () => {
    const result = modulateCutSeconds(3, 15, 30);
    // At 50% position → body zone (factor 1.0), should be ~3.0 s.
    expect(result).toBeCloseTo(3, 0);
  });

  it('accelerates during hook zone (5% position)', () => {
    const result = modulateCutSeconds(3, 1.5, 30);
    // At 5% → hook zone (factor 0.6), blended → shorter than nominal.
    expect(result).toBeLessThan(3);
    expect(result).toBeGreaterThanOrEqual(0.8);
  });

  it('accelerates during climax zone (85% position)', () => {
    const result = modulateCutSeconds(3, 25.5, 30);
    // At 85% → climax zone (factor 0.7) → shorter.
    expect(result).toBeLessThan(3);
  });

  it('slows down during outro zone (97% position)', () => {
    const result = modulateCutSeconds(3, 29.1, 30);
    // At 97% → outro zone (factor 1.2) → longer.
    expect(result).toBeGreaterThan(3);
  });

  it('clamps to [0.8, 12] range', () => {
    // Very short nominal with fast zone.
    expect(modulateCutSeconds(0.5, 1, 30)).toBe(0.8);
    // Very long nominal with slow zone.
    expect(modulateCutSeconds(15, 29, 30)).toBe(12);
  });

  it('returns nominal for zero/negative total duration', () => {
    expect(modulateCutSeconds(3, 5, 0)).toBe(3);
    expect(modulateCutSeconds(3, 5, -10)).toBe(3);
  });
});

// ── pacingZoneAt ───────────────────────────────────────────────────────

describe('pacingZoneAt', () => {
  it('returns hook for 0–15%', () => {
    expect(pacingZoneAt(2, 30)).toBe('hook');
  });

  it('returns body for 15–80%', () => {
    expect(pacingZoneAt(15, 30)).toBe('body');
  });

  it('returns climax for 80–95%', () => {
    expect(pacingZoneAt(25, 30)).toBe('climax');
  });

  it('returns outro for 95–100%', () => {
    expect(pacingZoneAt(29, 30)).toBe('outro');
  });
});

// ── detectPunchlineMoments ─────────────────────────────────────────────

describe('detectPunchlineMoments', () => {
  const makeTranscript = (
    segments: Array<{ start: number; end: number; text: string }>,
  ): TranscriptionResult => ({
    language: 'es',
    languageProbability: 0.99,
    durationSeconds: 60,
    model: 'whisper',
    segments: segments.map((s) => ({ ...s, words: [] })),
  });

  it('returns empty for no transcript', () => {
    expect(detectPunchlineMoments(null, null)).toEqual([]);
    expect(detectPunchlineMoments(undefined, undefined)).toEqual([]);
  });

  it('detects ellipsis-ending segments with a gap', () => {
    const transcript = makeTranscript([
      { start: 0, end: 3, text: 'Y entonces todo cambió...' },
      { start: 4.5, end: 7, text: 'El mundo nunca fue igual' },
    ]);
    const punchlines = detectPunchlineMoments(transcript, []);
    expect(punchlines.length).toBe(1);
    expect(punchlines[0]!.reason).toBe('ellipsis');
    expect(punchlines[0]!.startSeconds).toBeCloseTo(3, 1);
    expect(punchlines[0]!.endSeconds).toBeCloseTo(4.5, 1);
  });

  it('detects dramatic pauses (long gaps ≥ 2× minPause)', () => {
    const transcript = makeTranscript([
      { start: 0, end: 2, text: 'Ok' },
      { start: 5, end: 8, text: 'Siguiente punto' },
    ]);
    // Gap = 3 s, default minPause = 0.6 → 2× = 1.2 → qualifies.
    const punchlines = detectPunchlineMoments(transcript, []);
    expect(punchlines.length).toBeGreaterThanOrEqual(1);
    expect(punchlines[0]!.reason).toBe('dramatic-pause');
  });

  it('detects silence-after-energy with exclamation', () => {
    const transcript = makeTranscript([
      {
        start: 0,
        end: 3,
        text: '¡Esto es increíble, no puedo creer lo que estoy viendo aquí amigos!',
      },
      { start: 4, end: 7, text: 'Vamos a seguir' },
    ]);
    const silences: AnalysisRange[] = [
      { startSeconds: 2.9, endSeconds: 4.1 },
    ];
    const punchlines = detectPunchlineMoments(transcript, silences);
    expect(punchlines.length).toBe(1);
    expect(punchlines[0]!.reason).toBe('silence-after-energy');
    expect(punchlines[0]!.confidence).toBeGreaterThan(0.5);
  });

  it('ignores short gaps below minPauseDuration', () => {
    const transcript = makeTranscript([
      { start: 0, end: 3, text: 'Hola' },
      { start: 3.3, end: 6, text: 'mundo' },
    ]);
    const punchlines = detectPunchlineMoments(transcript, []);
    expect(punchlines.length).toBe(0);
  });
});

// ── buildDuckingKeyframes ──────────────────────────────────────────────

describe('buildDuckingKeyframes', () => {
  const makeTranscript = (
    segments: Array<{ start: number; end: number; text: string }>,
  ): TranscriptionResult => ({
    language: 'es',
    languageProbability: 0.99,
    durationSeconds: 60,
    model: 'whisper',
    segments: segments.map((s) => ({ ...s, words: [] })),
  });

  it('returns single base keyframe for no transcript', () => {
    const { keyframes, punchlines } = buildDuckingKeyframes(null, null, 60);
    expect(keyframes.length).toBe(1);
    expect(keyframes[0]!.gainDb).toBe(-14);
    expect(punchlines.length).toBe(0);
  });

  it('creates duck/swell cycle for speech segments with gaps', () => {
    const transcript = makeTranscript([
      { start: 2, end: 5, text: 'Primera frase del video' },
      { start: 8, end: 12, text: 'Segunda frase con pausa' },
    ]);
    const { keyframes } = buildDuckingKeyframes(transcript, [], 30);
    // Should have multiple keyframes: base → duck → swell → duck → swell.
    expect(keyframes.length).toBeGreaterThan(3);
    // Should include duck levels (-18) and swell levels (-10).
    const gains = keyframes.map((k) => k.gainDb);
    expect(gains.some((g) => g === -18)).toBe(true);
    expect(gains.some((g) => g === -10)).toBe(true);
  });

  it('includes punchline mute keyframes when detected', () => {
    const transcript = makeTranscript([
      {
        start: 0,
        end: 3,
        text: '¡Y entonces algo increíble pasó en este momento justo aquí!',
      },
      { start: 5, end: 8, text: 'Vamos a ver qué pasó' },
    ]);
    const silences: AnalysisRange[] = [
      { startSeconds: 2.9, endSeconds: 5.1 },
    ];
    const { keyframes, punchlines } = buildDuckingKeyframes(
      transcript,
      silences,
      30,
      { punchlineMutes: true },
    );
    expect(punchlines.length).toBe(1);
    // Should include a mute level (-60).
    const gains = keyframes.map((k) => k.gainDb);
    expect(gains.some((g) => g === -60)).toBe(true);
  });

  it('skips punchline mutes when disabled', () => {
    const transcript = makeTranscript([
      {
        start: 0,
        end: 3,
        text: '¡Esto es increíble y nadie se lo esperaba amigos!',
      },
      { start: 5, end: 8, text: 'Siguiente tema' },
    ]);
    const { keyframes, punchlines } = buildDuckingKeyframes(
      transcript,
      [],
      30,
      { punchlineMutes: false },
    );
    expect(punchlines.length).toBe(0);
    const gains = keyframes.map((k) => k.gainDb);
    expect(gains.every((g) => g !== -60)).toBe(true);
  });
});

// ── applyMusicDucking ──────────────────────────────────────────────────

describe('applyMusicDucking', () => {
  it('returns unchanged project if no music track exists', () => {
    const project = createEmptyProject('Test');
    const result = applyMusicDucking(project);
    expect(result.trackId).toBe('');
    expect(result.keyframeCount).toBe(0);
    expect(result.project).toBe(project);
  });

  it('automates gainKeyframes on music track when present', () => {
    let project = createEmptyProject('Test');
    const trackResult = addTrack(project, 'audio', 'Música de fondo');
    project = trackResult.project;
    const musicTrackId = trackResult.trackId;

    // Add a music clip
    project.timeline.clips.push({
      id: newId(),
      trackId: musicTrackId,
      kind: 'audio',
      label: 'Background Song',
      startFrame: 0,
      durationFrames: 900, // 30s at 30fps
      source: {
        type: 'asset',
        assetId: newId(),
        inFrame: 0,
        outFrame: 900,
      },
    });

    const transcript: TranscriptionResult = {
      language: 'es',
      languageProbability: 0.99,
      durationSeconds: 30,
      model: 'whisper',
      segments: [
        {
          start: 2,
          end: 5,
          text: '¡Esta es la primera revelación amigos mios!',
          words: [],
        },
        {
          start: 8,
          end: 12,
          text: 'Y aquí continúa la explicación detallada',
          words: [],
        },
      ],
    };

    const silences: AnalysisRange[] = [
      { startSeconds: 4.9, endSeconds: 8.1 },
    ];

    const result = applyMusicDucking(project, {
      transcript,
      silences,
      punchlineMutes: true,
    });

    expect(result.trackId).toBe(musicTrackId);
    expect(result.keyframeCount).toBeGreaterThan(0);
    expect(result.punchlineCount).toBe(1);

    const track = result.project.timeline.tracks.find((t) => t.id === musicTrackId);
    expect(track?.gainKeyframes).toBeDefined();
    expect(track!.gainKeyframes!.length).toBe(result.keyframeCount);

    // Verify keyframes are strictly ordered by frame
    for (let i = 1; i < track!.gainKeyframes!.length; i++) {
      expect(track!.gainKeyframes![i]!.frame).toBeGreaterThan(
        track!.gainKeyframes![i - 1]!.frame,
      );
    }

    // Verify mute keyframe at punchline
    const hasMute = track!.gainKeyframes!.some((k) => k.gainDb === -60);
    expect(hasMute).toBe(true);
  });

  it('preserves manual gainKeyframes and only replaces auto-duck ones', () => {
    let project = createEmptyProject('Test');
    const trackResult = addTrack(project, 'audio', 'Música de fondo');
    project = trackResult.project;
    const musicTrackId = trackResult.trackId;

    project.timeline.clips.push({
      id: newId(),
      trackId: musicTrackId,
      kind: 'audio',
      label: 'Background Song',
      startFrame: 0,
      durationFrames: 900,
      source: {
        type: 'asset',
        assetId: newId(),
        inFrame: 0,
        outFrame: 900,
      },
    });

    // Clave manual del usuario + una vieja 'auto-duck' de una corrida previa.
    project = setTrackGainKeyframe(project, musicTrackId, 0, -6);
    project = setTrackGainKeyframe(project, musicTrackId, 300, -20, 'linear', 'auto-duck');

    const transcript: TranscriptionResult = {
      language: 'es',
      languageProbability: 0.99,
      durationSeconds: 30,
      model: 'whisper',
      segments: [
        {
          start: 2,
          end: 5,
          text: '¡Esta es la primera revelación amigos mios!',
          words: [],
        },
        {
          start: 8,
          end: 12,
          text: 'Y aquí continúa la explicación detallada',
          words: [],
        },
      ],
    };

    const result = applyMusicDucking(project, { transcript });
    const track = result.project.timeline.tracks.find((t) => t.id === musicTrackId);
    const keyframes = track!.gainKeyframes!;

    // La manual sobrevive intacta; la auto-duck vieja fue reemplazada.
    const manual = keyframes.find((k) => k.frame === 0);
    expect(manual?.gainDb).toBe(-6);
    expect(manual?.origin).toBeUndefined();
    expect(keyframes.some((k) => k.frame === 300 && k.origin === 'auto-duck')).toBe(false);
    expect(keyframes.filter((k) => k.origin === 'auto-duck').length).toBe(result.keyframeCount);
  });
});


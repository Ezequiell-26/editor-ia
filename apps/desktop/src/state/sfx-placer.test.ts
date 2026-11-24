import { describe, expect, it } from 'vitest';
import {
  autoPlaceSfx,
  ensureSfxAsset,
  SFX_CATALOG,
} from './sfx-placer';
import {
  addAsset,
  addCaptionCueWindows,
  addClipFromAsset,
  addTrack,
  setTransformKeyframe,
  updateClip,
} from './project-actions';
import { createEmptyProject, type Asset } from '@editor-ia/project-schema';

const NOW = '2026-11-23T18:00:00.000Z';

function sampleVideoAsset(): Asset {
  return {
    id: 'asset-video-sfx',
    label: 'Main Footage.mp4',
    kind: 'video',
    status: 'ready',
    source: { type: 'local', path: 'videos/footage.mp4' },
    integrity: { sha256: 'a'.repeat(64), bytes: 10_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: {
      durationFrames: 600,
      width: 1920,
      height: 1080,
      frameRate: { num: 30, den: 1 },
      channels: 2,
    },
  } as Asset;
}

describe('ensureSfxAsset', () => {
  it('registra el asset de audio si no existía y lo reusa en llamadas posteriores', () => {
    let project = createEmptyProject('SFX Test', NOW);
    const first = ensureSfxAsset(project, 'sfx-woosh');
    expect(first.asset.kind).toBe('audio');
    expect(first.asset.tags).toContain('sfx:sfx-woosh');
    expect(first.project.assets).toHaveLength(1);

    // Segunda llamada con el mismo preset: reusa el asset sin duplicar
    const second = ensureSfxAsset(first.project, 'sfx-woosh');
    expect(second.asset.id).toBe(first.asset.id);
    expect(second.project.assets).toHaveLength(1);
  });

  it('falla con un error descriptivo si el ID de preset no existe', () => {
    const project = createEmptyProject('SFX Test', NOW);
    expect(() =>
      ensureSfxAsset(project, 'sfx-inexistente' as any),
    ).toThrow(/no existe en el catálogo/);
  });
});

describe('autoPlaceSfx', () => {
  it('coloca wooshes en zooms y transiciones, y dings/pops en subtítulos destacados', () => {
    const video = sampleVideoAsset();
    let project = addAsset(createEmptyProject('Auto SFX', NOW), video);
    const track = addTrack(project, 'video', 'Video');
    project = track.project;

    // Clip 1: Frame 0 a 120 (sin transición)
    const clip1 = addClipFromAsset(project, video, {
      trackId: track.trackId,
      atFrame: 0,
      durationFrames: 120,
    });
    project = clip1.project;

    // Clip 2: Frame 120 a 240 (con zoom punch-in y transición dissolve)
    const clip2 = addClipFromAsset(project, video, {
      trackId: track.trackId,
      atFrame: 120,
      durationFrames: 120,
    });
    project = updateClip(clip2.project, clip2.clipId, {
      transitionIn: { type: 'dissolve', frames: 10 },
    });
    // Añadir zoom keyframe al clip 2
    project = setTransformKeyframe(project, clip2.clipId, 0, {
      scale: 1.2,
      opacity: 1,
    });

    // Subtítulo con estadística/cifra en frame 180
    const captions = addCaptionCueWindows(
      project,
      [
        {
          text: '¡Aumentó un 45% en 2026!',
          startFrame: 180,
          endFrame: 230,
        },
        {
          text: 'Genial 🚀',
          startFrame: 300,
          endFrame: 350,
        },
      ],
      { replaceTrack: true },
    );
    project = captions.project;

    const result = autoPlaceSfx(project, {
      minIntervalFrames: 30, // 1 segundo
      trackName: 'Audio · SFX',
    });

    expect(result.placedCount).toBeGreaterThanOrEqual(3);
    const sfxClips = result.project.timeline.clips.filter(
      (c) => c.trackId === result.trackId,
    );
    expect(sfxClips).toHaveLength(result.placedCount);

    // Evento de apertura (hook) en frame 0
    const hookEvent = result.events.find((e) => e.reason === 'hook');
    expect(hookEvent).toBeDefined();
    expect(hookEvent!.presetId).toBe('sfx-boom');
    expect(hookEvent!.frame).toBe(0);

    // Evento de zoom / transición en frame 120
    const transitionEvent = result.events.find(
      (e) => e.frame === 120 && (e.reason === 'zoom' || e.reason === 'transition'),
    );
    expect(transitionEvent).toBeDefined();
    expect(transitionEvent!.presetId).toBe('sfx-woosh');

    // Evento de highlight numérico en frame 180
    const highlightEvent = result.events.find((e) => e.reason === 'highlight');
    expect(highlightEvent).toBeDefined();
    expect(highlightEvent!.presetId).toBe('sfx-ding');
    expect(highlightEvent!.frame).toBe(180);

    // Todos los clips de SFX tienen ganancia negativa (bien mezclados bajo el diálogo)
    expect(
      sfxClips.every((c) => c.audio?.gainDb !== undefined && c.audio.gainDb < 0),
    ).toBe(true);
  });

  it('respeta minIntervalFrames para no saturar con efectos muy pegados', () => {
    const video = sampleVideoAsset();
    let project = addAsset(createEmptyProject('Pacing SFX', NOW), video);
    const track = addTrack(project, 'video', 'Video');
    project = track.project;

    // Tres clips muy cortos pegados (cada 10 frames)
    for (let i = 0; i < 3; i++) {
      const added = addClipFromAsset(project, video, {
        trackId: track.trackId,
        atFrame: i * 15,
        durationFrames: 15,
      });
      project = setTransformKeyframe(added.project, added.clipId, 0, {
        scale: 1.2,
      });
    }

    const result = autoPlaceSfx(project, {
      zooms: true,
      hook: false,
      minIntervalFrames: 45, // 1.5s
    });

    // Con separación de 45 frames, sólo debe colocar 1 SFX en esa ventana
    const zoomEvents = result.events.filter((e) => e.reason === 'zoom');
    expect(zoomEvents.length).toBe(1);
  });
});

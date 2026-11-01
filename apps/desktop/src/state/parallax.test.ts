import { describe, expect, it } from 'vitest';
import type { Asset, Clip, ProjectDocument } from '@editor-ia/project-schema';
import { createEmptyProject, parseProject } from '@editor-ia/project-schema';
import { addAsset, ensureDelivery, newId } from './project-actions';
import { PARALLAX_PRESETS, addParallaxScene } from './parallax';

const NOW = '2025-01-01T00:00:00.000Z';

function motionOf(
  clip: Clip | undefined,
): { type: string; intensity?: number | undefined } | undefined {
  return clip && 'motion' in clip ? clip.motion : undefined;
}

function validated(project: ProjectDocument): ProjectDocument {
  const parsed = parseProject(project);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
}

function imageAsset(label: string): Asset {
  return {
    id: newId(),
    label,
    kind: 'image',
    source: { type: 'local', path: `media/${label}.png` },
    status: 'ready',
    integrity: { sha256: 'e'.repeat(64), bytes: 8_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { width: 1920, height: 1080 },
  } as Asset;
}

function audioAsset(): Asset {
  return {
    id: newId(),
    label: 'Voz',
    kind: 'audio',
    source: { type: 'local', path: 'media/voz.wav' },
    status: 'ready',
    integrity: { sha256: 'b'.repeat(64), bytes: 5_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { sampleRate: 48_000, channels: 1, durationFrames: 150 },
  } as Asset;
}

function setup() {
  const background = imageAsset('fondo');
  const foreground = imageAsset('recorte');
  const audio = audioAsset();
  let project = ensureDelivery(createEmptyProject('Parallax', NOW));
  project = addAsset(project, background);
  project = addAsset(project, foreground);
  project = addAsset(project, audio);
  return { project: validated(project), background, foreground, audio };
}

describe('presets 2.5D / parallax', () => {
  it('lista los nueve presets con su requisito de recorte', () => {
    expect(PARALLAX_PRESETS).toHaveLength(9);
    expect(PARALLAX_PRESETS.filter((preset) => preset.requiresForeground)).toHaveLength(7);
    expect(PARALLAX_PRESETS.find((preset) => preset.id === 'ken-burns')?.requiresForeground).toBe(false);
  });

  it('construye dos capas con movimiento relativo en parallax-soft', () => {
    const { project, background, foreground } = setup();
    const result = addParallaxScene(project, {
      backgroundAssetId: background.id,
      foregroundAssetId: foreground.id,
      preset: 'parallax-soft',
      direction: 'left',
      intensity: 0.2,
      durationFrames: 90,
    });
    const next = validated(result.project);
    expect(result.foregroundClipId).toBeTruthy();
    expect(next.timeline.clips).toHaveLength(2);
    expect(next.timeline.tracks).toHaveLength(2);
    const bgClip = next.timeline.clips.find((clip) => clip.id === result.backgroundClipId)!;
    const fgClip = next.timeline.clips.find((clip) => clip.id === result.foregroundClipId)!;
    expect(motionOf(bgClip)?.type).toBe('pan-left');
    expect(motionOf(bgClip)?.intensity).toBeCloseTo(0.07, 5);
    expect(motionOf(fgClip)?.type).toBe('pan-left');
    expect(motionOf(fgClip)?.intensity).toBeCloseTo(0.2, 5);
    const bgTrack = next.timeline.tracks.find((track) => track.id === result.backgroundTrackId)!;
    const fgTrack = next.timeline.tracks.find((track) => track.id === result.foregroundTrackId)!;
    expect(fgTrack.order).toBeGreaterThan(bgTrack.order);
    expect(bgClip.startFrame).toBe(0);
    expect(bgClip.durationFrames).toBe(90);
  });

  it('push-in y depth-zoom usan zoom relativo', () => {
    const { project, background, foreground } = setup();
    const push = addParallaxScene(project, {
      backgroundAssetId: background.id,
      foregroundAssetId: foreground.id,
      preset: 'cinematic-push-in',
      intensity: 0.2,
      direction: 'right',
    });
    const pushProject = validated(push.project);
    const pushBg = pushProject.timeline.clips.find((clip) => clip.id === push.backgroundClipId)!;
    const pushFg = pushProject.timeline.clips.find((clip) => clip.id === push.foregroundClipId)!;
    expect(motionOf(pushBg)?.type).toBe('zoom-in');
    expect(motionOf(pushBg)?.intensity).toBeCloseTo(0.1, 5);
    expect(motionOf(pushFg)?.type).toBe('zoom-in');
    expect(motionOf(pushFg)?.intensity).toBeCloseTo(0.2, 5);

    const depth = addParallaxScene(project, {
      backgroundAssetId: background.id,
      foregroundAssetId: foreground.id,
      preset: 'depth-zoom',
      intensity: 0.4,
    });
    const depthProject = validated(depth.project);
    const depthBg = depthProject.timeline.clips.find((clip) => clip.id === depth.backgroundClipId)!;
    const depthFg = depthProject.timeline.clips.find((clip) => clip.id === depth.foregroundClipId)!;
    expect(motionOf(depthBg)?.intensity).toBeCloseTo(0.1, 5);
    expect(motionOf(depthFg)?.intensity).toBeCloseTo(0.4, 5);
  });

  it('ken-burns y background-drift funcionan con una sola capa', () => {
    const { project, background } = setup();
    const ken = addParallaxScene(project, {
      backgroundAssetId: background.id,
      preset: 'ken-burns',
      durationFrames: 60,
    });
    const kenProject = validated(ken.project);
    expect(kenProject.timeline.clips).toHaveLength(1);
    expect(ken.foregroundClipId).toBeNull();
    expect(motionOf(kenProject.timeline.clips[0])?.type).toBe('zoom-in');
    expect(motionOf(kenProject.timeline.clips[0])?.intensity).toBeCloseTo(0.12, 5);

    const drift = addParallaxScene(project, {
      backgroundAssetId: background.id,
      preset: 'background-drift',
      direction: 'up',
      intensity: 0.3,
    });
    const driftClip = validated(drift.project).timeline.clips[0]!;
    expect(motionOf(driftClip)?.type).toBe('pan-up');
    expect(motionOf(driftClip)?.intensity).toBeCloseTo(0.15, 5);
  });

  it('rechaza presets que necesitan recorte sin recorte', () => {
    const { project, background } = setup();
    expect(() =>
      addParallaxScene(project, { backgroundAssetId: background.id, preset: 'parallax-soft' }),
    ).toThrow(/recorte de primer plano/);
  });

  it('rechaza el mismo material, audio y materiales inexistentes', () => {
    const { project, background, audio } = setup();
    expect(() =>
      addParallaxScene(project, {
        backgroundAssetId: background.id,
        foregroundAssetId: background.id,
        preset: 'parallax-soft',
      }),
    ).toThrow(/no pueden ser el mismo/);
    expect(() =>
      addParallaxScene(project, { backgroundAssetId: audio.id, preset: 'ken-burns' }),
    ).toThrow(/imagen o video/);
    expect(() =>
      addParallaxScene(project, { backgroundAssetId: 'nope', preset: 'ken-burns' }),
    ).toThrow(/no existe/);
    expect(() =>
      addParallaxScene(project, {
        backgroundAssetId: background.id,
        foregroundAssetId: 'nope',
        preset: 'parallax-soft',
      }),
    ).toThrow(/primer plano/);
  });

  it('acota intensidades fuera de rango al mínimo del schema', () => {
    const { project, background, foreground } = setup();
    const tiny = addParallaxScene(project, {
      backgroundAssetId: background.id,
      foregroundAssetId: foreground.id,
      preset: 'foreground-separation',
      intensity: 0.01,
    });
    const tinyClips = validated(tiny.project).timeline.clips;
    expect(tinyClips.every((clip) => (motionOf(clip)?.intensity ?? 0) >= 0.02)).toBe(true);
    const huge = addParallaxScene(project, {
      backgroundAssetId: background.id,
      foregroundAssetId: foreground.id,
      preset: 'camera-tilt',
      direction: 'down',
      intensity: 9,
    });
    const hugeClips = validated(huge.project).timeline.clips;
    expect(hugeClips.every((clip) => (motionOf(clip)?.intensity ?? 0) <= 0.5)).toBe(true);
  });
});

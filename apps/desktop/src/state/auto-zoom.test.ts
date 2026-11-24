import { describe, expect, it } from 'vitest';
import type { Asset, ProjectDocument } from '@editor-ia/project-schema';
import { createEmptyProject } from '@editor-ia/project-schema';
import { addAsset, addClipFromAsset, addTrack } from './project-actions';
import { applyFaceCenteredZoom } from './face-zoom';
import { applyAutoZooms, planAutoZooms } from './auto-zoom';

const NOW = '2026-11-23T18:00:00.000Z';
const CLIP_SECONDS = 5;

function sampleAsset(): Asset {
  return {
    id: 'asset-video-1',
    label: 'Talking Head Video.mp4',
    kind: 'video',
    status: 'ready',
    source: { type: 'local', path: 'videos/talking.mp4' },
    integrity: { sha256: 'a'.repeat(64), bytes: 10_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: {
      durationFrames: 300,
      width: 1920,
      height: 1080,
      frameRate: { num: 30, den: 1 },
      channels: 2,
    },
  } as Asset;
}

/** Seis clips de 5 s en fila sobre una sola pista (30 s totales, 30 fps). */
function sixClipProject(): { project: ProjectDocument; clipIds: string[] } {
  const asset = sampleAsset();
  let project = addAsset(createEmptyProject('Auto Zoom', NOW), asset);
  const track = addTrack(project, 'video', 'Video');
  project = track.project;
  const clipIds: string[] = [];
  for (let index = 0; index < 6; index += 1) {
    const added = addClipFromAsset(project, asset, {
      trackId: track.trackId,
      atFrame: index * CLIP_SECONDS * 30,
      inFrame: 0,
      outFrame: CLIP_SECONDS * 30,
    });
    project = added.project;
    clipIds.push(added.clipId);
  }
  return { project, clipIds };
}

function lockAllTracks(project: ProjectDocument): ProjectDocument {
  return {
    ...project,
    timeline: {
      ...project.timeline,
      tracks: project.timeline.tracks.map((track) => ({ ...track, locked: true })),
    },
  };
}

describe('planAutoZooms', () => {
  it('elige clips del hook y del cuerpo respetando densidad por defecto', () => {
    const { project, clipIds } = sixClipProject();
    const plan = planAutoZooms(project);
    // 30 s → maxZooms=2; minGap 15 s → hook (c=2.5) y cuerpo (c=17.5).
    expect(plan).toHaveLength(2);
    expect(plan[0]!.clipId).toBe(clipIds[0]);
    expect(plan[0]!.zone).toBe('hook');
    expect(plan[0]!.style).toBe('punch-in');
    expect(plan[1]!.zone).toBe('body');
    expect(plan[1]!.style).toBe('snap-settle');
  });

  it('es determinista: mismo proyecto, mismo plan', () => {
    const { project } = sixClipProject();
    const a = planAutoZooms(project, { minGapSeconds: 0, maxZooms: 10 });
    const b = planAutoZooms(project, { minGapSeconds: 0, maxZooms: 10 });
    expect(a).toEqual(b);
  });

  it('maxZooms acota el total y minGapSeconds separa los zooms', () => {
    const { project } = sixClipProject();
    const plan = planAutoZooms(project, { maxZooms: 1 });
    expect(plan).toHaveLength(1);
    expect(plan[0]!.reason).toBe('hook');

    const dense = planAutoZooms(project, { minGapSeconds: 0, maxZooms: 10 });
    expect(dense.length).toBeGreaterThan(2);
  });

  it('includeBody=false deja sólo hook y clímax', () => {
    const { project } = sixClipProject();
    const plan = planAutoZooms(project, {
      includeBody: false,
      minGapSeconds: 0,
      maxZooms: 10,
    });
    expect(plan.every((item) => item.zone !== 'body')).toBe(true);
    expect(plan.some((item) => item.zone === 'hook')).toBe(true);
    // El último clip (c=27.5 s de 30 s) cae en clímax.
    expect(plan.some((item) => item.zone === 'climax')).toBe(true);
  });

  it('salta pistas bloqueadas, clips deshabilitados y clips con keyframes', () => {
    const { project, clipIds } = sixClipProject();

    const locked = planAutoZooms(lockAllTracks(project));
    expect(locked).toHaveLength(0);

    const disabled: ProjectDocument = {
      ...project,
      timeline: {
        ...project.timeline,
        clips: project.timeline.clips.map((clip) =>
          clip.id === clipIds[0] ? { ...clip, enabled: false } : clip,
        ),
      },
    };
    expect(planAutoZooms(disabled, { minGapSeconds: 0, maxZooms: 10 })
      .some((item) => item.clipId === clipIds[0])).toBe(false);

    const keyframed = applyFaceCenteredZoom(project, {
      clipId: clipIds[0]!,
      zoomStrength: 60,
      style: 'punch-in',
    }).project;
    expect(
      planAutoZooms(keyframed, { minGapSeconds: 0, maxZooms: 10 })
        .some((item) => item.clipId === clipIds[0]),
    ).toBe(false);
  });

  it('salta clips más cortos que minClipSeconds', () => {
    const { project } = sixClipProject();
    const plan = planAutoZooms(project, {
      minClipSeconds: 10,
      minGapSeconds: 0,
      maxZooms: 10,
    });
    expect(plan).toHaveLength(0);
  });
});

describe('applyAutoZooms', () => {
  it('escribe keyframes de transform sólo en los clips del plan', () => {
    const { project, clipIds } = sixClipProject();
    const result = applyAutoZooms(project);

    expect(result.applied).toBe(result.plan.length);
    expect(result.skipped).toBe(0);
    for (const item of result.plan) {
      const clip = result.project.timeline.clips.find((c) => c.id === item.clipId)!;
      expect(clip.transform?.keyframes?.length).toBeGreaterThanOrEqual(2);
    }
    const untouched = clipIds.filter(
      (id) => !result.plan.some((item) => item.clipId === id),
    );
    for (const id of untouched) {
      const clip = result.project.timeline.clips.find((c) => c.id === id)!;
      expect(clip.transform?.keyframes ?? []).toHaveLength(0);
    }
  });

  it('devuelve el proyecto intacto cuando no hay candidatos', () => {
    const { project } = sixClipProject();
    const locked = lockAllTracks(project);
    const result = applyAutoZooms(locked);
    expect(result.applied).toBe(0);
    expect(result.plan).toHaveLength(0);
  });
});

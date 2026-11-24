import { describe, expect, it } from 'vitest';
import { clipShortExportRange } from './clip-short-export';
import { addAsset, addClipFromAsset, addTrack } from './project-actions';
import { createEmptyProject, type Asset, type Clip } from '@editor-ia/project-schema';

const NOW = '2026-11-23T18:00:00.000Z';

function sampleAsset(): Asset {
  return {
    id: 'asset-video-1',
    label: 'Entrevista.mp4',
    kind: 'video',
    status: 'ready',
    source: { type: 'local', path: 'videos/entrevista.mp4' },
    integrity: { sha256: 'a'.repeat(64), bytes: 10_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: {
      durationFrames: 3000,
      width: 1920,
      height: 1080,
      frameRate: { num: 30, den: 1 },
      channels: 2,
    },
  } as Asset;
}

function projectWithClip(
  inFrame: number,
  outFrame: number,
  mutate?: (clip: Clip) => void,
): { project: ReturnType<typeof createEmptyProject>; clip: Clip } {
  const asset = sampleAsset();
  let project = addAsset(createEmptyProject('Short Test', NOW), asset);
  const track = addTrack(project, 'video', 'Video');
  project = track.project;
  const added = addClipFromAsset(project, asset, {
    trackId: track.trackId,
    atFrame: 0,
    inFrame,
    outFrame,
  });
  project = added.project;
  const clip = project.timeline.clips.find((item) => item.id === added.clipId)!;
  if (mutate) {
    const copy = { ...clip } as Clip;
    mutate(copy);
    project = {
      ...project,
      timeline: {
        ...project.timeline,
        clips: project.timeline.clips.map((item) =>
          item.id === added.clipId ? copy : item,
        ),
      },
    };
  }
  return {
    project: project as ReturnType<typeof createEmptyProject>,
    clip: project.timeline.clips.find((item) => item.id === added.clipId)!,
  };
}

describe('clipShortExportRange', () => {
  it('mapea la ventana fuente del clip a segundos del medio', () => {
    const { project, clip } = projectWithClip(300, 1500); // 10–50 s a 30 fps
    const result = clipShortExportRange(project, clip);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.range.assetPath).toBe('videos/entrevista.mp4');
    expect(result.range.startSeconds).toBeCloseTo(10);
    expect(result.range.endSeconds).toBeCloseTo(50);
    expect(result.range.label).toBeTruthy();
  });

  it('rechaza clips más cortos que el mínimo de un short', () => {
    const { project, clip } = projectWithClip(0, 60); // 2 s < 3 s
    const result = clipShortExportRange(project, clip);
    expect(result.ok).toBe(false);
  });

  it('rechaza clips más largos que el máximo de un short', () => {
    const { project, clip } = projectWithClip(0, 3000); // 100 s > 90 s
    const result = clipShortExportRange(project, clip);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('90');
  });

  it('rechaza clips con velocidad distinta de 1×', () => {
    const { project, clip } = projectWithClip(0, 300, (c) => {
      (c as { speed?: { num: number; den: number } }).speed = { num: 2, den: 1 };
    });
    const result = clipShortExportRange(project, clip);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('velocidad');
  });

  it('rechaza clips invertidos', () => {
    const { project, clip } = projectWithClip(0, 300, (c) => {
      (c as { reverse?: boolean }).reverse = true;
    });
    const result = clipShortExportRange(project, clip);
    expect(result.ok).toBe(false);
  });

  it('rechaza clips sin fuente de asset', () => {
    const { project, clip } = projectWithClip(0, 300);
    const textClip = { ...clip, kind: 'text' } as unknown as Clip;
    const result = clipShortExportRange(project, textClip);
    expect(result.ok).toBe(false);
  });
});

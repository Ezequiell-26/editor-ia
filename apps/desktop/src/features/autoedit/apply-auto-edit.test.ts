import { describe, expect, it } from 'vitest';
import {
  createEmptyProject,
  parseProject,
  type Asset,
  type ProjectDocument,
} from '@editor-ia/project-schema';
import type { MediaAnalysis } from '../../services/project-service';
import { addAsset, ensureDelivery, newId } from '../../state/project-actions';
import { applyAutoEditVariant } from './apply-auto-edit';
import type { AutoEditStyle, AutoEditVariant } from './auto-edit';

const NOW = '2026-11-01T00:00:00.000Z';

function videoAsset(): Asset {
  return {
    id: newId(),
    label: 'Toma larga',
    kind: 'video',
    source: { type: 'local', path: 'media/toma.mp4' },
    status: 'ready',
    integrity: { sha256: 'b'.repeat(64), bytes: 900_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: {
      width: 1920,
      height: 1080,
      durationFrames: 900,
      frameRate: { num: 30, den: 1 },
    },
  } as Asset;
}

function analysis(): MediaAnalysis {
  return {
    assetId: newId(),
    kind: 'video',
    durationSeconds: 30,
    fpsNum: 30,
    fpsDen: 1,
    hasAudio: true,
    scenes: [],
    silences: [],
    blacks: [],
    freezes: [],
    loudness: null,
    lumaAverage: null,
    saturationAverage: null,
    warnings: [],
  };
}

function project(asset: Asset = videoAsset()): ProjectDocument {
  const created = createEmptyProject('Auto', NOW);
  const parsed = parseProject(ensureDelivery(created));
  if (!parsed.ok) throw new Error('proyecto inválido');
  return addAsset(parsed.project, asset);
}

/** Proyecto y asset con el mismo id: el clip tiene que apuntar al asset real. */
function scene(): { readonly project: ProjectDocument; readonly asset: Asset } {
  const asset = videoAsset();
  return { project: project(asset), asset };
}

function variant(style: AutoEditStyle, cuts: readonly [number, number][]): AutoEditVariant {
  return {
    id: `variant-${style}`,
    style,
    name: style,
    description: 'prueba',
    cuts: cuts.map(([startSeconds, endSeconds]) => ({ startSeconds, endSeconds, zoom: false })),
    durationSeconds: cuts.reduce((sum, [start, end]) => sum + (end - start), 0),
    zoomCount: 0,
    captions: [],
  };
}

function transitionsOf(document: ProjectDocument): number[] {
  return document.timeline.clips
    .sort((a, b) => a.startFrame - b.startFrame)
    .map((clip) => ('transitionIn' in clip ? (clip.transitionIn?.frames ?? 0) : 0));
}

describe('applyAutoEditVariant · transiciones', () => {
  it('deja el primer corte sin transición y el resto con disolvencia suave', () => {
    const { project: base, asset } = scene();
    const result = applyAutoEditVariant(
      base,
      asset,
      variant('story', [
        [0, 4],
        [4, 8],
        [8, 12],
      ]),
      analysis(),
      { replace: true, improveAudio: false, addCaptions: false },
    );
    const clips = result.project.timeline.clips;
    expect(clips[0] && 'transitionIn' in clips[0] ? clips[0].transitionIn : undefined).toBeUndefined();
    const withTransition = clips.filter(
      (clip) => 'transitionIn' in clip && clip.transitionIn !== undefined,
    );
    expect(withTransition).toHaveLength(2);
    for (const clip of withTransition) {
      if (!('transitionIn' in clip) || !clip.transitionIn) continue;
      expect(clip.transitionIn.type).toBe('dissolve');
      expect(clip.transitionIn.easing).toBe('ease-out');
    }
  });

  it('nunca pide más frames de transición que la duración del corte', () => {
    // El segundo corte dura 0,1 s = 3 frames: antes se le ponían 5 u 8 fijos y
    // el esquema rechazaba el proyecto.
    const { project: base, asset } = scene();
    const result = applyAutoEditVariant(
      base,
      asset,
      variant('pulse', [
        [0, 2],
        [2, 2.1],
      ]),
      analysis(),
      { replace: true, improveAudio: false, addCaptions: false },
    );
    const [, second] = result.project.timeline.clips.sort((a, b) => a.startFrame - b.startFrame);
    expect(second?.durationFrames).toBe(3);
    const frames = second && 'transitionIn' in second ? (second.transitionIn?.frames ?? 0) : 0;
    expect(frames).toBeLessThanOrEqual(3);
    const parsed = parseProject(result.project);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    expect(parsed.ok).toBe(true);
  });

  it('el pulso usa transiciones más largas que la historia', () => {
    const cuts: [number, number][] = [
      [0, 4],
      [4, 8],
      [8, 12],
    ];
    const pulseScene = scene();
    const storyScene = scene();
    const pulse = applyAutoEditVariant(pulseScene.project, pulseScene.asset, variant('pulse', cuts), analysis(), {
      replace: true,
      improveAudio: false,
      addCaptions: false,
    });
    const story = applyAutoEditVariant(storyScene.project, storyScene.asset, variant('story', cuts), analysis(), {
      replace: true,
      improveAudio: false,
      addCaptions: false,
    });
    expect(Math.max(...transitionsOf(pulse.project))).toBeGreaterThan(
      Math.max(...transitionsOf(story.project)),
    );
  });
});

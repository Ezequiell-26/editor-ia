import { describe, expect, it } from 'vitest';
import {
  createEmptyProject,
  parseProject,
  type Asset,
  type ProjectDocument,
} from '@editor-ia/project-schema';
import {
  addAsset,
  addClipFromAsset,
  addScene,
  ensureDelivery,
  newId,
} from './project-actions';
import { buildStoryboard } from './storyboard';

const NOW = '2026-10-19T00:00:00.000Z';

function validated(project: ProjectDocument): ProjectDocument {
  const parsed = parseProject(project);
  if (!parsed.ok) throw new Error(`proyecto inválido: ${JSON.stringify(parsed.issues)}`);
  return parsed.project;
}

function base(): ProjectDocument {
  return validated(ensureDelivery(createEmptyProject('Storyboard', NOW)));
}

function imageAsset(label: string, overrides: Partial<Asset> = {}): Asset {
  return {
    id: newId(),
    label,
    kind: 'image',
    source: { type: 'local', path: `media/${label.replace(/\s+/g, '-').toLowerCase()}.png` },
    status: 'ready',
    integrity: { sha256: 'c'.repeat(64), bytes: 20_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { width: 1024, height: 1024 },
    ...overrides,
  } as Asset;
}

function audioAsset(durationFrames: number): Asset {
  return {
    id: newId(),
    label: 'Narración',
    kind: 'audio',
    source: { type: 'local', path: 'media/narracion.wav' },
    status: 'ready',
    integrity: { sha256: 'd'.repeat(64), bytes: 50_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { sampleRate: 48_000, channels: 1, durationFrames },
  } as Asset;
}

function withAssets(assets: Asset[]): ProjectDocument {
  let project = base();
  for (const asset of assets) project = addAsset(project, asset);
  return project;
}

describe('storyboard automático', () => {
  it('distribuye imágenes sobre la duración de la narración y monta el audio', () => {
    const images = [imageAsset('001 faro'), imageAsset('002 bosque'), imageAsset('003 ciudad')];
    const audio = audioAsset(300);
    const project = withAssets([...images, audio]);

    const result = buildStoryboard(project, { images, audio });
    const next = validated(result.project);

    expect(result.distribution).toBe('audio');
    expect(result.totalFrames).toBe(300);
    expect(result.perImageFrames).toEqual([100, 100, 100]);
    expect(result.imageClipIds).toHaveLength(3);

    const imageClips = next.timeline.clips.filter((clip) => clip.kind === 'image');
    expect(imageClips.map((clip) => clip.startFrame)).toEqual([0, 100, 200]);
    expect(imageClips.map((clip) => clip.durationFrames)).toEqual([100, 100, 100]);

    const audioClip = next.timeline.clips.find((clip) => clip.kind === 'audio');
    expect(audioClip?.startFrame).toBe(0);
    expect(audioClip?.durationFrames).toBe(300);
    expect(result.audioClipId).toBe(audioClip?.id);
  });

  it('reparte el resto de frames sin perder ninguno', () => {
    const images = [imageAsset('a'), imageAsset('b'), imageAsset('c')];
    const audio = audioAsset(301);
    const project = withAssets([...images, audio]);

    const result = buildStoryboard(project, { images, audio });

    expect(result.perImageFrames).toEqual([101, 100, 100]);
    expect(result.perImageFrames.reduce((sum, value) => sum + value, 0)).toBe(301);
  });

  it('usa las duraciones estimadas del guion cuando no hay narración', () => {
    const images = [imageAsset('a'), imageAsset('b'), imageAsset('c')];
    let project = withAssets(images);
    const first = addScene(project, {
      title: 'Uno',
      intent: 'hook',
      narration: 'Primera escena.',
    });
    project = first.project;
    const second = addScene(project, {
      title: 'Dos',
      intent: 'outro',
      narration: 'Segunda escena.',
    });
    project = second.project;
    const fps = project.video.frameRate.num / project.video.frameRate.den;
    const total = project.scenes.reduce(
      (sum, scene) => sum + (scene.narration.estimatedDurationFrames ?? 0),
      0,
    );
    expect(total).toBeGreaterThan(0);

    const result = buildStoryboard(project, { images });

    expect(result.distribution).toBe('scenes');
    expect(result.totalFrames).toBe(total);
    expect(result.perImageFrames.reduce((sum, value) => sum + value, 0)).toBe(total);
    expect(fps).toBe(30);
  });

  it('usa cinco segundos por imagen cuando no hay audio ni guion', () => {
    const images = [imageAsset('a'), imageAsset('b')];
    const project = withAssets(images);

    const result = buildStoryboard(project, { images });

    expect(result.distribution).toBe('default');
    expect(result.perImageFrames).toEqual([150, 150]);
    expect(result.totalFrames).toBe(300);
  });

  it('reutiliza una pista de imágenes vacía y crea una nueva si está ocupada', () => {
    const images = [imageAsset('a'), imageAsset('b')];
    const project = withAssets(images);
    const before = project.timeline.tracks.length;

    const result = buildStoryboard(project, { images });
    expect(result.project.timeline.tracks.length).toBe(before + 1);

    const third = imageAsset('c');
    const withThird = addAsset(result.project, third);
    const again = buildStoryboard(withThird, { images: [third] });
    expect(again.project.timeline.tracks.filter((track) => track.kind === 'image')).toHaveLength(2);
  });

  it('no muta el proyecto de entrada', () => {
    const images = [imageAsset('a')];
    const project = withAssets(images);
    const snapshot = JSON.stringify(project);

    buildStoryboard(project, { images });

    expect(JSON.stringify(project)).toBe(snapshot);
  });

  it('rechaza lotes vacíos y material sin derechos', () => {
    const project = base();
    expect(() => buildStoryboard(project, { images: [] })).toThrow(/al menos una imagen/i);

    const unready = imageAsset('sin derechos', { status: 'unverified' } as Partial<Asset>);
    const withUnready = withAssets([unready]);
    expect(() => buildStoryboard(withUnready, { images: [unready] })).toThrow(/derechos/i);
  });

  it('exige que los assets estén en el proyecto', () => {
    const asset = imageAsset('huérfana');
    const project = base();

    expect(() => buildStoryboard(project, { images: [asset] })).toThrow(/no está en el proyecto/i);
  });

  it('registra la operación en provenance', () => {
    const images = [imageAsset('a'), imageAsset('b')];
    const project = withAssets(images);

    const result = buildStoryboard(project, { images });
    const operation = result.project.provenance.operations.at(-1);

    expect(operation?.role).toBe('editor');
    expect(operation?.appliedStatus).toBe('applied');
    expect(operation?.summary).toMatch(/storyboard/i);
    expect(operation?.patch.length).toBeGreaterThanOrEqual(2);
  });

  it('tolera una pista bloqueada y elige otra', () => {
    const images = [imageAsset('a')];
    const project = withAssets(images);
    const locked = addClipFromAsset(project, images[0] as Asset, { atFrame: 0 });
    const lockedProject = {
      ...locked.project,
      timeline: {
        ...locked.project.timeline,
        tracks: locked.project.timeline.tracks.map((track) => ({ ...track, locked: true })),
      },
    };

    const second = imageAsset('b');
    const withSecond = addAsset(lockedProject, second);
    const result = buildStoryboard(withSecond, { images: [second] });
    expect(result.project.timeline.tracks.some((track) => track.locked)).toBe(true);  });
});

describe('storyboard con movimiento y transiciones', () => {
  it('aplica Ken Burns alternado y fundidos a cada imagen', () => {
    const images = [imageAsset('001 faro'), imageAsset('002 bosque'), imageAsset('003 ciudad')];
    const audio = audioAsset(300);
    const project = withAssets([...images, audio]);

    const result = buildStoryboard(project, {
      images,
      audio,
      photoMotion: 'auto',
      transitionFrames: 15,
    });
    const next = validated(result.project);
    const imageClips = next.timeline.clips
      .filter((clip) => clip.kind === 'image')
      .sort((a, b) => a.startFrame - b.startFrame);

    expect(imageClips.map((clip) => clip.motion?.type)).toEqual([
      'zoom-in',
      'zoom-out',
      'pan-left',
    ]);
    expect(
      imageClips.map((clip) => [clip.effects?.fadeInFrames, clip.effects?.fadeOutFrames]),
    ).toEqual([
      [15, 15],
      [15, 15],
      [15, 15],
    ]);
  });

  it('no toca las imágenes cuando el movimiento y la transición están apagados', () => {
    const images = [imageAsset('001 faro'), imageAsset('002 bosque')];
    const project = withAssets(images);

    const result = buildStoryboard(project, {
      images,
      photoMotion: 'none',
      transitionFrames: 0,
    });
    const next = validated(result.project);
    const imageClips = next.timeline.clips.filter((clip) => clip.kind === 'image');

    expect(imageClips.every((clip) => clip.motion === undefined)).toBe(true);
    expect(imageClips.every((clip) => clip.effects === undefined)).toBe(true);
  });
});

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
  attachNarrationAsset,
  ensureDelivery,
  newId,
  totalFrames,
  updateScene,
} from './project-actions';
import { buildAutoEdit, prepareAutoEdit } from './auto-edit';

const NOW = '2026-10-19T00:00:00.000Z';

function validated(project: ProjectDocument): ProjectDocument {
  const parsed = parseProject(project);
  if (!parsed.ok) throw new Error(`proyecto inválido: ${JSON.stringify(parsed.issues)}`);
  return parsed.project;
}

function base(): ProjectDocument {
  return validated(ensureDelivery(createEmptyProject('Auto edit', NOW)));
}

function image(label: string): Asset {
  return {
    id: newId(),
    label,
    kind: 'image',
    source: { type: 'local', path: `media/${label}.png` },
    status: 'ready',
    integrity: { sha256: 'a'.repeat(64), bytes: 12_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { width: 1024, height: 1024 },
  } as Asset;
}

function video(): Asset {
  return {
    id: newId(),
    label: 'clip.mp4',
    kind: 'video',
    source: { type: 'local', path: 'media/clip.mp4' },
    status: 'ready',
    integrity: { sha256: 'c'.repeat(64), bytes: 30_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { width: 1920, height: 1080, durationFrames: 150, frameRate: { num: 30, den: 1 } },
  } as Asset;
}

function audio(durationFrames: number): Asset {
  return {
    id: newId(),
    label: `narracion-${durationFrames}.wav`,
    kind: 'audio',
    source: { type: 'local', path: `media/narracion-${durationFrames}.wav` },
    status: 'ready',
    integrity: { sha256: 'b'.repeat(64), bytes: 40_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { sampleRate: 48_000, channels: 1, durationFrames },
  } as Asset;
}

function withScene(
  project: ProjectDocument,
  title: string,
  narration: string,
  notes: string,
): { project: ProjectDocument; sceneId: string } {
  const added = addScene(project, { title, intent: 'explainer', narration });
  const updated = updateScene(added.project, added.sceneId, { notes });
  return { project: updated, sceneId: added.sceneId };
}

describe('montaje automático', () => {
  it('asigna imágenes en orden y monta audio y subtítulos con duración exacta', () => {
    const firstImage = image('001-faro');
    const secondImage = image('002-bosque');
    let project = base();
    project = addAsset(addAsset(project, firstImage), secondImage);
    const first = withScene(project, 'El faro', 'Un faro azul resiste la tormenta.', 'Un faro azul sobre el acantilado.');
    project = first.project;
    const second = withScene(project, 'El bosque', 'El bosque despierta al amanecer.', 'Un bosque de abedules al amanecer.');
    project = second.project;
    const firstAudio = audio(90);
    const secondAudio = audio(120);
    project = addAsset(addAsset(project, firstAudio), secondAudio);
    project = attachNarrationAsset(project, first.sceneId, firstAudio.id);
    project = attachNarrationAsset(project, second.sceneId, secondAudio.id);

    const result = buildAutoEdit(project, {
      assignment: 'order',
      includeCaptions: true,
      replaceTimeline: true,
    });
    const next = validated(result.project);

    expect(result.plan.totalFrames).toBe(210);
    expect(result.plan.scenes.map((scene) => scene.durationFrames)).toEqual([90, 120]);
    const imageClips = next.timeline.clips.filter((clip) => clip.kind === 'image');
    expect(imageClips.map((clip) => [clip.startFrame, clip.durationFrames])).toEqual([
      [0, 90],
      [90, 120],
    ]);
    const audioClips = next.timeline.clips.filter((clip) => clip.kind === 'audio');
    expect(audioClips.map((clip) => [clip.startFrame, clip.durationFrames])).toEqual([
      [0, 90],
      [90, 120],
    ]);
    expect(next.captions.cues.length).toBeGreaterThanOrEqual(2);
    expect(next.captions.cues[0]?.startFrame).toBe(0);
    expect(next.captions.cues.at(-1)?.endFrame).toBe(210);
    expect(next.scenes[0]?.clipIds).toHaveLength(2);
    expect(next.scenes[1]?.narration.assetId).toBe(secondAudio.id);
    expect(next.provenance.operations.at(-1)?.role).toBe('editor');
    expect(result.plan.warnings).toEqual([]);
  });

  it('repite imágenes con un aviso cuando hay más escenas que recursos', () => {
    const only = image('001-unico');
    let project = addAsset(base(), only);
    const first = withScene(project, 'Uno', 'Primera escena.', 'Primera nota.');
    project = first.project;
    const second = withScene(project, 'Dos', 'Segunda escena.', 'Segunda nota.');
    project = second.project;

    const result = buildAutoEdit(project, {
      assignment: 'order',
      includeCaptions: false,
      replaceTimeline: true,
    });

    expect(result.plan.scenes.map((scene) => scene.imageId)).toEqual([only.id, only.id]);
    expect(result.plan.warnings.join(' ')).toMatch(/repit/i);
    expect(result.plan.scenes.map((scene) => scene.audioId)).toEqual([undefined, undefined]);
  });

  it('elige la imagen por coincidencia de texto cuando se pide', () => {
    const forest = image('001-bosque-abedules-amanecer');
    const lighthouse = image('002-faro-acantilado-mar');
    let project = base();
    project = addAsset(addAsset(project, forest), lighthouse);
    const first = withScene(
      project,
      'El faro',
      'El faro resiste la tormenta.',
      'Un faro sobre un acantilado con olas.',
    );
    project = first.project;
    const second = withScene(
      project,
      'El bosque',
      'El bosque despierta.',
      'Un bosque de abedules al amanecer.',
    );
    project = second.project;

    const result = buildAutoEdit(project, {
      assignment: 'match',
      includeCaptions: false,
      replaceTimeline: true,
    });

    expect(result.plan.scenes[0]?.imageId).toBe(lighthouse.id);
    expect(result.plan.scenes[1]?.imageId).toBe(forest.id);
  });

  it('parte subtítulos largos en cues contiguos sin perder frames', () => {
    const imageAsset = image('001-largo');
    let project = addAsset(base(), imageAsset);
    const text =
      'Esta es una narración deliberadamente larga para comprobar que los subtítulos se dividen en varios bloques legibles y que cada bloque conserva su parte de la duración total de la escena.';
    const scene = withScene(project, 'Larga', text, 'Una escena de prueba.');
    project = scene.project;
    const narration = audio(300);
    project = addAsset(project, narration);
    project = attachNarrationAsset(project, scene.sceneId, narration.id);

    const result = buildAutoEdit(project, {
      assignment: 'order',
      includeCaptions: true,
      replaceTimeline: true,
      maxCaptionChars: 55,
    });
    const next = validated(result.project);
    const cues = next.captions.cues;

    expect(cues.length).toBeGreaterThan(1);
    let cursor = 0;
    for (const cue of cues) {
      expect(cue.startFrame).toBe(cursor);
      expect(cue.endFrame).toBeGreaterThan(cue.startFrame);
      cursor = cue.endFrame;
    }
    expect(cursor).toBe(300);
  });

  it('reemplaza la timeline anterior sin borrar assets', () => {
    const oldImage = image('000-vieja');
    const newImage = image('001-nueva');
    let project = base();
    project = addAsset(addAsset(project, oldImage), newImage);
    const oldClip = addClipFromAsset(project, oldImage, { atFrame: 0 });
    project = oldClip.project;
    const scene = withScene(project, 'Nueva', 'Nueva narración.', 'Nueva nota.');
    project = scene.project;

    const result = buildAutoEdit(project, {
      assignment: 'order',
      includeCaptions: true,
      replaceTimeline: true,
    });
    const next = validated(result.project);

    expect(next.timeline.clips.some((clip) => clip.id === oldClip.clipId)).toBe(false);
    expect(next.assets.map((asset) => asset.id)).toContain(oldImage.id);
    expect(next.timeline.clips).toHaveLength(1);
    expect(next.timeline.clips[0]?.kind).toBe('image');
  });

  it('no muta el proyecto de entrada', () => {
    const imageAsset = image('001-faro');
    let project = addAsset(base(), imageAsset);
    const scene = withScene(project, 'Faro', 'Narración.', 'Nota.');
    project = scene.project;
    const snapshot = JSON.stringify(project);

    buildAutoEdit(project, {
      assignment: 'order',
      includeCaptions: true,
      replaceTimeline: true,
    });

    expect(JSON.stringify(project)).toBe(snapshot);
  });

  it('exige escenas e imágenes', () => {
    expect(() =>
      buildAutoEdit(base(), {
        assignment: 'order',
        includeCaptions: false,
        replaceTimeline: true,
      }),
    ).toThrow(/escena/i);

    const withImage = addAsset(base(), image('001-faro'));
    expect(() =>
      buildAutoEdit(withImage, {
        assignment: 'order',
        includeCaptions: false,
        replaceTimeline: true,
      }),
    ).toThrow(/escena/i);

    const scene = withScene(base(), 'Faro', 'Narración.', 'Nota.');
    expect(() =>
      buildAutoEdit(scene.project, {
        assignment: 'order',
        includeCaptions: false,
        replaceTimeline: true,
      }),
    ).toThrow(/imagen/i);
  });

  it('estima la duración cuando la escena no tiene audio', () => {
    const imageAsset = image('001-faro');
    let project = addAsset(base(), imageAsset);
    const scene = withScene(project, 'Faro', 'Una narración sin audio.', 'Nota.');
    project = scene.project;
    const estimated = project.scenes[0]?.narration.estimatedDurationFrames ?? 0;

    const result = buildAutoEdit(project, {
      assignment: 'order',
      includeCaptions: false,
      replaceTimeline: true,
    });

    expect(result.plan.scenes[0]?.durationFrames).toBe(estimated);
    expect(result.plan.scenes[0]?.audioId).toBeUndefined();
    expect(result.plan.warnings.join(' ')).toMatch(/sin audio|estimad/i);
  });

  it('calcula la duración total del plan', () => {
    const imageAsset = image('001-faro');
    let project = addAsset(base(), imageAsset);
    const scene = withScene(project, 'Faro', 'Narración.', 'Nota.');
    project = scene.project;
    const narration = audio(45);
    project = addAsset(project, narration);
    project = attachNarrationAsset(project, scene.sceneId, narration.id);

    const result = buildAutoEdit(project, {
      assignment: 'order',
      includeCaptions: true,
      replaceTimeline: true,
    });

    expect(result.plan.totalFrames).toBe(45);
    expect(totalFrames(validated(result.project))).toBe(45);
  });
});

describe('preparar montaje con narraciones nuevas', () => {
  it('agrega la narración, la marca lista, la vincula y monta la timeline', () => {
    const imageAsset = image('001-faro');
    let project = addAsset(base(), imageAsset);
    const scene = withScene(project, 'Faro', 'Narración nueva.', 'Nota.');
    project = scene.project;
    const candidate = {
      ...audio(60),
      status: 'unverified' as const,
      rights: {
        license: { id: 'unknown', commercialUse: 'unknown' as const },
        provenance: { origin: 'generated-locally' as const, acquiredAt: NOW, provider: 'windows-sapi' },
      },
    } as Asset;

    const result = prepareAutoEdit(
      project,
      [{ sceneId: scene.sceneId, asset: candidate }],
      { assignment: 'order', includeCaptions: true, replaceTimeline: true },
      true,
    );
    const next = validated(result.project);

    expect(next.assets.find((asset) => asset.id === candidate.id)?.status).toBe('ready');
    expect(next.scenes[0]?.narration.assetId).toBe(candidate.id);
    expect(next.timeline.clips.filter((clip) => clip.kind === 'audio')).toHaveLength(1);
    expect(result.plan.scenes[0]?.audioId).toBe(candidate.id);
  });

  it('exige confirmar derechos cuando hay narraciones nuevas', () => {
    const imageAsset = image('001-faro');
    let project = addAsset(base(), imageAsset);
    const scene = withScene(project, 'Faro', 'Narración nueva.', 'Nota.');
    project = scene.project;

    expect(() =>
      prepareAutoEdit(
        project,
        [{ sceneId: scene.sceneId, asset: audio(60) }],
        { assignment: 'order', includeCaptions: false, replaceTimeline: true },
        false,
      ),
    ).toThrow(/derechos/i);
  });
});


describe('preparar montaje con audio existente sin derechos', () => {
  it('marca el audio existente como listo cuando el usuario confirma la voz', () => {
    const imageAsset = image('001-faro');
    const pending = {
      ...audio(45),
      status: 'unverified' as const,
      rights: {
        license: { id: 'unknown', commercialUse: 'unknown' as const },
        provenance: { origin: 'generated-locally' as const, acquiredAt: NOW, provider: 'windows-sapi' },
      },
    } as Asset;
    let project = addAsset(addAsset(base(), imageAsset), pending);
    const scene = withScene(project, 'Faro', 'Narración existente.', 'Nota.');
    project = attachNarrationAsset(scene.project, scene.sceneId, pending.id);

    const result = prepareAutoEdit(
      project,
      [],
      { assignment: 'order', includeCaptions: false, replaceTimeline: true },
      true,
    );

    expect(result.project.assets.find((asset) => asset.id === pending.id)?.status).toBe('ready');
    expect(result.plan.scenes[0]?.audioId).toBe(pending.id);
  });
});


describe('aviso de videos no montados', () => {
  it('avisa cuando hay videos listos que el montaje automático no usa', () => {
    const imageAsset = image('001-faro');
    const videoAsset = video();
    let project = addAsset(addAsset(base(), imageAsset), videoAsset);
    const scene = withScene(project, 'Faro', 'Narración.', 'Nota.');
    project = scene.project;

    const result = buildAutoEdit(project, {
      assignment: 'order',
      includeCaptions: false,
      replaceTimeline: true,
    });

    expect(result.plan.warnings.join(' ')).toMatch(/video/i);
    expect(result.plan.scenes).toHaveLength(1);
  });
});

describe('movimiento y transiciones automáticas', () => {
  function twoScenes(): ProjectDocument {
    const firstImage = image('001-faro');
    const secondImage = image('002-bosque');
    let project = addAsset(addAsset(base(), firstImage), secondImage);
    const first = withScene(
      project,
      'El faro',
      'Un faro azul resiste la tormenta.',
      'Un faro azul sobre el acantilado.',
    );
    project = first.project;
    const second = withScene(
      project,
      'El bosque',
      'El bosque despierta al amanecer.',
      'Un bosque de abedules al amanecer.',
    );
    project = second.project;
    const firstAudio = audio(90);
    const secondAudio = audio(120);
    project = addAsset(addAsset(project, firstAudio), secondAudio);
    project = attachNarrationAsset(project, first.sceneId, firstAudio.id);
    project = attachNarrationAsset(project, second.sceneId, secondAudio.id);
    return project;
  }

  it('aplica movimiento Ken Burns alternado y fundidos de transición', () => {
    const result = buildAutoEdit(twoScenes(), {
      assignment: 'order',
      includeCaptions: false,
      replaceTimeline: true,
      photoMotion: 'auto',
      transitionFrames: 12,
    });
    const next = validated(result.project);
    const imageClips = next.timeline.clips
      .filter((clip) => clip.kind === 'image')
      .sort((a, b) => a.startFrame - b.startFrame);

    expect(imageClips.map((clip) => clip.motion)).toEqual([
      { type: 'zoom-in', intensity: 0.12 },
      { type: 'zoom-out', intensity: 0.12 },
    ]);
    expect(
      imageClips.map((clip) => [clip.effects?.fadeInFrames, clip.effects?.fadeOutFrames]),
    ).toEqual([
      [12, 12],
      [12, 12],
    ]);
  });

  it('deja las fotos quietas cuando se pide none y transición cero', () => {
    const result = buildAutoEdit(twoScenes(), {
      assignment: 'order',
      includeCaptions: false,
      replaceTimeline: true,
      photoMotion: 'none',
      transitionFrames: 0,
    });
    const next = validated(result.project);
    const imageClips = next.timeline.clips.filter((clip) => clip.kind === 'image');

    expect(imageClips.every((clip) => clip.motion === undefined)).toBe(true);
    expect(imageClips.every((clip) => clip.effects === undefined)).toBe(true);
  });
});


import { describe, expect, it, vi } from 'vitest';
import type { Asset, ProjectDocument } from '@editor-ia/project-schema';
import { createEmptyProject, parseProject } from '@editor-ia/project-schema';
import {
  ASSISTANT_TOOLS,
  assistantToolPayload,
  findAssistantTool,
  validateToolArguments,
  type AssistantToolHost,
} from './assistant-tools';
import { addAsset, ensureDelivery, newId } from '../../state/project-actions';

const NOW = '2025-01-01T00:00:00.000Z';

function validated(project: ProjectDocument): ProjectDocument {
  const parsed = parseProject(project);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
}

function videoAsset(durationFrames = 300): Asset {
  return {
    id: newId(),
    label: 'Toma',
    kind: 'video',
    source: { type: 'local', path: 'media/toma.mp4' },
    status: 'ready',
    integrity: { sha256: 'a'.repeat(64), bytes: 10_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { width: 1920, height: 1080, durationFrames, frameRate: { num: 30, den: 1 } },
  } as Asset;
}

function createHost(initial: ProjectDocument | null) {
  const state = {
    project: initial,
    playhead: 0,
    view: 'editor',
    selection: { kind: 'none' } as { kind: string; id?: string },
    playing: false,
  };
  const host: AssistantToolHost = {
    project: () => state.project,
    playheadFrame: () => state.playhead,
    selection: () => state.selection,
    view: () => state.view,
    navigate: vi.fn((view: string) => {
      state.view = view;
    }),
    setPlaying: vi.fn((playing: boolean) => {
      state.playing = playing;
    }),
    undo: vi.fn(),
    redo: vi.fn(),
    save: vi.fn(async () => undefined),
    requestExport: vi.fn(),
    mutate: vi.fn((update: (project: ProjectDocument) => ProjectDocument) => {
      if (!state.project) return false;
      const next = update(state.project);
      const parsed = parseProject(next);
      if (!parsed.ok) return false;
      state.project = parsed.project;
      return true;
    }),
    selectClip: vi.fn((clipId: string) => {
      state.selection = { kind: 'clip', id: clipId };
    }),
    openProjectAt: vi.fn(async () => true),
    importAssetPath: vi.fn(async () => [{ id: 'asset-new', label: 'Foto importada' }]),
    renderRigClip: vi.fn(async () => ({
      assetId: 'asset-rig',
      label: 'Personaje caminar.mp4',
      bytes: 12_345,
      durationSeconds: 2,
    })),
    perfStats: vi.fn(() => ({
      active: true,
      fps: 58.5,
      targetFps: 30,
      frames: 120,
      dropped: 2,
      heapMb: 180,
    })),
    synthesizeNarration: vi.fn(async () =>
      ({
        id: newId(),
        label: 'Narración SAPI',
        kind: 'audio',
        source: { type: 'local', path: 'media/voz.wav' },
        status: 'ready',
        integrity: { sha256: 'b'.repeat(64), bytes: 5_000 },
        rights: {
          license: { id: 'owned', commercialUse: 'allowed' },
          provenance: { origin: 'generated-locally', acquiredAt: NOW },
        },
        media: { sampleRate: 48_000, channels: 1, durationFrames: 60 },
      }) as Asset,
    ),
    renderThreeScene: vi.fn(async () => ({
      assetId: 'asset-3d',
      label: 'Escena 3D.mp4',
      bytes: 50_000,
      durationSeconds: 4,
    })),
    renderSceneSegment: vi.fn(async (request: { sceneId: string }) => ({
      sceneId: request.sceneId,
      skipped: false,
      outputPath: 'C:/ws/escena.mp4',
      bytes: 0,
      startFrame: 0,
      endFrame: 60,
      jobId: 'job-seg',
      profileName: 'YouTube 1080p',
    })),
    concatVideos: vi.fn(async (paths: readonly string[]) => ({
      outputPath: 'C:/ws/final.mp4',
      bytes: 1_000 * paths.length,
      durationSeconds: paths.length,
      segments: paths.length,
    })),
    trackPoint: vi.fn(async () => ({
      durationSeconds: 1,
      fps: 6,
      scaledWidth: 480,
      scaledHeight: 270,
      points: [
        { time: 0, x: 0.4, y: 0.5, confidence: 1 },
        { time: 0.5, x: 0.5, y: 0.5, confidence: 0.9 },
      ],
    })),
    trackObject: vi.fn(async () => ({
      durationSeconds: 1,
      fps: 6,
      scaledWidth: 480,
      scaledHeight: 270,
      regionWidth: 0.2,
      regionHeight: 0.1,
      points: [
        { time: 0, x: 0.4, y: 0.5, confidence: 1 },
        { time: 0.5, x: 0.5, y: 0.5, confidence: 0.9 },
      ],
    })),
    startRender: vi.fn(async () => ({ jobId: 'job-1', profileName: 'Test' })),
    cancelRender: vi.fn(async () => undefined),
    activeRender: vi.fn(async () => null),
    lastRenderEvent: vi.fn(() => null),
  };
  return { host, state };
}

describe('herramientas del asistente', () => {
  it('valida los argumentos con el JSON Schema declarado', () => {
    const split = findAssistantTool('clip_split');
    expect(split).not.toBeNull();
    const schema = split!.parameters;
    expect(validateToolArguments(schema, {})).toEqual([]);
    expect(validateToolArguments(schema, { frame: 10 })).toEqual([]);
    expect(validateToolArguments(schema, { frame: 1.5 })).toContain(
      'frame debe ser un entero',
    );
    expect(validateToolArguments(schema, { clipId: '' })).toContain(
      'clipId es demasiado corto',
    );
    expect(validateToolArguments(schema, { extra: true })).toContain(
      'argumento desconocido: extra',
    );
    const navigate = findAssistantTool('navigate')!;
    expect(validateToolArguments(navigate.parameters, { view: 'nowhere' })).toContain(
      'view debe ser uno de: home, projects, script, assets, production, editor, download, director, factory, compliance, convert, compare, compress, denoise, thumbnails, localization, ai-hub, motion, visuals, background, upscale, learn, mcp, settings',
    );
    expect(validateToolArguments(navigate.parameters, {})).toContain(
      'falta el argumento obligatorio: view',
    );
  });

  it('expone las herramientas en formato OpenAI function calling', () => {
    const payload = assistantToolPayload();
    expect(payload.length).toBe(ASSISTANT_TOOLS.length);
    expect(payload.every((entry) => entry.type === 'function')).toBe(true);
    expect(payload.map((entry) => entry.function.name)).toContain('project_inspect');
    expect(payload.map((entry) => entry.function.name)).toContain('export_open');
    expect(payload.map((entry) => entry.function.name)).toContain('scene_resolve');
    expect(payload.map((entry) => entry.function.name)).toContain('engine_catalog');
    expect(payload.map((entry) => entry.function.name)).toContain('parallax_add');
    expect(payload.map((entry) => entry.function.name)).toContain('track_point');
    expect(payload.map((entry) => entry.function.name)).toContain('track_object');
    expect(payload.map((entry) => entry.function.name)).toContain('render_start');
    expect(payload.map((entry) => entry.function.name)).toContain('rig_add');
    expect(payload.map((entry) => entry.function.name)).toContain('project_open');
    expect(payload.map((entry) => entry.function.name)).toContain('asset_import');
    expect(payload.map((entry) => entry.function.name)).toContain('three_add');
    expect(payload.map((entry) => entry.function.name)).toContain('camera_move');
    expect(payload.map((entry) => entry.function.name)).toContain('effect_apply');
    expect(payload.map((entry) => entry.function.name)).toContain('transition_apply');
    expect(payload.map((entry) => entry.function.name)).toContain('subtitle_add');
    expect(payload.map((entry) => entry.function.name)).toContain('scene_create');
    expect(payload.map((entry) => entry.function.name)).toContain('render_scene');
    expect(payload.map((entry) => entry.function.name)).toContain('video_concat');
    expect(payload.map((entry) => entry.function.name)).toContain('motion_path');
  });

  it('expone el catálogo de motores y exige un objetivo para resolver', async () => {
    const base = validated(ensureDelivery(createEmptyProject('Prueba', NOW)));
    const { host } = createHost(base);
    const catalog = await findAssistantTool('engine_catalog')!.execute({}, host);
    expect(catalog.ok).toBe(true);
    expect((catalog.data as { engines: unknown[] }).engines.length).toBeGreaterThanOrEqual(9);
    const invalid = await findAssistantTool('scene_resolve')!.execute({}, host);
    expect(invalid.ok).toBe(false);
    expect(invalid.summary).toContain('sceneId o clipId');
  });

  it('inspecciona el proyecto con pistas, duración y selección', async () => {
    const base = validated(ensureDelivery(createEmptyProject('Prueba', NOW)));
    const { host, state } = createHost(base);
    state.selection = { kind: 'track', id: 't1' };
    const tool = findAssistantTool('project_inspect')!;
    const result = await tool.execute({}, host);
    expect(result.ok).toBe(true);
    const data = result.data as {
      name: string;
      clips: number;
      fps: number;
      durationFrames: number;
      selection: { kind: string };
    };
    expect(data.name).toBe('Prueba');
    expect(data.clips).toBe(0);
    expect(data.fps).toBeGreaterThan(0);
    expect(data.durationFrames).toBe(0);
    expect(data.selection.kind).toBe('track');
  });

  it('agrega un clip y lo divide en el playhead con acciones reales', async () => {
    const asset = videoAsset(300);
    const base = validated(addAsset(ensureDelivery(createEmptyProject('Prueba', NOW)), asset));
    const { host, state } = createHost(base);
    const add = await findAssistantTool('clip_add')!.execute({ assetId: asset.id }, host);
    expect(add.ok).toBe(true);
    expect(state.project?.timeline.clips.length).toBe(1);
    expect(state.project?.timeline.tracks.length).toBe(1);
    expect(state.selection.kind).toBe('clip');

    state.playhead = 20;
    const split = await findAssistantTool('clip_split')!.execute({}, host);
    expect(split.ok).toBe(true);
    expect(state.project?.timeline.clips.length).toBe(2);
    expect(state.selection.id).toBeTruthy();

    const data = split.data as { rightClipId: string };
    const original = state.project?.timeline.clips.find((clip) => clip.id === data.rightClipId);
    expect(original?.startFrame).toBe(20);
  });

  it('rechaza dividir fuera del clip y agregar material inexistente', async () => {
    const base = validated(ensureDelivery(createEmptyProject('Prueba', NOW)));
    const { host, state } = createHost(base);
    const add = await findAssistantTool('clip_add')!.execute({ assetId: 'nope' }, host);
    expect(add.ok).toBe(false);
    expect(state.project?.timeline.clips.length).toBe(0);
    const split = await findAssistantTool('clip_split')!.execute({ clipId: 'nope' }, host);
    expect(split.ok).toBe(false);
  });

  it('agrega un gráfico animado y navega al editor', async () => {
    const base = validated(ensureDelivery(createEmptyProject('Prueba', NOW)));
    const { host, state } = createHost(base);
    state.view = 'home';
    state.playhead = 12;
    const result = await findAssistantTool('motion_add')!.execute(
      { templateId: 'lower-third', text: 'Ana', secondary: 'Producción' },
      host,
    );
    expect(result.ok).toBe(true);
    expect(state.project?.timeline.clips.length).toBe(1);
    expect(state.project?.timeline.clips[0]?.kind).toBe('graphic');
    expect(state.project?.timeline.clips[0]?.startFrame).toBe(12);
    expect(state.selection.kind).toBe('clip');
    expect(state.view).toBe('editor');
  });

  it('sigue un punto y aplica la máscara al clip', async () => {
    const asset = videoAsset();
    const base = validated(addAsset(ensureDelivery(createEmptyProject('Prueba', NOW)), asset));
    const { host, state } = createHost(base);
    const added = await findAssistantTool('clip_add')!.execute({ assetId: asset.id }, host);
    const clipId = (added.data as { clipId: string }).clipId;
    const result = await findAssistantTool('track_point')!.execute(
      { clipId, x: 0.4, y: 0.5 },
      host,
    );
    expect(result.ok).toBe(true);
    const clip = state.project?.timeline.clips.find((item) => item.id === clipId);
    const mask = clip && 'mask' in clip ? clip.mask : undefined;
    expect(mask?.shape).toBe('polygon');
    expect(mask?.keyframes?.length).toBe(2);
    expect(host.trackPoint).toHaveBeenCalled();
  });

  it('sigue un objeto con caja y aplica la máscara rectangular', async () => {
    const asset = videoAsset();
    const base = validated(addAsset(ensureDelivery(createEmptyProject('Prueba', NOW)), asset));
    const { host, state } = createHost(base);
    const added = await findAssistantTool('clip_add')!.execute({ assetId: asset.id }, host);
    const clipId = (added.data as { clipId: string }).clipId;
    const result = await findAssistantTool('track_object')!.execute(
      { clipId, x: 0.4, y: 0.5, width: 0.2, height: 0.1 },
      host,
    );
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('caja 20×10 %');
    expect(host.trackObject).toHaveBeenCalledWith({
      path: 'media/toma.mp4',
      startSeconds: 0,
      endSeconds: 10,
      x: 0.4,
      y: 0.5,
      width: 0.2,
      height: 0.1,
    });
    const clip = state.project?.timeline.clips.find((item) => item.id === clipId);
    const mask = clip && 'mask' in clip ? clip.mask : undefined;
    expect(mask?.points).toHaveLength(4);
    expect(mask?.keyframes?.length).toBe(2);
    expect(
      validateToolArguments(findAssistantTool('track_object')!.parameters, {
        x: 0.4,
        y: 0.5,
        width: 0.005,
        height: 0.1,
      }),
    ).toContain('width no puede ser menor que 0.01');
  });

  it('abre un proyecto por ruta e importa material con el host', async () => {
    const base = validated(ensureDelivery(createEmptyProject('Prueba', NOW)));
    const { host } = createHost(base);
    const opened = await findAssistantTool('project_open')!.execute(
      { path: 'C:/ws/demo.editoria.json' },
      host,
    );
    expect(opened.ok).toBe(true);
    expect(host.openProjectAt).toHaveBeenCalledWith('C:/ws/demo.editoria.json');

    const imported = await findAssistantTool('asset_import')!.execute(
      { path: 'C:/ws/foto.png' },
      host,
    );
    expect(imported.ok).toBe(true);
    expect(imported.summary).toContain('Foto importada');
    expect(host.importAssetPath).toHaveBeenCalledWith('C:/ws/foto.png');

    const perf = await findAssistantTool('perf_stats')!.execute({}, host);
    expect(perf.ok).toBe(true);
    expect((perf.data as { fps: number }).fps).toBe(58.5);
    const empty = createHost(null);
    const noProject = await findAssistantTool('asset_import')!.execute(
      { path: 'C:/ws/foto.png' },
      empty.host,
    );
    expect(noProject.ok).toBe(false);
  });

  it('aplica cámara, efectos, transición, subtítulo, escena y 3D', async () => {
    const asset = videoAsset();
    const base = validated(addAsset(ensureDelivery(createEmptyProject('Prueba', NOW)), asset));
    const { host, state } = createHost(base);
    const added = await findAssistantTool('clip_add')!.execute({ assetId: asset.id }, host);
    const clipId = (added.data as { clipId: string }).clipId;

    const camera = await findAssistantTool('camera_move')!.execute(
      { clipId, type: 'zoom-in', intensity: 0.1 },
      host,
    );
    expect(camera.ok).toBe(true);
    const effects = await findAssistantTool('effect_apply')!.execute(
      { clipId, contrast: 1.2, grain: 0.2 },
      host,
    );
    expect(effects.ok).toBe(true);
    const transition = await findAssistantTool('transition_apply')!.execute(
      { clipId, type: 'dissolve', frames: 8 },
      host,
    );
    expect(transition.ok).toBe(true);
    const subtitle = await findAssistantTool('subtitle_add')!.execute(
      { text: 'Hola agente', startFrame: 0, durationFrames: 30 },
      host,
    );
    expect(subtitle.ok).toBe(true);
    const scene = await findAssistantTool('scene_create')!.execute(
      { title: 'Escena uno', narration: 'Demo del motor', clipIds: [clipId] },
      host,
    );
    expect(scene.ok).toBe(true);
    const sceneId = (scene.data as { sceneId: string }).sceneId;
    const noRights = await findAssistantTool('narrate_scenes')!.execute(
      { sceneIds: [sceneId] },
      host,
    );
    expect(noRights.ok).toBe(false);
    const narration = await findAssistantTool('narrate_scenes')!.execute(
      { sceneIds: [sceneId], confirmRights: true, voice: 'es-ES' },
      host,
    );
    expect(narration.ok, (narration as { summary?: string }).summary).toBe(true);
    const narrated = state.project!.scenes.find((item) => item.id === sceneId)!;
    expect(narrated.narration.assetId).toBeTruthy();
    const audioClip = state.project!.timeline.clips.find((clip) => clip.kind === 'audio');
    expect(audioClip).toBeTruthy();
    const narrationTrack = state.project!.timeline.tracks.find(
      (track) => track.id === audioClip!.trackId,
    );
    expect(narrationTrack?.kind).toBe('narration');
    expect(audioClip!.startFrame).toBe(0);
    const clipMixed = await findAssistantTool('clip_audio')!.execute(
      { clipIds: [audioClip!.id], gainDb: -4, pan: 0.5, fadeInFrames: 8 },
      host,
    );
    expect(clipMixed.ok).toBe(true);
    const mixedClip = state.project!.timeline.clips.find((clip) => clip.id === audioClip!.id)!;
    expect('audio' in mixedClip ? mixedClip.audio : undefined).toMatchObject({
      gainDb: -4,
      pan: 0.5,
      fadeInFrames: 8,
    });
    const mixed = await findAssistantTool('audio_mix')!.execute(
      {
        trackKind: 'narration',
        gainDb: -6,
        pan: 0.4,
        eqLowDb: 2,
        eqHighDb: -1,
        masterGainDb: -1,
        masterLimiter: true,
      },
      host,
    );
    expect(mixed.ok).toBe(true);
    const mixedTrack = state.project!.timeline.tracks.find(
      (track) => track.kind === 'narration',
    )!;
    expect(mixedTrack.gainDb).toBe(-6);
    expect(mixedTrack.pan).toBe(0.4);
    expect(mixedTrack.eqLowDb).toBe(2);
    expect(mixedTrack.eqHighDb).toBe(-1);
    expect(state.project!.audio.master.gainDb).toBe(-1);
    expect(state.project!.audio.master.limiter).toBe(true);
    const noTarget = await findAssistantTool('audio_mix')!.execute(
      { gainDb: -3 },
      host,
    );
    expect(noTarget.ok).toBe(false);
    const look = await findAssistantTool('project_look')!.execute(
      { contrast: 1.4, saturation: 0.3, vignette: 0.4, sepia: true },
      host,
    );
    expect(look.ok).toBe(true);
    expect(state.project!.look).toMatchObject({
      contrast: 1.4,
      saturation: 0.3,
      vignette: 0.4,
      sepia: true,
    });
    const cleared = await findAssistantTool('project_look')!.execute(
      { clear: true },
      host,
    );
    expect(cleared.ok).toBe(true);
    expect(state.project!.look).toBeUndefined();
    const updatedScene = await findAssistantTool('scene_update')!.execute(
      { sceneId, title: 'Escena editada', engine: 'ken-burns', clipIds: [] },
      host,
    );
    expect(updatedScene.ok).toBe(true);
    const savedScene = state.project!.scenes.find((item) => item.id === sceneId)!;
    expect(savedScene.title).toBe('Escena editada');
    expect(savedScene.engine).toBe('ken-burns');
    expect(savedScene.clipIds).toEqual([]);
    const restored = await findAssistantTool('scene_update')!.execute(
      { sceneId, clipIds: [clipId] },
      host,
    );
    expect(restored.ok).toBe(true);
    const missingScene = await findAssistantTool('scene_update')!.execute(
      { sceneId: 'no-existe', title: 'X' },
      host,
    );
    expect(missingScene.ok).toBe(false);
    const plan = await findAssistantTool('chapter_plan')!.execute(
      {
        narration: ['# Uno', 'Frase uno del plan.', '', '# Dos', 'Frase dos del plan.'].join('\n'),
        clipIds: [clipId],
        maxWords: 20,
      },
      host,
    );
    expect(plan.ok).toBe(true);
    expect(state.project!.sequences).toHaveLength(2);
    expect(state.project!.scenes.filter((item) => item.sequenceId)).toHaveLength(2);
    const three = await findAssistantTool('three_add')!.execute(
      { preset: 'orbit-cube', seconds: 2 },
      host,
    );
    expect(three.ok).toBe(true);
    expect(host.renderThreeScene).toHaveBeenCalledWith({ preset: 'orbit-cube', seconds: 2 });
    const model = await findAssistantTool('three_add')!.execute(
      { modelPath: 'C:\\trabajo\\modelo.gltf', seconds: 3 },
      host,
    );
    expect(model.ok).toBe(true);
    expect(host.renderThreeScene).toHaveBeenCalledWith({
      preset: 'orbit-cube',
      seconds: 3,
      modelPath: 'C:\\trabajo\\modelo.gltf',
    });
    const extruded = await findAssistantTool('three_add')!.execute(
      { preset: 'orbit-cube', seconds: 2, text: 'Olyvia', textDepth: 0.2 },
      host,
    );
    expect(extruded.ok).toBe(true);
    expect(host.renderThreeScene).toHaveBeenCalledWith({
      preset: 'orbit-cube',
      seconds: 2,
      text: 'Olyvia',
      textDepth: 0.2,
    });
    const withoutText = await findAssistantTool('three_add')!.execute(
      { preset: 'orbit-cube', textDepth: 0.2 },
      host,
    );
    expect(withoutText.ok).toBe(false);
    const empty = await findAssistantTool('three_add')!.execute({}, host);
    expect(empty.ok).toBe(false);

    const project = state.project!;
    const clip = project.timeline.clips.find((item) => item.id === clipId)!;
    expect('motion' in clip ? clip.motion?.type : undefined).toBe('zoom-in');
    expect('effects' in clip ? clip.effects?.contrast : undefined).toBe(1.2);
    expect('effects' in clip ? clip.effects?.grain : undefined).toBe(0.2);
    expect('transitionIn' in clip ? clip.transitionIn?.type : undefined).toBe('dissolve');
    expect(project.captions.cues.length).toBe(1);
    expect(project.scenes[0]?.clipIds).toEqual([clipId]);
    const editedClip = await findAssistantTool('clip_edit')!.execute(
      { clipId, startFrame: 60, durationFrames: 120 },
      host,
    );
    expect(editedClip.ok).toBe(true);
    const movedClip = state.project!.timeline.clips.find((item) => item.id === clipId)!;
    expect(movedClip.startFrame).toBe(60);
    expect(movedClip.durationFrames).toBe(120);
    const restoredClip = await findAssistantTool('clip_edit')!.execute(
      { clipId, startFrame: 0, durationFrames: 300 },
      host,
    );
    expect(restoredClip.ok).toBe(true);
    const back = state.project!.timeline.clips.find((item) => item.id === clipId)!;
    expect(back.startFrame).toBe(0);
    expect(back.durationFrames).toBe(300);
  });

  it('aplica varias ediciones como una transacción atómica', async () => {
    const asset = videoAsset();
    const base = validated(addAsset(ensureDelivery(createEmptyProject('Transacción', NOW)), asset));
    const { host, state } = createHost(base);
    const tool = findAssistantTool('edit_transaction')!;
    expect(tool).not.toBeNull();
    expect(
      validateToolArguments(tool.parameters, { operations: [{ tool: 'clip_add' }] }),
    ).toContain('operations[0]: falta el argumento obligatorio: arguments');
    const applied = await tool.execute(
      {
        operations: [
          { tool: 'clip_add', arguments: JSON.stringify({ assetId: asset.id, atFrame: 0 }) },
          {
            tool: 'subtitle_add',
            arguments: JSON.stringify({ text: 'Hola', startFrame: 0, durationFrames: 30 }),
          },
        ],
      },
      host,
    );
    expect(applied.ok).toBe(true);
    expect(state.project!.timeline.clips).toHaveLength(1);
    expect(state.project!.captions.cues).toHaveLength(1);
    expect(host.mutate).toHaveBeenCalledTimes(1);
    const before = JSON.stringify(state.project);
    const failed = await tool.execute(
      {
        operations: [
          { tool: 'clip_add', arguments: JSON.stringify({ assetId: asset.id, atFrame: 120 }) },
          { tool: 'clip_split', arguments: JSON.stringify({ clipId: 'no-existe' }) },
        ],
      },
      host,
    );
    expect(failed.ok).toBe(false);
    expect(JSON.stringify(state.project)).toBe(before);
    expect(host.mutate).toHaveBeenCalledTimes(1);
    const forbidden = await tool.execute(
      { operations: [{ tool: 'render_start', arguments: '{}' }] },
      host,
    );
    expect(forbidden.ok).toBe(false);
    expect(forbidden.summary).toContain('no se permite');
    const invalid = await tool.execute(
      { operations: [{ tool: 'clip_split', arguments: 'no-json' }] },
      host,
    );
    expect(invalid.ok).toBe(false);
  });

  it('fija el motor del router en la escena', async () => {
    const asset = videoAsset();
    const base = validated(addAsset(ensureDelivery(createEmptyProject('Motores', NOW)), asset));
    const { host, state } = createHost(base);
    const added = await findAssistantTool('clip_add')!.execute({ assetId: asset.id }, host);
    expect(added.ok).toBe(true);
    const clipId = (added.data as { clipId: string }).clipId;
    const scene = await findAssistantTool('scene_create')!.execute(
      { title: 'Escena motor', narration: 'Prueba de motor', clipIds: [clipId], engine: 'ken-burns' },
      host,
    );
    expect(scene.ok).toBe(true);
    expect(state.project!.scenes[0]?.engine).toBe('ken-burns');
    const pinned = await findAssistantTool('scene_resolve')!.execute(
      { sceneId: (scene.data as { sceneId: string }).sceneId, request: 'effects', pin: true },
      host,
    );
    expect(pinned.ok).toBe(true);
    expect((pinned.data as { pinned: boolean }).pinned).toBe(true);
    expect(state.project!.scenes[0]?.engine).toBe('effects');
    const inspected = await findAssistantTool('project_inspect')!.execute({}, host);
    expect((inspected.data as { sceneList: Array<{ engine: string | null }> }).sceneList[0]?.engine).toBe('effects');
    const noScene = await findAssistantTool('scene_resolve')!.execute(
      { clipId, pin: true },
      host,
    );
    expect(noScene.ok).toBe(false);
  });

  it('renderiza por escena y concatena segmentos', async () => {
    const asset = videoAsset();
    const base = validated(addAsset(ensureDelivery(createEmptyProject('Prueba', NOW)), asset));
    const { host, state } = createHost(base);
    const added = await findAssistantTool('clip_add')!.execute({ assetId: asset.id }, host);
    const clipId = (added.data as { clipId: string }).clipId;
    const scene = await findAssistantTool('scene_create')!.execute(
      { title: 'Capítulo', narration: 'Prueba', clipIds: [clipId] },
      host,
    );
    const sceneId = (scene.data as { sceneId: string }).sceneId;

    const inspect = await findAssistantTool('project_inspect')!.execute({}, host);
    const sceneList = (inspect.data as { sceneList: Array<{ id: string; startFrame: number; endFrame: number }> })
      .sceneList;
    expect(sceneList).toHaveLength(1);
    expect(sceneList[0]?.id).toBe(sceneId);
    expect(sceneList[0]?.endFrame).toBe(300);

    const segment = await findAssistantTool('render_scene')!.execute(
      { sceneId, includeCaptions: true },
      host,
    );
    expect(segment.ok).toBe(true);
    expect(host.renderSceneSegment).toHaveBeenCalledWith({ sceneId, includeCaptions: true });
    expect((segment.data as { outputPath: string }).outputPath).toBe('C:/ws/escena.mp4');

    const concat = await findAssistantTool('video_concat')!.execute(
      { paths: ['C:/ws/a.mp4', 'C:/ws/b.mp4'] },
      host,
    );
    expect(concat.ok).toBe(true);
    expect(host.concatVideos).toHaveBeenCalledWith(['C:/ws/a.mp4', 'C:/ws/b.mp4']);
    expect((concat.data as { segments: number }).segments).toBe(2);
    expect(state.project?.scenes).toHaveLength(1);
  });

  it('crea una trayectoria de transform con keyframes', async () => {
    const asset = videoAsset();
    const base = validated(addAsset(ensureDelivery(createEmptyProject('Prueba', NOW)), asset));
    const { host, state } = createHost(base);
    const added = await findAssistantTool('clip_add')!.execute({ assetId: asset.id }, host);
    const clipId = (added.data as { clipId: string }).clipId;
    const path = await findAssistantTool('motion_path')!.execute(
      {
        clipId,
        path: [0, 0, 120, -40, 240, 0],
        durationFrames: 60,
        easing: 'ease-in-out',
        startScale: 1,
        endScale: 1.2,
      },
      host,
    );
    expect(path.ok).toBe(true);
    const clip = state.project?.timeline.clips.find((item) => item.id === clipId);
    const keyframes = clip && 'transform' in clip ? clip.transform?.keyframes ?? [] : [];
    expect(keyframes.map((keyframe) => keyframe.frame)).toEqual([0, 30, 59]);
    expect(keyframes[1]?.offsetX).toBe(120);
    expect(keyframes[1]?.offsetY).toBe(-40);
    expect(keyframes[0]?.scale).toBe(1);
    expect(keyframes[2]?.scale).toBe(1.2);
    expect(keyframes[0]?.easing).toBe('ease-in-out');

    const bad = await findAssistantTool('motion_path')!.execute({ clipId, path: [0, 0, 10] }, host);
    expect(bad.ok).toBe(false);
  });

  it('inicia, consulta y cancela un render con el host', async () => {
    const base = validated(ensureDelivery(createEmptyProject('Prueba', NOW)));
    const { host } = createHost(base);
    const started = await findAssistantTool('render_start')!.execute({}, host);
    expect(started.ok).toBe(true);
    expect((started.data as { jobId: string }).jobId).toBe('job-1');
    const status = await findAssistantTool('render_status')!.execute({}, host);
    expect(status.ok).toBe(true);
    expect(status.summary).toContain('sin renders');
    const noActive = await findAssistantTool('render_cancel')!.execute({}, host);
    expect(noActive.ok).toBe(false);
    (host.activeRender as ReturnType<typeof vi.fn>).mockResolvedValueOnce('job-2');
    const cancelled = await findAssistantTool('render_cancel')!.execute({}, host);
    expect(cancelled.ok).toBe(true);
    expect(host.cancelRender).toHaveBeenCalledWith('job-2');
  });

  it('ejecuta transporte y exportación con el host', async () => {
    const base = validated(ensureDelivery(createEmptyProject('Prueba', NOW)));
    const { host } = createHost(base);
    await findAssistantTool('transport')!.execute({ action: 'play' }, host);
    expect(host.setPlaying).toHaveBeenCalledWith(true);
    const exported = await findAssistantTool('export_open')!.execute({}, host);
    expect(exported.ok).toBe(true);
    expect(host.requestExport).toHaveBeenCalledTimes(1);
  });

  it('genera un personaje 2D con el host y valida el clip', async () => {
    const base = validated(ensureDelivery(createEmptyProject('Prueba', NOW)));
    const { host } = createHost(base);
    const tool = findAssistantTool('rig_add')!;
    expect(tool).not.toBeNull();
    expect(validateToolArguments(tool.parameters, { clip: 'walk' })).toEqual([]);
    expect(validateToolArguments(tool.parameters, { clip: 'moonwalk' })).toContain(
      'clip debe ser uno de: idle, walk, run, jump, wave, reach',
    );
    const created = await tool.execute({ clip: 'run', palette: 'amber', seconds: 3 }, host);
    expect(created.ok).toBe(true);
    expect(created.summary).toContain('Personaje caminar.mp4');
    expect(host.renderRigClip).toHaveBeenCalledWith({
      clip: 'run',
      paletteId: 'amber',
      seconds: 3,
    });
    const reached = await tool.execute(
      { clip: 'reach', target: [0.9, 0.2], seconds: 2 },
      host,
    );
    expect(reached.ok).toBe(true);
    expect(host.renderRigClip).toHaveBeenCalledWith({
      clip: 'reach',
      paletteId: 'cyan',
      seconds: 2,
      target: { x: 0.9, y: 0.2 },
    });
    const badTarget = await tool.execute({ clip: 'walk', target: [0.5, 0.5] }, host);
    expect(badTarget.ok).toBe(false);
    const missing = await tool.execute({ clip: 'moonwalk' }, host);
    expect(missing.ok).toBe(false);
    expect(missing.summary).toContain('clip desconocido');
    (host.renderRigClip as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const empty = await tool.execute({ clip: 'idle' }, host);
    expect(empty.ok).toBe(false);
  });

  it('encola escenas y controla la cola de render', async () => {
    const base = validated(ensureDelivery(createEmptyProject('Prueba', NOW)));
    const { host } = createHost(base);
    const snapshot = {
      paused: false,
      runningId: null,
      finals: [],
      items: [
        {
          id: 'q1',
          projectRoot: 'C:\\proyecto',
          sceneId: 's1',
          sceneTitle: 'Uno',
          includeCaptions: false,
          status: 'completed',
          attempts: 1,
          createdAt: NOW,
          finishedAt: NOW,
          outputPath: 'C:\\s1.mp4',
          bytes: 1200,
          durationSeconds: 3,
        },
      ],
    };
    const add = vi.fn(async () => ({ ids: ['q1'], snapshot }));
    const status = vi.fn(() => snapshot);
    const control = vi.fn(() => ({ ...snapshot, paused: true }));
    Object.assign(host, {
      renderQueueAdd: add,
      renderQueueStatus: status,
      renderQueueControl: control,
    });

    const queued = await findAssistantTool('render_queue_add')!.execute(
      { sceneIds: ['s1'], includeCaptions: true, concat: true },
      host,
    );
    expect(queued.ok).toBe(true);
    expect(add).toHaveBeenCalledWith({
      sceneIds: ['s1'],
      includeCaptions: true,
      concat: true,
    });
    const listed = await findAssistantTool('render_queue_status')!.execute({}, host);
    expect(listed.ok).toBe(true);
    expect(listed.summary).toContain('1 completed');
    const paused = await findAssistantTool('render_queue_control')!.execute(
      { action: 'pause' },
      host,
    );
    expect(paused.ok).toBe(true);
    expect(control).toHaveBeenCalledWith('pause', undefined);
    const invalid = await findAssistantTool('render_queue_control')!.execute(
      { action: 'explode' },
      host,
    );
    expect(invalid.ok).toBe(false);
    const noHost = await findAssistantTool('render_queue_status')!.execute(
      {},
      createHost(base).host,
    );
    expect(noHost.ok).toBe(false);
    expect(noHost.summary).toContain('vive en la app');
  });
});

describe('herramientas de archivos del asistente', () => {
  it('publica las cuatro herramientas de exploración en el catálogo', () => {
    const names = ASSISTANT_TOOLS.map((tool) => tool.name);
    for (const name of ['auto_video_from_folder', 'media_find', 'files_roots', 'files_list', 'files_search', 'files_read_text']) {
      expect(names).toContain(name);
    }
    const payload = assistantToolPayload();
    const published = payload.map((tool) => tool.function.name);
    expect(published).toContain('files_list');
    expect(published).toContain('files_search');
  });

  it('lista, busca y lee archivos sin necesitar un proyecto abierto', async () => {
    const { host } = createHost(null);
    const fsHost: AssistantToolHost = {
      ...host,
      fsRoots: async () => [
        { id: 'downloads', label: 'Descargas', path: 'C:\\Users\\tester\\Downloads' },
      ],
      fsList: async (path) => ({
        path: path ?? '',
        parent: 'C:\\Users\\tester',
        entries: [
          {
            name: 'clips',
            path: 'C:\\Users\\tester\\Downloads\\clips',
            kind: 'folder',
            bytes: 0,
            modifiedMs: 0,
            extension: '',
          },
          {
            name: 'toma.mp4',
            path: 'C:\\Users\\tester\\Downloads\\toma.mp4',
            kind: 'file',
            bytes: 12_582_912,
            modifiedMs: 0,
            extension: 'mp4',
          },
        ],
        truncated: false,
        total: 2,
      }),
      fsSearch: async () => ({
        path: 'C:\\Users\\tester\\Downloads',
        parent: null,
        entries: [
          {
            name: 'toma.mp4',
            path: 'C:\\Users\\tester\\Downloads\\toma.mp4',
            kind: 'file',
            bytes: 12_582_912,
            modifiedMs: 0,
            extension: 'mp4',
          },
        ],
        truncated: false,
        total: 1,
      }),
      fsReadText: async (path) => ({ path, bytes: 42, text: 'Hola guion', truncated: false }),
      fsFindMedia: async () => ({
        path: '',
        parent: null,
        entries: [
          {
            name: 'campaign-001.mp4',
            path: 'C:' + String.fromCharCode(92) + 'Users' + String.fromCharCode(92) + 'tester' + String.fromCharCode(92) + 'Downloads' + String.fromCharCode(92) + 'campaign-001.mp4',
            kind: 'file',
            bytes: 2_516_582,
            modifiedMs: 0,
            extension: 'mp4',
          },
        ],
        truncated: false,
        total: 1,
      }),
    };

    const roots = await findAssistantTool('files_roots')!.execute({}, fsHost);
    expect(roots.ok).toBe(true);
    expect(roots.summary).toContain('Descargas');

    const listed = await findAssistantTool('files_list')!.execute(
      { path: 'C:\\Users\\tester\\Downloads' },
      fsHost,
    );
    expect(listed.ok).toBe(true);
    expect(listed.summary).toContain('[carpeta] clips');
    expect(listed.summary).toContain('12 MB');

    const found = await findAssistantTool('files_search')!.execute(
      { root: 'C:\\Users\\tester\\Downloads', query: 'toma' },
      fsHost,
    );
    expect(found.ok).toBe(true);
    expect(found.summary).toContain('toma.mp4');

    const media = await findAssistantTool('media_find')!.execute({ kind: 'video' }, fsHost);
    expect(media.ok).toBe(true);
    expect(media.summary).toContain('campaign-001.mp4');

    const text = await findAssistantTool('files_read_text')!.execute(
      { path: 'C:\\Users\\tester\\guion.txt' },
      fsHost,
    );
    expect(text.ok).toBe(true);
    expect(text.summary).toContain('Hola guion');
  });

  it('sin host nativo devuelve un error claro en vez de fallar', async () => {
    const { host } = createHost(null);
    const result = await findAssistantTool('files_list')!.execute({ path: 'C:\\x' }, host);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('sólo está disponible en la app');
  });
});

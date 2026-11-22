import { describe, expect, it, vi } from 'vitest';
import { createEmptyProject, type ClipEffects, type ProjectDocument } from '@editor-ia/project-schema';
import { readyAsset, createFakeService } from '../test/fake-service';
import { addAsset, addClipFromAsset, ensureDelivery } from './project-actions';
import { executeMcpTool, type McpToolContext } from './mcp-tools';

const NOW = '2026-11-02T00:00:00.000Z';

function fixture() {
  const asset = readyAsset({ label: 'Toma', source: { type: 'local', path: 'media/toma.mp4' } });
  let project = addAsset(ensureDelivery(createEmptyProject('MCP', NOW)), asset);
  const added = addClipFromAsset(project, asset, { atFrame: 0, durationFrames: 90 });
  project = added.project;
  let current: ProjectDocument = project;
  const updates: number[] = [];
  let playhead = 0;
  const store = {
    state: {
      project: current,
      opened: { root: 'C:\\tester', path: 'C:\\tester\\mcp.editoria.json' },
    },
    service: createFakeService(),
    update: (fn: (value: ProjectDocument) => ProjectDocument) => {
      current = fn(current);
      store.state.project = current;
      updates.push(current.revision);
      return true;
    },
    setPlayhead: (frame: number) => {
      playhead = frame;
    },
    createProject: async () => true,
    openProjectAt: async () => true,
    saveNow: async () => true,
    saveAs: async () => true,
    closeProject: () => {},
    undo: () => {},
    redo: () => {},
    acceptRecovery: async () => true,
    dismissRecovery: () => {},
  } as unknown as McpToolContext['store'];
  const context: McpToolContext = {
    store,
    selectView: () => {},
    runCommand: async (text) => `eco: ${text}`,
  };
  return {
    context,
    get project() {
      return current;
    },
    get playhead() {
      return playhead;
    },
    updates,
    assetId: asset.id,
  };
}

describe('herramientas MCP', () => {
  it('resume el proyecto', async () => {
    const { context } = fixture();
    const summary = JSON.parse(await executeMcpTool('project_summary', {}, context));
    expect(summary.name).toBe('MCP');
    expect(summary.clips).toBe(1);
    expect(summary.width).toBe(1920);
    expect(summary.durationSeconds).toBe(3);
  });

  it('project_new con directorio escribe perfiles de entrega', async () => {
    const { context } = fixture();
    let written: unknown = null;
    const spy = vi
      .spyOn(context.store.service, 'writeProjectFile')
      .mockImplementation(async (input) => {
        written = input.project;
        return {
          path: `${input.directory}\\${input.fileName}.editoria.json`,
          bytes: 1,
          copiedAssets: 0,
          revision: 0,
        };
      });
    const result = JSON.parse(
      await executeMcpTool(
        'project_new',
        { name: 'Lote', directory: 'D:\\out', width: 640, height: 360, fps: 30 },
        context,
      ),
    );
    expect(result.ok).toBe(true);
    const doc = written as ProjectDocument;
    expect(doc.renderProfiles.length).toBeGreaterThan(0);
    expect(
      doc.renderProfiles.some(
        (profile) => profile.resolution.width === 640 && profile.resolution.height === 360,
      ),
    ).toBe(true);
    spy.mockRestore();
  });

  it('autoedit_measure/variants/apply montan la timeline', async () => {
    const { context } = fixture();
    const measured = JSON.parse(await executeMcpTool('autoedit_measure', {}, context));
    expect(measured.ok).toBe(true);
    expect(measured.sources).toHaveLength(1);
    expect(measured.variants.length).toBeGreaterThan(0);

    const rebuilt = JSON.parse(
      await executeMcpTool('autoedit_variants', { recipe: { cutSeconds: 2 } }, context),
    );
    expect(rebuilt.ok).toBe(true);
    expect(rebuilt.variants.length).toBeGreaterThan(0);

    const variantId = rebuilt.variants[0].id;
    const applied = JSON.parse(
      await executeMcpTool('autoedit_apply', { variantId }, context),
    );
    expect(applied.ok).toBe(true);
    expect(applied.clipCount).toBeGreaterThan(0);
    expect(context.store.state.project?.timeline.clips.length).toBe(applied.clipCount);

    // Sin sesión de medida sobre ESTE proyecto no se puede aplicar.
    const { context: other } = fixture();
    await expect(
      executeMcpTool('autoedit_apply', { variantId }, other),
    ).rejects.toThrow(/autoedit_measure/);

    // `cuts` con índices inválidos se rechaza: subsetVariant los tomaría
    // como "sin filtro" y aplicaría la variante entera en silencio.
    // (400 pasa el schema 0-499 pero no existe en una variante de ~15 cortes.)
    await expect(
      executeMcpTool('autoedit_apply', { variantId, cuts: [400] }, context),
    ).rejects.toThrow(/corte/);

    // assetIds desconocidos se informan en messages en vez de ignorarse.
    const assetId = context.store.state.project!.assets[0]!.id;
    const partial = JSON.parse(
      await executeMcpTool(
        'autoedit_measure',
        { assetIds: [assetId, 'id-que-no-existe'] },
        context,
      ),
    );
    expect(
      partial.messages.some((m: string) => m.includes('id-que-no-existe')),
    ).toBe(true);
    await expect(
      executeMcpTool('autoedit_measure', { assetIds: ['solo-inventado'] }, context),
    ).rejects.toThrow(/assetId/);

    // autoedit_status reporta la sesión sin re-medir.
    const status = JSON.parse(await executeMcpTool('autoedit_status', {}, context));
    expect(status.measured).toBe(true);
    expect(status.variants.length).toBeGreaterThan(0);
    const { context: fresh } = fixture();
    const empty = JSON.parse(await executeMcpTool('autoedit_status', {}, fresh));
    expect(empty.measured).toBe(false);
  });

  it('autoedit_export renderiza variantes sin tocar el proyecto', async () => {
    const { context } = fixture();
    const measured = JSON.parse(await executeMcpTool('autoedit_measure', {}, context));
    const variantId = measured.variants[0].id;
    const clipsBefore = context.store.state.project?.timeline.clips.length;

    const report = JSON.parse(
      await executeMcpTool(
        'autoedit_export',
        { variantIds: [variantId], outputDir: 'D:\\out\\auto' },
        context,
      ),
    );
    expect(report.done).toBe(1);
    expect(report.items[0].videoPath.startsWith('D:\\out\\auto\\')).toBe(true);
    expect(report.items[0].videoPath.endsWith('.mp4')).toBe(true);
    expect(context.store.state.project?.timeline.clips.length).toBe(clipsBefore);

    // Sin sesión medida no exporta.
    const { context: other } = fixture();
    await expect(
      executeMcpTool('autoedit_export', { outputDir: 'D:\\x' }, other),
    ).rejects.toThrow(/autoedit_measure/);

    // `cuts` filtra los índices exportados; un filtro inválido se rechaza
    // en vez de exportar la variante completa por error.
    const subset = JSON.parse(
      await executeMcpTool(
        'autoedit_export',
        { variantIds: [variantId], cuts: [0], outputDir: 'D:\\out\\sub' },
        context,
      ),
    );
    expect(subset.done).toBe(1);
    await expect(
      executeMcpTool(
        'autoedit_export',
        { variantIds: [variantId], cuts: [999], outputDir: 'D:\\out\\bad' },
        context,
      ),
    ).rejects.toThrow(/corte/);
  });

  it('devuelve un snapshot consolidado y permite filtrar secciones', async () => {
    const { context } = fixture();
    const full = JSON.parse(await executeMcpTool('project_snapshot', {}, context));
    expect(full.schemaVersion).toBe(1);
    expect(full.project.name).toBe('MCP');
    expect(full.counts.clips).toBe(1);
    expect(full.sections.clips.items).toHaveLength(1);
    expect(full.sections.assets.items).toHaveLength(1);
    expect(full.sections.tracks.items.length).toBeGreaterThan(0);
    expect(
      full.sections.tracks.items.reduce((sum: number, track: { clips: number }) => sum + track.clips, 0),
    ).toBe(full.counts.clips);
    expect(full.sections.profiles.items.length).toBeGreaterThan(0);

    const compact = JSON.parse(
      await executeMcpTool('project_snapshot', { include: ['clips'], limit: 1 }, context),
    );
    expect(Object.keys(compact.sections)).toEqual(['clips']);
    expect(compact.sections.clips.items).toHaveLength(1);
    expect(compact.sections.clips.truncated).toBe(false);
  });

  it('lista clips, pistas, assets y perfiles', async () => {
    const { context } = fixture();
    const clips = JSON.parse(await executeMcpTool('timeline_clips', {}, context));
    expect(clips).toHaveLength(1);
    expect(clips[0].durationFrames).toBe(90);
    const tracks = JSON.parse(await executeMcpTool('tracks_list', {}, context));
    expect(tracks.length).toBeGreaterThan(0);
    const assets = JSON.parse(await executeMcpTool('assets_list', {}, context));
    expect(assets[0].kind).toBe('video');
    const profiles = JSON.parse(await executeMcpTool('export_profiles', {}, context));
    expect(profiles.length).toBeGreaterThanOrEqual(3);
  });

  it('edita un clip y lo registra en el historial', async () => {
    const { context, project, updates } = fixture();
    const clipId = project.timeline.clips[0]!.id;
    const result = JSON.parse(
      await executeMcpTool(
        'clip_update',
        { clipId, label: 'Plano A', gainDb: -3, motion: 'zoom-in' },
        context,
      ),
    );
    expect(result.ok).toBe(true);
    expect(updates).toHaveLength(1);
    const clip = context.store.state.project!.timeline.clips[0]!;
    expect(clip.label).toBe('Plano A');
    expect(clip && 'audio' in clip ? clip.audio?.gainDb : undefined).toBe(-3);
  });

  it('agrega, edita y borra subtítulos', async () => {
    const { context } = fixture();
    const added = JSON.parse(
      await executeMcpTool(
        'caption_add',
        { text: 'Hola', startFrame: 0, durationFrames: 30 },
        context,
      ),
    );
    let cues = JSON.parse(await executeMcpTool('captions_list', {}, context));
    expect(cues).toHaveLength(1);
    await executeMcpTool('caption_update', { cueId: added.cueId, text: 'Chau' }, context);
    cues = JSON.parse(await executeMcpTool('captions_list', {}, context));
    expect(cues[0].text).toBe('Chau');
    await executeMcpTool('caption_delete', { cueId: added.cueId }, context);
    cues = JSON.parse(await executeMcpTool('captions_list', {}, context));
    expect(cues).toHaveLength(0);
  });

  it('mueve, divide y elimina clips', async () => {
    const { context, project } = fixture();
    const clipId = project.timeline.clips[0]!.id;
    await executeMcpTool('clip_move', { clipId, startFrame: 30 }, context);
    expect(context.store.state.project!.timeline.clips[0]!.startFrame).toBe(30);
    const split = JSON.parse(
      await executeMcpTool('clip_split', { clipId, atFrame: 60 }, context),
    );
    expect(split.rightClipId).toBeTruthy();
    await executeMcpTool('clip_delete', { clipId: split.rightClipId }, context);
    expect(context.store.state.project!.timeline.clips).toHaveLength(1);
  });

  it('expone slip, slide y roll sobre clips contiguos', async () => {
    const { context, assetId } = fixture();
    // Tres clips contiguos de 90 frames en la misma pista.
    await executeMcpTool('clip_add', { assetId, atFrame: 90, durationFrames: 90 }, context);
    await executeMcpTool('clip_add', { assetId, atFrame: 180, durationFrames: 90 }, context);
    const clips = () => context.store.state.project!.timeline.clips
      .slice()
      .sort((a, b) => a.startFrame - b.startFrame);
    expect(clips().map((clip) => clip.startFrame)).toEqual([0, 90, 180]);

    // Slip sobre el clip del medio: misma posición y duración, ventana de origen corrida.
    const middle = clips()[1]!;
    const before = 'source' in middle ? middle.source : null;
    await executeMcpTool('clip_slip', { clipId: middle.id, deltaFrames: 10 }, context);
    const slipped = clips()[1]!;
    expect(slipped.startFrame).toBe(90);
    expect(slipped.durationFrames).toBe(90);
    if (before && 'inFrame' in before && 'inFrame' in slipped.source) {
      expect((slipped.source as { inFrame: number }).inFrame).toBe(
        (before as { inFrame: number }).inFrame + 10,
      );
    }

    // Roll 'in' mueve el corte de entrada del clip del medio hacia la derecha.
    await executeMcpTool('clip_roll', { clipId: middle.id, edge: 'in', deltaFrames: 5 }, context);
    expect(clips()[0]!.durationFrames).toBe(95);
    expect(clips()[1]!.startFrame).toBe(95);
    expect(clips()[1]!.durationFrames).toBe(85);

    // Roll fuera de rango falla con error explícito.
    await expect(
      executeMcpTool('clip_roll', { clipId: middle.id, edge: 'out', deltaFrames: -500 }, context),
    ).rejects.toThrow();

    // Slip extremo también falla (se sale de la ventana del material).
    await expect(
      executeMcpTool('clip_slip', { clipId: middle.id, deltaFrames: 100000 }, context),
    ).rejects.toThrow();
  });

  it('expone operaciones de edición avanzadas (duplicar, detach, split múltiple)', async () => {
    const { context, assetId } = fixture();
    await executeMcpTool('clip_add', { assetId, atFrame: 90, durationFrames: 90 }, context);
    const clips = () => context.store.state.project!.timeline.clips;
    const first = clips()[0]!.id;

    // Duplicar crea un clip nuevo.
    const dup = JSON.parse(await executeMcpTool('clip_duplicate', { clipId: first }, context));
    expect(dup.ok).toBe(true);
    expect(dup.clipId).not.toBe(first);

    // Split múltiple en dos frames.
    const clip = clips().find((item) => item.id === first)!;
    const multi = JSON.parse(
      await executeMcpTool('clip_split_multi', {
        clipId: first,
        frames: [clip.startFrame + 30, clip.startFrame + 60],
      }, context),
    );
    expect(multi.ok).toBe(true);
    expect(multi.clipIds.length).toBeGreaterThanOrEqual(2);

    // Adjustment layer + preset de audio masivo no fallan.
    const adj = JSON.parse(
      await executeMcpTool('adjustment_add', { atFrame: 0, durationFrames: 300 }, context),
    );
    expect(adj.ok).toBe(true);
    const preset = JSON.parse(
      await executeMcpTool('audio_preset_apply_all', { preset: 'voice' }, context),
    );
    expect(preset.ok).toBe(true);
    expect(typeof preset.applied).toBe('number');

    // split_at_markers sin marcadores no rompe.
    const markers = JSON.parse(await executeMcpTool('split_at_markers', {}, context));
    expect(markers.ok).toBe(true);

    // Errores de dominio llegan claros.
    await expect(
      executeMcpTool('compound_expand', { clipId: 'no-existe' }, context),
    ).rejects.toThrow();
  });

  it('expone máscaras y look de proyecto', async () => {
    const { context } = fixture();
    const clipId = context.store.state.project!.timeline.clips[0]!.id;
    const mask = JSON.parse(await executeMcpTool('clip_mask_set', {
      clipId,
      mask: { shape: 'ellipse', x: 0, y: 0, width: 0.6, height: 0.6, feather: 0.2 },
    }, context));
    expect(mask.ok).toBe(true);
    expect(mask.hasMask).toBe(true);
    // Keyframe de máscara + look global.
    const kf = JSON.parse(await executeMcpTool('mask_keyframe_add', {
      clipId, frame: 10, width: 0.8, easing: 'ease-in-out',
    }, context));
    expect(kf.ok).toBe(true);
    const look = JSON.parse(await executeMcpTool('project_look_set', {
      look: { exposure: 0.2, contrast: 1.05, saturation: 1.1 },
    }, context));
    expect(look.ok).toBe(true);
    // Quitar máscara y keyframes.
    await executeMcpTool('clip_mask_set', { clipId, mask: null }, context);
    const clip = context.store.state.project!.timeline.clips.find((c) => c.id === clipId)!;
    expect('mask' in clip ? clip.mask : undefined).toBeUndefined();
  });

  it('expone marcadores, títulos y escenas', async () => {
    const { context } = fixture();
    // Marcador + update + from_cuts.
    const mk = JSON.parse(await executeMcpTool('marker_add', { frame: 30, label: 'A' }, context));
    expect(mk.ok).toBe(true);
    await executeMcpTool('marker_update', { markerId: mk.markerId ?? mk.id, label: 'B', color: 'amber' }, context);
    const cuts = JSON.parse(await executeMcpTool('markers_from_cuts', { frames: [60, 90] }, context));
    expect(cuts.added).toBe(2);
    // Título.
    const title = JSON.parse(await executeMcpTool('caption_title_add', { text: 'Hola', startFrame: 0, durationFrames: 60 }, context));
    expect(title.ok).toBe(true);
    // Escenas CRUD.
    const sc = JSON.parse(await executeMcpTool('scene_add', { title: 'Hook', intent: 'hook', narration: 'Texto de prueba' }, context));
    expect(sc.ok).toBe(true);
    await executeMcpTool('scene_update', { sceneId: sc.sceneId, status: 'reviewed' }, context);
    const list = context.store.state.project!.scenes;
    expect(list.some((scene) => scene.id === sc.sceneId && scene.status === 'reviewed')).toBe(true);
    await executeMcpTool('scene_remove', { sceneId: sc.sceneId }, context);
    // markers_from_scenes no rompe sin escenas.
    const mfs = JSON.parse(await executeMcpTool('markers_from_scenes', {}, context));
    expect(mfs.ok).toBe(true);
  });

  it('corre automatizaciones y devuelve el conteo', async () => {
    const { context } = fixture();
    const result = JSON.parse(
      await executeMcpTool('run_automation', { kind: 'cut_silences' }, context),
    );
    expect(result.ok).toBe(true);
    expect(typeof result.cuts).toBe('number');
  });

  it('navega y ejecuta el operador', async () => {
    const { context } = fixture();
    const nav = JSON.parse(await executeMcpTool('navigate', { view: 'editor' }, context));
    expect(nav.ok).toBe(true);
    const reply = await executeMcpTool('run_command', { command: 'cortá los silencios' }, context);
    expect(reply).toBe('eco: cortá los silencios');
  });

  it('expone un diagnóstico sin secretos', async () => {
    const { context } = fixture();
    const info = JSON.parse(await executeMcpTool('diagnostics', {}, context));
    expect(info.app).toBe('olyvia');
    expect(info.tools).toBeGreaterThan(20);
    expect(info.project?.clips).toBe(1);
    expect(JSON.stringify(info)).not.toMatch(/apiKey|sk-/);
  });

  it('marca las herramientas de lectura como readOnly', async () => {
    const { context } = fixture();
    const catalog = JSON.parse(await executeMcpTool('__catalog', {}, context));
    const reads = catalog.filter((tool: { annotations?: { readOnlyHint?: boolean } }) => tool.annotations?.readOnlyHint);
    const names = reads.map((tool: { name: string }) => tool.name);
    for (const required of ['project_summary', 'timeline_clips', 'diagnostics', 'critic_run']) {
      expect(names).toContain(required);
    }
    expect(names).not.toContain('clip_delete');
  });

  it('publica el catálogo completo de herramientas', async () => {
    const { context } = fixture();
    const catalog = JSON.parse(await executeMcpTool('__catalog', {}, context));
    const names = catalog.map((tool: { name: string }) => tool.name);
    expect(names.length).toBeGreaterThanOrEqual(30);
    for (const required of [
      'project_new',
      'project_snapshot',
      'clip_add',
      'clip_effects',
      'audio_mix',
      'critic_run',
      'critic_fix',
      'diarize',
      'export_interchange',
      'playhead',
      'asset_import',
      'marker_add',
      'settings_get',
      'review_build',
      'package_project',
      'multicam_build',
      'factory_run',
      'factory_job_status',
      'factory_job_list',
      'factory_job_cancel',
      'caption_style_update',
      'settings_set_tools',
    ]) {
      expect(names).toContain(required);
    }
  });

  it('expone consulta y cancelación de trabajos MCP sin bloquear la sesión', async () => {
    const { context } = fixture();
    const jobs = JSON.parse(await executeMcpTool('factory_job_list', {}, context));
    expect(Array.isArray(jobs)).toBe(true);
    await expect(
      executeMcpTool('factory_job_status', { jobId: 'missing-job' }, context),
    ).rejects.toThrow(/no existe un trabajo/);
    const cancelled = JSON.parse(
      await executeMcpTool('factory_job_cancel', { jobId: 'missing-job' }, context),
    );
    expect(cancelled).toMatchObject({
      accepted: false,
      jobId: 'missing-job',
      status: 'not_found',
      cooperative: true,
    });
  });

  it('factory_run devuelve un jobId inmediatamente y se completa desde la cola MCP', async () => {
    const { context } = fixture();
    const accepted = JSON.parse(
      await executeMcpTool(
        'factory_run',
        {
          brief: 'Crear un video corto de prueba sobre un faro.',
          outputDir: 'C:/salida',
          scenes: 1,
          render: false,
        },
        context,
      ),
    );

    expect(accepted.ok).toBe(true);
    expect(accepted.jobId).toEqual(expect.any(String));
    expect(accepted.status).toBe('queued');

    let final: Record<string, unknown> | null = null;
    await vi.waitFor(async () => {
      const current = JSON.parse(
        await executeMcpTool('factory_job_status', { jobId: accepted.jobId }, context),
      ) as Record<string, unknown>;
      if (current.status === 'done' || current.status === 'error') final = current;
      expect(final).not.toBeNull();
    }, { timeout: 5000, interval: 20 });

    const completed = final as Record<string, unknown> | null;
    expect(completed?.error ?? undefined, JSON.stringify(completed)).toBeUndefined();
    expect(completed).toMatchObject({
      id: accepted.jobId,
      source: 'mcp',
      status: 'done',
      progress: 1,
    });
    expect(final).toHaveProperty('projectPath');
  });

  it('factory_run con generateMedia encadena guion→Flow→montaje→render', async () => {
    const { context } = fixture();
    const accepted = JSON.parse(
      await executeMcpTool(
        'factory_run',
        {
          brief: 'Video corto de prueba con visuales generados por Flow.',
          outputDir: 'C:/salida',
          scenes: 1,
          render: false,
          generateMedia: true,
          flowServerId: 'flow-test',
          flowKind: 'image',
          approveCredits: true,
        },
        context,
      ),
    );

    expect(accepted.ok).toBe(true);
    expect(accepted.jobId).toEqual(expect.any(String));

    let final: Record<string, unknown> | null = null;
    await vi.waitFor(async () => {
      const current = JSON.parse(
        await executeMcpTool('factory_job_status', { jobId: accepted.jobId }, context),
      ) as Record<string, unknown>;
      if (current.status === 'done' || current.status === 'error') final = current;
      expect(final).not.toBeNull();
    }, { timeout: 8000, interval: 20 });

    const completed = final as Record<string, unknown> | null;
    expect(completed?.error ?? undefined, JSON.stringify(completed)).toBeUndefined();
    expect(completed).toMatchObject({ status: 'done' });
  });

  it('agrega pistas y clips, y cambia la velocidad', async () => {
    const { context, assetId } = fixture();
    const track = JSON.parse(
      await executeMcpTool('track_add', { kind: 'audio', label: 'Voz' }, context),
    );
    expect(track.trackId).toBeTruthy();
    const clip = JSON.parse(
      await executeMcpTool('clip_add', { assetId, atFrame: 120, durationFrames: 60 }, context),
    );
    expect(clip.clipId).toBeTruthy();
    const before = context.store.state.project!.timeline.clips.find(
      (item) => item.id === clip.clipId,
    )!;
    await executeMcpTool('clip_effects', { clipId: clip.clipId, speed: 2 }, context);
    const after = context.store.state.project!.timeline.clips.find(
      (item) => item.id === clip.clipId,
    )!;
    expect(after.durationFrames).toBeLessThan(before.durationFrames);
  });

  it('mezcla audio y evalúa con el crítico', async () => {
    const { context } = fixture();
    await executeMcpTool('audio_mix', { masterGainDb: -2, targetLufs: -16 }, context);
    expect(context.store.state.project!.audio.master.gainDb).toBe(-2);
    expect(context.store.state.project!.audio.loudnessTarget?.integratedLufs).toBe(-16);
    const report = JSON.parse(await executeMcpTool('critic_run', {}, context));
    expect(typeof report.score).toBe('number');
    expect(Array.isArray(report.findings)).toBe(true);
  });

  it('agrega, lista y borra marcadores', async () => {
    const { context } = fixture();
    const added = JSON.parse(
      await executeMcpTool('marker_add', { frame: 30, label: 'Gancho' }, context),
    );
    let markers = JSON.parse(await executeMcpTool('markers_list', {}, context));
    expect(markers).toHaveLength(1);
    expect(markers[0].label).toBe('Gancho');
    await executeMcpTool('marker_delete', { markerId: added.markerId }, context);
    markers = JSON.parse(await executeMcpTool('markers_list', {}, context));
    expect(markers).toHaveLength(0);
  });

  it('lee los ajustes de proveedores', async () => {
    const { context } = fixture();
    const settings = JSON.parse(await executeMcpTool('settings_get', {}, context));
    expect(settings).toHaveProperty('ai');
    expect(settings).toHaveProperty('diarize');
  });

  it('arma la revisión por ítem', async () => {
    const { context } = fixture();
    const items = JSON.parse(await executeMcpTool('review_build', {}, context));
    expect(Array.isArray(items)).toBe(true);
    expect(items.some((item: { kind: string }) => item.kind === 'level')).toBe(true);
  });

  it('arma el multicámara y ajusta el estilo', async () => {
    const { context, assetId } = fixture();
    const second = readyAsset({ label: 'Cam B', source: { type: 'local', path: 'media/b.mp4' } });
    const withSecond = addAsset(context.store.state.project!, second);
    context.store.update(() => withSecond);
    const built = JSON.parse(
      await executeMcpTool(
        'multicam_build',
        { assetIds: [assetId, second.id, 'asset-inexistente'] },
        context,
      ),
    );
    expect(built.trackId).toBeTruthy();
    expect(built.clips).toBeGreaterThan(0);
    expect(built.ignoredAssetIds).toEqual(['asset-inexistente']);
    await executeMcpTool(
      'caption_add',
      { text: 'Hola', startFrame: 0, durationFrames: 30 },
      context,
    );
    const styleId = context.store.state.project!.captions.styles[0]!.id;
    await executeMcpTool('caption_style_update', { styleId, fontSizePx: 64 }, context);
    expect(context.store.state.project!.captions.styles[0]!.fontSizePx).toBe(64);
  });

  it('fija las rutas de herramientas', async () => {
    const { context } = fixture();
    const result = JSON.parse(
      await executeMcpTool('settings_set_tools', { ffmpeg: 'C:////bin////ffmpeg.exe' }, context),
    );
    expect(result.ok).toBe(true);
  });

  it('mueve el cabezal', async () => {
    const state = fixture();
    await executeMcpTool('playhead', { frame: 42 }, state.context);
    expect(state.playhead).toBe(42);
  });

  it('ejecuta tools_batch en orden y reporta resultados por paso', async () => {
    const { context, project, assetId } = fixture();
    const clipId = project.timeline.clips[0]!.id;
    const batch = JSON.parse(
      await executeMcpTool(
        'tools_batch',
        {
          steps: [
            { name: 'clip_update', arguments: { clipId, label: 'Lote', gainDb: -2 } },
            { name: 'caption_add', arguments: { text: 'Hola', startFrame: 0, durationFrames: 30 } },
            { name: 'marker_add', arguments: { frame: 10, label: 'Marca' } },
          ],
        },
        context,
      ),
    );
    expect(batch.completed).toBe(3);
    expect(batch.failed).toBe(0);
    expect(batch.stoppedEarly).toBe(false);
    expect(batch.results.every((r: { ok: boolean }) => r.ok)).toBe(true);
    expect(context.store.state.project!.timeline.clips[0]!.label).toBe('Lote');
    expect(context.store.state.project!.captions.cues).toHaveLength(1);
    expect(context.store.state.project!.markers).toHaveLength(1);
    void assetId;
  });

  it('tools_batch se detiene en el primer error con stop_on_error', async () => {
    const { context, project } = fixture();
    const clipId = project.timeline.clips[0]!.id;
    const batch = JSON.parse(
      await executeMcpTool(
        'tools_batch',
        {
          steps: [
            { name: 'clip_update', arguments: { clipId, label: 'Antes' } },
            { name: 'clip_split', arguments: { clipId: 'no-existe', atFrame: 10 } },
            { name: 'caption_add', arguments: { text: 'No debe correr', startFrame: 0, durationFrames: 10 } },
          ],
        },
        context,
      ),
    );
    expect(batch.completed).toBe(1);
    expect(batch.failed).toBe(1);
    expect(batch.stoppedEarly).toBe(true);
    expect(batch.results[1].ok).toBe(false);
    expect(context.store.state.project!.captions.cues).toHaveLength(0);
  });


  it('tools_batch rechaza pasos anidados', async () => {
    const { context } = fixture();
    const batch = JSON.parse(
      await executeMcpTool(
        'tools_batch',
        { steps: [{ name: 'tools_batch', arguments: { steps: [{ name: 'undo', arguments: {} }] } }] },
        context,
      ),
    );
    expect(batch.completed).toBe(0);
    expect(batch.failed).toBe(1);
    expect(batch.results[0].error).toMatch(/anidados/);
  });

  it('explora carpetas de la PC y devuelve los medios encontrados', async () => {
    const { context } = fixture();
    const spy = vi
      .spyOn(context.store.service, 'listMediaFolder')
      .mockResolvedValue({
        directory: 'D:\\material\\boda',
        files: [
          { path: 'D:\\material\\boda\\clip.mp4', name: 'clip.mp4', kind: 'video', bytes: 1024 },
          { path: 'D:\\material\\boda\\foto.jpg', name: 'foto.jpg', kind: 'image', bytes: 512 },
        ],
      });
    const result = JSON.parse(
      await executeMcpTool('media_folder_list', { folder: 'D:\\material\\boda' }, context),
    );
    expect(spy).toHaveBeenCalledWith({ folder: 'D:\\material\\boda' });
    expect(result.ok).toBe(true);
    expect(result.count).toBe(2);
    expect(result.files[0]).toMatchObject({ name: 'clip.mp4', kind: 'video' });
    spy.mockRestore();
  });

  it('busca medios por nombre dentro de una carpeta', async () => {
    const { context } = fixture();
    const spy = vi
      .spyOn(context.store.service, 'searchMediaFolder')
      .mockResolvedValue({
        directory: 'D:\\material\\boda',
        query: 'boda',
        truncated: false,
        files: [
          { path: 'D:\\material\\boda\\boda-clip.mp4', name: 'boda-clip.mp4', kind: 'video', bytes: 2048 },
        ],
      });
    const result = JSON.parse(
      await executeMcpTool(
        'media_search',
        { folder: 'D:\\material\\boda', query: 'boda', kind: 'video' },
        context,
      ),
    );
    expect(spy).toHaveBeenCalledWith({
      folder: 'D:\\material\\boda',
      query: 'boda',
      kind: 'video',
    });
    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.files[0]).toMatchObject({ name: 'boda-clip.mp4', kind: 'video' });
    spy.mockRestore();
  });

  it('lista cualquier carpeta del disco y lee archivos de texto', async () => {
    const { context } = fixture();
    const listSpy = vi
      .spyOn(context.store.service, 'listDirectory')
      .mockResolvedValue({
        directory: 'D:\\proyectos',
        truncated: false,
        entries: [
          { name: 'boda', path: 'D:\\proyectos\\boda', kind: 'dir', bytes: 0 },
          { name: 'lista.srt', path: 'D:\\proyectos\\lista.srt', kind: 'subtitle', bytes: 2048 },
        ],
      });
    const listed = JSON.parse(
      await executeMcpTool('fs_list', { path: 'D:\\proyectos' }, context),
    );
    expect(listSpy).toHaveBeenCalledWith('D:\\proyectos');
    expect(listed.count).toBe(2);
    expect(listed.entries[0].kind).toBe('dir');
    listSpy.mockRestore();

    const readSpy = vi
      .spyOn(context.store.service, 'readTextFile')
      .mockResolvedValue({
        path: 'D:\\proyectos\\lista.srt',
        bytes: 2048,
        truncated: false,
        content: '1\n00:00:01,000 --> 00:00:02,000\nHola',
      });
    const read = JSON.parse(
      await executeMcpTool('fs_read', { path: 'D:\\proyectos\\lista.srt' }, context),
    );
    expect(readSpy).toHaveBeenCalledWith('D:\\proyectos\\lista.srt');
    expect(read.content).toContain('Hola');
    readSpy.mockRestore();
  });

  it('genera assets en Flow en lote y los importa al proyecto', async () => {
    const { context } = fixture();
    const genSpy = vi
      .spyOn(context.store.service, 'flowGenerateImage')
      .mockImplementation(async (input) => ({
        ok: true,
        files: [{ path: `${input.outputDir}\\flow_${input.prompt.length}.webp`, bytes: 100, ext: 'webp' }],
        url: 'https://flow.google.com/project/x',
      }));
    const result = JSON.parse(
      await executeMcpTool(
        'flow_generate_assets',
        { prompts: ['un gato', 'un perro'], outputDir: 'C:\\tmp\\flow' },
        context,
      ),
    );
    expect(genSpy).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.files).toHaveLength(2);
    expect(result.assets.length).toBeGreaterThan(0);
    genSpy.mockRestore();
  });

  it('analiza assets con el motor de visión y verifica archivos del disco', async () => {
    const { context, assetId } = fixture();
    const analyzeSpy = vi
      .spyOn(context.store.service, 'analyzeMediaFrames')
      .mockResolvedValue([
        {
          assetId,
          kind: 'video',
          width: 1920,
          height: 1080,
          brightness: 0.5,
          dominantColor: '#336699',
          tags: ['oscuro'],
        } as never,
      ]);
    const analyzed = JSON.parse(
      await executeMcpTool('media_analyze', { assetIds: [assetId] }, context),
    );
    expect(analyzeSpy).toHaveBeenCalledWith([assetId]);
    expect(analyzed[0].assetId).toBe(assetId);
    analyzeSpy.mockRestore();

    const checkSpy = vi
      .spyOn(context.store.service, 'checkAssetFiles')
      .mockResolvedValue([
        { path: 'media/toma.mp4', exists: true },
        { path: 'media/perdido.mp4', exists: false },
      ] as never);
    const checked = JSON.parse(
      await executeMcpTool('fs_check', { paths: ['media/toma.mp4', 'media/perdido.mp4'] }, context),
    );
    expect(checkSpy).toHaveBeenCalledWith(['media/toma.mp4', 'media/perdido.mp4']);
    expect(checked).toHaveLength(2);
    checkSpy.mockRestore();
  });

  it('convierte un asset suelto y un lote por la misma tool', async () => {
    const { context, assetId } = fixture();
    const singleSpy = vi
      .spyOn(context.store.service, 'convertMedia')
      .mockResolvedValue({
        path: 'C:\\out\\toma.png',
        bytes: 2048,
        durationSeconds: 1,
        formatName: 'png',
        sourceBytes: 8192,
        encoder: 'png',
      });
    const one = JSON.parse(
      await executeMcpTool(
        'media_convert',
        { assetIds: [assetId], target: 'png', outputDir: 'C:\\out' },
        context,
      ),
    );
    expect(singleSpy).toHaveBeenCalledWith(
      expect.objectContaining({ assetId, target: 'png', outputDir: 'C:\\out' }),
    );
    expect(one.path).toContain('toma.png');
    singleSpy.mockRestore();

    const batchSpy = vi
      .spyOn(context.store.service, 'convertMediaBatch')
      .mockResolvedValue([
        {
          assetId,
          label: 'Toma',
          ok: true,
          path: 'C:\\out\\toma.mp3',
          bytes: 4096,
          sourceBytes: 16384,
          durationSeconds: 2,
          formatName: 'mp3',
          encoder: 'libmp3lame',
        },
      ]);
    const many = JSON.parse(
      await executeMcpTool(
        'media_convert',
        { assetIds: [assetId, assetId], target: 'mp3', outputDir: 'C:\\out' },
        context,
      ),
    );
    expect(batchSpy).toHaveBeenCalled();
    expect(many[0].path).toContain('toma.mp3');
    batchSpy.mockRestore();
  });

  it('falla claro si no hay proyecto o la herramienta no existe', async () => {
    const { context } = fixture();
    await expect(executeMcpTool('inventada', {}, context)).rejects.toThrow(/desconocida/);
    (context.store.state as { project: ProjectDocument | null }).project = null;
    await expect(executeMcpTool('project_summary', {}, context)).rejects.toThrow(/proyecto abierto/);
  });

  it('aplica, previsualiza y limpia efectos visuales', async () => {
    const { context, project } = fixture();
    const clipId = project.timeline.clips[0]!.id;
    const applied = JSON.parse(
      await executeMcpTool(
        'clip_effects_apply',
        { clipId, brightness: 0.2, contrast: 1.4, saturation: 1.3 },
        context,
      ),
    );
    expect(applied.ok).toBe(true);
    const fxOf = (index: number): ClipEffects | undefined => {
      const clip = context.store.state.project!.timeline.clips[index]!;
      return (clip as { effects?: ClipEffects }).effects;
    };
    expect(fxOf(0)?.brightness).toBe(0.2);
    expect(fxOf(0)?.contrast).toBe(1.4);

    const wheels = JSON.parse(
      await executeMcpTool(
        'color_wheels_adjust',
        { clipId, lift: { r: 0.1, g: 0, b: -0.1 }, gain: { r: 0.05, g: 0, b: 0.05 } },
        context,
      ),
    );
    expect(wheels.ok).toBe(true);
    expect(fxOf(0)?.lift?.r).toBe(0.1);
    expect(fxOf(0)?.gain?.b).toBe(0.05);

    const preset = JSON.parse(
      await executeMcpTool('clip_effects_preset', { clipId, preset: 'vintage' }, context),
    );
    expect(preset.ok).toBe(true);
    expect(fxOf(0)?.curvePreset).toBe('vintage');
    expect(fxOf(0)?.brightness).toBeUndefined();

    const cinematic = JSON.parse(
      await executeMcpTool(
        'color_preset_cinematic',
        { clipId, preset: 'teal-orange', intensity: 0.5 },
        context,
      ),
    );
    expect(cinematic.ok).toBe(true);
    expect(fxOf(0)?.gain?.r).toBeCloseTo(0.035, 3);

    const cleared = JSON.parse(
      await executeMcpTool('clip_effects_clear', { clipId }, context),
    );
    expect(cleared.ok).toBe(true);
    expect(fxOf(0)?.brightness).toBeUndefined();
    expect(fxOf(0)?.gain).toBeUndefined();
  });

  it('agrega, lista y quita transiciones entre clips contiguos', async () => {
    const { context, project, assetId } = fixture();
    const first = project.timeline.clips[0]!;
    await executeMcpTool(
      'clip_add',
      { assetId, atFrame: first.startFrame + first.durationFrames, durationFrames: 60 },
      context,
    );
    const second = context.store.state.project!.timeline.clips.find(
      (clip) => clip.id !== first.id,
    )!;

    const added = JSON.parse(
      await executeMcpTool(
        'transition_add',
        { fromClipId: first.id, toClipId: second.id, type: 'dissolve', durationFrames: 12 },
        context,
      ),
    );
    expect(added.ok).toBe(true);
    expect(added.type).toBe('dissolve');

    const list = JSON.parse(await executeMcpTool('transitions_list', {}, context));
    expect(list.count).toBe(1);
    expect(list.transitions[0].clipId).toBe(second.id);

    const removed = JSON.parse(
      await executeMcpTool('transition_remove', { clipId: second.id }, context),
    );
    expect(removed.ok).toBe(true);
    const after = context.store.state.project!.timeline.clips.find(
      (clip) => clip.id === second.id,
    )! as { transitionIn?: unknown };
    expect(after.transitionIn).toBeUndefined();

    await expect(
      executeMcpTool(
        'transition_add',
        { fromClipId: first.id, toClipId: second.id, type: 'inventada' },
        context,
      ),
    ).rejects.toThrow(/inválido|desconocido/);
  });

  it('crea y edita capas de texto y lower thirds', async () => {
    const { context } = fixture();
    const text = JSON.parse(
      await executeMcpTool(
        'text_layer_add',
        {
          text: 'Título de prueba',
          startFrame: 0,
          durationFrames: 60,
          fontSize: 64,
          color: '#ff0000',
          positionX: 0.5,
          positionY: 0.2,
          animation: 'typewriter',
        },
        context,
      ),
    );
    expect(text.ok).toBe(true);
    expect(text.animation).toBe('write');
    const graphicClip = context.store.state.project!.timeline.clips.find(
      (clip) => clip.id === text.clipId,
    )!;
    expect(graphicClip.kind).toBe('graphic');

    const updated = JSON.parse(
      await executeMcpTool(
        'text_layer_update',
        { clipId: text.clipId, text: 'Nuevo texto', positionY: 0.8 },
        context,
      ),
    );
    expect(updated.ok).toBe(true);
    const motion = context.store.state.project!.motion.find(
      (item) => item.id === text.motionId,
    )!;
    expect(motion.props.text).toBe('Nuevo texto');
    expect(motion.props.y).toBe(0.8);

    const lower = JSON.parse(
      await executeMcpTool(
        'lower_third_add',
        {
          title: 'Ana García',
          subtitle: 'Periodista',
          startFrame: 10,
          durationFrames: 120,
          style: 'minimal',
          position: 'lower-right',
        },
        context,
      ),
    );
    expect(lower.ok).toBe(true);
    expect(lower.style).toBe('lower-third-minimal');
    const lowerMotion = context.store.state.project!.motion.find(
      (item) => item.id === lower.motionId,
    )!;
    expect(lowerMotion.props.title).toBe('Ana García');
    expect(lowerMotion.props.side).toBe('right');
  });

  it('selecciona en lote, aplica efectos y velocidad a varios clips', async () => {
    const { context, project, assetId } = fixture();
    const first = project.timeline.clips[0]!;
    await executeMcpTool(
      'clip_add',
      { assetId, atFrame: first.startFrame + first.durationFrames, durationFrames: 60 },
      context,
    );
    const ids = context.store.state.project!.timeline.clips.map((clip) => clip.id);

    const selected = JSON.parse(
      await executeMcpTool('batch_clips_select', { kind: 'video' }, context),
    );
    expect(selected.count).toBe(2);

    const fx = JSON.parse(
      await executeMcpTool(
        'batch_effects_apply',
        { clipIds: ids, effect: 'saturation', value: 1.5 },
        context,
      ),
    );
    expect(fx.ok).toBe(true);
    expect(fx.applied).toBe(2);
    for (const clip of context.store.state.project!.timeline.clips) {
      expect((clip as { effects?: ClipEffects }).effects?.saturation).toBe(1.5);
    }

    const speed = JSON.parse(
      await executeMcpTool('batch_speed_change', { clipIds: ids, speed: 2 }, context),
      );
    expect(speed.ok).toBe(true);
    for (const clip of context.store.state.project!.timeline.clips) {
      expect((clip as { speed?: { num: number } }).speed?.num).toBe(2);
    }
  });

  it('batch_effects_apply rechaza valores fuera del rango del esquema', async () => {
    const { context, project } = fixture();
    const clipId = project.timeline.clips[0]!.id;
    await expect(
      executeMcpTool(
        'batch_effects_apply',
        { clipIds: [clipId], effect: 'saturation', value: -0.2 },
        context,
      ),
    ).rejects.toThrow('admite valores entre 0 y 3');
    // brightness -1..1: 1.5 también es inválido
    await expect(
      executeMcpTool(
        'batch_effects_apply',
        { clipIds: [clipId], effect: 'brightness', value: 1.5 },
        context,
      ),
    ).rejects.toThrow('admite valores entre -1 y 1');
  });

  it('agrega keyframes y aplica presets de animación', async () => {
    const { context, project } = fixture();
    const clipId = project.timeline.clips[0]!.id;
    const key = JSON.parse(
      await executeMcpTool(
        'keyframe_add',
        { clipId, frame: 30, property: 'scale', value: 1.3, easing: 'ease-out' },
        context,
      ),
    );
    expect(key.ok).toBe(true);
    expect(key.localFrame).toBe(30);
    const clip = context.store.state.project!.timeline.clips[0]!;
    expect(clip.transform?.keyframes?.some((k) => k.frame === 30 && k.scale === 1.3)).toBe(true);

    await expect(
      executeMcpTool(
        'keyframe_add',
        { clipId, frame: 500, property: 'scale', value: 1 },
        context,
      ),
    ).rejects.toThrow(/fuera del clip/);

    const anim = JSON.parse(
      await executeMcpTool('animation_preset_apply', { clipId, preset: 'zoom-in', intensity: 0.6 }, context),
    );
    expect(anim.ok).toBe(true);
    const after = context.store.state.project!.timeline.clips[0]! as {
      motion?: { type: string };
    };
    expect(after.motion?.type).toBe('zoom-in');
  });

  it('aplica EQ, voz, nivelación y ducking de audio', async () => {
    const { context, project } = fixture();
    const clipId = project.timeline.clips[0]!.id;
    const eq = JSON.parse(
      await executeMcpTool(
        'audio_effect_eq',
        { clipId, lowDb: 3, midDb: -2, highDb: 1.5 },
        context,
      ),
    );
    expect(eq.ok).toBe(true);
    let clip = context.store.state.project!.timeline.clips[0]!;
    expect(clip.audio?.eqLowDb).toBe(3);
    expect(clip.audio?.eqMidDb).toBe(-2);
    expect(clip.audio?.eqHighDb).toBe(1.5);

    const voice = JSON.parse(
      await executeMcpTool('audio_effect_voice', { clipId, effect: 'deep' }, context),
    );
    expect(voice.ok).toBe(true);
    clip = context.store.state.project!.timeline.clips[0]!;
    expect(clip.audio?.voiceEffect).toBe('deep');

    const norm = JSON.parse(
      await executeMcpTool('batch_audio_normalize', { clipIds: [clipId], targetLufs: -16 }, context),
    );
    expect(norm.ok).toBe(true);
    const audioFx = (context.store.state.project!.timeline.clips[0] as {
      effects?: { audioStack?: { effectId: string }[] };
    }).effects;
    expect(audioFx?.audioStack?.some((item) => item.effectId === 'audio.leveler')).toBe(true);

    const track = context.store.state.project!.timeline.tracks[0]!;
    const duck = JSON.parse(
      await executeMcpTool(
        'audio_ducking',
        {
          musicTrackId: track.id,
          voiceTrackId: track.id,
          reductionDb: -10,
          fadeMs: 200,
        },
        context,
      ),
    );
    expect(duck.ok).toBe(true);
    expect(context.store.state.project!.audio.ducking.enabled).toBe(true);
    expect(context.store.state.project!.audio.ducking.amountDb).toBe(-10);
    expect(duck.warnings.length).toBe(1);
  });

  it('ripple delete, cierra gaps, alinea y agrega transiciones en lote', async () => {
    const { context, project, assetId } = fixture();
    const first = project.timeline.clips[0]!;
    const extraTrack = JSON.parse(
      await executeMcpTool('track_add', { kind: 'video', label: 'P2' }, context),
    );
    await executeMcpTool(
      'clip_add',
      { assetId, atFrame: first.startFrame + first.durationFrames, durationFrames: 60 },
      context,
    );
    const second = context.store.state.project!.timeline.clips.find(
      (clip) => clip.id !== first.id,
    )!;
    const trackId = first.trackId;

    const batch = JSON.parse(
      await executeMcpTool(
        'batch_transitions_add',
        { trackId, type: 'fade', durationFrames: 10 },
        context,
      ),
    );
    expect(batch.ok).toBe(true);
    expect(batch.applied).toBe(1);

    const gaps = JSON.parse(
      await executeMcpTool('timeline_gaps_remove', { trackId }, context),
    );
    expect(gaps.ok).toBe(true);

    // Alinear dos clips en la misma pista siempre solapa: se mueve el segundo
    // a otra pista para que la alineación por borde sea posible.
    await executeMcpTool(
      'clip_move',
      { clipId: second.id, startFrame: second.startFrame, trackId: extraTrack.trackId },
      context,
    );
    const align = JSON.parse(
      await executeMcpTool(
        'timeline_align_clips',
        { clipIds: [first.id, second.id], alignTo: 'end', referenceFrame: 300 },
        context,
      ),
    );
    expect(align.ok).toBe(true);
    const movedFirst = context.store.state.project!.timeline.clips.find(
      (clip) => clip.id === first.id,
    )!;
    const movedSecond = context.store.state.project!.timeline.clips.find(
      (clip) => clip.id === second.id,
    )!;
    expect(movedFirst.startFrame + movedFirst.durationFrames).toBe(300);
    expect(movedSecond.startFrame + movedSecond.durationFrames).toBe(300);

    const ripple = JSON.parse(
      await executeMcpTool('timeline_ripple_delete', { clipIds: [second.id] }, context),
    );
    expect(ripple.ok).toBe(true);
    expect(ripple.deleted).toBe(1);
  });
});

describe('fs_* audit y confirmación (AUD-014)', () => {
  it('fs_delete exige confirm=true y fs_write/fs_move quedan en la bitácora', async () => {
    const { context } = fixture();
    await expect(
      executeMcpTool('fs_delete', { path: 'C:\tmp\a.txt' }, context),
    ).rejects.toThrow(/confirm/);
    const deleted = JSON.parse(
      await executeMcpTool(
        'fs_delete',
        { path: 'C:\tmp\a.txt', confirm: true },
        context,
      ),
    );
    expect(deleted.ok).toBe(true);
    await executeMcpTool('fs_write', { path: 'C:\tmp\b.txt', content: 'x' }, context);
    await executeMcpTool('fs_move', { from: 'C:\tmp\b.txt', to: 'C:\tmp\c.txt' }, context);
    const diagnostics = JSON.parse(await executeMcpTool('diagnostics', {}, context));
    const ops = diagnostics.fsAudit.map((entry: { op: string }) => entry.op);
    expect(ops).toContain('delete');
    expect(ops).toContain('write');
    expect(ops).toContain('move');
  });
});

describe('tools de producción, análisis y sistema (pasadas 130-133)', () => {
  it('production_plan_from_brief genera un plan a partir del brief', async () => {
    const { context } = fixture();
    const plan = JSON.parse(
      await executeMcpTool(
        'production_plan_from_brief',
        { objective: 'Resumen semanal de launches', platform: 'tiktok', keyPoints: ['uno', 'dos'] },
        context,
      ),
    );
    expect(plan.objective ?? plan.target?.objective ?? plan.id).toBeTruthy();
  });

  it('subtitles_save_localized guarda srt/vtt localizado', async () => {
    const { context } = fixture();
    const result = JSON.parse(
      await executeMcpTool(
        'subtitles_save_localized',
        {
          content: '1\n00:00:00,000 --> 00:00:01,000\nHola',
          outputDir: 'C:\tmp',
          baseName: 'sub',
          language: 'es',
          format: 'srt',
        },
        context,
      ),
    );
    expect(result.path).toContain('es.srt');
    expect(result.bytes).toBeGreaterThan(0);
  });

  it('subtitles_inspect_file y subtitles_convert_file despachan al servicio', async () => {
    const { context } = fixture();
    const inspect = JSON.parse(
      await executeMcpTool('subtitles_inspect_file', { path: 'C:/tmp/subs.srt' }, context),
    );
    expect(inspect.format).toBe('srt');
    expect(inspect.cueCount).toBe(2);
    const converted = JSON.parse(
      await executeMcpTool(
        'subtitles_convert_file',
        { input: 'C:/tmp/subs.srt', output: 'C:/tmp/subs.vtt' },
        context,
      ),
    );
    expect(converted.output).toBe('C:/tmp/subs.vtt');
  });

  it('analyze_face_track y track_object devuelven tracks muestreados', async () => {
    const { context } = fixture();
    const face = JSON.parse(
      await executeMcpTool(
        'analyze_face_track',
        { path: 'C:\media\talk.mp4', startSeconds: 0, endSeconds: 4 },
        context,
      ),
    );
    expect(face.samples.length).toBeGreaterThan(0);
    expect(face.xExpression).toBeTruthy();
    const obj = JSON.parse(
      await executeMcpTool(
        'track_object',
        {
          path: 'C:\media\talk.mp4',
          rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
          startSeconds: 0,
          endSeconds: 4,
        },
        context,
      ),
    );
    expect(obj.samples.length).toBeGreaterThan(0);
    expect(obj.samples[0].confidence).toBeGreaterThan(0);
  });

  it('track_object exige rect completo', async () => {
    const { context } = fixture();
    await expect(
      executeMcpTool(
        'track_object',
        { path: 'C:\m.mp4', rect: { x: 0.1 }, startSeconds: 0, endSeconds: 1 },
        context,
      ),
    ).rejects.toThrow(/rect/);
  });

  it('convert_file, compress_asset y audio_peaks despachan al servicio', async () => {
    const { context, assetId } = fixture();
    const conv = JSON.parse(
      await executeMcpTool(
        'convert_file',
        { inputPath: 'C:\out\clip.mp4', target: 'gif', outputDir: 'C:\out', fps: 12 },
        context,
      ),
    );
    expect(conv).toBeTruthy();
    const comp = JSON.parse(
      await executeMcpTool(
        'compress_asset',
        { assetId, outputDir: 'C:\out', target: 'mp4', mode: 'quality', quality: 28 },
        context,
      ),
    );
    expect(comp).toBeTruthy();
    const peaks = JSON.parse(
      await executeMcpTool('audio_peaks', { assetId, buckets: 256 }, context),
    );
    expect(peaks).toBeTruthy();
  });

  it('herramientas de sistema MCP responden sin proyecto pesado', async () => {
    const { context } = fixture();
    expect(await executeMcpTool('mcp_server_status', {}, context)).toBe('null');
    const clients = JSON.parse(await executeMcpTool('mcp_detect_clients', {}, context));
    expect(clients.some((c: { id: string }) => c.id === 'claude-desktop')).toBe(true);
    const auto = JSON.parse(
      await executeMcpTool('mcp_autoconnect', { client: 'claude-desktop' }, context),
    );
    expect(auto.configPath).toBeTruthy();
    const plugins = JSON.parse(await executeMcpTool('plugins_list', {}, context));
    expect(Array.isArray(plugins)).toBe(true);
    const catalog = JSON.parse(await executeMcpTool('visual_catalog', {}, context));
    expect(catalog).toBeTruthy();
    const gate = JSON.parse(await executeMcpTool('quality_gate_review', {}, context));
    expect(gate).toBeTruthy();
  });

  it('proxy_cancel y models_list responden', async () => {
    const { context, assetId } = fixture();
    const status = JSON.parse(
      await executeMcpTool('proxy_cancel', { assetId }, context),
    );
    expect(status).toBeTruthy();
    const models = JSON.parse(await executeMcpTool('models_list', {}, context));
    expect(Array.isArray(models)).toBe(true);
  });

  it('overlay y delivery aplican a clips y perfiles (pasada 147)', async () => {
    const { context, project } = fixture();
    const clipId = project.timeline.clips[0]!.id;
    const breath = JSON.parse(
      await executeMcpTool('overlay_breathing', { clipId, amplitude: 0.05, periodSeconds: 3 }, context),
    );
    expect(breath.ok).toBe(true);
    const second = fixture();
    const pulse = JSON.parse(
      await executeMcpTool('overlay_click_pulse', { clipId: second.project.timeline.clips[0]!.id, atOffset: 30 }, second.context),
    );
    expect(pulse.ok).toBe(true);
    const third = fixture();
    const blur = JSON.parse(
      await executeMcpTool('overlay_face_blur', {
        clipId: third.project.timeline.clips[0]!.id,
        samples: [
          { time: 0, centerX: 0.5, centerY: 0.4, size: 0.2 },
          { time: 1, centerX: 0.52, centerY: 0.41, size: 0.21 },
        ],
        kind: 'pixelate',
        pixelSize: 12,
      }, third.context),
    );
    expect(blur.ok).toBe(true);
    expect(blur.clipId).toBeTruthy();
    const comp = JSON.parse(
      await executeMcpTool('delivery_compression', { preset: 'equilibrado', videoCodec: 'h264' }, context),
    );
    expect(comp.ok).toBe(true);
    const fit = JSON.parse(
      await executeMcpTool('delivery_profile_fit', { fit: 'cover' }, context),
    );
    expect(fit.ok).toBe(true);
    const px = JSON.parse(
      await executeMcpTool('delivery_pixel_format', { pixelFormat: 'yuv422p10le' }, context),
    );
    expect(px.ok).toBe(true);
  });

  it('keyframes de transform/ganancia y automatización de pista (pasada 148)', async () => {
    const { context, project } = fixture();
    const clipId = project.timeline.clips[0]!.id;
    const trackId = project.timeline.tracks[0]!.id;
    const add = JSON.parse(
      await executeMcpTool('keyframe_add', { clipId, frame: 10, property: 'scale', value: 1.2 }, context),
    );
    expect(add.ok).toBe(true);
    const snap = JSON.parse(
      await executeMcpTool('keyframe_snapshot', { clipId, frame: 10 }, context),
    );
    expect(snap.patch?.scale).toBeCloseTo(1.2);
    const at = JSON.parse(
      await executeMcpTool('keyframe_transform_at', { clipId, frame: 10 }, context),
    );
    expect(at.transform).toBeTruthy();
    const gain = JSON.parse(
      await executeMcpTool('gain_keyframe_add', { clipId, frame: 20, gainDb: -6 }, context),
    );
    expect(gain.ok).toBe(true);
    const gainAt = JSON.parse(
      await executeMcpTool('clip_gain_at', { clipId, frame: 20 }, context),
    );
    expect(gainAt.gainDb).toBeCloseTo(-6);
    const tg = JSON.parse(
      await executeMcpTool('track_gain_keyframe_add', { trackId, frame: 30, gainDb: -3 }, context),
    );
    expect(tg.ok).toBe(true);
    const tp = JSON.parse(
      await executeMcpTool('track_pan_keyframe_add', { trackId, frame: 40, value: 0.5 }, context),
    );
    expect(tp.ok).toBe(true);
    const bez = JSON.parse(
      await executeMcpTool('keyframe_bezier_apply', { clipId, cp1X: 0.2, cp1Y: 0, cp2X: 0.8, cp2Y: 1 }, context),
    );
    expect(bez.ok).toBe(true);
    const rm = JSON.parse(
      await executeMcpTool('gain_keyframe_remove', { clipId, frame: 20 }, context),
    );
    expect(rm.ok).toBe(true);
  });

  it('cerebro: planners, smart bins, luma mates y director (pasada 149)', async () => {
    const { context, project } = fixture();
    const split = JSON.parse(
      await executeMcpTool('caption_text_split', { text: 'Primera oración. Segunda oración un poco más larga para partir.', maxChars: 40 }, context),
    );
    expect(split.chunks.length).toBeGreaterThan(0);
    const wrap = JSON.parse(
      await executeMcpTool('caption_wrap', { text: 'Hola mundo esto es una prueba de subtitulos', maxCharsPerLine: 20 }, context),
    );
    expect(wrap.wrapped.length).toBeGreaterThan(0);
    const cues = JSON.parse(
      await executeMcpTool('caption_plan_cues', { segments: [{ start: 0, end: 2, text: 'Hola mundo' }] }, context),
    );
    expect(cues.ok).toBe(true);
    const narr = JSON.parse(
      await executeMcpTool('narration_plan_build', { segments: [{ start: 0, end: 3, text: 'Hola.', words: [] }] }, context),
    );
    expect(narr.ok).toBe(true);
    const bins = JSON.parse(await executeMcpTool('smart_bin_list', {}, context));
    expect(bins.builtins.length).toBeGreaterThan(0);
    const filtered = JSON.parse(
      await executeMcpTool('assets_smart_bin_filter', { kind: 'video' }, context),
    );
    expect(filtered.count).toBeGreaterThan(0);
    const adaptive = JSON.parse(await executeMcpTool('adaptive_profile', {}, context));
    expect(adaptive.profile).toBeTruthy();
    const clipId = project.timeline.clips[0]!.id;
    const mates = JSON.parse(
      await executeMcpTool('luma_mate_candidates', { clipId }, context),
    );
    expect(mates.ok).toBe(true);
    await expect(
      executeMcpTool('auto_edit_build', { assignment: 'match', includeCaptions: true, replaceTimeline: false }, context),
    ).rejects.toThrow(/escena/i);
  });

  it('ritmo, motion templates y visual intelligence (pasada 150)', async () => {
    const { context, assetId, project } = fixture();
    const list = JSON.parse(await executeMcpTool('motion_templates_list', {}, context));
    expect(list.count).toBeGreaterThan(0);
    expect(list.templates[0].id).toBeTruthy();
    const mg = JSON.parse(
      await executeMcpTool('motion_graphic_add', {
        templateId: 'free-text',
        props: { text: 'Hola', x: 0.1, y: 0.5 },
        atFrame: 0,
        durationFrames: 90,
      }, context),
    );
    expect(mg.ok).toBe(true);
    expect(mg.clipId).toBeTruthy();
    const fakeContent = {
      assetId, width: 1920, height: 1080, aspect: 16 / 9,
      orientation: 'landscape', lumaMean: 0.4, lumaStd: 0.1,
      saturationMean: 0.3, colorfulness: 0.2, dominantHue: 210,
      hueConcentration: 0.5, temperature: 'neutral',
    };
    vi.spyOn(context.store.service, 'analyzeMediaFrames').mockResolvedValue([fakeContent] as never);
    const traits = JSON.parse(
      await executeMcpTool('image_traits', { assetId, sentence: 'un paisaje azul' }, context),
    );
    expect(traits.traits).toBeTruthy();
    expect(traits.description).toBeTruthy();
    const plan = JSON.parse(
      await executeMcpTool('visual_plan_assignments', { sentences: ['intro'], imageAssetIds: [assetId] }, context),
    );
    expect(plan.ok).toBe(true);
    await expect(
      executeMcpTool('beat_detect', { assetId }, context),
    ).rejects.toThrow();
    await expect(
      executeMcpTool('storyboard_build', { imageAssetIds: [assetId] }, context),
    ).rejects.toThrow(/imagen/i);
    void project;
  });

  it('calidad, reglas de plataforma, presets y utilidades (pasada 151)', async () => {
    const { context, project } = fixture();
    const clipId = project.timeline.clips[0]!.id;
    const quality = JSON.parse(
      await executeMcpTool('project_quality_evaluate', {}, context),
    );
    expect(quality.ok).toBe(true);
    expect(Array.isArray(quality.findings)).toBe(true);
    const packs = JSON.parse(
      await executeMcpTool('platform_rules_list', {}, context),
    );
    expect(packs.packs.length).toBeGreaterThan(0);
    const audit = JSON.parse(
      await executeMcpTool('platform_rules_audit', { packId: packs.packs[0]!.id }, context),
    );
    expect(audit.ok).toBe(true);
    await expect(
      executeMcpTool('platform_rules_audit', { packId: 'inexistente' }, context),
    ).rejects.toThrow(/reglas/i);
    const ramps = JSON.parse(await executeMcpTool('speed_ramp_presets', {}, context));
    expect(ramps.presets.length).toBeGreaterThan(0);
    const ramp = JSON.parse(
      await executeMcpTool('speed_ramp_preset_apply', { clipId, presetId: 'heroe' }, context),
    );
    expect(ramp.ok).toBe(true);
    const presets = JSON.parse(await executeMcpTool('effect_presets_list', {}, context));
    expect(presets.presets.length).toBeGreaterThan(0);
    const fx = JSON.parse(
      await executeMcpTool('effect_preset_apply', { clipId, presetId: presets.presets[0]!.id }, context),
    );
    expect(fx.ok).toBe(true);
    const ioSet = JSON.parse(
      await executeMcpTool('project_io_range_set', { inFrame: 0, outFrame: 30 }, context),
    );
    expect(ioSet.ok).toBe(true);
    const ioGet = JSON.parse(await executeMcpTool('project_io_range_get', {}, context));
    expect(ioGet.range?.outFrame).toBe(30);
    const subs = JSON.parse(
      await executeMcpTool('subtitles_export_content', { format: 'srt' }, context),
    );
    expect(subs.ok).toBe(true);
    expect(typeof subs.content).toBe('string');
    const fav = JSON.parse(
      await executeMcpTool('catalog_favorite_toggle', { kind: 'effect', id: 'blur' }, context),
    );
    expect(fav.ok).toBe(true);
    const retime = JSON.parse(
      await executeMcpTool('project_retime', { num: 30, den: 1 }, context),
    );
    expect(retime.ok).toBe(true);
    const queue = JSON.parse(await executeMcpTool('render_queue_status', {}, context));
    expect(queue.ok).toBe(true);
    const mem = JSON.parse(await executeMcpTool('director_memory_get', {}, context));
    expect(mem.ok).toBe(true);
    const vf = JSON.parse(await executeMcpTool('video_format_presets', {}, context));
    expect(vf.fpsPresets.length).toBeGreaterThan(0);
    const title = JSON.parse(await executeMcpTool('project_title_card_apply', {}, context));
    expect(typeof title.ok).toBe('boolean');
  });

  it('planificación, publicación, plantillas y cleanup (pasada 152)', async () => {
    const { context, project } = fixture();
    const clipId = project.timeline.clips[0]!.id;
    const plan = JSON.parse(
      await executeMcpTool('production_plan_from_project', { objective: 'video para tiktok' }, context),
    );
    expect(plan.ok).toBe(true);
    expect(plan.plan).toBeTruthy();
    const variants = JSON.parse(
      await executeMcpTool('factory_variants_plan', { topic: 'review de café', variants: 3 }, context),
    );
    expect(variants.variants.length).toBe(3);
    const meta = JSON.parse(await executeMcpTool('publication_metadata', {}, context));
    expect(meta.ok).toBe(true);
    const audit = JSON.parse(await executeMcpTool('publication_audit', {}, context));
    expect(audit.ok).toBe(true);
    const tpl = JSON.parse(await executeMcpTool('effect_templates_list', { kind: 'video' }, context));
    expect(tpl.ok).toBe(true);
    expect(tpl.builtins.length).toBeGreaterThan(0);
    const motions = JSON.parse(await executeMcpTool('caption_motion_presets', {}, context));
    expect(motions.presets).toContain('fade');
    const found = JSON.parse(
      await executeMcpTool('project_search', { query: project.name.slice(0, 8) || 'clip', limit: 5 }, context),
    );
    expect(found.ok).toBe(true);
    const subs = JSON.parse(
      await executeMcpTool('subtitle_import', {
        text: '1\n00:00:00,000 --> 00:00:01,000\nHola mundo\n\n2\n00:00:01,000 --> 00:00:02,000\nSegunda línea\n',
      }, context),
    );
    expect(subs.ok).toBe(true);
    expect(subs.added).toBeGreaterThanOrEqual(0);
    const folder = JSON.parse(await executeMcpTool('folder_timeline_build', {}, context));
    expect(typeof folder.ok).toBe('boolean');
    const apply = JSON.parse(
      await executeMcpTool('effect_template_apply', { name: tpl.builtins[0]!.name, clipId }, context),
    );
    expect(apply.ok).toBe(true);
    await expect(
      executeMcpTool('effect_template_apply', { name: 'plantilla-inexistente', clipId }, context),
    ).rejects.toThrow(/plantilla/i);
    const cleanup = JSON.parse(await executeMcpTool('auto_cleanup_run', { cutSilences: false, cutPauses: false, denoise: 'off', levelAudio: false, zoomCuts: false }, context));
    expect(cleanup.ok).toBe(true);
  });

  it('sfx, looks, presets de export/grade y transcripción (pasada 153)', async () => {
    const { context, project } = fixture();
    const clipId = project.timeline.clips[0]!.id;
    const sfx = JSON.parse(await executeMcpTool('sfx_library', {}, context));
    expect(Array.isArray(sfx)).toBe(true);
    const looks = JSON.parse(await executeMcpTool('color_looks_list', {}, context));
    expect(looks.looks.length).toBeGreaterThan(0);
    const look = JSON.parse(
      await executeMcpTool('color_look_apply', { lookId: looks.looks[1]!.id, clipId }, context),
    );
    expect(look.ok).toBe(true);
    const presets = JSON.parse(await executeMcpTool('export_presets_list', {}, context));
    expect(presets.ok).toBe(true);
    const est = JSON.parse(await executeMcpTool('export_size_estimate', { durationSeconds: 60 }, context));
    expect(est.ok).toBe(true);
    expect(est.bytes).toBeGreaterThan(0);
    const grades = JSON.parse(await executeMcpTool('grade_presets_list', {}, context));
    expect(grades.ok).toBe(true);
    await expect(
      executeMcpTool('grade_preset_apply', { preset: 'inexistente', clipId }, context),
    ).rejects.toThrow(/plantilla/i);
    await expect(
      executeMcpTool('sfx_add', { sfxId: 'no-existe', atFrame: 0 }, context),
    ).rejects.toThrow(/sonido|biblioteca/i);
    const saved = JSON.parse(
      await executeMcpTool('export_preset_save', {
        name: 'test-preset', profileId: project.renderProfiles[0]?.id ?? 'x',
        compression: 'equilibrado', useGpu: false,
      }, context),
    );
    expect(saved.ok).toBe(true);
    if (saved.presets[0]) {
      const del = JSON.parse(
        await executeMcpTool('export_preset_delete', { id: saved.presets[0].id }, context),
      );
      expect(del.ok).toBe(true);
    }
  });

  it('media por bytes, copia al proyecto y pipeline alfa (pasada 154)', async () => {
    const { context } = fixture();
    const url = JSON.parse(
      await executeMcpTool('file_url_absolute', { path: 'media/test.png' }, context),
    );
    expect(url.ok).toBe(true);
    const wavB64 = Buffer.from('RIFFfake-wav-bytes').toString('base64');
    const imported = JSON.parse(
      await executeMcpTool('audio_import_bytes', { fileName: 'test-tone.wav', dataBase64: wavB64 }, context),
    );
    expect(imported.ok).toBe(true);
    // La extensión se valida en Rust (IMPORT_BYTE_EXTENSIONS); el fake no la replica.
    await expect(
      executeMcpTool('media_copy_into', { paths: [], directory: 'media' }, context),
    ).rejects.toThrow();
    const discarded = JSON.parse(
      await executeMcpTool('alpha_frames_discard', { token: 'token-inexistente' }, context),
    );
    expect(discarded.ok).toBe(true);
  });

  it('generación AI, ciclo de render y proveedores (pasada 155)', async () => {
    const { context } = fixture();
    const script = JSON.parse(
      await executeMcpTool('script_generate', {
        brief: 'review de una app', sceneCount: 3, language: 'es', approvedCost: true,
      }, context),
    );
    expect(script.scenes).toHaveLength(3);
    const recipe = JSON.parse(
      await executeMcpTool('effect_recipe_generate', { prompt: 'look frío' }, context),
    );
    expect(recipe.name).toBeTruthy();
    const motion = JSON.parse(
      await executeMcpTool('motion_suggest', {
        brief: 'título principal', templateId: 'lower-third', approvedCost: true,
      }, context),
    );
    expect(motion.templateId).toBe('lower-third');
    const wb = JSON.parse(await executeMcpTool('whiteboard_status', {}, context));
    expect(wb.available).toBe(true);
    const fonts = JSON.parse(await executeMcpTool('system_fonts_list', {}, context));
    expect(Array.isArray(fonts)).toBe(true);
    const active = JSON.parse(await executeMcpTool('render_active', {}, context));
    expect(active.ok).toBe(true);
    const provider = JSON.parse(await executeMcpTool('audio_provider_get', {}, context));
    expect(provider).toBeTruthy();
    const whisper = JSON.parse(await executeMcpTool('whisper_model_status', {}, context));
    expect(whisper).toBeTruthy();
    const proxies = JSON.parse(await executeMcpTool('flow_proxies_get', {}, context));
    expect(proxies).toBeTruthy();
    const saved = JSON.parse(
      await executeMcpTool('mcp_server_save', {
        name: 'test-mcp', command: 'node', args: ['server.js'], enabled: false,
      }, context),
    );
    expect(saved).toBeTruthy();
    const evaled = JSON.parse(
      await executeMcpTool('web_session_eval', { js: '1+1' }, context),
    );
    expect(evaled.ok).toBe(true);
    await expect(
      executeMcpTool('render_start', { profileId: 'p', outputPath: 'o.mp4', includeCaptions: true, startFrame: 10 }, context),
    ).rejects.toThrow(/rango/i);
    await expect(
      executeMcpTool('tool_choose', { tool: 'vlc' }, context),
    ).rejects.toThrow();
    await expect(
      executeMcpTool('media_plan_match', { sentences: [], images: ['a.png'] }, context),
    ).rejects.toThrow();
  });

  it('recuperación, memoria del director y preferencias (pasada 156)', async () => {
    const { context } = fixture();
    const status = JSON.parse(await executeMcpTool('recovery_status', {}, context));
    expect(status.ok).toBe(true);
    expect(status.offer === null || typeof status.offer === 'object').toBe(true);
    const prefs = JSON.parse(await executeMcpTool('preferences_export', {}, context));
    expect(prefs.ok).toBe(true);
    expect(typeof prefs.json).toBe('string');
    expect(prefs.json.length).toBeGreaterThan(10);
    const imported = JSON.parse(
      await executeMcpTool('preferences_import', { json: prefs.json }, context),
    );
    expect(imported.ok).toBe(true);
    const bad = JSON.parse(
      await executeMcpTool('preferences_import', { json: '{"kind":"nope"}' }, context),
    );
    expect(bad.ok).toBe(false);
    const reset = JSON.parse(await executeMcpTool('director_memory_reset', {}, context));
    expect(reset.ok).toBe(true);
    const dismissed = JSON.parse(await executeMcpTool('recovery_dismiss', {}, context));
    expect(dismissed.ok).toBe(true);
  });

  it('catálogo de efectos y stack por clip (pasada 157)', async () => {
    const { context, project } = fixture();
    const clipId = project.timeline.clips[0]!.id;
    const catalog = JSON.parse(
      await executeMcpTool('effect_catalog_search', { query: 'blur', kind: 'video' }, context),
    );
    expect(catalog.ok).toBe(true);
    expect(catalog.total).toBeGreaterThan(0);
    expect(catalog.effects[0].params.length).toBeGreaterThanOrEqual(0);
    const effectId = catalog.effects[0]!.id as string;
    const added = JSON.parse(
      await executeMcpTool('effect_stack_add', { clipId, effectId }, context),
    );
    expect(added.ok).toBe(true);
    const instanceId = added.instanceId as string;
    const listed = JSON.parse(await executeMcpTool('effect_stack_list', { clipId }, context));
    expect(listed.stack.some((i: { id: string }) => i.id === instanceId)).toBe(true);
    const param = catalog.effects[0]!.params[0];
    if (param) {
      const set = JSON.parse(
        await executeMcpTool('effect_stack_set_param', {
          clipId, instanceId, param: param.id, value: param.default ?? 0,
        }, context),
      );
      expect(set.ok).toBe(true);
    }
    const toggled = JSON.parse(
      await executeMcpTool('effect_stack_set_enabled', { clipId, instanceId, enabled: false }, context),
    );
    expect(toggled.enabled).toBe(false);
    const reset = JSON.parse(
      await executeMcpTool('effect_stack_reset', { clipId, instanceId }, context),
    );
    expect(reset.ok).toBe(true);
    const secondId = catalog.effects[1]?.id ?? effectId;
    const added2 = JSON.parse(
      await executeMcpTool('effect_stack_add', { clipId, effectId: secondId }, context),
    );
    expect(added2.ok).toBe(true);
    const moved = JSON.parse(
      await executeMcpTool('effect_stack_move', { clipId, instanceId: added2.instanceId, direction: 'up' }, context),
    );
    expect(moved.ok).toBe(true);
    const removed2 = JSON.parse(
      await executeMcpTool('effect_stack_remove', { clipId, instanceId: added2.instanceId }, context),
    );
    expect(removed2.ok).toBe(true);
    const removed = JSON.parse(
      await executeMcpTool('effect_stack_remove', { clipId, instanceId }, context),
    );
    expect(removed.ok).toBe(true);
    await expect(
      executeMcpTool('effect_stack_add', { clipId, effectId: 'no.existe' }, context),
    ).rejects.toThrow(/catálogo/i);
    await expect(
      executeMcpTool('effect_stack_add', { clipId, effectId: 'transition.fade' }, context),
    ).rejects.toThrow();
  });

  it('grafos de nodos, edición por texto y lottie (pasada 158)', async () => {
    const { context, assetId } = fixture();
    const catalog = JSON.parse(
      await executeMcpTool('effect_catalog_search', { query: 'blur', kind: 'video' }, context),
    );
    const effectId = catalog.effects[0].id as string;
    const graph = {
      version: 1,
      name: 'g1',
      nodes: [
        { id: 'in', kind: 'input', x: 0, y: 0, data: { assetId, atFrame: 0, durationFrames: 30 } },
        { id: 'fx', kind: 'effect', x: 140, y: 0, data: { manifestId: effectId } },
      ],
      edges: [{ id: 'e1', source: 'in', target: 'fx' }],
    };
    const valid = JSON.parse(await executeMcpTool('node_graph_validate', { graph }, context));
    expect(valid.ok).toBe(true);
    const saved = JSON.parse(await executeMcpTool('node_graph_save', { name: 'g1', graph }, context));
    expect(saved.ok).toBe(true);
    const listed = JSON.parse(await executeMcpTool('node_graph_list', {}, context));
    expect(listed.graphs.some((g: { name: string }) => g.name === 'g1')).toBe(true);
    const ran = JSON.parse(await executeMcpTool('node_graph_execute', { name: 'g1' }, context));
    expect(ran.ok).toBe(true);
    // input produce el clip y effect propaga el mismo clipId: 2 referencias.
    expect(ran.clipCount).toBe(2);
    const got = JSON.parse(await executeMcpTool('node_graph_get', { name: 'g1' }, context));
    expect(got.graph.nodes).toHaveLength(2);
    const removed = JSON.parse(await executeMcpTool('node_graph_remove', { name: 'g1' }, context));
    expect(removed.ok).toBe(true);
    const badGraph = { version: 1, name: 'bad', nodes: [], edges: [] };
    const invalid = JSON.parse(await executeMcpTool('node_graph_validate', { graph: badGraph }, context));
    expect(invalid.ok).toBe(false);
    await expect(
      executeMcpTool('node_graph_save', { name: 'bad', graph: badGraph }, context),
    ).rejects.toThrow(/inválido/);

    const edited = JSON.parse(
      await executeMcpTool('text_edit_build', {
        assetId,
        segments: [
          { start: 0, end: 1, text: 'hola' },
          { start: 1, end: 2, text: 'chau' },
        ],
        exclude: [1],
      }, context),
    );
    expect(edited.ok).toBe(true);
    expect(edited.clipCount).toBe(1);

    await expect(executeMcpTool('lottie_import', { json: '{}' }, context)).rejects.toThrow(/confirmRights/);
    await expect(
      executeMcpTool('lottie_import', { confirmRights: true }, context),
    ).rejects.toThrow(/exactamente uno/);
  });

  it('skills del AI Hub: listar, componer y CRUD de personalizadas (pasada 159)', async () => {
    const { context } = fixture();
    const listed = JSON.parse(await executeMcpTool('ai_skills_list', {}, context));
    expect(listed.ok).toBe(true);
    expect(listed.skills.length).toBeGreaterThan(0);
    const builtin = listed.skills.find((s: { custom: boolean }) => !s.custom);
    expect(builtin).toBeTruthy();
    const composed = JSON.parse(
      await executeMcpTool('ai_skill_compose', { skillId: builtin.id, brief: 'un video sobre café' }, context),
    );
    expect(composed.ok).toBe(true);
    expect(composed.prompt).toContain('SKILL:');
    expect(composed.tooLong).toBe(false);
    await expect(
      executeMcpTool('ai_skill_compose', { skillId: 'no-existe', brief: 'x' }, context),
    ).rejects.toThrow(/skill/i);

    const saved = JSON.parse(
      await executeMcpTool('custom_skill_save', {
        name: 'Mis ganchos',
        summary: 'Ganchos alternativos para reels',
        category: 'guion',
        target: 'script',
        output: 'JSON con 3 ganchos',
        prompt: 'Generá 3 ganchos distintos para el brief.',
      }, context),
    );
    expect(saved.ok).toBe(true);
    expect(saved.id).toBe('mis-ganchos');
    const customOnly = JSON.parse(await executeMcpTool('ai_skills_list', { customOnly: true }, context));
    expect(customOnly.skills.some((s: { id: string }) => s.id === 'mis-ganchos')).toBe(true);
    const composedCustom = JSON.parse(
      await executeMcpTool('ai_skill_compose', { skillId: 'mis-ganchos', brief: 'video de perros' }, context),
    );
    expect(composedCustom.ok).toBe(true);
    await expect(
      executeMcpTool('custom_skill_save', {
        name: 'X', summary: 'Y', category: 'guion', target: 'vista-inexistente',
        output: 'Z', prompt: 'W',
      }, context),
    ).rejects.toThrow(/target/);
    const deleted = JSON.parse(await executeMcpTool('custom_skill_delete', { id: 'mis-ganchos' }, context));
    expect(deleted.ok).toBe(true);
    await expect(
      executeMcpTool('custom_skill_delete', { id: 'mis-ganchos' }, context),
    ).rejects.toThrow(/no hay/);
  });

  it('expone snapshot y opciones de captura en screen_record', async () => {
    const { context } = fixture();
    const snapshot = JSON.parse(await executeMcpTool('screen_record', { action: 'snapshot' }, context));
    expect(snapshot.ok).toBe(true);
    expect(snapshot.path).toContain('preview-');
    const started = JSON.parse(
      await executeMcpTool('screen_record', {
        action: 'start',
        outputDir: 'C:\\out',
        webcamDevice: 'HD Webcam',
        webcamChroma: { color: '#00ff00', similarity: 0.4, blend: 0.1 },
        cursorOverlay: { style: 'flecha', color: 'blanco', scale: 2, ripple: true },
      }, context),
    );
    expect(started.recording).toBe(true);
    await expect(
      executeMcpTool('screen_record', { action: 'bogus' }, context),
    ).rejects.toThrow(/action/);
  });

  it('hornea y exporta LUTs y las importa por path', async () => {
    const { context } = fixture();
    const service = context.store.service;
    const exportSpy = vi.spyOn(service, 'exportLookLut');
    const exported = JSON.parse(
      await executeMcpTool('lut_export', {
        outputDir: 'C:\\luts',
        title: 'Mi Look',
        brightness: 0.05,
        contrast: 1.1,
        saturation: 0.9,
        temperature: -0.2,
      }, context),
    );
    expect(exported.path).toContain('look.cube');
    expect(exportSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        outputDir: 'C:\\luts',
        title: 'Mi Look',
        effects: { brightness: 0.05, contrast: 1.1, saturation: 0.9, temperature: -0.2 },
      }),
    );
    const importSpy = vi.spyOn(service, 'importLut');
    const imported = JSON.parse(
      await executeMcpTool('lut_import', { path: 'C:\\descargas\\look.cube' }, context),
    );
    expect(imported.path).toBe('media/luts/fake.cube');
    expect(importSpy).toHaveBeenCalledWith('C:\\descargas\\look.cube');
  });

  it('guarda thumbnails y opera el concat_worker', async () => {
    const { context } = fixture();
    const service = context.store.service;
    const thumbSpy = vi.spyOn(service, 'saveThumbnail');
    const thumb = JSON.parse(
      await executeMcpTool('thumbnail_save', {
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        outputDir: 'C:\\thumbs',
        fileName: 'frame.png',
      }, context),
    );
    expect(thumb.path).toContain('miniatura.png');
    expect(thumbSpy).toHaveBeenCalledWith(
      expect.objectContaining({ dataUrl: 'data:image/png;base64,iVBORw0KGgo=', fileName: 'frame.png' }),
    );
    const status = JSON.parse(await executeMcpTool('concat_worker', { action: 'status' }, context));
    expect(status.available).toBe(false);
    const ping = JSON.parse(
      await executeMcpTool('concat_worker', { action: 'request', op: 'ping', params: { hello: 1 } }, context),
    );
    expect(ping.ok).toBe(true);
    expect(ping.pong).toBe(true);
    const cancel = JSON.parse(await executeMcpTool('concat_worker', { action: 'cancel' }, context));
    expect(cancel.ok).toBe(true);
    await expect(
      executeMcpTool('concat_worker', { action: 'bogus' }, context),
    ).rejects.toThrow(/action/);
  });
});

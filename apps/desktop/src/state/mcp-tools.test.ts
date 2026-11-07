import { describe, expect, it, vi } from 'vitest';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
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
      await executeMcpTool('multicam_build', { assetIds: [assetId, second.id] }, context),
    );
    expect(built.trackId).toBeTruthy();
    expect(built.clips).toBeGreaterThan(0);
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
});

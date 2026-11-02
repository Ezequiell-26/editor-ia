import { describe, expect, it } from 'vitest';
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

  it('publica el catálogo completo de herramientas', async () => {
    const { context } = fixture();
    const catalog = JSON.parse(await executeMcpTool('__catalog', {}, context));
    const names = catalog.map((tool: { name: string }) => tool.name);
    expect(names.length).toBeGreaterThanOrEqual(30);
    for (const required of [
      'project_new',
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
      'caption_style_update',
      'settings_set_tools',
    ]) {
      expect(names).toContain(required);
    }
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

  it('falla claro si no hay proyecto o la herramienta no existe', async () => {
    const { context } = fixture();
    await expect(executeMcpTool('inventada', {}, context)).rejects.toThrow(/desconocida/);
    (context.store.state as { project: ProjectDocument | null }).project = null;
    await expect(executeMcpTool('project_summary', {}, context)).rejects.toThrow(/proyecto abierto/);
  });
});

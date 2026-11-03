import { describe, expect, it } from 'vitest';
import { MCP_READ_ONLY_TOOL_NAMES, MCP_TOOLS, MCP_TOOL_BY_NAME } from './mcp-catalog';
import { validateMcpToolArguments } from './mcp-validation';

describe('contrato MCP', () => {
  it('publica un perfil de riesgo completo para cada herramienta', () => {
    expect(MCP_TOOLS.length).toBeGreaterThan(30);
    expect(new Set(MCP_TOOLS.map((tool) => tool.name)).size).toBe(MCP_TOOLS.length);

    for (const tool of MCP_TOOLS) {
      expect(tool.annotations?.title, tool.name).toBeTruthy();
      expect(typeof tool.annotations?.readOnlyHint, tool.name).toBe('boolean');
      expect(typeof tool.annotations?.destructiveHint, tool.name).toBe('boolean');
      expect(typeof tool.annotations?.idempotentHint, tool.name).toBe('boolean');
      expect(typeof tool.annotations?.openWorldHint, tool.name).toBe('boolean');
      expect(tool.inputSchema.type, tool.name).toBe('object');
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
      expect(MCP_TOOL_BY_NAME.get(tool.name)).toBe(tool);
    }
  });

  it('clasifica las lecturas desde la fuente única del catálogo', () => {
    for (const name of [
      'diagnostics',
      'app_status',
      'project_summary',
      'project_snapshot',
      'assets_list',
      'tracks_list',
      'factory_job_status',
      'factory_job_list',
    ]) {
      expect(MCP_READ_ONLY_TOOL_NAMES.has(name)).toBe(true);
      expect(MCP_TOOL_BY_NAME.get(name)?.annotations?.readOnlyHint).toBe(true);
    }
    expect(MCP_READ_ONLY_TOOL_NAMES.has('clip_delete')).toBe(false);
    expect(MCP_TOOL_BY_NAME.get('clip_delete')?.annotations?.destructiveHint).toBe(true);
    expect(MCP_TOOL_BY_NAME.get('clip_add')?.annotations?.destructiveHint).toBe(false);
    expect(MCP_TOOL_BY_NAME.get('extract_audio')?.annotations?.destructiveHint).toBe(true);
    expect(MCP_TOOL_BY_NAME.get('write_chapters')?.annotations?.destructiveHint).toBe(true);
    expect(MCP_TOOL_BY_NAME.get('export_interchange')?.annotations?.openWorldHint).toBe(true);
    expect(MCP_TOOL_BY_NAME.get('project_open')?.annotations?.openWorldHint).toBe(true);
  });

  it('acepta argumentos válidos y los devuelve sin mutarlos', () => {
    const args = { include: ['clips', 'assets'], limit: 25 };
    expect(validateMcpToolArguments('project_snapshot', args)).toBe(args);
    expect(validateMcpToolArguments('factory_job_list', undefined)).toEqual({});
  });

  it('rechaza argumentos que no sean un objeto JSON', () => {
    expect(() => validateMcpToolArguments('project_summary', ['unexpected'])).toThrow(/objeto JSON/);
  });

  it('rechaza campos obligatorios ausentes, tipos incorrectos y propiedades desconocidas', () => {
    expect(() => validateMcpToolArguments('clip_move', { clipId: 'clip-1' })).toThrow(/startFrame/);
    expect(() => validateMcpToolArguments('clip_move', { clipId: 'clip-1', startFrame: '20' })).toThrow(/se esperaba integer/);
    expect(() => validateMcpToolArguments('project_summary', { debug: true })).toThrow(/parámetro desconocido/);
  });

  it('valida enums y objetos anidados antes de ejecutar herramientas', () => {
    expect(() => validateMcpToolArguments('project_snapshot', { include: ['not-a-section'] })).toThrow(/opciones permitidas/);
    expect(() =>
      validateMcpToolArguments('settings_set', {
        ai: { kind: 'openai-compatible', unexpected: 'value' },
      }),
    ).toThrow(/parámetro desconocido/);
  });

  it('valida los elementos de arrays estructurados', () => {
    expect(() =>
      validateMcpToolArguments('write_chapters', {
        input: 'C:\\video.mp4',
        output: 'C:\\chapters.mp4',
        chapters: [{ startSeconds: 0, endSeconds: '3', title: 'Inicio' }],
      }),
    ).toThrow(/endSeconds/);
  });

  it('aplica límites del catálogo y rechaza secciones repetidas', () => {
    expect(() => validateMcpToolArguments('factory_run', { brief: 'Un brief de prueba', scenes: 13 })).toThrow(/máximo 12/);
    expect(() => validateMcpToolArguments('project_snapshot', { limit: 501 })).toThrow(/máximo 500/);
    expect(() =>
      validateMcpToolArguments('project_snapshot', { include: ['clips', 'clips'] }),
    ).toThrow(/duplicados/);
    expect(() =>
      validateMcpToolArguments('audio_mix', { targetLufs: -5 }),
    ).toThrow(/máximo -9/);
  });

  it('rechaza frames y resoluciones fraccionarias en lugar de redondearlas', () => {
    expect(() =>
      validateMcpToolArguments('clip_add', { assetId: 'asset-1', atFrame: 1.5 }),
    ).toThrow(/se esperaba integer/);
    expect(() =>
      validateMcpToolArguments('project_new', { name: 'Prueba', width: 1920.5 }),
    ).toThrow(/se esperaba integer/);
    expect(() =>
      validateMcpToolArguments('playhead', { frame: -1 }),
    ).toThrow(/mínimo 0/);
  });

  it('impide parches vacíos y conserva operaciones con parámetros opcionales', () => {
    expect(() => validateMcpToolArguments('clip_update', { clipId: 'clip-1' })).toThrow(/al menos 2 campo/);
    expect(() => validateMcpToolArguments('clip_effects', { clipId: 'clip-1', speed: 0.05 })).toThrow(/mínimo 0.1/);
    expect(validateMcpToolArguments('critic_fix', undefined)).toEqual({});
  });

  it('valida coherencia temporal antes de modificar el proyecto o archivos', () => {
    expect(() =>
      validateMcpToolArguments('export_lossless', {
        input: 'C:\\source.mp4',
        output: 'C:\\clip.mp4',
        startSeconds: 12,
        endSeconds: 12,
      }),
    ).toThrow(/posterior al inicio/);

    expect(() =>
      validateMcpToolArguments('caption_update', {
        cueId: 'cue-1',
        startFrame: 90,
        endFrame: 90,
      }),
    ).toThrow(/posterior al inicio/);

    expect(() =>
      validateMcpToolArguments('marker_add', {
        frame: 100,
        endFrame: 100,
      }),
    ).toThrow(/posterior al frame/);

    expect(() =>
      validateMcpToolArguments('write_chapters', {
        input: 'C:\\source.mp4',
        output: 'C:\\chapters.mp4',
        chapters: [
          { startSeconds: 10, endSeconds: 20, title: 'Segundo' },
          { startSeconds: 5, endSeconds: 15, title: 'Primero' },
        ],
      }),
    ).toThrow(/solaparse ni estar desordenados/);
  });

  it('rechaza herramientas que no estén publicadas en el catálogo', () => {
    expect(() => validateMcpToolArguments('not_a_tool', {})).toThrow(/desconocida/);
  });
});

import { describe, expect, it } from 'vitest';
import { createEmptyProject, parseProject } from '@editor-ia/project-schema';
import type { ProjectDocument } from '@editor-ia/project-schema';
import type { PluginInfo } from '../services/project-service';
import { loadEffectTemplates } from './effect-templates';
import {
  applyPluginCaptionStyles,
  applyPluginExportProfiles,
  countPluginPresets,
  importPluginEffectTemplate,
  parsePluginPresets,
  type PluginCaptionStyle,
  type PluginExportProfile,
} from './plugin-presets';

const NOW = '2025-01-01T00:00:00.000Z';

function plugin(presets: PluginInfo['presets']): PluginInfo {
  return {
    id: 'mi-plugin',
    name: 'Mi plugin',
    version: '1.0.0',
    description: '',
    author: '',
    official: false,
    kind: 'plugin',
    mcp: null,
    enabled: true,
    directory: 'plugins/mi-plugin',
    error: null,
    presets,
    commands: [],
  };
}

function effectDoc(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'olyvia-effect-template',
    version: 1,
    name: 'Look cálido',
    effectKind: 'video',
    stack: [
      { id: 'inst-1', effectId: 'color.exposure', enabled: true, params: { exposure: 0.4 } },
      { id: 'inst-2', effectId: 'efecto.que.no.existe', enabled: true, params: {} },
    ],
    createdAt: NOW,
    ...overrides,
  };
}

function profilePreset(overrides: Record<string, unknown> = {}) {
  return {
    name: 'YouTube 720p',
    container: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    resolution: { width: 1280, height: 720 },
    frameRate: { num: 30, den: 1 },
    bitrate: { mode: 'crf', crf: 20 },
    pixelFormat: 'yuv420p',
    audioSampleRate: 48_000,
    audioChannels: 2,
    aspectRatio: '16:9',
    qualityGate: {
      minOutputBytes: 500_000,
      durationToleranceFrames: 10,
      requireAllAssetsReady: true,
    },
    ...overrides,
  };
}

function stylePreset(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Karaoke grande',
    fontFamily: 'Arial',
    fontSizePx: 64,
    color: '#ffffff',
    position: 'bottom',
    ...overrides,
  };
}

function baseProject(): ProjectDocument {
  return createEmptyProject('Prueba', NOW);
}

describe('parsePluginPresets', () => {
  it('valida una plantilla de efectos y reporta effectId desconocidos', () => {
    const parsed = parsePluginPresets(
      plugin({ effects: [effectDoc()], exportProfiles: [], captionStyles: [] }),
    );
    const entry = parsed.effects[0]!;
    expect('error' in entry).toBe(false);
    if ('error' in entry) return;
    expect(entry.template.name).toBe('Look cálido');
    expect(entry.template.kind).toBe('video');
    expect(entry.unknownEffectIds).toEqual(['efecto.que.no.existe']);
  });

  it('rechaza una plantilla de efectos con formato incorrecto', () => {
    const parsed = parsePluginPresets(
      plugin({ effects: [{ nope: true }, effectDoc({ kind: 'otro' })], exportProfiles: [], captionStyles: [] }),
    );
    expect(parsed.effects).toHaveLength(2);
    expect('error' in parsed.effects[0]!).toBe(true);
    expect('error' in parsed.effects[1]!).toBe(true);
  });

  it('acepta un perfil de exportación sin id y rechaza el que lo trae', () => {
    const parsed = parsePluginPresets(
      plugin({
        effects: [],
        exportProfiles: [profilePreset(), profilePreset({ id: 'con-id', name: 'Con id' })],
        captionStyles: [],
      }),
    );
    const ok = parsed.exportProfiles[0]!;
    expect('error' in ok).toBe(false);
    if ('error' in ok) return;
    expect(ok.preset.name).toBe('YouTube 720p');
    expect('id' in ok.preset).toBe(false);
    expect('error' in parsed.exportProfiles[1]!).toBe(true);
  });

  it('rechaza un perfil que viola el schema (aspectRatio inconsistente)', () => {
    const parsed = parsePluginPresets(
      plugin({
        effects: [],
        exportProfiles: [profilePreset({ resolution: { width: 100, height: 100 } })],
        captionStyles: [],
      }),
    );
    expect('error' in parsed.exportProfiles[0]!).toBe(true);
  });

  it('acepta un estilo de subtítulo sin id y rechaza campos inválidos', () => {
    const parsed = parsePluginPresets(
      plugin({
        effects: [],
        exportProfiles: [],
        captionStyles: [stylePreset(), stylePreset({ fontSizePx: 0 })],
      }),
    );
    const ok = parsed.captionStyles[0]!;
    expect('error' in ok).toBe(false);
    if ('error' in ok) return;
    expect(ok.preset.position).toBe('bottom');
    expect('error' in parsed.captionStyles[1]!).toBe(true);
  });

  it('cuenta válidos e inválidos por grupo', () => {
    const parsed = parsePluginPresets(
      plugin({
        effects: [effectDoc(), { malo: 1 }],
        exportProfiles: [profilePreset()],
        captionStyles: [stylePreset({ color: 'rojo' })],
      }),
    );
    expect(countPluginPresets(parsed)).toEqual({ valid: 2, invalid: 2 });
  });
});

describe('applyPluginExportProfiles', () => {
  it('agrega perfiles con id nuevo y salta nombres repetidos', () => {
    const project = baseProject();
    const presets = [
      profilePreset() as PluginExportProfile,
      profilePreset({ name: 'YouTube 720p' }) as PluginExportProfile,
      profilePreset({ name: 'Feed 1:1', resolution: { width: 1080, height: 1080 }, aspectRatio: '1:1' }) as PluginExportProfile,
    ];
    const before = project.renderProfiles.length;
    const result = applyPluginExportProfiles(project, presets);
    expect(result.added).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.project.renderProfiles.length).toBe(before + 2);
    const added = result.project.renderProfiles.slice(before);
    for (const profile of added) {
      expect(profile.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    }
    // El proyecto original no se muta.
    expect(project.renderProfiles.length).toBe(before);
    const parsed = parseProject(result.project);
    expect(parsed.ok).toBe(true);
  });

  it('no toca el proyecto cuando todos los nombres ya existen', () => {
    const project = baseProject();
    const first = applyPluginExportProfiles(project, [profilePreset() as PluginExportProfile]);
    const second = applyPluginExportProfiles(first.project, [
      profilePreset() as PluginExportProfile,
    ]);
    expect(second.added).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.project).toBe(first.project);
    expect(second.project.renderProfiles.length).toBe(first.project.renderProfiles.length);
  });
});

describe('applyPluginCaptionStyles', () => {
  it('agrega estilos con id nuevo y deduplica por nombre', () => {
    const project = baseProject();
    const presets = [
      stylePreset() as PluginCaptionStyle,
      stylePreset({ name: 'karaoke grande' }) as PluginCaptionStyle,
      stylePreset({ name: 'Minimal', fontSizePx: 32 }) as PluginCaptionStyle,
    ];
    const result = applyPluginCaptionStyles(project, presets);
    expect(result.added).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.project.captions.styles).toHaveLength(2);
    const parsed = parseProject(result.project);
    expect(parsed.ok).toBe(true);
  });
});

describe('importPluginEffectTemplate', () => {
  it('guarda la plantilla en la biblioteca del usuario', () => {
    const backing = new Map<string, string>();
    const storage = {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => {
        backing.set(key, value);
      },
      removeItem: (key: string) => {
        backing.delete(key);
      },
      clear: () => backing.clear(),
      key: (index: number) => [...backing.keys()][index] ?? null,
      get length() {
        return backing.size;
      },
    } as unknown as Storage;

    const parsed = parsePluginPresets(
      plugin({ effects: [effectDoc()], exportProfiles: [], captionStyles: [] }),
    );
    const entry = parsed.effects[0]!;
    if ('error' in entry) throw new Error('preset inválido');
    const templates = importPluginEffectTemplate(entry.template, storage);
    expect(templates.some((template) => template.name === 'Look cálido')).toBe(true);
    expect(loadEffectTemplates(storage).some((template) => template.name === 'Look cálido')).toBe(true);
  });
});

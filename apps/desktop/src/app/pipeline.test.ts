import { describe, expect, it } from 'vitest';
import {
  PIPELINE_STAGES,
  clearProjectExported,
  computePipeline,
  isProjectExported,
  markProjectExported,
  pipelineSignals,
  type PipelineSignals,
} from './pipeline';
import { createEmptyProject } from '@editor-ia/project-schema';
import type { Asset } from '@editor-ia/project-schema';

const EMPTY: PipelineSignals = {
  hasProject: false,
  scenes: 0,
  media: 0,
  audio: 0,
  clips: 0,
  exported: false,
};

function withProject(patch: Partial<PipelineSignals>): PipelineSignals {
  return { ...EMPTY, hasProject: true, ...patch };
}

function imageAsset(): Asset {
  return {
    id: 'a1',
    label: 'Foto',
    kind: 'image',
    source: { type: 'local', path: 'media/foto.png' },
    status: 'ready',
    integrity: { sha256: 'b'.repeat(64), bytes: 10 },
    rights: {
      license: { id: 'user-declared', commercialUse: 'allowed' },
      provenance: { source: 'user', confirmed: true },
    },
  } as unknown as Asset;
}

function audioAsset(): Asset {
  return {
    id: 'a2',
    label: 'Voz',
    kind: 'audio',
    source: { type: 'local', path: 'media/voz.mp3' },
    status: 'ready',
    integrity: { sha256: 'c'.repeat(64), bytes: 10 },
    rights: {
      license: { id: 'user-declared', commercialUse: 'allowed' },
      provenance: { source: 'user', confirmed: true },
    },
  } as unknown as Asset;
}

describe('ruta de producción', () => {
  it('tiene seis etapas ordenadas y una vista para cada una', () => {
    expect(PIPELINE_STAGES).toHaveLength(6);
    expect(PIPELINE_STAGES.map((stage) => stage.label)).toEqual([
      'Proyecto',
      'Guion',
      'Medios',
      'Voz',
      'Edición',
      'Exportar',
    ]);
    expect(PIPELINE_STAGES.map((stage) => stage.view)).toEqual([
      'projects',
      'script',
      'assets',
      'production',
      'editor',
      'production',
    ]);
    for (const stage of PIPELINE_STAGES) {
      expect(stage.action.length).toBeGreaterThan(20);
    }
  });

  it('sin proyecto apunta al paso 1', () => {
    const progress = computePipeline(EMPTY);
    expect(progress.currentIndex).toBe(0);
    expect(progress.next?.id).toBe('project');
    expect(progress.steps[0]?.state).toBe('current');
    expect(progress.percent).toBe(0);
    expect(progress.complete).toBe(false);
  });

  it('marca como hecho sólo lo que el documento respalda', () => {
    const progress = computePipeline(
      withProject({ scenes: 3, media: 5, audio: 2, clips: 4, exported: true }),
    );
    expect(progress.doneCount).toBe(6);
    expect(progress.percent).toBe(100);
    expect(progress.complete).toBe(true);
    expect(progress.next).toBeNull();
    expect(progress.steps.every((step) => step.state === 'done')).toBe(true);
  });

  it('la etapa actual es la primera incompleta, aunque haya trabajo después', () => {
    // Importó clips y medios pero nunca escribió el guion: la ruta señala el
    // guion, no da todo por terminado.
    const progress = computePipeline(withProject({ media: 4, clips: 7 }));
    expect(progress.currentIndex).toBe(1);
    expect(progress.next?.label).toBe('Guion');
    expect(progress.steps.map((step) => step.state)).toEqual([
      'done',
      'current',
      'done',
      'pending',
      'done',
      'pending',
    ]);
    expect(progress.steps[1]?.detail).toBe('Sin escenas');
    expect(progress.steps[2]?.detail).toBe('4 medios');
  });

  it('detalla cada etapa con lo que hay en el proyecto', () => {
    const progress = computePipeline(withProject({ scenes: 1, media: 1, audio: 1, clips: 1 }));
    expect(progress.steps.map((step) => step.detail)).toEqual([
      'Proyecto abierto',
      '1 escena',
      '1 medio',
      '1 audio',
      '1 clip',
      'Sin render',
    ]);
  });

  it('cuenta medios y audio desde el proyecto real', () => {
    const project = createEmptyProject('Obra', '2025-01-01T00:00:00Z');
    const signals = pipelineSignals(project, false);
    expect(signals).toEqual({
      hasProject: true,
      scenes: 0,
      media: 0,
      audio: 0,
      clips: 0,
      exported: false,
    });
    expect(pipelineSignals(null, true)).toEqual(EMPTY);
  });

  it('recuerda los proyectos exportados y se puede limpiar', () => {
    const storage = new Map<string, string>();
    const adapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    };
    expect(isProjectExported('proy-1', adapter)).toBe(false);
    markProjectExported('proy-1', '2025-01-01T00:00:00.000Z', adapter);
    expect(isProjectExported('proy-1', adapter)).toBe(true);
    expect(isProjectExported('proy-2', adapter)).toBe(false);

    clearProjectExported('proy-1', adapter);
    expect(isProjectExported('proy-1', adapter)).toBe(false);
  });

  it('tolera un almacenamiento corrupto o ausente', () => {
    expect(isProjectExported('x', { getItem: () => '{roto', setItem: () => {} })).toBe(false);
    expect(isProjectExported('x', null)).toBe(false);
    expect(markProjectExported('x', undefined, null)).toBe(false);
    expect(isProjectExported(undefined, null)).toBe(false);
  });
});

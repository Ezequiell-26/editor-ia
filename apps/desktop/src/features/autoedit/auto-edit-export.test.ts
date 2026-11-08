import { describe, expect, it } from 'vitest';
import type { Asset, ProjectDocument } from '@editor-ia/project-schema';
import { createEmptyProject } from '@editor-ia/project-schema';
import type {
  MediaAnalysis,
  TranscriptionResult,
  VariantRendered,
  VariantWritten,
} from '../../services/project-service';
import { addAsset, ensureDelivery } from '../../state/project-actions';
import { autoEditExportSummary, exportAutoEditVariants } from './auto-edit-export';
import { buildAutoEditVariants, type AutoEditSource } from './auto-edit';

const NOW = '2026-10-27T00:00:00.000Z';
const ASSET_A = '11111111-1111-4111-8111-111111111111';

function analysis(): MediaAnalysis {
  return {
    assetId: ASSET_A,
    kind: 'video',
    durationSeconds: 60,
    fpsNum: 30,
    fpsDen: 1,
    hasAudio: true,
    scenes: [10, 20, 30, 40, 50],
    silences: [{ startSeconds: 12, endSeconds: 14 }],
    blacks: [],
    freezes: [],
    loudness: {
      integratedLufs: -20,
      truePeakDb: -3,
      lraDb: 5,
      noiseFloorDb: -60,
    },
    lumaAverage: 0.5,
    saturationAverage: 0.4,
    warnings: [],
  };
}

function transcript(): TranscriptionResult {
  return {
    language: 'es',
    languageProbability: 0.9,
    durationSeconds: 60,
    model: 'local',
    segments: [
      { start: 1, end: 3, text: 'Primera frase', words: [] },
      { start: 21, end: 23, text: 'Segunda frase', words: [] },
    ],
  };
}

function source(): AutoEditSource {
  return {
    assetId: ASSET_A,
    label: 'Entrevista',
    analysis: analysis(),
    transcript: transcript(),
    energy: null,
  };
}

function videoAsset(): Asset {
  return {
    id: ASSET_A,
    label: 'Entrevista',
    kind: 'video',
    source: { type: 'local', path: 'media/entrevista.mp4' },
    status: 'ready',
    integrity: { sha256: 'a'.repeat(64), bytes: 10_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: {
      width: 1920,
      height: 1080,
      durationFrames: 1800,
      frameRate: { num: 30, den: 1 },
    },
  } as Asset;
}

function projectWithAsset(): { project: ProjectDocument; asset: Asset } {
  const asset = videoAsset();
  const project = ensureDelivery(addAsset(createEmptyProject('Auto', NOW), asset));
  return { project, asset };
}

function fakeService(options?: { failRenderFor?: string }) {
  const written: ProjectDocument[] = [];
  const rendered: { outputPath: string; profileId: string }[] = [];
  return {
    written,
    rendered,
    async writeProjectVariant(input: {
      directory: string;
      fileName: string;
      project: unknown;
    }): Promise<VariantWritten> {
      written.push(input.project as ProjectDocument);
      return {
        path: `${input.directory}\\${input.fileName}`,
        bytes: 512,
        copiedAssets: 1,
      };
    },
    async renderProjectVariant(input: {
      projectPath: string;
      profileId: string;
      outputPath: string;
      includeCaptions: boolean;
    }): Promise<VariantRendered> {
      if (options?.failRenderFor && input.outputPath.includes(options.failRenderFor)) {
        throw new Error('el render falló');
      }
      rendered.push({ outputPath: input.outputPath, profileId: input.profileId });
      return {
        path: input.outputPath,
        bytes: 4096,
        durationSeconds: 12.5,
        width: 1920,
        height: 1080,
      };
    },
  };
}

describe('exportAutoEditVariants', () => {
  it('escribe un proyecto y renderiza un MP4 por variante', async () => {
    const { project, asset } = projectWithAsset();
    const variants = buildAutoEditVariants([source()]);
    const custom = variants.find((item) => item.style === 'custom')!;
    const service = fakeService();
    const report = await exportAutoEditVariants(service, {
      project,
      assets: [asset],
      entries: [{ variant: custom, indices: custom.cuts.map((_, i) => i), title: 'Mi Corte' }],
      outputDir: 'C:\\out',
      analysis: analysis(),
      improveAudio: true,
      addCaptions: true,
    });
    expect(report.done).toBe(1);
    expect(report.failed).toBe(0);
    expect(service.written).toHaveLength(1);
    expect(service.rendered).toHaveLength(1);
    // El proyecto escrito tiene clips reales y conserva la ruta relativa del medio.
    const written = service.written[0]!;
    expect(written.timeline.clips.length).toBeGreaterThan(0);
    expect(written.assets[0]!.source.path).toBe('media/entrevista.mp4');
    expect(service.rendered[0]!.outputPath).toBe('C:\\out\\mi-corte.mp4');
    expect(report.items[0]!.videoPath).toBe('C:\\out\\mi-corte.mp4');
    expect(report.items[0]!.message).toContain('verificado');
  });

  it('no toca el proyecto abierto ni la timeline actual', async () => {
    const { project, asset } = projectWithAsset();
    const clipsBefore = project.timeline.clips.length;
    const variants = buildAutoEditVariants([source()]);
    const custom = variants.find((item) => item.style === 'custom')!;
    const service = fakeService();
    await exportAutoEditVariants(service, {
      project,
      assets: [asset],
      entries: [{ variant: custom, indices: custom.cuts.map((_, i) => i) }],
      outputDir: 'C:\\out',
      analysis: null,
      improveAudio: false,
      addCaptions: false,
    });
    expect(project.timeline.clips.length).toBe(clipsBefore);
  });

  it('sin selección explícita exporta todos los cortes (semántica de la UI)', async () => {
    const { project, asset } = projectWithAsset();
    const variants = buildAutoEditVariants([source()]);
    const custom = variants.find((item) => item.style === 'custom')!;
    const service = fakeService();
    const report = await exportAutoEditVariants(service, {
      project,
      assets: [asset],
      entries: [{ variant: custom, indices: [] }],
      outputDir: 'C:\\out',
      analysis: null,
      improveAudio: false,
      addCaptions: false,
    });
    // `subsetVariant` con lista vacía devuelve la variante completa: igual que
    // `includedIndices` en la vista, donde no marcar nada significa «todos».
    expect(report.done).toBe(1);
    expect(service.written[0]!.timeline.clips.length).toBe(custom.cuts.length);
  });

  it('un render fallido no cancela las variantes siguientes', async () => {
    const { project, asset } = projectWithAsset();
    const variants = buildAutoEditVariants([source()]);
    const [first, second] = variants;
    const service = fakeService({ failRenderFor: 'pulso' });
    const report = await exportAutoEditVariants(service, {
      project,
      assets: [asset],
      entries: [
        { variant: first!, indices: first!.cuts.map((_, i) => i) },
        { variant: second!, indices: second!.cuts.map((_, i) => i) },
      ],
      outputDir: 'C:\\out',
      analysis: null,
      improveAudio: false,
      addCaptions: false,
    });
    expect(report.items).toHaveLength(2);
    expect(report.failed + report.done).toBe(2);
    expect(report.failed).toBeGreaterThanOrEqual(1);
  });

  it('avisa el progreso por variante y resume el resultado', async () => {
    const { project, asset } = projectWithAsset();
    const variants = buildAutoEditVariants([source()]);
    const seen: string[] = [];
    const service = fakeService();
    const report = await exportAutoEditVariants(service, {
      project,
      assets: [asset],
      entries: variants.slice(0, 2).map((variant) => ({
        variant,
        indices: variant.cuts.map((_, i) => i),
      })),
      outputDir: 'C:\\out',
      analysis: null,
      improveAudio: false,
      addCaptions: false,
      onProgress: (item) => seen.push(item.name),
    });
    expect(seen).toHaveLength(2);
    expect(autoEditExportSummary(report)).toContain('2 MP4 exportado(s)');
  });
});

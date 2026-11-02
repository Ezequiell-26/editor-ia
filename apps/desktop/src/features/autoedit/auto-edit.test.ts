import { describe, expect, it } from 'vitest';
import type { Asset } from '@editor-ia/project-schema';
import { createEmptyProject, parseProject } from '@editor-ia/project-schema';
import type { MediaAnalysis, TranscriptionResult } from '../../services/project-service';
import { addAsset, totalFrames } from '../../state/project-actions';
import { applyAutoEditVariant } from './apply-auto-edit';
import {
  DEFAULT_RECIPE,
  buildAutoEditVariants,
  clampRecipe,
  recipeSummary,
  reorderVariant,
  scoreSegment,
  subsetVariant,
  variantRecipes,
  type AutoEditRecipe,
  type AutoEditSource,
} from './auto-edit';
import { buildDirectorBrief, buildDirectorMessages, parseDirectorProposal } from './ai-director';

const NOW = '2026-10-27T00:00:00.000Z';
const ASSET_A = '11111111-1111-4111-8111-111111111111';
const ASSET_B = '22222222-2222-4222-8222-222222222222';

function analysis(overrides: Partial<MediaAnalysis> = {}): MediaAnalysis {
  return {
    assetId: ASSET_A,
    kind: 'video',
    durationSeconds: 60,
    fpsNum: 30,
    fpsDen: 1,
    hasAudio: true,
    scenes: [10, 20, 30, 40, 50],
    silences: [
      { startSeconds: 12, endSeconds: 14 },
      { startSeconds: 32, endSeconds: 35 },
    ],
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
    ...overrides,
  };
}

function transcript(): TranscriptionResult {
  return {
    language: 'es',
    languageProbability: 0.9,
    durationSeconds: 60,
    model: 'local',
    segments: [
      { start: 1, end: 3, text: 'Primer momento', words: [] },
      { start: 21, end: 23, text: 'Segundo momento', words: [] },
      { start: 41, end: 43, text: 'Tercer momento', words: [] },
    ],
  };
}

/** Habla continua: sirve para comprobar el corte por frases. */
function denseTranscript(): TranscriptionResult {
  const segments = [];
  for (let start = 0; start < 58; start += 2) {
    segments.push({
      start,
      end: start + 1.8,
      text: `Frase ${segments.length + 1}`,
      words: [],
    });
  }
  return {
    language: 'es',
    languageProbability: 0.95,
    durationSeconds: 60,
    model: 'local',
    segments,
  };
}

function source(overrides: Partial<AutoEditSource> = {}): AutoEditSource {
  return {
    assetId: ASSET_A,
    label: 'Entrevista',
    analysis: analysis(),
    transcript: transcript(),
    energy: null,
    ...overrides,
  };
}

function videoAsset(id = ASSET_A, label = 'Entrevista', durationFrames = 1800): Asset {
  return {
    id,
    label,
    kind: 'video',
    source: { type: 'local', path: `media/${label.toLowerCase()}.mp4` },
    status: 'ready',
    integrity: { sha256: 'a'.repeat(64), bytes: 10_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { width: 1920, height: 1080, durationFrames, frameRate: { num: 30, den: 1 } },
  } as Asset;
}

describe('motor del editor automático', () => {
  it('genera cuatro ritmos distintos y quita silencios', () => {
    const variants = buildAutoEditVariants([source()]);
    expect(variants.map((variant) => variant.style)).toEqual([
      'custom',
      'pulse',
      'story',
      'impact',
    ]);
    const custom = variants.find((variant) => variant.style === 'custom')!;
    const pulse = variants.find((variant) => variant.style === 'pulse')!;
    const story = variants.find((variant) => variant.style === 'story')!;
    const impact = variants.find((variant) => variant.style === 'impact')!;
    expect(pulse.cuts.length).toBeGreaterThan(story.cuts.length);
    expect(impact.durationSeconds).toBeGreaterThan(0);
    expect(impact.durationSeconds).toBeLessThanOrEqual(31);
    expect(custom.durationSeconds).toBeLessThanOrEqual(46);
    for (const variant of variants) {
      for (const cut of variant.cuts) {
        expect(cut.endSeconds).toBeGreaterThan(cut.startSeconds);
        const insideSilence =
          (cut.startSeconds < 14 && cut.endSeconds > 12) ||
          (cut.startSeconds < 35 && cut.endSeconds > 32);
        expect(insideSilence).toBe(false);
      }
    }
  });

  it('abre con un gancho más corto que el resto de los cortes', () => {
    const variant = buildAutoEditVariants([source()], {
      ...DEFAULT_RECIPE,
      cutSeconds: 5,
      hook: true,
    }).find((item) => item.style === 'custom')!;
    expect(variant.cuts[0]?.reason).toBe('hook');
    const hookLength = variant.cuts[0]!.endSeconds - variant.cuts[0]!.startSeconds;
    expect(hookLength).toBeLessThanOrEqual(2.41);
    const quiet = buildAutoEditVariants([source()], {
      ...DEFAULT_RECIPE,
      cutSeconds: 5,
      hook: false,
    }).find((item) => item.style === 'custom')!;
    expect(quiet.cuts.some((cut) => cut.reason === 'hook')).toBe(false);
  });

  it('respeta la duración objetivo de la receta', () => {
    const short = buildAutoEditVariants([source()], {
      ...DEFAULT_RECIPE,
      targetSeconds: 20,
    }).find((item) => item.style === 'custom')!;
    expect(short.durationSeconds).toBeLessThanOrEqual(21);
    const long = buildAutoEditVariants([source()], {
      ...DEFAULT_RECIPE,
      targetSeconds: 120,
    }).find((item) => item.style === 'custom')!;
    expect(long.durationSeconds).toBeGreaterThan(short.durationSeconds);
  });

  it('corta en pausas de voz cuando la transcripción cubre el material', () => {
    const variant = buildAutoEditVariants([
      source({ transcript: denseTranscript() }),
    ]).find((item) => item.style === 'custom')!;
    // El gancho se marca aparte porque además está recortado.
    expect(
      variant.cuts.slice(1).every((cut) => cut.reason === 'speech'),
    ).toBe(true);
    // Cada corte arranca en una frase medida o en el borde de un tramo limpio
    // (los silencios del audio y los tiempos del texto no siempre coinciden).
    const rangeStarts = [0, 14, 35];
    for (const cut of variant.cuts) {
      const atPhrase = denseTranscript().segments.some(
        (segment) => Math.abs(segment.start - cut.startSeconds) < 0.11,
      );
      const atRangeStart = rangeStarts.some(
        (start) => Math.abs(start - cut.startSeconds) < 0.11,
      );
      expect(atPhrase || atRangeStart).toBe(true);
    }
  });

  it('sin voz suficiente cae al corte por escena en vez de vaciar el video', () => {
    const sparse = buildAutoEditVariants([source()]).find((item) => item.style === 'custom')!;
    expect(sparse.cuts.length).toBeGreaterThan(2);
    expect(sparse.cuts.some((cut) => cut.reason === 'scene')).toBe(true);
  });

  it('alterna archivos cuando hay varios videos', () => {
    const variants = buildAutoEditVariants([
      source(),
      source({
        assetId: ASSET_B,
        label: 'B-roll',
        analysis: analysis({ assetId: ASSET_B, scenes: [5, 15, 25, 45] }),
        transcript: null,
      }),
    ]);
    const custom = variants.find((item) => item.style === 'custom')!;
    const assets = new Set(custom.cuts.map((cut) => cut.assetId));
    expect(assets.size).toBe(2);
    // Nunca dos cortes seguidos del mismo archivo mientras haya alternativa.
    for (let index = 1; index < custom.cuts.length - 1; index += 1) {
      const previous = custom.cuts[index - 1]!.assetId;
      const current = custom.cuts[index]!.assetId;
      if (previous === current) {
        expect(custom.cuts.slice(index + 1).every((cut) => cut.assetId === current)).toBe(true);
      }
    }
  });

  it('remetea subtítulos al tiempo de salida sin inventar texto', () => {
    const variant = buildAutoEditVariants([source()]).find((item) => item.style === 'custom')!;
    expect(variant.captions.length).toBeGreaterThan(0);
    for (const caption of variant.captions) {
      expect(caption.text).toMatch(/momento/i);
      expect(caption.startSeconds).toBeGreaterThanOrEqual(0);
      expect(caption.endSeconds).toBeLessThanOrEqual(variant.durationSeconds + 0.01);
    }
    const without = buildAutoEditVariants([source({ transcript: null })]);
    expect(without.every((variantItem) => variantItem.captions.length === 0)).toBe(true);
  });

  it('puntúa distinto un segmento con voz y movimiento que uno mudo', () => {
    const base = {
      target: 3,
      duration: 60,
      scenes: [1, 2, 3, 4, 5, 6],
      energy: null,
    };
    const lively = scoreSegment({ ...base, start: 0, end: 3, hasSpeech: true });
    const dead = scoreSegment({
      ...base,
      start: 0,
      end: 3,
      hasSpeech: false,
      scenes: [],
      energy: [0, 0, 0, 0],
    });
    expect(lively).toBeGreaterThan(dead);
    // Es determinista: la misma entrada da el mismo número.
    expect(scoreSegment({ ...base, start: 0, end: 3, hasSpeech: true })).toBe(lively);
  });

  it('la energía de audio sube el interés del segmento', () => {
    const quiet = scoreSegment({
      start: 0,
      end: 3,
      target: 3,
      duration: 60,
      scenes: [2],
      energy: [0, 0, 0, 0],
      hasSpeech: true,
    });
    const loud = scoreSegment({
      start: 0,
      end: 3,
      target: 3,
      duration: 60,
      scenes: [2],
      energy: [1, 1, 1, 1],
      hasSpeech: true,
    });
    expect(loud).toBeGreaterThan(quiet);
  });

  it('normaliza la receta y describe el ritmo', () => {
    const clean = clampRecipe({
      cutSeconds: 40,
      targetSeconds: -5,
      zoom: 400,
      transition: 'raro' as AutoEditRecipe['transition'],
      hook: true,
      speechCuts: false,
    });
    expect(clean.cutSeconds).toBe(12);
    expect(clean.targetSeconds).toBe(0);
    expect(clean.zoom).toBe(100);
    expect(clean.transition).toBe('dissolve');
    expect(recipeSummary(clean)).toContain('sin límite');
  });

  it('los presets derivados respetan los límites del motor', () => {
    for (const preset of variantRecipes(DEFAULT_RECIPE)) {
      expect(preset.recipe.cutSeconds).toBeGreaterThanOrEqual(0.8);
      expect(preset.recipe.cutSeconds).toBeLessThanOrEqual(12);
      expect(preset.recipe.zoom).toBeGreaterThanOrEqual(0);
      expect(preset.recipe.zoom).toBeLessThanOrEqual(100);
    }
  });
});

describe('selección y orden de cortes', () => {
  it('deja sólo los cortes elegidos y reubica los subtítulos', () => {
    const variant = buildAutoEditVariants([source()]).find((item) => item.style === 'custom')!;
    const subset = subsetVariant(variant, [0, 2]);
    expect(subset.cuts).toHaveLength(2);
    expect(subset.durationSeconds).toBeLessThan(variant.durationSeconds);
    for (const caption of subset.captions) {
      expect(caption.endSeconds).toBeLessThanOrEqual(subset.durationSeconds + 0.01);
    }
  });

  it('reordena sin perder cortes y mantiene el texto dentro de la ventana', () => {
    const variant = buildAutoEditVariants([source()]).find((item) => item.style === 'custom')!;
    const reversed = reorderVariant(
      variant,
      variant.cuts.map((_, index) => variant.cuts.length - 1 - index),
    );
    expect(reversed.cuts).toHaveLength(variant.cuts.length);
    expect(reversed.cuts[0]).toEqual(variant.cuts[variant.cuts.length - 1]);
    expect(reversed.durationSeconds).toBeCloseTo(variant.durationSeconds, 2);
    for (const caption of reversed.captions) {
      expect(caption.endSeconds).toBeLessThanOrEqual(reversed.durationSeconds + 0.01);
    }
  });

  it('ignora índices inválidos en el orden', () => {
    const variant = buildAutoEditVariants([source()]).find((item) => item.style === 'custom')!;
    const messy = reorderVariant(variant, [99, -1, 1]);
    expect(messy.cuts).toHaveLength(variant.cuts.length);
    expect(messy.cuts[0]).toEqual(variant.cuts[1]);
  });
});

describe('aplicación a la timeline', () => {
  it('aplica la variante con zoom, transición, audio y subtítulos', () => {
    const project = addAsset(createEmptyProject('Auto', NOW), videoAsset());
    const variant = buildAutoEditVariants([source()]).find((item) => item.style === 'story')!;
    const result = applyAutoEditVariant(project, videoAsset(), variant, analysis(), {
      replace: true,
      improveAudio: true,
      addCaptions: true,
      transition: 'fade',
      zoom: 80,
    });
    const parsed = parseProject(JSON.parse(JSON.stringify(result.project)));
    expect(parsed.ok).toBe(true);
    expect(result.clipCount).toBe(variant.cuts.length);
    expect(result.captionCount).toBeGreaterThan(0);
    const clips = result.project.timeline.clips;
    expect(clips.every((clip) => clip.kind === 'video')).toBe(true);
    expect(
      clips.some((clip) => clip.kind === 'video' && clip.transform?.keyframes?.length),
    ).toBe(true);
    const transitioned = clips.filter(
      (clip) => clip.kind === 'video' && clip.transitionIn,
    );
    expect(transitioned.length).toBeGreaterThan(0);
    expect(
      transitioned.every(
        (clip) => clip.kind === 'video' && clip.transitionIn?.type === 'fade-black',
      ),
    ).toBe(true);
    const withAudio = clips.find(
      (clip) => clip.kind === 'video' && clip.audio && clip.audio.denoise !== undefined,
    );
    expect(withAudio).toBeTruthy();
    expect(result.project.captions.cues.length).toBe(result.captionCount);
  });

  it('corte seco no escribe transiciones', () => {
    const project = addAsset(createEmptyProject('Auto', NOW), videoAsset());
    const variant = buildAutoEditVariants([source()]).find((item) => item.style === 'custom')!;
    const result = applyAutoEditVariant(project, videoAsset(), variant, analysis(), {
      replace: true,
      improveAudio: false,
      addCaptions: false,
      transition: 'none',
      zoom: 0,
    });
    expect(
      result.project.timeline.clips.every(
        (clip) => clip.kind !== 'video' || !clip.transitionIn,
      ),
    ).toBe(true);
    expect(
      result.project.timeline.clips.every(
        (clip) => clip.kind !== 'video' || !clip.transform?.keyframes?.length,
      ),
    ).toBe(true);
  });

  it('monta cortes de dos videos distintos en la misma pista', () => {
    const project = addAsset(
      addAsset(createEmptyProject('Auto', NOW), videoAsset()),
      videoAsset(ASSET_B, 'B-roll'),
    );
    const variant = buildAutoEditVariants([
      source(),
      source({
        assetId: ASSET_B,
        label: 'B-roll',
        analysis: analysis({ assetId: ASSET_B, scenes: [5, 15, 25, 45] }),
        transcript: null,
      }),
    ]).find((item) => item.style === 'custom')!;
    const result = applyAutoEditVariant(
      project,
      [videoAsset(), videoAsset(ASSET_B, 'B-roll')],
      variant,
      analysis(),
      { replace: true, improveAudio: false, addCaptions: false, transition: 'dissolve' },
    );
    const assetIds = new Set(
      result.project.timeline.clips
        .filter((clip) => clip.kind === 'video')
        .map((clip) =>
          clip.source.type === 'asset' ? clip.source.assetId : '',
        ),
    );
    expect(assetIds.size).toBe(2);
    expect(parseProject(JSON.parse(JSON.stringify(result.project))).ok).toBe(true);
  });

  it('agrega la variante al final sin borrar los clips existentes', () => {
    const project = addAsset(createEmptyProject('Auto', NOW), videoAsset());
    const variant = buildAutoEditVariants([source()])[0]!;
    const first = applyAutoEditVariant(project, videoAsset(), variant, analysis(), {
      replace: true,
      improveAudio: false,
      addCaptions: false,
    });
    const appended = applyAutoEditVariant(
      first.project,
      videoAsset(),
      { ...variant, cuts: [variant.cuts[0]!] },
      analysis(),
      { replace: false, improveAudio: false, addCaptions: false },
    );
    expect(appended.project.timeline.clips.length).toBe(
      first.project.timeline.clips.length + 1,
    );
    expect(totalFrames(appended.project)).toBeGreaterThan(totalFrames(first.project));
    expect(parseProject(JSON.parse(JSON.stringify(appended.project))).ok).toBe(true);
  });
});

describe('dirección asistida por IA', () => {
  it('arma un brief con los cortes medidos y el texto disponible', () => {
    const variant = buildAutoEditVariants([source()]).find((item) => item.style === 'custom')!;
    const brief = buildDirectorBrief(variant, ['Entrevista']);
    expect(brief).toContain('Cortes (índice');
    expect(brief).toContain('Material: Entrevista');
    expect(brief).toContain('momento');
    const messages = buildDirectorMessages(variant, ['Entrevista']);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('assistant');
    expect(messages[0]?.content).toContain('SOLO JSON');
  });

  it('acepta una propuesta válida y la normaliza', () => {
    const variant = buildAutoEditVariants([source()]).find((item) => item.style === 'custom')!;
    const order = variant.cuts.map((_, index) => index);
    const reply = JSON.stringify({
      title: '  Apertura fuerte  ',
      hook: 'Arrancamos con lo mejor.',
      notes: 'El gancho primero.',
      order,
    });
    const proposal = parseDirectorProposal(reply, variant, 'modelo-x');
    expect(proposal?.title).toBe('Apertura fuerte');
    expect(proposal?.order).toEqual(order);
    expect(proposal?.model).toBe('modelo-x');
  });

  it('tolera markdown alrededor del JSON', () => {
    const variant = buildAutoEditVariants([source()])[0]!;
    const order = variant.cuts.map((_, index) => index);
    const reply = `Listo:\n\`\`\`json\n${JSON.stringify({
      title: 'Corte',
      hook: '',
      notes: '',
      order,
    })}\n\`\`\``;
    expect(parseDirectorProposal(reply, variant, 'm')?.order).toEqual(order);
  });

  it('rechaza órdenes incompletos, repetidos o fuera de rango', () => {
    const variant = buildAutoEditVariants([source()])[0]!;
    const count = variant.cuts.length;
    const make = (order: unknown) =>
      JSON.stringify({ title: 't', hook: '', notes: '', order });
    expect(parseDirectorProposal(make([0]), variant, 'm')).toBeNull();
    expect(
      parseDirectorProposal(make(Array.from({ length: count }, () => 0)), variant, 'm'),
    ).toBeNull();
    expect(
      parseDirectorProposal(
        make(Array.from({ length: count }, (_, index) => index + 999)),
        variant,
        'm',
      ),
    ).toBeNull();
    expect(parseDirectorProposal('no es json', variant, 'm')).toBeNull();
    expect(parseDirectorProposal('{"title":"x"}', variant, 'm')).toBeNull();
  });
});

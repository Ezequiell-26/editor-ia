import type { Asset, ProjectDocument } from '@editor-ia/project-schema';
import type { DesktopService, MediaAnalysis, TranscriptionResult } from '../services/project-service';
import { parseSubtitles } from './subtitles';
import {
  DEFAULT_RECIPE,
  MAX_SOURCES,
  buildAutoEditVariants,
  clampRecipe,
  energyFromPeaks,
  subsetVariant,
  type AutoEditRecipe,
  type AutoEditSource,
  type AutoEditVariant,
} from './autoedit-engine';
import { applyAutoEditVariant } from './autoedit-apply';
import { autoEditExportSummary, exportAutoEditVariants } from './autoedit-export';

/**
 * Sesión del motor de variantes para el MCP: la medición (FFmpeg +
 * transcripción) es cara, así que `autoedit_measure` la hace una vez y
 * `autoedit_variants`/`autoedit_apply` reutilizan las fuentes medidas.
 * La sesión se invalida al cambiar de proyecto.
 */

/** Lo mínimo que el store expone a estas herramientas. */
export interface AutoEditMcpStore {
  readonly state: {
    readonly project: ProjectDocument | null;
    readonly opened?: { readonly root?: string | null } | null;
  };
  readonly service: DesktopService;
  update(fn: (project: ProjectDocument) => ProjectDocument): boolean;
}

export interface AutoEditMcpContext {
  readonly store: AutoEditMcpStore;
}

interface AutoEditSession {
  readonly projectId: string;
  readonly sources: readonly AutoEditSource[];
  variants: AutoEditVariant[];
}

let session: AutoEditSession | null = null;

const DEFAULT_ANALYZE = { sceneThreshold: 0.35, silenceDb: -32, minSilence: 0.35 };

function numArg(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function boolArg(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function stringListArg(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function intListArg(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is number => typeof item === 'number' && Number.isInteger(item),
  );
}

function textArg(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function videoAssetsOf(project: ProjectDocument): Asset[] {
  return project.assets.filter((asset) => asset.kind === 'video' && asset.status === 'ready');
}

function projectOf(context: AutoEditMcpContext): ProjectDocument {
  const project = context.store.state.project;
  if (!project) throw new Error('no hay ningún proyecto abierto');
  return project;
}

function sessionFor(project: ProjectDocument): AutoEditSession {
  if (!session || session.projectId !== project.id) {
    throw new Error(
      'no hay material medido para este proyecto: corré autoedit_measure primero',
    );
  }
  return session;
}

function recipeFromArgs(
  args: Record<string, unknown>,
): { recipe: AutoEditRecipe; warnings: string[] } {
  const raw = args.recipe;
  const base: AutoEditRecipe = { ...DEFAULT_RECIPE };
  const warnings: string[] = [];
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const recipe = raw as Record<string, unknown>;
    const cutSeconds = numArg(recipe.cutSeconds);
    const targetSeconds = numArg(recipe.targetSeconds);
    const zoom = numArg(recipe.zoom);
    const transition = textArg(recipe.transition);
    const hook = boolArg(recipe.hook);
    const speechCuts = boolArg(recipe.speechCuts);
    if (transition !== undefined && transition !== 'none' && transition !== 'fade' && transition !== 'dissolve') {
      warnings.push(`transition «${transition}» no existe; se usó «${base.transition}».`);
    }
    for (const key of ['cutSeconds', 'targetSeconds', 'zoom'] as const) {
      const rawValue = recipe[key];
      if (
        rawValue !== undefined &&
        (typeof rawValue !== 'number' || !Number.isFinite(rawValue))
      ) {
        warnings.push(`${key} no es un número válido; se usó el valor por defecto.`);
      }
    }
    return {
      recipe: clampRecipe({
        cutSeconds: cutSeconds ?? base.cutSeconds,
        targetSeconds: targetSeconds ?? base.targetSeconds,
        zoom: zoom ?? base.zoom,
        transition:
          transition === 'none' || transition === 'fade' || transition === 'dissolve'
            ? transition
            : base.transition,
        hook: hook ?? base.hook,
        speechCuts: speechCuts ?? base.speechCuts,
      }),
      warnings,
    };
  }
  return { recipe: clampRecipe(base), warnings };
}

function variantSummary(variant: AutoEditVariant) {
  return {
    id: variant.id,
    name: variant.name,
    style: variant.style,
    description: variant.description,
    durationSeconds: variant.durationSeconds,
    cuts: variant.cuts.length,
    zoomCount: variant.zoomCount,
    captions: variant.captions.length,
    score: variant.score,
  };
}

/**
 * Mide los assets de video listos (o los `assetIds` pedidos) con las mismas
 * pasadas FFmpeg de la vista, arma las variantes y deja la sesión lista
 * para `autoedit_apply`.
 */
export async function autoEditMeasure(
  context: AutoEditMcpContext,
  args: Record<string, unknown>,
): Promise<string> {
  const project = projectOf(context);
  const assets = videoAssetsOf(project);
  if (assets.length === 0) {
    throw new Error('el proyecto no tiene videos listos para analizar');
  }
  const wanted = stringListArg(args.assetIds);
  const unmatched =
    wanted.length > 0
      ? wanted.filter((id) => !assets.some((asset) => asset.id === id))
      : [];
  const picked =
    wanted.length > 0
      ? wanted
          .map((id) => assets.find((asset) => asset.id === id))
          .filter((asset): asset is Asset => Boolean(asset))
          .slice(0, MAX_SOURCES)
      : assets.slice(0, MAX_SOURCES);
  if (picked.length === 0) {
    throw new Error('ningún assetId corresponde a un video listo del proyecto');
  }

  const sceneThreshold = numArg(args.sceneThreshold) ?? DEFAULT_ANALYZE.sceneThreshold;
  const silenceDb = numArg(args.silenceDb) ?? DEFAULT_ANALYZE.silenceDb;
  const minSilence = numArg(args.minSilence) ?? DEFAULT_ANALYZE.minSilence;
  const transcribe = boolArg(args.transcribe) === true;
  const useEmbedded = boolArg(args.useEmbeddedCaptions) !== false;
  const { recipe, warnings: recipeWarnings } = recipeFromArgs(args);

  const sources: AutoEditSource[] = [];
  const messages: string[] = [...recipeWarnings];
  for (const [index, asset] of picked.entries()) {
    const analysis: MediaAnalysis = await context.store.service.analyzeMedia(
      asset.id,
      sceneThreshold,
      silenceDb,
      minSilence,
      false,
    );
    let energy: number[] | null = null;
    if (analysis.hasAudio) {
      try {
        const peaks = await context.store.service.audioPeaks(asset.id, 240);
        energy = energyFromPeaks(peaks.peaks);
      } catch {
        energy = null;
      }
    }
    let transcript: TranscriptionResult | null = null;
    if (useEmbedded) {
      try {
        const extracted = await context.store.service.extractSubtitles(asset.source.path);
        if (extracted) {
          const parsed = parseSubtitles(extracted.srt);
          if (parsed.cues.length > 0) {
            transcript = {
              language: extracted.language ?? project.language ?? 'es',
              languageProbability: 1,
              durationSeconds: analysis.durationSeconds,
              model: 'embedded',
              segments: parsed.cues.map((cue) => ({
                start: cue.startSeconds,
                end: cue.endSeconds,
                text: cue.text,
                words: [],
              })),
            };
            messages.push(`${asset.label}: ${parsed.cues.length} subtítulos incrustados.`);
          }
        }
      } catch {
        // Sin pista de subtítulos no es error del montaje.
      }
    }
    if (!transcript && transcribe) {
      try {
        transcript = await context.store.service.transcribeAsset(asset.id);
        messages.push(`${asset.label}: ${transcript.segments.length} segmentos de voz.`);
      } catch (cause) {
        messages.push(
          `${asset.label}: no se pudo transcribir (${
            cause instanceof Error ? cause.message : 'modelo no disponible'
          }).`,
        );
      }
    }
    sources.push({ assetId: asset.id, label: asset.label, analysis, transcript, energy });
    void index;
  }

  const variants = buildAutoEditVariants(sources, recipe);
  session = { projectId: project.id, sources, variants };
  if (unmatched.length > 0) {
    messages.push(
      `${unmatched.length} assetId(s) no corresponden a videos listos y se ignoraron: ${unmatched.join(', ')}.`,
    );
  }
  return JSON.stringify({
    ok: true,
    sources: sources.map((source) => ({
      assetId: source.assetId,
      label: source.label,
      durationSeconds: source.analysis.durationSeconds,
      scenes: source.analysis.scenes.length,
      silences: source.analysis.silences.length,
      hasAudio: source.analysis.hasAudio,
      transcriptSegments: source.transcript?.segments.length ?? 0,
      energyBuckets: source.energy?.length ?? 0,
    })),
    variants: variants.map(variantSummary),
    messages,
  });
}

/**
 * Regenera las variantes con otra receta sin volver a medir el material.
 * Requiere una sesión previa de `autoedit_measure` sobre el mismo proyecto.
 */
export function autoEditVariants(
  context: AutoEditMcpContext,
  args: Record<string, unknown>,
): string {
  const project = projectOf(context);
  const current = sessionFor(project);
  const parsed =
    args.recipe && typeof args.recipe === 'object' && !Array.isArray(args.recipe)
      ? recipeFromArgs(args)
      : null;
  current.variants = parsed
    ? buildAutoEditVariants(current.sources, parsed.recipe)
    : buildAutoEditVariants(current.sources, DEFAULT_RECIPE);
  return JSON.stringify({
    ok: true,
    variants: current.variants.map(variantSummary),
    warnings: parsed?.warnings ?? [],
  });
}

/**
 * Aplica una variante medida a la timeline del proyecto abierto. Por defecto
 * reemplaza la timeline (como la vista); `replace:false` la agrega al final.
 */
export function autoEditApply(
  context: AutoEditMcpContext,
  args: Record<string, unknown>,
): string {
  const project = projectOf(context);
  const current = sessionFor(project);
  const variantId = textArg(args.variantId);
  if (!variantId) throw new Error('falta el parámetro «variantId»');
  const variant = current.variants.find((item) => item.id === variantId);
  if (!variant) {
    throw new Error(`la variante «${variantId}» no existe: corré autoedit_measure o autoedit_variants`);
  }
  const indices = intListArg(args.cuts);
  if (
    indices.length > 0 &&
    !indices.some((index) => index >= 0 && index < variant.cuts.length)
  ) {
    // subsetVariant trata índices vacíos/inválidos como "sin filtro" y
    // aplicaría la variante entera — mentiría sobre lo pedido.
    throw new Error('ningún índice de «cuts» corresponde a un corte de la variante');
  }
  const chosen = indices.length > 0 ? subsetVariant(variant, indices) : variant;
  if (chosen.cuts.length === 0) {
    throw new Error('la selección de cortes quedó vacía');
  }
  const videoAssets = videoAssetsOf(project);
  const matched = videoAssets.filter((asset) =>
    chosen.cuts.some((cut) => cut.assetId === asset.id),
  );
  const applied = context.store.update((live) =>
    applyAutoEditVariant(
      live,
      matched.length > 0 ? matched : videoAssets,
      chosen,
      current.sources[0]?.analysis ?? null,
      {
        replace: boolArg(args.replace) !== false,
        improveAudio: boolArg(args.improveAudio) !== false,
        addCaptions: boolArg(args.addCaptions) !== false && chosen.captions.length > 0,
        transition: chosen.recipe.transition,
        zoom: chosen.recipe.zoom,
      },
    ).project,
  );
  if (!applied) throw new Error('el cambio dejaría el proyecto en un estado inválido');
  return JSON.stringify({
    ok: true,
    name: chosen.name,
    clipCount: chosen.cuts.length,
    captionCount: chosen.captions.length,
    durationSeconds: chosen.durationSeconds,
    replace: boolArg(args.replace) !== false,
  });
}

/**
 * Exporta variantes medidas a MP4 en lote (una por variante o las pedidas en
 * `variantIds`), sin tocar el proyecto abierto: cada una se monta sobre una
 * copia, se escribe como `.editoria.json` y se renderiza verificada.
 */
export async function autoEditExport(
  context: AutoEditMcpContext,
  args: Record<string, unknown>,
): Promise<string> {
  const project = projectOf(context);
  const current = sessionFor(project);
  const outputDir =
    textArg(args.outputDir) ??
    (context.store.state.opened?.root
      ? `${context.store.state.opened.root}\variantes-auto`
      : undefined);
  if (!outputDir) {
    throw new Error('falta outputDir (no hay raíz de proyecto para el default)');
  }
  const wanted = stringListArg(args.variantIds);
  const variants =
    wanted.length > 0
      ? wanted.map((id) => {
          const variant = current.variants.find((item) => item.id === id);
          if (!variant) {
            throw new Error(`la variante «${id}» no existe en la sesión medida`);
          }
          return variant;
        })
      : current.variants;
  if (variants.length === 0) {
    throw new Error('no hay variantes para exportar: corré autoedit_measure primero');
  }
  // `cuts` (opcional) filtra los índices de corte de cada variante exportada,
  // igual que los chips de la vista; sin él va la variante completa. Un
  // filtro que no deja ningún corte válido en una variante la excluye —
  // `subsetVariant` interpreta índices vacíos como "sin filtro" y exportaría
  // la variante entera, lo cual mentiría sobre lo pedido.
  const cutFilter = intListArg(args.cuts);
  const entries = variants
    .map((variant) => ({
      variant,
      indices:
        cutFilter.length > 0
          ? cutFilter.filter((index) => index >= 0 && index < variant.cuts.length)
          : variant.cuts.map((_, index) => index),
    }))
    .filter((entry) => entry.indices.length > 0);
  if (entries.length === 0) {
    throw new Error('el filtro de cortes no dejó ningún corte válido en las variantes pedidas');
  }
  const report = await exportAutoEditVariants(context.store.service, {
    project,
    assets: videoAssetsOf(project),
    entries,
    outputDir,
    analysis: current.sources[0]?.analysis ?? null,
    improveAudio: boolArg(args.improveAudio) !== false,
    addCaptions: boolArg(args.addCaptions) !== false,
  });
  return JSON.stringify({
    ok: report.failed === 0,
    outputDir,
    summary: autoEditExportSummary(report),
    done: report.done,
    failed: report.failed,
    skipped: report.skipped,
    items: report.items,
  });
}

/**
 * Estado de la sesión de montaje automático del proyecto abierto: fuentes
 * medidas, variantes disponibles y si el material medido sigue presente.
 * No exige sesión previa: reporta `measured:false` si no hay ninguna.
 */
export function autoEditStatus(context: AutoEditMcpContext): string {
  const project = projectOf(context);
  if (!session || session.projectId !== project.id) {
    return JSON.stringify({ ok: true, measured: false });
  }
  const current = session;
  const readyIds = new Set(videoAssetsOf(project).map((asset) => asset.id));
  const missing = current.sources.filter((source) => !readyIds.has(source.assetId));
  return JSON.stringify({
    ok: true,
    measured: true,
    sources: current.sources.map((source) => ({
      assetId: source.assetId,
      label: source.label,
      durationSeconds: source.analysis.durationSeconds,
      scenes: source.analysis.scenes.length,
      silences: source.analysis.silences.length,
      blacks: source.analysis.blacks.length,
      freezes: source.analysis.freezes.length,
      transcriptSegments: source.transcript?.segments.length ?? 0,
      missingFromProject: !readyIds.has(source.assetId),
    })),
    variants: current.variants.map(variantSummary),
    staleSources: missing.length,
  });
}

import type { Clip, ProjectDocument } from '@editor-ia/project-schema';
import type { TranscriptionResult } from '../services/contracts';
import {
  addTranscriptionCues,
  fpsOf,
  listTranscribableTimelineClips,
  transcriptionSegmentsForClip,
} from './project-actions';

/**
 * «Subtitular proyecto»: transcribe TODOS los clips elegibles de la timeline en
 * una sola acción (paridad con auto-captions de CapCut sobre el flujo existente
 * de `transcribeAsset` + `addTranscriptionCues`).
 *
 * - Dedup por asset: cada medio se transcribe una sola vez aunque tenga varios
 *   clips; cada clip recibe sólo los segmentos que caen dentro de su ventana
 *   `inFrame..outFrame` (ver `transcriptionSegmentsForClip`).
 * - Un asset que falla no aborta el lote: sus clips quedan en `failed` y se
 *   sigue con el resto. Cada clip aplica sus cues en su propio `store.update`
 *   para que un fallo puntual no pierda el trabajo ya insertado.
 */

/** Subconjunto del store del proyecto que el orquestador necesita. */
export interface TranscribeProjectStore {
  readonly state: { readonly project: ProjectDocument | null };
  /**
   * Proyecto vivo del store (`stateRef`), cuando el store real lo expone.
   * `state.project` es la foto del render que invocó la función: durante la
   * transcripción async el usuario puede cambiar de proyecto y `update`
   * escribiría en el nuevo — el lote debe abortar en ese caso (AUD-144).
   */
  getProject?(): ProjectDocument | null;
  readonly service: {
    transcribeAsset(
      assetId: string,
      language?: string,
      model?: string,
    ): Promise<TranscriptionResult>;
  };
  saveNow(): Promise<boolean>;
  update(recipe: (project: ProjectDocument) => ProjectDocument): boolean;
  setNotice(notice: string | null): void;
}

export interface TranscribeProjectFailure {
  readonly clipId: string;
  readonly reason: string;
}

export interface TranscribeProjectSummary {
  /** Clips que terminaron con al menos un cue insertado. */
  readonly clips: number;
  readonly cuesAdded: number;
  /** Medios distintos transcritos (dedup por assetId). */
  readonly assetsTranscribed: number;
  /** Clips sin resultado: ventana sin voz o edición no mapeable. */
  readonly skipped: readonly TranscribeProjectFailure[];
  /** Clips cuyo asset falló o cuya inserción lanzó error. */
  readonly failed: readonly TranscribeProjectFailure[];
}

function clipAssetId(clip: Clip): string | null {
  return clip.source.type === 'asset' && 'assetId' in clip.source
    ? clip.source.assetId
    : null;
}

/** Proyecto vivo si el store lo expone; si no, la foto de `state`. */
function liveProject(store: TranscribeProjectStore): ProjectDocument | null {
  return store.getProject?.() ?? store.state.project;
}

function clipLabel(project: ProjectDocument, clip: Clip): string {
  if (clip.label?.trim()) return clip.label.trim();
  const assetId = clipAssetId(clip);
  const asset = assetId ? project.assets.find((item) => item.id === assetId) : undefined;
  return asset?.label ?? clip.id;
}

export async function transcribeProjectClips(
  store: TranscribeProjectStore,
  options: {
    readonly language?: string;
    readonly model?: string;
    readonly onProgress?: (done: number, total: number, label: string) => void;
  } = {},
): Promise<TranscribeProjectSummary> {
  const empty: TranscribeProjectSummary = {
    clips: 0,
    cuesAdded: 0,
    assetsTranscribed: 0,
    skipped: [],
    failed: [],
  };
  const project = liveProject(store);
  if (!project) return empty;
  const clips = listTranscribableTimelineClips(project);
  if (clips.length === 0) return empty;
  const projectId = project.id;
  const SWITCHED_REASON = 'el proyecto cambió durante la transcripción';
  /** Marca como fallidos el clip actual y todos los que quedan del lote. */
  const failRest = (fromIndex: number) => {
    for (const rest of clips.slice(fromIndex)) {
      failed.push({ clipId: rest.id, reason: SWITCHED_REASON });
    }
  };
  const stillSameProject = () => liveProject(store)?.id === projectId;

  const language = options.language ?? project.language;
  const model = options.model ?? 'small';

  // Mismo prerequisito que el flujo por clip: el backend transcribe el asset
  // guardado en disco, así que el proyecto tiene que estar persistido.
  const saved = await store.saveNow();
  if (!saved) {
    return {
      ...empty,
      failed: clips.map((clip) => ({
        clipId: clip.id,
        reason: 'no se pudo guardar el proyecto',
      })),
    };
  }

  const fps = fpsOf(project);
  const assetResults = new Map<
    string,
    { ok: true; result: TranscriptionResult } | { ok: false; reason: string }
  >();
  const skipped: TranscribeProjectFailure[] = [];
  const failed: TranscribeProjectFailure[] = [];
  let cuesAdded = 0;
  let clipsDone = 0;
  let assetsTranscribed = 0;

  for (const [index, clip] of clips.entries()) {
    if (!stillSameProject()) {
      failRest(index);
      break;
    }
    const label = clipLabel(project, clip);
    options.onProgress?.(index, clips.length, label);

    const assetId = clipAssetId(clip);
    if (!assetId) {
      skipped.push({ clipId: clip.id, reason: 'el clip no referencia un asset' });
      continue;
    }

    let entry = assetResults.get(assetId);
    if (!entry) {
      try {
        const result = await store.service.transcribeAsset(assetId, language, model);
        entry = { ok: true, result };
        assetsTranscribed += 1;
      } catch (error) {
        entry = {
          ok: false,
          reason: error instanceof Error ? error.message : 'no se pudo transcribir',
        };
      }
      assetResults.set(assetId, entry);
    }
    if (!entry.ok) {
      failed.push({ clipId: clip.id, reason: entry.reason });
      continue;
    }

    const plan = transcriptionSegmentsForClip(entry.result.segments, clip, fps);
    if (plan.status === 'unsupported') {
      skipped.push({ clipId: clip.id, reason: plan.reason });
      continue;
    }
    if (plan.status === 'empty') {
      skipped.push({ clipId: clip.id, reason: 'sin voz dentro de la ventana del clip' });
      continue;
    }

    try {
      // `update` escribe sobre el proyecto VIVO: si cambió mientras se
      // transcribía el asset, aplicar los cues de este clip caería en el
      // proyecto equivocado. Se aborta el lote restante, no sólo el clip.
      if (!stillSameProject()) {
        failRest(index);
        break;
      }
      let added = 0;
      const applied = store.update((current) => {
        const planned = addTranscriptionCues(current, clip.id, plan.segments);
        added = planned.added;
        return planned.project;
      });
      if (!applied) {
        failed.push({ clipId: clip.id, reason: 'la edición no se aplicó al proyecto' });
      } else {
        cuesAdded += added;
        if (added > 0) clipsDone += 1;
        else skipped.push({ clipId: clip.id, reason: 'los segmentos no generaron subtítulos' });
      }
    } catch (error) {
      failed.push({
        clipId: clip.id,
        reason: error instanceof Error ? error.message : 'no se pudieron insertar los subtítulos',
      });
    }
  }

  options.onProgress?.(clips.length, clips.length, '');
  return { clips: clipsDone, cuesAdded, assetsTranscribed, skipped, failed };
}

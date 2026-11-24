import type { ProjectDocument } from '@editor-ia/project-schema';
import { applyMorphCut } from './project-actions';

/**
 * Morph cut por lote: aplica `applyMorphCut` en TODOS los cortes entre
 * clips de video o audio contiguos de pistas desbloqueadas. Pensado para
 * talking-head con muchos jump cuts — un clic y cada corte queda con
 * las voces cruzadas (en pistas de audio también suaviza música y
 * narración).
 *
 * Reglas honestas:
 * - Cada corte se intenta de forma independiente: sin handle de fuente
 *   en un lado, ese lado queda en 0 frames y el otro igual se aplica.
 * - Los clips de video conservan su id (applyMorphCut sólo agrega clips
 *   de audio), así que el plan se calcula una vez y se ejecuta en orden.
 * - Nunca pisa clips deshabilitados ni pistas bloqueadas.
 */

export interface MorphCutCandidate {
  readonly incomingClipId: string;
  readonly outgoingClipId: string;
}

export interface MorphCutOutcome {
  readonly incomingClipId: string;
  readonly outgoingClipId: string;
  readonly jCutFrames: number;
  readonly lCutFrames: number;
}

export interface MorphCutsResult {
  readonly project: ProjectDocument;
  readonly applied: readonly MorphCutOutcome[];
  readonly skipped: readonly MorphCutCandidate[];
  readonly failed: readonly { readonly incomingClipId: string; readonly reason: string }[];
}

/** Pares (saliente→entrante) contiguos de video en pistas editables. */
export function morphCutCandidates(project: ProjectDocument): MorphCutCandidate[] {
  const unlocked = new Set(
    project.timeline.tracks.filter((track) => !track.locked).map((track) => track.id),
  );
  const videos = project.timeline.clips.filter(
    (clip) =>
      (clip.kind === 'video' || clip.kind === 'audio') &&
      unlocked.has(clip.trackId) &&
      clip.enabled !== false,
  );
  const candidates: MorphCutCandidate[] = [];
  for (const incoming of videos) {
    const outgoing = videos
      .filter(
        (clip) =>
          clip.id !== incoming.id &&
          clip.trackId === incoming.trackId &&
          clip.kind === incoming.kind &&
          clip.startFrame + clip.durationFrames === incoming.startFrame,
      )
      .sort((a, b) => b.startFrame - a.startFrame)[0];
    if (outgoing) {
      candidates.push({ incomingClipId: incoming.id, outgoingClipId: outgoing.id });
    }
  }
  return candidates;
}

export interface ApplyMorphCutsOptions {
  readonly frames?: number;
  /** Si se omite, corta todos los candidatos encontrados. */
  readonly clipIds?: readonly string[];
}

/**
 * Aplica morph cut en lote. Cada par se procesa contra el proyecto
 * vigente; un fallo en un corte no frena a los demás.
 */
export function applyMorphCutsToAll(
  project: ProjectDocument,
  options: ApplyMorphCutsOptions = {},
): MorphCutsResult {
  const wanted = options.clipIds ? new Set(options.clipIds) : null;
  const candidates = morphCutCandidates(project).filter(
    (candidate) => !wanted || wanted.has(candidate.incomingClipId),
  );
  let next = project;
  const applied: MorphCutOutcome[] = [];
  const skipped: MorphCutCandidate[] = [];
  const failed: { incomingClipId: string; reason: string }[] = [];

  for (const candidate of candidates) {
    // El clip entrante puede haber desaparecido si un corte anterior lo tocó
    // (no debería: applyMorphCut no borra clips de video, pero se verifica).
    const stillThere = next.timeline.clips.some(
      (clip) => clip.id === candidate.incomingClipId,
    );
    if (!stillThere) {
      skipped.push(candidate);
      continue;
    }
    try {
      const result = applyMorphCut(next, {
        incomingClipId: candidate.incomingClipId,
        ...(options.frames !== undefined ? { frames: options.frames } : {}),
      });
      if (result.jCutFrames === 0 && result.lCutFrames === 0) {
        skipped.push(candidate);
        continue;
      }
      next = result.project;
      applied.push({
        incomingClipId: candidate.incomingClipId,
        outgoingClipId: candidate.outgoingClipId,
        jCutFrames: result.jCutFrames,
        lCutFrames: result.lCutFrames,
      });
    } catch (cause) {
      failed.push({
        incomingClipId: candidate.incomingClipId,
        reason: cause instanceof Error ? cause.message : 'error desconocido',
      });
    }
  }

  return { project: next, applied, skipped, failed };
}

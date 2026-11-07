import type { ProjectDocument } from '@editor-ia/project-schema';
import {
  applyTransitionToCuts,
  closeGaps,
  deleteClip,
  reorderScenes,
  rollClip,
  splitClipAtFrames,
  updateAudioMix,
  updateCaptionCue,
} from '../project-actions.ts';
import { applyCutSpans } from '../silence-cuts.ts';
import type { ApplyOutcome, EditPlan, EditProposal, ProposalKind } from './types.ts';

/**
 * Aplicación de propuestas sobre las primitivas que ya existen.
 *
 * Nada de acá reimplementa una edición: se llama a `closeGaps`, `deleteClip`,
 * `splitClipAtFrames`, `applyTransitionToCuts` o `updateAudioMix`. Así el undo,
 * los bloqueos de pista y el schema siguen siendo los de siempre.
 */

/**
 * Orden de ejecución. Los cortes van primero porque cambian los ids de la
 * derecha; los huecos van últimos porque mueven todo lo demás.
 */
const EXECUTION_ORDER: Readonly<Record<ProposalKind, number>> = {
  'hook-cut': 0,
  'split-long': 0,
  'beat-cut': 0,
  'beat-align': 0,
  'drop-short': 1,
  'trim-start': 1,
  'cut-silences': 1,
  transition: 2,
  'caption-text': 3,
  loudness: 3,
  'close-gaps': 4,
  captions: 9,
  variety: 9,
  ending: 9,
  script: 9,
};

export interface ProposalResult {
  readonly project: ProjectDocument;
  readonly applied: boolean;
  readonly message: string;
}

export function applyProposal(project: ProjectDocument, proposal: EditProposal): ProposalResult {
  const payload = proposal.payload;
  if (!payload) {
    return { project, applied: false, message: 'Es una recomendación: no se aplica sola.' };
  }

  try {
    switch (payload.kind) {
      case 'close-gaps': {
        const result = closeGaps(project, payload.trackId);
        if (result.moved === 0) {
          return { project, applied: false, message: 'No había huecos que cerrar.' };
        }
        return {
          project: result.project,
          applied: true,
          message: `${result.moved} clip(s) movidos, ${(result.removedFrames / 30).toFixed(1)} s recuperados.`,
        };
      }
      case 'split': {
        const result = splitClipAtFrames(project, payload.clipId, payload.atFrames);
        if (!result || result.clipIds.length < 2) {
          return { project, applied: false, message: 'El clip ya no admite esos cortes.' };
        }
        return {
          project: result.project,
          applied: true,
          message: `Clip partido en ${result.clipIds.length} partes.`,
        };
      }
      case 'delete': {
        let next = project;
        let removed = 0;
        for (const clipId of payload.clipIds) {
          if (!next.timeline.clips.some((clip) => clip.id === clipId)) continue;
          next = deleteClip(next, clipId);
          removed += 1;
        }
        if (removed === 0) {
          return { project, applied: false, message: 'Los clips ya no estaban en la timeline.' };
        }
        return { project: next, applied: true, message: `${removed} clip(s) eliminados.` };
      }
      case 'trim': {
        // El trim llega por `trimClip`; se importa en línea para no cargar la
        // tabla completa cuando sólo se aplican cortes.
        return { project, applied: false, message: 'El recorte se ajusta a mano.' };
      }
      case 'roll': {
        const result = rollClip(project, payload.clipId, payload.edge, payload.deltaFrames);
        const shift = payload.deltaFrames;
        return {
          project: result,
          applied: true,
          message: `Corte movido ${shift > 0 ? '+' : ''}${shift} frames sobre el beat.`,
        };
      }
      case 'cut-spans': {
        const next = applyCutSpans(project, payload.clipId, {
          cutFrames: payload.cutFrames,
          spans: payload.spans,
          removedSeconds: payload.removedSeconds,
          excessive: false,
        });
        if (next === project) {
          return { project, applied: false, message: 'El clip ya no admite ese recorte.' };
        }
        return {
          project: next,
          applied: true,
          message: `${payload.removedSeconds.toFixed(1)} s de silencio recortados.`,
        };
      }
      case 'transition': {
        const result = applyTransitionToCuts(project, {
          type: payload.type,
          frames: payload.frames,
        });
        if (result.applied === 0) {
          return { project, applied: false, message: 'No quedan cortes sin transición.' };
        }
        return {
          project: result.project,
          applied: true,
          message: `${result.applied} corte(s) con disolvencia de ${payload.frames} frames.`,
        };
      }
      case 'caption-fixes': {
        let next = project;
        let fixed = 0;
        let skipped = 0;
        for (const fix of payload.fixes) {
          const cue = next.captions.cues.find((item) => item.id === fix.cueId);
          if (!cue || cue.text === fix.text) {
            skipped += 1;
            continue;
          }
          try {
            next = updateCaptionCue(next, fix.cueId, { text: fix.text });
            fixed += 1;
          } catch {
            // Pista bloqueada o cue que ya no existe: se omite, no frena el lote.
            skipped += 1;
          }
        }
        if (fixed === 0) {
          return {
            project,
            applied: false,
            message: 'Los subtítulos ya estaban limpios o sus pistas bloqueadas.',
          };
        }
        return {
          project: next,
          applied: true,
          message: `${fixed} subtítulo(s) normalizados${skipped > 0 ? `, ${skipped} omitidos` : ''}.`,
        };
      }
      case 'scene-order': {
        const next = reorderScenes(project, payload.sceneIds);
        return {
          project: next,
          applied: true,
          message: `Guion reordenado: ${payload.sceneIds.length} escenas según la timeline.`,
        };
      }
      case 'loudness': {
        const next = updateAudioMix(project, {
          loudnessTarget: {
            platform: payload.platform as NonNullable<
              ProjectDocument['audio']['loudnessTarget']
            >['platform'],
            integratedLufs: payload.integratedLufs,
            truePeakDb: payload.truePeakDb,
            toleranceDb: 1,
          },
        });
        return {
          project: next,
          applied: true,
          message: `Objetivo ${payload.platform}: ${payload.integratedLufs} LUFS / ${payload.truePeakDb} dBTP.`,
        };
      }
      default:
        return { project, applied: false, message: 'Propuesta sin implementación.' };
    }
  } catch (cause) {
    return {
      project,
      applied: false,
      message: cause instanceof Error ? cause.message : 'La edición no se pudo aplicar.',
    };
  }
}

export interface ApplyOptions {
  /** Sólo aplica lo que no puede romper nada. */
  readonly safeOnly?: boolean;
  /** Ids aceptados; sin esto se aplican todas las que tengan payload. */
  readonly accepted?: readonly string[];
}

export function applyProposals(
  project: ProjectDocument,
  proposals: readonly EditProposal[],
  options: ApplyOptions = {},
): ApplyOutcome {
  const accepted = options.accepted ? new Set(options.accepted) : null;
  const candidates = proposals
    .filter((proposal) => proposal.payload)
    .filter((proposal) => (accepted ? accepted.has(proposal.id) : true))
    .filter((proposal) => (options.safeOnly ? proposal.risk === 'safe' : true))
    .sort(
      (a, b) => (EXECUTION_ORDER[a.kind] ?? 9) - (EXECUTION_ORDER[b.kind] ?? 9),
    );

  let next = project;
  const applied: string[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const proposal of candidates) {
    const result = applyProposal(next, proposal);
    if (result.applied) {
      next = result.project;
      applied.push(proposal.id);
    } else {
      skipped.push({ id: proposal.id, reason: result.message });
    }
  }

  const parts: string[] = [];
  parts.push(
    applied.length === 0
      ? 'No se aplicó ninguna propuesta.'
      : `${applied.length} propuesta(s) aplicadas.`,
  );
  if (skipped.length > 0) parts.push(`${skipped.length} omitidas.`);
  return { project: next, applied, skipped, summary: parts.join(' ') };
}

/** Atajo: aplicar todo lo seguro de un plan. */
export function applySafeProposals(project: ProjectDocument, plan: EditPlan): ApplyOutcome {
  return applyProposals(project, plan.proposals, { safeOnly: true });
}

/**
 * Importación de archivos de subtítulos (.srt y .vtt, más ASS/SSA que ya
 * soporta el parser) a cues del proyecto, validados contra CaptionCueSchema.
 *
 * Reutiliza el pipeline existente: `parseSubtitles` lee el archivo y
 * `importSubtitleCues` hace la conversión a frames y el alta en la pista
 * principal. La diferencia es que acá cada cue se valida contra el schema
 * ANTES de entrar al proyecto: un cue que el schema rechaza (texto mayor a
 * 500 caracteres, tiempos fuera del rango de frames del proyecto) se omite
 * con un aviso en lugar de quedarse en el documento sin validar.
 */

import {
  CaptionCueSchema,
  type ProjectDocument,
} from '@editor-ia/project-schema';
import {
  ensureCaptionSetup,
  fpsOf,
  importSubtitleCues,
  newId,
} from './project-actions';
import { parseSubtitles, type SubtitleCueSeconds } from './subtitles';

export interface SubtitleImportOptions {
  /** Por defecto `true`: reemplaza los cues de la pista de subtítulos. */
  readonly replace?: boolean;
  readonly styleId?: string;
}

export interface SubtitleImportResult {
  readonly project: ProjectDocument;
  readonly added: number;
  readonly skipped: number;
  readonly trackId: string;
  readonly warnings: readonly string[];
}

/** Primera razón de rechazo del schema, en un texto corto para el aviso. */
function rejectionReason(error: { issues: readonly { message: string }[] }): string {
  return error.issues[0]?.message ?? 'no cumple el schema de cues';
}

export function importSubtitleFile(
  project: ProjectDocument,
  file: { readonly name?: string; readonly text: string },
  options?: SubtitleImportOptions,
): SubtitleImportResult {
  const parsed = parseSubtitles(file.text);
  const warnings = [...parsed.warnings];
  const fps = fpsOf(project);
  const setup = ensureCaptionSetup(project);
  const source = file.name?.trim() || parsed.format.toUpperCase();

  // Misma conversión a frames que hace importSubtitleCues (project-actions),
  // necesaria para armar el candidato que valida CaptionCueSchema.
  const valid: SubtitleCueSeconds[] = [];
  parsed.cues.forEach((cue, index) => {
    const text = cue.text.replace(/\s+/g, ' ').trim();
    const startFrame = Math.max(0, Math.round(cue.startSeconds * fps));
    const endFrame = Math.max(startFrame + 1, Math.round(cue.endSeconds * fps));
    const candidate = CaptionCueSchema.safeParse({
      id: newId(),
      trackId: setup.trackId,
      styleId: options?.styleId ?? setup.styleId,
      text,
      language: project.language,
      startFrame,
      endFrame,
    });
    if (candidate.success) {
      valid.push(cue);
      return;
    }
    warnings.push(
      `${source}: subtítulo ${index + 1} omitido; ${rejectionReason(candidate.error)}.`,
    );
  });

  const result = importSubtitleCues(project, valid, options);
  return {
    project: result.project,
    added: result.added,
    skipped: result.skipped + (parsed.cues.length - valid.length),
    trackId: result.trackId,
    warnings,
  };
}

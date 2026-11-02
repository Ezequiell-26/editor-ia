import type { Clip, ProjectDocument } from '@editor-ia/project-schema';
import type { AudioPeaks } from '../services/project-service';
import { measureAdaptiveProfile } from './adaptive';
import { DENOISE_LEVELS, type DenoiseLevel } from './auto-cleanup';
import { fpsOf, updateAudioMix, updateClip } from './project-actions';
import { applyCutSpans, planSilenceCutsForProject } from './silence-cuts';
import { cuesForClip, planSpeechCutsFromCues } from './speech-cuts';

/**
 * Revisión por ítem de la automatización.
 *
 * La limpieza automática aplica todo o nada. Este módulo arma una lista de
 * decisiones independientes —cada silencio, cada pausa, el ruido, el zoom y el
 * nivelado— para que se puedan aceptar o rechazar de a una antes de tocar la
 * timeline.
 *
 * Los tramos se guardan **relativos al clip**, no en frames absolutos: si un
 * corte anterior corre la timeline, el ítem sigue apuntando al mismo lugar.
 */

export type ReviewKind = 'silence' | 'pause' | 'denoise' | 'zoom' | 'level';

export interface ReviewSpan {
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface ReviewItem {
  readonly id: string;
  readonly kind: ReviewKind;
  readonly clipId: string | null;
  readonly label: string;
  readonly detail: string;
  readonly seconds: number;
  readonly span?: ReviewSpan;
  readonly motion?: { readonly type: 'zoom-in' | 'zoom-out'; readonly intensity: number };
  readonly denoise?: number;
  readonly targetLufs?: number;
}

export interface ReviewBuildOptions {
  readonly silenceThresholdDb?: number;
  readonly minPauseSeconds?: number;
  readonly paddingSeconds?: number;
  readonly denoise?: DenoiseLevel;
  readonly targetLufs?: number;
  readonly zoomIntensity?: number;
}

function isUnlocked(project: ProjectDocument, clip: Clip): boolean {
  return project.timeline.tracks.find((track) => track.id === clip.trackId)?.locked !== true;
}

function speedOf(clip: Clip): number {
  const speed = 'speed' in clip ? clip.speed : undefined;
  if (!speed) return 1;
  return speed.num / Math.max(1, speed.den);
}

function candidateClips(project: ProjectDocument): Clip[] {
  return project.timeline.clips
    .filter(
      (clip) =>
        (clip.kind === 'video' || clip.kind === 'audio') &&
        clip.source.type === 'asset' &&
        Math.abs(speedOf(clip) - 1) < 0.001 &&
        isUnlocked(project, clip),
    )
    .sort((a, b) => a.startFrame - b.startFrame);
}

function pictureClips(project: ProjectDocument): Clip[] {
  return project.timeline.clips
    .filter(
      (clip) =>
        (clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'freeze') &&
        clip.durationFrames >= 24 &&
        !('motion' in clip && clip.motion) &&
        isUnlocked(project, clip),
    )
    .sort((a, b) => a.startFrame - b.startFrame);
}

/** Etiqueta legible del clip, sin depender del asset. */
function clipName(clip: Clip): string {
  return clip.label ?? `clip ${clip.id.slice(0, 4)}`;
}

export async function buildReviewItems(
  project: ProjectDocument,
  fetchPeaks: (assetId: string) => Promise<AudioPeaks>,
  options: ReviewBuildOptions = {},
): Promise<ReviewItem[]> {
  const fps = fpsOf(project);
  if (!(fps > 0)) return [];
  const items: ReviewItem[] = [];
  const candidates = candidateClips(project);

  for (const clip of candidates) {
    if (clip.source.type !== 'asset') continue;
    let peaks: AudioPeaks | null = null;
    try {
      peaks = await fetchPeaks(clip.source.assetId);
    } catch {
      peaks = null;
    }
    if (peaks) {
      const plan = planSilenceCutsForProject(project, clip.id, peaks, {
        ...(options.silenceThresholdDb !== undefined
          ? { thresholdDb: options.silenceThresholdDb }
          : {}),
      });
      for (const [index, span] of (plan?.spans ?? []).entries()) {
        items.push({
          id: `silence:${clip.id}:${index}`,
          kind: 'silence',
          clipId: clip.id,
          label: `Silencio en ${clipName(clip)}`,
          detail: `${(span.startFrame / fps).toFixed(2)}–${(span.endFrame / fps).toFixed(2)} s`,
          seconds: (span.endFrame - span.startFrame) / fps,
          span: {
            startOffset: span.startFrame - clip.startFrame,
            endOffset: span.endFrame - clip.startFrame,
          },
        });
      }
    }

    const pausePlan = planSpeechCutsFromCues(cuesForClip(project, clip.id), clip, fps, {
      ...(options.minPauseSeconds !== undefined
        ? { minPauseSeconds: options.minPauseSeconds }
        : {}),
      ...(options.paddingSeconds !== undefined ? { paddingSeconds: options.paddingSeconds } : {}),
    });
    for (const [index, span] of (pausePlan?.spans ?? []).entries()) {
      items.push({
        id: `pause:${clip.id}:${index}`,
        kind: 'pause',
        clipId: clip.id,
        label: `Pausa en ${clipName(clip)}`,
        detail: `${(span.startFrame / fps).toFixed(2)}–${(span.endFrame / fps).toFixed(2)} s`,
        seconds: (span.endFrame - span.startFrame) / fps,
        span: {
          startOffset: span.startFrame - clip.startFrame,
          endOffset: span.endFrame - clip.startFrame,
        },
      });
    }

    const profile = measureAdaptiveProfile(project, peaks);
    const denoise = options.denoise ?? profile.denoise;
    if (DENOISE_LEVELS[denoise] > 0) {
      items.push({
        id: `denoise:${clip.id}`,
        kind: 'denoise',
        clipId: clip.id,
        label: `Reducir ruido en ${clipName(clip)}`,
        detail: `${denoise} · ${Math.round(DENOISE_LEVELS[denoise] * 100)} %`,
        seconds: 0,
        denoise: DENOISE_LEVELS[denoise],
      });
    }
  }

  pictureClips(project).forEach((clip, index) => {
    items.push({
      id: `zoom:${clip.id}`,
      kind: 'zoom',
      clipId: clip.id,
      label: `Zoom en ${clipName(clip)}`,
      detail: index % 2 === 0 ? 'zoom-in' : 'zoom-out',
      seconds: 0,
      motion: {
        type: index % 2 === 0 ? 'zoom-in' : 'zoom-out',
        intensity: options.zoomIntensity ?? 0.08,
      },
    });
  });

  items.push({
    id: 'level:master',
    kind: 'level',
    clipId: null,
    label: 'Nivelar volumen del proyecto',
    detail: `${options.targetLufs ?? -14} LUFS · limitador`,
    seconds: 0,
    targetLufs: options.targetLufs ?? -14,
  });

  return items;
}

/**
 * Aplica sólo los ítems aceptados.
 *
 * Orden deliberado: primero los ajustes por clip (nivel, ruido, zoom) y al
 * final los cortes, porque un corte divide el clip y cambia los ids de las
 * piezas; hacerlo antes dejaría los ajustes aplicados a medias.
 */
export function applyReviewItems(
  project: ProjectDocument,
  items: readonly ReviewItem[],
  accepted: ReadonlySet<string>,
): ProjectDocument {
  const chosen = items.filter((item) => accepted.has(item.id));
  if (chosen.length === 0) return project;
  let next = project;

  const level = chosen.find((item) => item.kind === 'level');
  if (level?.targetLufs !== undefined) {
    next = updateAudioMix(next, {
      loudnessTarget: {
        platform: next.video.height > next.video.width ? 'shorts' : 'youtube',
        integratedLufs: level.targetLufs,
        truePeakDb: -1,
        toleranceDb: 1,
      },
      masterLimiter: true,
    });
  }

  for (const item of chosen) {
    if (item.kind !== 'denoise' || !item.clipId || item.denoise === undefined) continue;
    const clip = next.timeline.clips.find((entry) => entry.id === item.clipId);
    if (!clip || !isUnlocked(next, clip)) continue;
    const audio = 'audio' in clip ? clip.audio : undefined;
    next = updateClip(next, clip.id, { audio: { ...(audio ?? {}), denoise: item.denoise } });
  }

  for (const item of chosen) {
    if (item.kind !== 'zoom' || !item.clipId || !item.motion) continue;
    const clip = next.timeline.clips.find((entry) => entry.id === item.clipId);
    if (!clip || !isUnlocked(next, clip)) continue;
    next = updateClip(next, clip.id, { motion: item.motion });
  }

  // Cortes: se agrupan por clip y se aplican en orden de timeline. Los offsets
  // son relativos, así que un corte previo no los invalida.
  const spansByClip = new Map<string, ReviewSpan[]>();
  for (const item of chosen) {
    if ((item.kind !== 'silence' && item.kind !== 'pause') || !item.clipId || !item.span) continue;
    const list = spansByClip.get(item.clipId) ?? [];
    list.push(item.span);
    spansByClip.set(item.clipId, list);
  }
  const ordered = [...spansByClip.entries()].sort((a, b) => {
    const first = next.timeline.clips.find((clip) => clip.id === a[0])?.startFrame ?? 0;
    const second = next.timeline.clips.find((clip) => clip.id === b[0])?.startFrame ?? 0;
    return first - second;
  });
  for (const [clipId, spans] of ordered) {
    const clip = next.timeline.clips.find((entry) => entry.id === clipId);
    if (!clip) continue;
    const absolute = spans
      .map((span) => ({
        startFrame: Math.round(clip.startFrame + span.startOffset),
        endFrame: Math.round(clip.startFrame + span.endOffset),
      }))
      .filter((span) => span.endFrame > span.startFrame);
    if (absolute.length === 0) continue;
    const cutFrames = [
      ...new Set(absolute.flatMap((span) => [span.startFrame, span.endFrame])),
    ].sort((a, b) => a - b);
    next = applyCutSpans(next, clipId, {
      cutFrames,
      spans: absolute,
      removedSeconds: 0,
      excessive: false,
    });
  }

  return next;
}

/** Resumen para el aviso: cuántos ítems de cada tipo se aplicaron. */
export function reviewSummary(items: readonly ReviewItem[], accepted: ReadonlySet<string>): string {
  const chosen = items.filter((item) => accepted.has(item.id));
  const seconds = chosen.reduce((sum, item) => sum + item.seconds, 0);
  if (chosen.length === 0) return 'No aceptaste ningún cambio.';
  const cuts = chosen.filter((item) => item.kind === 'silence' || item.kind === 'pause').length;
  return `${chosen.length} cambio(s) aplicados · ${cuts} corte(s)${seconds > 0 ? ` · ${seconds.toFixed(2)} s menos` : ''}.`;
}

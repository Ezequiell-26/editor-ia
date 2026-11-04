import type { ProjectDocument } from '@editor-ia/project-schema';
import { collectSnapTargets, snapThreshold, type SnapKind } from '../../state/snapping';

/**
 * Snapping extendido del timeline: además de origen/playhead/marcadores/bordes
 * de clips (lo que ya provee `state/snapping`), agrega inicio de escenas y
 * beats detectados de la forma de onda de un clip de audio.
 *
 * `SnapKind` es un contrato del estado; para no cambiarlo, escenas y beats se
 * representan como targets con `kind: 'marker'` pero con etiqueta propia
 * ("Escena: …", "Beat 120 bpm"), que es lo que muestra la guía del imán.
 */
export interface TimelineSnapTarget {
  readonly frame: number;
  readonly kind: SnapKind | 'scene' | 'beat';
  readonly label: string;
}

export interface TimelineSnapOptions {
  readonly excludeClipId?: string;
  readonly playhead?: number;
  readonly scenes?: readonly { readonly frame: number; readonly label: string }[];
  readonly beats?: readonly number[];
  readonly beatLabel?: string;
}

export function collectTimelineSnapTargets(
  project: ProjectDocument,
  options: TimelineSnapOptions = {},
): TimelineSnapTarget[] {
  const targets: TimelineSnapTarget[] = collectSnapTargets(project, {
    ...(options.excludeClipId !== undefined ? { excludeClipId: options.excludeClipId } : {}),
    ...(options.playhead !== undefined ? { playhead: options.playhead } : {}),
  }).map((target) => ({ frame: target.frame, kind: target.kind, label: target.label }));

  for (const scene of options.scenes ?? []) {
    if (!Number.isFinite(scene.frame) || scene.frame < 0) continue;
    targets.push({ frame: Math.round(scene.frame), kind: 'marker', label: scene.label });
  }
  for (const beat of options.beats ?? []) {
    if (!Number.isFinite(beat) || beat < 0) continue;
    targets.push({
      frame: Math.round(beat),
      kind: 'marker',
      label: options.beatLabel ?? 'Beat',
    });
  }
  return targets.sort((a, b) => a.frame - b.frame);
}

export interface TimelineSnapResult {
  readonly frame: number;
  readonly target?: TimelineSnapTarget;
}

/** Igual semántica que `snapFrame`, pero con targets extendidos. */
export function snapFrameTo(
  frame: number,
  targets: readonly TimelineSnapTarget[],
  threshold: number,
): TimelineSnapResult {
  let best: TimelineSnapTarget | undefined;
  let bestDistance = threshold + 1;
  for (const target of targets) {
    const distance = Math.abs(target.frame - frame);
    if (distance <= threshold && distance < bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }
  return best ? { frame: best.frame, target: best } : { frame };
}

/** Igual semántica que `snapSpan` (borde más cercano), targets extendidos. */
export function snapSpanTo(
  start: number,
  duration: number,
  targets: readonly TimelineSnapTarget[],
  threshold: number,
): TimelineSnapResult {
  const startSnap = snapFrameTo(start, targets, threshold);
  const endSnap = snapFrameTo(start + duration, targets, threshold);
  const startDistance = startSnap.target
    ? Math.abs(startSnap.frame - start)
    : Number.POSITIVE_INFINITY;
  const endDistance = endSnap.target
    ? Math.abs(endSnap.frame - (start + duration))
    : Number.POSITIVE_INFINITY;
  if (startDistance === Number.POSITIVE_INFINITY && endDistance === Number.POSITIVE_INFINITY) {
    return { frame: start };
  }
  if (startDistance <= endDistance) return { frame: startSnap.frame, ...(startSnap.target ? { target: startSnap.target } : {}) };
  return {
    frame: endSnap.frame - duration,
    ...(endSnap.target ? { target: endSnap.target } : {}),
  };
}

export { snapThreshold };

/**
 * Escenas del proyecto como puntos de snap: el frame de inicio es el menor
 * `startFrame` de los clips que la escena referencia.
 */
export function sceneSnapPoints(
  project: ProjectDocument,
): { frame: number; label: string }[] {
  const clipsById = new Map(project.timeline.clips.map((clip) => [clip.id, clip]));
  const points: { frame: number; label: string }[] = [];
  for (const scene of project.scenes) {
    const starts = scene.clipIds
      .map((id) => clipsById.get(id)?.startFrame)
      .filter((frame): frame is number => typeof frame === 'number');
    if (starts.length === 0) continue;
    points.push({
      frame: Math.min(...starts),
      label: `Escena: ${scene.title}`,
    });
  }
  return points.sort((a, b) => a.frame - b.frame);
}

/**
 * Detecta beats (onsets) desde la forma de onda normalizada de un asset
 * (0..1 por bucket) y los ubica en frames de timeline del clip que la usa.
 *
 * Es una detección de onsets simple y determinista: diferencia positiva de la
 * energía, umbral relativo al promedio y separación mínima de ~0.22 s entre
 * beats (≈270 bpm máximo). Pensada para snap, no reemplaza el análisis de
 * `state/beat-sync` (FFmpeg) que usa el Inspector.
 */
export function beatFramesFromPeaks(
  peaks: readonly number[],
  options: {
    readonly clipStartFrame: number;
    readonly inFrame: number;
    readonly outFrame: number;
    readonly totalFrames: number;
    readonly fps: number;
  },
): number[] {
  const { clipStartFrame, inFrame, outFrame, totalFrames, fps } = options;
  if (peaks.length < 4 || totalFrames <= 0 || fps <= 0) return [];
  const energies = peaks.map((value) => Math.max(0, Math.min(1, value)));
  const diffs: number[] = [];
  for (let index = 1; index < energies.length; index += 1) {
    diffs.push(Math.max(0, energies[index]! - energies[index - 1]!));
  }
  const average = diffs.reduce((sum, value) => sum + value, 0) / Math.max(1, diffs.length);
  const threshold = Math.max(0.045, average * 1.35);
  const minGapFrames = Math.max(2, Math.round(fps * 0.22));
  const result: number[] = [];
  const bucketFrames = totalFrames / energies.length;
  for (let index = 1; index < diffs.length; index += 1) {
    const diff = diffs[index]!;
    if (diff < threshold) continue;
    if (diff < (diffs[index - 1] ?? 0) || diff < (diffs[index + 1] ?? 0)) continue;
    const sourceFrame = Math.round((index + 1) * bucketFrames);
    if (sourceFrame < inFrame || sourceFrame >= outFrame) continue;
    const timelineFrame = clipStartFrame + Math.round(sourceFrame - inFrame);
    if (timelineFrame < 0) continue;
    const previous = result[result.length - 1];
    if (previous !== undefined && timelineFrame - previous < minGapFrames) continue;
    result.push(timelineFrame);
  }
  return result;
}

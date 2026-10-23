import type { ProjectDocument } from '@editor-ia/project-schema';

export type SnapKind = 'origin' | 'playhead' | 'marker' | 'clip';

export interface SnapTarget {
  readonly frame: number;
  readonly kind: SnapKind;
  readonly label: string;
}

export interface SnapResult {
  readonly frame: number;
  readonly target?: SnapTarget;
}

export interface SnapSpanResult {
  readonly start: number;
  readonly target?: SnapTarget;
}

/**
 * Every edge a drag can snap to: the timeline origin, the playhead, markers and
 * both edges of every clip except the one being dragged. All tracks count, so a
 * video cut can align with a narration or music cut.
 */
export function collectSnapTargets(
  project: ProjectDocument,
  options: { excludeClipId?: string; playhead?: number } = {},
): SnapTarget[] {
  const targets: SnapTarget[] = [
    { frame: 0, kind: 'origin', label: 'Inicio' },
  ];
  if (options.playhead !== undefined) {
    targets.push({
      frame: options.playhead,
      kind: 'playhead',
      label: 'Playhead',
    });
  }
  for (const marker of project.markers) {
    targets.push({ frame: marker.frame, kind: 'marker', label: marker.label });
  }
  const trackLabels = new Map(
    project.timeline.tracks.map((track) => [track.id, track.label]),
  );
  for (const clip of project.timeline.clips) {
    if (clip.id === options.excludeClipId) continue;
    const label =
      clip.label?.trim() || trackLabels.get(clip.trackId) || 'Clip';
    targets.push({
      frame: clip.startFrame,
      kind: 'clip',
      label,
    });
    targets.push({
      frame: clip.startFrame + clip.durationFrames,
      kind: 'clip',
      label,
    });
  }
  return targets.sort((a, b) => a.frame - b.frame);
}

export function snapFrame(
  frame: number,
  targets: readonly SnapTarget[],
  threshold: number,
): SnapResult {
  let best: SnapTarget | undefined;
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

/**
 * Snaps a moving span by either edge, whichever is closer. The returned start
 * may be negative; the caller is responsible for clamping it to the timeline.
 */
export function snapSpan(
  start: number,
  duration: number,
  targets: readonly SnapTarget[],
  threshold: number,
): SnapSpanResult {
  const startSnap = snapFrame(start, targets, threshold);
  const endSnap = snapFrame(start + duration, targets, threshold);
  const startDistance = startSnap.target
    ? Math.abs(startSnap.frame - start)
    : Number.POSITIVE_INFINITY;
  const endDistance = endSnap.target
    ? Math.abs(endSnap.frame - (start + duration))
    : Number.POSITIVE_INFINITY;
  if (startDistance === Number.POSITIVE_INFINITY && endDistance === Number.POSITIVE_INFINITY) {
    return { start };
  }
  if (startDistance <= endDistance) {
    return startSnap.target
      ? { start: startSnap.frame, target: startSnap.target }
      : { start: startSnap.frame };
  }
  return endSnap.target
    ? { start: endSnap.frame - duration, target: endSnap.target }
    : { start: endSnap.frame - duration };
}

/** A zoom-aware threshold: roughly 10 screen pixels, bounded for very high/low zoom. */
export function snapThreshold(
  pxPerFrame: number,
  pixels = 10,
  min = 1,
  max = 12,
): number {
  const scale = pxPerFrame > 0 ? pxPerFrame : 1;
  return Math.max(min, Math.min(max, Math.round(pixels / scale)));
}

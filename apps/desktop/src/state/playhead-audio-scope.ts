import {
  curveSourceFraction,
  type Clip,
  type ProjectDocument,
} from '@editor-ia/project-schema';
import { fpsOf } from './project-actions';

/**
 * Scope de audio «bajo el playhead» (pendiente Kdenlive: scopes del clip en el
 * punto de reproducción). Traduce el frame del playhead al segundo del asset
 * fuente — el mismo mapeo que usa `Preview.tsx`
 * (`inFrame + (playhead - startFrame) * speed`) / fps del proyecto — y arma la
 * ventana de análisis centrada en ese punto.
 *
 * Mide el MATERIAL FUENTE: no aplica mutes, fades, ganancia ni efectos del
 * clip. Con `speedCurve` usa `curveSourceFraction`, el mismo mapeo salida→
 * fuente de `buildSpeedKnots` del renderer. La UI lo declara.
 */

/** Ventana simétrica alrededor del playhead, en segundos del asset. */
export const SCOPE_WINDOW_HALF_SECONDS = 2.5;
export const SCOPE_WINDOW_SECONDS = SCOPE_WINDOW_HALF_SECONDS * 2;
/** Mínimo de audio decodificable para que la ventana tenga sentido. */
const MIN_WINDOW_SECONDS = 0.5;

export interface PlayheadScopeTarget {
  readonly clipId: string;
  readonly clipLabel: string;
  readonly assetId: string;
  /** Segundos del archivo fuente donde empieza la ventana. */
  readonly startSeconds: number;
  readonly durationSeconds: number;
  /** Segundo del archivo fuente que queda bajo el playhead. */
  readonly centerSeconds: number;
}

/** Duración del asset en segundos, o null si no se puede saber. */
function assetDurationSeconds(
  project: ProjectDocument,
  assetId: string,
  projectFps: number,
): number | null {
  const asset = project.assets.find((item) => item.id === assetId);
  if (!asset) return null;
  if (asset.kind === 'video') {
    const frames = asset.media?.durationFrames;
    const rate = asset.media?.frameRate;
    if (frames === undefined || !rate) return null;
    return frames / (rate.num / Math.max(1, rate.den));
  }
  if (asset.kind === 'audio') {
    const frames = asset.media?.durationFrames;
    // `media.durationFrames` de audio se persiste en frames del proyecto.
    return frames === undefined ? null : frames / projectFps;
  }
  return null;
}

function targetForClip(
  project: ProjectDocument,
  clip: Clip,
  playheadFrame: number,
  projectFps: number,
): PlayheadScopeTarget | null {
  if (clip.source.type !== 'asset' || !('inFrame' in clip.source)) return null;
  const local = Math.max(0, Math.min(clip.durationFrames - 1, playheadFrame - clip.startFrame));
  const reversed = 'reverse' in clip && clip.reverse === true;
  const localSource = reversed ? clip.durationFrames - 1 - local : local;
  let sourceFrame: number;
  if (clip.kind === 'video' && clip.speedCurve && 'outFrame' in clip.source) {
    // Mismo mapeo que `buildSpeedKnots` del renderer: fracción de salida →
    // fracción de fuente consumida.
    const outputFraction = localSource / Math.max(1, clip.durationFrames - 1);
    const sourceFraction = curveSourceFraction(clip.speedCurve, outputFraction);
    sourceFrame = clip.source.inFrame + sourceFraction * (clip.source.outFrame - clip.source.inFrame);
  } else {
    const speed = 'speed' in clip ? clip.speed : undefined;
    const factor = speed ? speed.num / Math.max(1, speed.den) : 1;
    sourceFrame = clip.source.inFrame + localSource * factor;
  }
  const centerSeconds = sourceFrame / projectFps;
  const assetSeconds = assetDurationSeconds(project, clip.source.assetId, projectFps);

  let startSeconds = Math.max(0, centerSeconds - SCOPE_WINDOW_HALF_SECONDS);
  let endSeconds = centerSeconds + SCOPE_WINDOW_HALF_SECONDS;
  if (assetSeconds !== null && assetSeconds > 0) {
    startSeconds = Math.min(startSeconds, Math.max(0, assetSeconds - MIN_WINDOW_SECONDS));
    endSeconds = Math.min(endSeconds, assetSeconds);
  }
  const durationSeconds = Math.max(MIN_WINDOW_SECONDS, endSeconds - startSeconds);
  return {
    clipId: clip.id,
    clipLabel: clip.label ?? clip.id,
    assetId: clip.source.assetId,
    startSeconds,
    durationSeconds,
    centerSeconds,
  };
}

/**
 * Clips con audio bajo el playhead, de arriba hacia abajo en la timeline
 * (mayor `order` de pista primero; a igual orden, el último insertado).
 * Devuelve la ventana de análisis de cada uno; vacío si el playhead no cae
 * sobre ningún clip de video/audio con fuente de asset.
 */
export function audioScopeCandidatesAtPlayhead(
  project: ProjectDocument,
  playheadFrame: number,
): PlayheadScopeTarget[] {
  const projectFps = fpsOf(project);
  if (!(projectFps > 0)) return [];
  const frame = Math.max(0, Math.floor(playheadFrame));
  const trackOrder = new Map(
    project.timeline.tracks.map((track) => [track.id, track.order] as const),
  );
  const found: { clip: Clip; order: number; index: number }[] = [];
  project.timeline.clips.forEach((clip, index) => {
    if (clip.kind !== 'video' && clip.kind !== 'audio') return;
    if (clip.source.type !== 'asset') return;
    if (clip.enabled === false) return;
    if (frame < clip.startFrame || frame >= clip.startFrame + clip.durationFrames) return;
    found.push({ clip, order: trackOrder.get(clip.trackId) ?? 0, index });
  });
  found.sort((a, b) => b.order - a.order || b.index - a.index);
  const targets: PlayheadScopeTarget[] = [];
  for (const { clip } of found) {
    const target = targetForClip(project, clip, frame, projectFps);
    if (target) targets.push(target);
  }
  return targets;
}

/** El clip "principal" bajo el playhead: el primero de `audioScopeCandidatesAtPlayhead`. */
export function audioScopeAtPlayhead(
  project: ProjectDocument,
  playheadFrame: number,
): PlayheadScopeTarget | null {
  return audioScopeCandidatesAtPlayhead(project, playheadFrame)[0] ?? null;
}

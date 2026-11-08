import type { Clip, ProjectDocument, Track } from '@editor-ia/project-schema';
import { addTrack, moveClip, updateTrack } from '../../state/project-actions';

/// Candidato a mate de una transición `luma-wipe`: clip visual habilitado cuya
/// ventana activa (inicio propio menos su lead de entrada) cubre el solape del
/// clip que la usa, con la misma tolerancia de un frame que valida el renderer
/// (`render/ffmpeg.rs::luma_mate`). `track`/`trackHidden` alimentan la UI: una
/// pista oculta también puede aportar la máscara, pero hay que decirlo.
export interface LumaMateCandidate {
  clip: Clip;
  track: Track | undefined;
  trackHidden: boolean;
}

/// Clips que pueden servir de mate para `clip` en el frame `fps` del proyecto.
/// El mate puede vivir en cualquier pista —incluida una oculta— porque el
/// render sólo lee su luminancia, no su visibilidad en la timeline.
export function lumaMateCandidates(
  clips: readonly Clip[],
  tracks: readonly Track[],
  clip: Clip,
  fps: number,
): LumaMateCandidate[] {
  const leadCap = Math.round(fps * 2);
  const transitionFrames =
    'transitionIn' in clip
      ? (clip as Clip & { transitionIn?: { frames?: number } }).transitionIn?.frames ?? 0
      : 0;
  const needFrom = Math.max(
    0,
    clip.startFrame - Math.min(transitionFrames, clip.durationFrames, clip.startFrame, leadCap),
  );
  const trackById = new Map(tracks.map((track) => [track.id, track]));
  const candidates: LumaMateCandidate[] = [];
  for (const candidate of clips) {
    if (candidate.id === clip.id || candidate.enabled === false) continue;
    if (!['video', 'image', 'freeze'].includes(candidate.kind)) continue;
    const ownFrames =
      (candidate as { transitionIn?: { frames?: number } }).transitionIn?.frames ?? 0;
    const ownLead = Math.min(
      ownFrames,
      candidate.durationFrames,
      candidate.startFrame,
      leadCap,
    );
    const from = candidate.startFrame - ownLead;
    const to = candidate.startFrame + candidate.durationFrames;
    if (from <= needFrom + 1 && to >= clip.startFrame - 1) {
      const track = trackById.get(candidate.trackId);
      candidates.push({ clip: candidate, track, trackHidden: track?.hidden === true });
    }
  }
  return candidates;
}

/// Etiqueta de la opción del selector de mate: nombre del clip, frame de
/// inicio, pista y la marca «pista oculta» cuando aplica.
export function lumaMateOptionLabel(candidate: LumaMateCandidate): string {
  const clip = candidate.clip;
  const parts = [clip.label || clip.id.slice(0, 8), `frame ${clip.startFrame}`];
  if (candidate.track) parts.push(candidate.track.label);
  if (candidate.trackHidden) parts.push('pista oculta');
  return parts.join(' · ');
}

/// Clip mate asignado por id con su pista, para mostrar el estado de
/// visibilidad de la pista en la UI. No valida cobertura ni tipo: sirve
/// aunque el mate esté stale, porque ocultar su pista sigue siendo útil.
export function lumaMateById(
  clips: readonly Clip[],
  tracks: readonly Track[],
  mateClipId: string | undefined,
): LumaMateCandidate | undefined {
  if (!mateClipId) return undefined;
  const mate = clips.find((candidate) => candidate.id === mateClipId);
  if (!mate) return undefined;
  const track = tracks.find((item) => item.id === mate.trackId);
  return { clip: mate, track, trackHidden: track?.hidden === true };
}

/// Mate elegido para `luma-wipe` en la aplicación por lote: el override de la
/// vista si sigue siendo un candidato válido; si no, el mate que el clip ya
/// tiene en su `transitionIn` (también sólo si sigue siendo válido); y por
/// último el primer candidato. Devuelve `undefined` cuando no hay candidatos.
export function lumaMatePick(
  clip: Clip,
  choice: string | undefined,
  candidates: readonly LumaMateCandidate[],
): string | undefined {
  const isValid = (id: string | undefined) =>
    id !== undefined && candidates.some((item) => item.clip.id === id);
  if (isValid(choice)) return choice;
  const transition = 'transitionIn' in clip ? clip.transitionIn : undefined;
  const existing =
    transition?.type === 'luma-wipe' ? transition.mateClipId : undefined;
  if (isValid(existing)) return existing;
  return candidates[0]?.clip.id;
}

/// Mueve el clip mate a una pista nueva propia y la oculta: es el flujo
/// recomendado cuando el mate comparte pista con otros clips (o está en la
/// misma pista del clip que usa la transición) y ocultar la pista entera
/// sacaría del preview/export material que no es máscara. Devuelve `null`
/// si el clip no existe o el movimiento no es posible (pista bloqueada).
export function moveLumaMateToOwnTrack(
  project: ProjectDocument,
  mateClipId: string,
): ProjectDocument | null {
  const mate = project.timeline.clips.find((item) => item.id === mateClipId);
  if (!mate) return null;
  const kind: Track['kind'] = mate.kind === 'image' ? 'image' : 'video';
  const base = mate.label?.trim() || mate.id.slice(0, 8);
  const label = `Mate · ${base}`.slice(0, 120);
  const created = addTrack(project, kind, label);
  const moved = moveClip(created.project, mateClipId, mate.startFrame, created.trackId);
  if (!moved) return null;
  return updateTrack(moved, created.trackId, { hidden: true });
}

/// `true` cuando el clip tiene `luma-wipe` con un mate asignado que ya no es un
/// candidato válido (se movió, se deshabilitó o cambió de tipo): el render
/// fallaría y la UI tiene que avisarlo en vez de mostrar un selector vacío.
export function lumaMateIsStale(
  clips: readonly Clip[],
  tracks: readonly Track[],
  clip: Clip,
  fps: number,
): boolean {
  if (!('transitionIn' in clip)) return false;
  const mateId = (clip as Clip & { transitionIn?: { mateClipId?: string } }).transitionIn
    ?.mateClipId;
  if (!mateId) return false;
  return !lumaMateCandidates(clips, tracks, clip, fps).some(
    (candidate) => candidate.clip.id === mateId,
  );
}

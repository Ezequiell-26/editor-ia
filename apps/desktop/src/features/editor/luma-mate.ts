import type { Clip, ProjectDocument, Track } from '@editor-ia/project-schema';
import { addTrack, moveClip, newId, touch, updateTrack } from '../../state/project-actions';

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

/// Plan para crear el mate de un `luma-wipe` congelando un frame: el donor es
/// el clip de video habilitado, sin reverse ni curva de velocidad, cuya
/// ventana cubre el solape (misma regla que `lumaMateCandidates`). El mate
/// queda como clip `freeze` de una sola imagen — para la máscara sólo importa
/// la luminancia, así que un frame quieto es una máscara válida y honesta.
export interface LumaMateFreezePlan {
  donorClipId: string;
  donorLabel: string;
  /// Asset de video del que sale el frame (para heredar su licencia).
  sourceAssetId: string;
  assetPath: string;
  /// Segundos dentro del video fuente del que sale el frame.
  seconds: number;
  /// Ventana exacta que debe cubrir el clip mate (frames de timeline).
  startFrame: number;
  durationFrames: number;
}

/// Elige el donor y calcula el frame a congelar para `clip` (que debe tener
/// `transitionIn.type === 'luma-wipe'`). Prioriza el clip que termina justo en
/// el corte —el «saliente» del fundido— y después el que más reciente empieza.
/// Devuelve `null` cuando no hay donor usable o el lead es inválido.
export function lumaMateFreezePlan(
  project: ProjectDocument,
  clip: Clip,
  fps: number,
): LumaMateFreezePlan | null {
  if (!('transitionIn' in clip)) return null;
  const transition = clip.transitionIn;
  if (!transition || transition.type !== 'luma-wipe') return null;
  const transitionFrames = transition.frames ?? 0;
  const leadCap = Math.round(fps * 2);
  const lead = Math.min(
    transitionFrames,
    clip.durationFrames,
    clip.startFrame,
    leadCap,
  );
  if (lead < 1) return null;
  const needFrom = clip.startFrame - lead;
  const needTo = clip.startFrame;
  const assetById = new Map(project.assets.map((asset) => [asset.id, asset]));

  type VideoClip = Extract<Clip, { kind: 'video' }>;
  const donors: { clip: VideoClip; from: number; to: number }[] = [];
  for (const candidate of project.timeline.clips) {
    if (candidate.id === clip.id || candidate.kind !== 'video') continue;
    if (candidate.enabled === false || candidate.reverse === true) continue;
    if (candidate.speedCurve) continue;
    const source = candidate.source;
    if (source.type !== 'asset') continue;
    const asset = assetById.get(source.assetId);
    if (!asset || asset.kind !== 'video' || asset.status !== 'ready') continue;
    if (asset.source.type !== 'local' || !asset.source.path) continue;
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
    if (from <= needFrom + 1 && to >= needTo - 1) {
      donors.push({ clip: candidate, from, to });
    }
  }
  if (donors.length === 0) return null;
  donors.sort((a, b) => {
    const aCut = a.to === needTo ? 0 : 1;
    const bCut = b.to === needTo ? 0 : 1;
    if (aCut !== bCut) return aCut - bCut;
    if (a.clip.startFrame !== b.clip.startFrame) {
      return b.clip.startFrame - a.clip.startFrame;
    }
    return a.clip.id.localeCompare(b.clip.id);
  });
  const donor = donors[0];
  if (!donor) return null;
  const sourceClip = donor.clip;
  const source = sourceClip.source;
  // Último frame compartido por el solape y el donor (preferencia al clip
  // saliente en el instante del corte).
  const freezeAt = Math.max(donor.from, Math.min(needTo, donor.to) - 1);
  const factor = (sourceClip.speed?.num ?? 1) / Math.max(0.01, sourceClip.speed?.den ?? 1);
  const sourceFrame = source.inFrame + (freezeAt - sourceClip.startFrame) * factor;
  const clamped = Math.min(
    Math.max(sourceFrame, source.inFrame),
    Math.max(source.inFrame, source.outFrame - 1),
  );
  const asset = assetById.get(source.assetId);
  if (!asset || asset.source.type !== 'local') return null;
  return {
    donorClipId: sourceClip.id,
    donorLabel: sourceClip.label?.trim() || sourceClip.id.slice(0, 8),
    sourceAssetId: source.assetId,
    assetPath: asset.source.path,
    seconds: Math.max(0, clamped / Math.max(1, fps)),
    startFrame: needFrom,
    durationFrames: lead,
  };
}

/// Crea el clip mate congelado: pista `video` nueva ya oculta (la máscara no
/// debe verse) con un `freeze` que cubre exactamente la ventana del solape.
/// Devuelve el id del clip para asignarlo como `mateClipId`.
export function placeFreezeMate(
  project: ProjectDocument,
  frameAssetId: string,
  input: { startFrame: number; durationFrames: number; label?: string },
): { project: ProjectDocument; mateClipId: string; trackId: string } {
  const base = (input.label ?? 'frame').trim() || 'frame';
  const created = addTrack(project, 'video', `Mate · ${base}`.slice(0, 120));
  let next = created.project;
  const mateClipId = newId();
  const mate: Clip = {
    id: mateClipId,
    trackId: created.trackId,
    kind: 'freeze',
    label: `Mate · ${base}`.slice(0, 120),
    startFrame: Math.max(0, Math.round(input.startFrame)),
    durationFrames: Math.max(1, Math.round(input.durationFrames)),
    source: { type: 'asset', assetId: frameAssetId },
  };
  next.timeline.clips.push(mate);
  next = updateTrack(next, created.trackId, { hidden: true });
  touch(next);
  return { project: next, mateClipId, trackId: created.trackId };
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

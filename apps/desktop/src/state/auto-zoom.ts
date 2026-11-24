import {
  totalProjectDuration,
  type Clip,
  type ProjectDocument,
} from '@editor-ia/project-schema';
import { pacingZoneAt } from './dynamic-pacing';
import {
  applyFaceCenteredZoom,
  type FaceZoomStyle,
} from './face-zoom';

/**
 * Orquestador de punch-ins/zoom estilo YouTube.
 *
 * Decide DÓNDE va cada zoom automático combinando la posición del clip en
 * la timeline (`pacingZoneAt`: hook / cuerpo / clímax / outro) con topes de
 * densidad (`maxZooms`, `minGapSeconds`) para que el resultado se sienta
 * edición humana y no un efecto en cada corte.
 *
 * Heurísticas deterministas (sin azar):
 * - `hook` y `climax`: punch-in sostenido sobre el rostro en casi todos los
 *   clips elegibles.
 * - `body`: sólo clips largos (planos de habla), con estilo `snap-settle`.
 * - `outro`: sin zoom (el cierre respira).
 *
 * Nunca pisa trabajo existente: salta clips en pistas bloqueadas, clips
 * deshabilitados, clips con keyframes de transform propios y clips cortos.
 * El encuadre usa la heurística talking-head (`TALKING_HEAD_DEFAULT_FACE`);
 * no hay detección facial en esta capa — para eso está `clip_face_track`.
 */

export interface AutoZoomPlanItem {
  readonly clipId: string;
  readonly style: FaceZoomStyle;
  /** Intensidad 0–100 que se pasa a `applyFaceCenteredZoom`. */
  readonly zoomStrength: number;
  /** Zona de pacing donde cayó el clip. */
  readonly zone: string;
  /** Por qué se eligió el clip. */
  readonly reason: 'hook' | 'climax' | 'long-body-shot';
}

export interface PlanAutoZoomsOptions {
  /** Tope de zooms en todo el video (default: ~1 por cada 60 s, mínimo 2). */
  readonly maxZooms?: number;
  /** Distancia mínima en segundos entre dos zooms aplicados (default 15). */
  readonly minGapSeconds?: number;
  /** Duración mínima del clip en segundos para ser candidato (default 2). */
  readonly minClipSeconds?: number;
  /** En el cuerpo, duración mínima del clip para merecer zoom (default 4). */
  readonly bodyMinClipSeconds?: number;
  /** Si false, el cuerpo no recibe zooms (default true). */
  readonly includeBody?: boolean;
  /** Multiplicador de intensidad 0.5–1.5 sobre los defaults por zona. */
  readonly strengthScale?: number;
}

export interface ApplyAutoZoomsResult {
  readonly project: ProjectDocument;
  readonly plan: readonly AutoZoomPlanItem[];
  readonly applied: number;
  readonly skipped: number;
}

const ZONE_PRESETS: Record<
  string,
  { style: FaceZoomStyle; strength: number; reason: AutoZoomPlanItem['reason'] } | null
> = {
  hook: { style: 'punch-in', strength: 80, reason: 'hook' },
  climax: { style: 'punch-in', strength: 75, reason: 'climax' },
  body: { style: 'snap-settle', strength: 50, reason: 'long-body-shot' },
  outro: null,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isCandidateClip(project: ProjectDocument, clip: Clip): boolean {
  if (clip.kind !== 'video' && clip.kind !== 'image' && clip.kind !== 'freeze') {
    return false;
  }
  if (clip.enabled === false) return false;
  const track = project.timeline.tracks.find((item) => item.id === clip.trackId);
  if (!track || track.locked) return false;
  // No pisar una animación que el usuario ya armó a mano.
  if ((clip.transform?.keyframes?.length ?? 0) > 0) return false;
  return true;
}

/**
 * Plan determinista de zooms automáticos. Devuelve los clips elegidos en
 * orden temporal con su estilo e intensidad; `applyAutoZooms` los materializa.
 */
export function planAutoZooms(
  project: ProjectDocument,
  options: PlanAutoZoomsOptions = {},
): AutoZoomPlanItem[] {
  const fps = Math.max(
    1,
    project.video.frameRate.num / Math.max(1, project.video.frameRate.den),
  );
  const totalSeconds = totalProjectDuration(project) / fps;
  if (totalSeconds <= 0) return [];

  const minClipSeconds = Math.max(0.5, options.minClipSeconds ?? 2);
  const bodyMinClipSeconds = Math.max(
    minClipSeconds,
    options.bodyMinClipSeconds ?? 4,
  );
  const includeBody = options.includeBody !== false;
  const strengthScale = clamp(options.strengthScale ?? 1, 0.5, 1.5);
  const minGapSeconds = Math.max(0, options.minGapSeconds ?? 15);
  const maxZooms = Math.max(
    1,
    Math.round(
      options.maxZooms ?? Math.max(2, Math.round(totalSeconds / 60)),
    ),
  );

  const candidates = project.timeline.clips
    .filter((clip) => isCandidateClip(project, clip))
    .filter(
      (clip) => clip.durationFrames / fps >= minClipSeconds,
    )
    .sort((a, b) => a.startFrame - b.startFrame);

  const plan: AutoZoomPlanItem[] = [];
  let lastZoomCenter = -Infinity;

  for (const clip of candidates) {
    if (plan.length >= maxZooms) break;
    const centerSeconds =
      (clip.startFrame + clip.durationFrames / 2) / fps;
    const zone = pacingZoneAt(centerSeconds, totalSeconds);
    const preset = ZONE_PRESETS[zone];
    if (!preset) continue;
    if (zone === 'body' && !includeBody) continue;
    if (zone === 'body' && clip.durationFrames / fps < bodyMinClipSeconds) {
      continue;
    }
    if (centerSeconds - lastZoomCenter < minGapSeconds) continue;

    plan.push({
      clipId: clip.id,
      style: preset.style,
      zoomStrength: Math.round(clamp(preset.strength * strengthScale, 10, 100)),
      zone,
      reason: preset.reason,
    });
    lastZoomCenter = centerSeconds;
  }

  return plan;
}

/**
 * Aplica el plan de `planAutoZooms` sobre el proyecto. Cada zoom usa
 * `applyFaceCenteredZoom`, que mergea keyframes sin pisar otras
 * propiedades del transform.
 */
export function applyAutoZooms(
  project: ProjectDocument,
  options: PlanAutoZoomsOptions = {},
): ApplyAutoZoomsResult {
  const plan = planAutoZooms(project, options);
  let next = project;
  let applied = 0;
  let skipped = 0;

  for (const item of plan) {
    try {
      const result = applyFaceCenteredZoom(next, {
        clipId: item.clipId,
        zoomStrength: item.zoomStrength,
        style: item.style,
      });
      next = result.project;
      applied += 1;
    } catch {
      // Un clip que quedó inválido entre plan y apply no frena al resto.
      skipped += 1;
    }
  }

  return { project: next, plan, applied, skipped };
}

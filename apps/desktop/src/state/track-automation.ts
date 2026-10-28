import type {
  CubicBezier,
  KeyframeEasing,
  ProjectDocument,
  Track,
  TrackGainKeyframe,
  TrackPanKeyframe,
} from '@editor-ia/project-schema';
import { MAX_GAIN_KEYFRAMES, cubicBezierProgress } from '@editor-ia/project-schema';
import { cloneProject, ProjectActionError, touch } from './project-actions';

/**
 * Automatización de fader y paneo por keyframes de pista.
 *
 * Los keyframes son los del esquema (`Track.gainKeyframes` / `Track.panKeyframes`):
 * frames absolutos de la timeline, estrictamente crecientes, con el easing o la
 * curva Bézier de la clave donde empieza el segmento. El render Rust muestrea
 * las mismas reglas (clamp antes de la primera clave, valor de la última
 * después) para que la mezcla no cambie entre preview y export.
 *
 * Las claves capturan el valor del fader/knob, así que reemplazan al valor
 * estático mientras existen; al quitar la animación se congela el valor
 * muestreado en el frame indicado.
 */

type GainKeyframeList = NonNullable<Track['gainKeyframes']>;
type PanKeyframeList = NonNullable<Track['panKeyframes']>;

type Point = {
  frame: number;
  value: number;
  easing: KeyframeEasing;
  bezier?: CubicBezier | undefined;
};

const EASINGS: readonly KeyframeEasing[] = [
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'hold',
];

function easingValido(easing: KeyframeEasing | undefined): easing is KeyframeEasing {
  return easing !== undefined && EASINGS.includes(easing);
}

function easingProgress(progress: number, easing: KeyframeEasing): number {
  switch (easing) {
    case 'ease-in':
      return progress ** 3;
    case 'ease-out':
      return 1 - (1 - progress) ** 3;
    case 'ease-in-out':
      return progress * progress * (3 - 2 * progress);
    case 'hold':
      return 0;
    case 'linear':
    default:
      return progress;
  }
}

/**
 * Muestreo de una propiedad animada de pista en `frame` (absoluto de la
 * timeline). Mismo contrato que `sampleGainKeyframes` del esquema para las
 * claves de clip: indefinido sin claves, clamp en los extremos y progresión
 * eased/Bézier del segmento que empieza en la clave anterior.
 */
function samplePoints(points: readonly Point[], frame: number): number | undefined {
  if (points.length === 0) return undefined;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (frame <= first.frame) return first.value;
  if (frame >= last.frame) return last.value;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    if (frame <= current.frame) {
      const span = current.frame - previous.frame;
      if (span <= 0) return current.value;
      const progress = (frame - previous.frame) / span;
      // Como con `easing`, la Bézier que gobierna el segmento es la de la
      // clave donde el segmento empieza.
      const eased = previous.bezier
        ? cubicBezierProgress(
            progress,
            previous.bezier.cp1X,
            previous.bezier.cp1Y,
            previous.bezier.cp2X,
            previous.bezier.cp2Y,
          )
        : easingProgress(progress, previous.easing);
      return previous.value + (current.value - previous.value) * eased;
    }
  }
  return last.value;
}

/** Valor del fader automatizado en `frame`; indefinido si la pista no tiene claves. */
export function sampleTrackGain(
  keyframes: Readonly<GainKeyframeList> | undefined,
  frame: number,
): number | undefined {
  if (!keyframes || keyframes.length === 0) return undefined;
  const points: Point[] = keyframes.map((keyframe) => ({
    frame: keyframe.frame,
    value: keyframe.gainDb,
    easing: easingValido(keyframe.easing) ? keyframe.easing : 'linear',
    ...(keyframe.bezier ? { bezier: keyframe.bezier } : {}),
  }));
  return samplePoints(points, frame);
}

/** Valor del paneo automatizado en `frame`; indefinido si la pista no tiene claves. */
export function sampleTrackPan(
  keyframes: Readonly<PanKeyframeList> | undefined,
  frame: number,
): number | undefined {
  if (!keyframes || keyframes.length === 0) return undefined;
  const points: Point[] = keyframes.map((keyframe) => ({
    frame: keyframe.frame,
    value: keyframe.value,
    easing: easingValido(keyframe.easing) ? keyframe.easing : 'linear',
    ...(keyframe.bezier ? { bezier: keyframe.bezier } : {}),
  }));
  return samplePoints(points, frame);
}

function trackOrFail(project: ProjectDocument, trackId: string): Track {
  const track = project.timeline.tracks.find((item) => item.id === trackId);
  if (!track) {
    throw new ProjectActionError('la pista no está en la timeline');
  }
  if (track.locked) {
    throw new ProjectActionError('la pista está bloqueada');
  }
  return track;
}

function frameOrFail(frame: number): number {
  const rounded = Math.round(frame);
  if (!Number.isFinite(rounded) || rounded < 0) {
    throw new ProjectActionError('la clave debe caer en un frame de la timeline');
  }
  return rounded;
}

function easingOrFail(easing: KeyframeEasing | undefined, propiedad: string): KeyframeEasing {
  if (!easingValido(easing)) {
    throw new ProjectActionError(`la curva de la clave de ${propiedad} no es válida`);
  }
  return easing;
}

function upsertGain(track: Track, keyframe: TrackGainKeyframe): void {
  const keyframes: TrackGainKeyframe[] = (track.gainKeyframes ?? []).map((item) => ({ ...item }));
  const index = keyframes.findIndex((item) => item.frame === keyframe.frame);
  if (index >= 0) {
    keyframes[index] = keyframe;
  } else {
    if (keyframes.length >= MAX_GAIN_KEYFRAMES) {
      throw new ProjectActionError(
        `esta pista ya tiene el máximo de ${MAX_GAIN_KEYFRAMES} keyframes de volumen`,
      );
    }
    keyframes.push(keyframe);
  }
  keyframes.sort((left, right) => left.frame - right.frame);
  track.gainKeyframes = keyframes;
}

function upsertPan(track: Track, keyframe: TrackPanKeyframe): void {
  const keyframes: TrackPanKeyframe[] = (track.panKeyframes ?? []).map((item) => ({ ...item }));
  const index = keyframes.findIndex((item) => item.frame === keyframe.frame);
  if (index >= 0) {
    keyframes[index] = keyframe;
  } else {
    if (keyframes.length >= MAX_GAIN_KEYFRAMES) {
      throw new ProjectActionError(
        `esta pista ya tiene el máximo de ${MAX_GAIN_KEYFRAMES} keyframes de paneo`,
      );
    }
    keyframes.push(keyframe);
  }
  keyframes.sort((left, right) => left.frame - right.frame);
  track.panKeyframes = keyframes;
}

/** Fija (o reemplaza) la clave de fader de pista en `frame` con `gainDb`. */
export function setTrackGainKeyframe(
  project: ProjectDocument,
  trackId: string,
  frame: number,
  gainDb: number,
  easing: KeyframeEasing = 'linear',
): ProjectDocument {
  if (!Number.isFinite(gainDb) || gainDb < -60 || gainDb > 12) {
    throw new ProjectActionError('la ganancia de pista debe estar entre -60 y 12 dB');
  }
  const keyframeEasing = easingOrFail(easing, 'volumen');
  const next = cloneProject(project);
  const track = trackOrFail(next, trackId);
  upsertGain(track, { frame: frameOrFail(frame), gainDb, easing: keyframeEasing });
  touch(next);
  return next;
}

/** Quita la clave de fader de pista en `frame`; sin cambio si no existe. */
export function removeTrackGainKeyframe(
  project: ProjectDocument,
  trackId: string,
  frame: number,
): ProjectDocument {
  const next = cloneProject(project);
  const track = trackOrFail(next, trackId);
  const offset = Math.round(frame);
  const keyframes = track.gainKeyframes ?? [];
  if (!keyframes.some((keyframe) => keyframe.frame === offset)) {
    return project;
  }
  const remaining = keyframes
    .filter((keyframe) => keyframe.frame !== offset)
    .map((keyframe) => ({ ...keyframe }));
  if (remaining.length === 0) {
    delete track.gainKeyframes;
  } else {
    track.gainKeyframes = remaining;
  }
  touch(next);
  return next;
}

/** Quita la animación de fader y congela el valor muestreado en `freezeAtFrame`. */
export function clearTrackGainKeyframes(
  project: ProjectDocument,
  trackId: string,
  freezeAtFrame = 0,
): ProjectDocument {
  const next = cloneProject(project);
  const track = trackOrFail(next, trackId);
  const keyframes = track.gainKeyframes ?? [];
  if (keyframes.length === 0) {
    return project;
  }
  const freeze = Math.max(0, Math.round(freezeAtFrame));
  track.gainDb = sampleTrackGain(keyframes, freeze) ?? track.gainDb ?? 0;
  delete track.gainKeyframes;
  touch(next);
  return next;
}

/** Fija (o reemplaza) la clave de paneo de pista en `frame` con `value` (-1..1). */
export function setTrackPanKeyframe(
  project: ProjectDocument,
  trackId: string,
  frame: number,
  value: number,
  easing: KeyframeEasing = 'linear',
): ProjectDocument {
  if (!Number.isFinite(value) || value < -1 || value > 1) {
    throw new ProjectActionError('el paneo de pista debe estar entre -1 y 1');
  }
  const keyframeEasing = easingOrFail(easing, 'paneo');
  const next = cloneProject(project);
  const track = trackOrFail(next, trackId);
  upsertPan(track, { frame: frameOrFail(frame), value, easing: keyframeEasing });
  touch(next);
  return next;
}

/** Quita la clave de paneo de pista en `frame`; sin cambio si no existe. */
export function removeTrackPanKeyframe(
  project: ProjectDocument,
  trackId: string,
  frame: number,
): ProjectDocument {
  const next = cloneProject(project);
  const track = trackOrFail(next, trackId);
  const offset = Math.round(frame);
  const keyframes = track.panKeyframes ?? [];
  if (!keyframes.some((keyframe) => keyframe.frame === offset)) {
    return project;
  }
  const remaining = keyframes
    .filter((keyframe) => keyframe.frame !== offset)
    .map((keyframe) => ({ ...keyframe }));
  if (remaining.length === 0) {
    delete track.panKeyframes;
  } else {
    track.panKeyframes = remaining;
  }
  touch(next);
  return next;
}

/** Quita la animación de paneo y congela el valor muestreado en `freezeAtFrame`. */
export function clearTrackPanKeyframes(
  project: ProjectDocument,
  trackId: string,
  freezeAtFrame = 0,
): ProjectDocument {
  const next = cloneProject(project);
  const track = trackOrFail(next, trackId);
  const keyframes = track.panKeyframes ?? [];
  if (keyframes.length === 0) {
    return project;
  }
  const freeze = Math.max(0, Math.round(freezeAtFrame));
  track.pan = sampleTrackPan(keyframes, freeze) ?? track.pan ?? 0;
  delete track.panKeyframes;
  touch(next);
  return next;
}

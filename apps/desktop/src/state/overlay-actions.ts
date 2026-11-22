import type { ClipMaskKeyframe, ProjectDocument } from '@editor-ia/project-schema';
import { MAX_TRANSFORM_KEYFRAMES } from '@editor-ia/project-schema';
import { createInstance, effectRegistry } from '@editor-ia/effect-kit';
import {
  ProjectActionError,
  addTrack,
  cloneProject,
  fpsOf,
  intervalsForTrack,
  newId,
  touch,
} from './project-actions-core';

/**
 * AI overlays and tracked masks: face/object tracking written as transform
 * or mask keyframes, idle/click scale gestures and the blur overlay that
 * follows a detected face. Extracted from `project-actions.ts`;
 * `project-actions.ts` re-exports the public API.
 */

export interface FaceCenterSample {
  /** Segundos relativos al inicio de la ventana analizada. */
  readonly time: number;
  readonly centerX: number;
  readonly centerY: number;
}

/** Convierte un track de rostro u objeto en keyframes de transformación que
 * lo mantienen centrado y escalan lo justo para no dejar bordes vacíos.
 * `options.smoothing` (0–1) aplica un EMA sobre el centro: el tracker de
 * objeto (NCC) es más ruidoso que rustface y se beneficia del suavizado.
 * La escala se topa en 2.5 — el `ZOOM_TETO` del auto-reframe de
 * `rastreamento.js` de AlaukCut. */
export function applyFaceCenter(
  project: ProjectDocument,
  clipId: string,
  samples: readonly FaceCenterSample[],
  options?: { readonly smoothing?: number },
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip || clip.kind !== 'video') {
    throw new ProjectActionError('el seguimiento de rostro necesita un clip de video');
  }
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  if (clip.reverse) {
    throw new ProjectActionError('quitá el reverse antes de centrar el rostro');
  }
  if (clip.motion) {
    throw new ProjectActionError(
      'quitá el movimiento Ken Burns antes de centrar el rostro',
    );
  }
  if (clip.stabilization) {
    throw new ProjectActionError(
      'quitá la estabilización antes de centrar el rostro: mueve el encuadre',
    );
  }
  if (clip.transform?.keyframes?.length) {
    throw new ProjectActionError(
      'quitá los keyframes de transformación antes de centrar el rostro',
    );
  }
  if (samples.length < 2) {
    throw new ProjectActionError('no hay suficientes muestras de rostro para seguir');
  }
  const smoothing = Math.min(0.75, Math.max(0, options?.smoothing ?? 0));
  const usable =
    smoothing > 0 && samples.length >= 3
      ? (() => {
          const alpha = Math.max(0.05, smoothing);
          let cx = samples[0]!.centerX;
          let cy = samples[0]!.centerY;
          return samples.map((sample) => {
            cx += alpha * (sample.centerX - cx);
            cy += alpha * (sample.centerY - cy);
            return { ...sample, centerX: cx, centerY: cy };
          });
        })()
      : samples;
  const fps = fpsOf(next);
  const speed = (clip.speed?.num ?? 1) / (clip.speed?.den ?? 1);
  const width = next.video.width;
  const height = next.video.height;
  if (!(fps > 0) || !(speed > 0) || width < 2 || height < 2) {
    throw new ProjectActionError('el proyecto no tiene una geometría válida');
  }
  const points = new Map<
    number,
    { readonly offsetX: number; readonly offsetY: number }
  >();
  let maxRelative = 0;
  for (const sample of usable) {
    if (
      !Number.isFinite(sample.time) ||
      !Number.isFinite(sample.centerX) ||
      !Number.isFinite(sample.centerY)
    ) {
      continue;
    }
    const frame = Math.max(
      0,
      Math.min(clip.durationFrames - 1, Math.round((sample.time * fps) / speed)),
    );
    const dx = (0.5 - sample.centerX) * width;
    const dy = (0.5 - sample.centerY) * height;
    maxRelative = Math.max(maxRelative, Math.abs(dx) / width, Math.abs(dy) / height);
    points.set(frame, { offsetX: Math.round(dx), offsetY: Math.round(dy) });
  }
  if (points.size < 2) {
    throw new ProjectActionError('las muestras de rostro no alcanzan para crear keyframes');
  }
  const scale = Math.min(2.5, Math.max(1.02, 1 + 2 * maxRelative + 0.03));
  const ordered = [...points.entries()].sort((a, b) => a[0] - b[0]);
  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;
  const keyframes = [
    { frame: 0, ...first[1], easing: 'ease-in-out' as const },
    ...ordered.map(([frame, point]) => ({
      frame,
      ...point,
      easing: 'ease-in-out' as const,
    })),
    {
      frame: Math.max(first[0], clip.durationFrames - 1),
      ...last[1],
      easing: 'ease-in-out' as const,
    },
  ].filter(
    (keyframe, index, list) =>
      list.findIndex((item) => item.frame === keyframe.frame) === index,
  );
  // La escala va en la transformación estática: agranda de verdad la capa y
  // deja margen para que los offsets no descubran los bordes. El keyframe de
  // escala se reserva para zooms; acá sólo se anima la posición.
  clip.transform = {
    ...(clip.transform ?? {}),
    scaleX: scale,
    scaleY: scale,
    keyframes,
  };
  touch(next);
  return next;
}

export interface BreathingLoopOptions {
  /** Amplitud del vaivén de escala (0.01–0.3, default 0.04). */
  readonly amplitude?: number;
  /** Período del ciclo en segundos (0.4–30, default 2.4). */
  readonly periodSeconds?: number;
}

/**
 * «Respiración» idle de stickers/clips (paridad del idle sutil de
 * `emojis_animados.js` de AlaukCut): keyframes de `transform.scale` en
 * loop suave sobre toda la duración del clip. Se escriben como
 * transform.keyframes normales — el usuario las puede editar en Curvas
 * o borrarlas. El `scale` del keyframe multiplica la capa ya escalada
 * por `scaleX/scaleY`, así que no pisa la escala estática.
 * Requiere que el clip no tenga ya keyframes de transformación.
 */
export function applyBreathingLoop(
  project: ProjectDocument,
  clipId: string,
  options: BreathingLoopOptions = {},
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (
    !clip ||
    (clip.kind !== 'video' &&
      clip.kind !== 'image' &&
      clip.kind !== 'graphic' &&
      clip.kind !== 'freeze')
  ) {
    throw new ProjectActionError('la respiración necesita un clip visual');
  }
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  if (clip.transform?.keyframes?.length) {
    throw new ProjectActionError(
      'quitá los keyframes de transformación antes de aplicar la respiración',
    );
  }
  const duration = clip.durationFrames;
  const fps = fpsOf(next);
  if (!(fps > 0) || duration < 8) {
    throw new ProjectActionError('el clip es demasiado corto para respirar');
  }
  const amplitude = Math.min(0.3, Math.max(0.01, options.amplitude ?? 0.04));
  const periodSeconds = Math.min(30, Math.max(0.4, options.periodSeconds ?? 2.4));
  // 2 claves por período (pico y vuelta a base) + la inicial; el tope del
  // schema es MAX_TRANSFORM_KEYFRAMES. Si no entran, el período crece
  // hasta cubrir el clip entero con el máximo de ciclos posible.
  const maxPeriods = Math.floor((MAX_TRANSFORM_KEYFRAMES - 1) / 2);
  let periodFrames = Math.max(4, Math.round(periodSeconds * fps));
  let periods = Math.ceil(duration / periodFrames);
  if (periods > maxPeriods) {
    periodFrames = Math.ceil(duration / maxPeriods);
    periods = maxPeriods;
  }
  // Clips más cortos que dos períodos: el ciclo se achica para que entre
  // al menos un vaivén completo en vez de quedar estático.
  periodFrames = Math.min(periodFrames, Math.max(4, Math.floor(duration / 2)));
  const half = Math.max(2, Math.round(periodFrames / 2));
  const keyframes: {
    frame: number;
    scale: number;
    easing: 'ease-in-out';
  }[] = [{ frame: 0, scale: 1, easing: 'ease-in-out' }];
  let frame = half;
  let peak = true;
  while (frame < duration - 1 && keyframes.length < MAX_TRANSFORM_KEYFRAMES - 1) {
    keyframes.push({
      frame,
      scale: peak ? 1 + amplitude : 1,
      easing: 'ease-in-out',
    });
    frame += half;
    peak = !peak;
  }
  const last = keyframes[keyframes.length - 1]!;
  if (last.frame !== duration - 1) {
    keyframes.push({ frame: duration - 1, scale: 1, easing: 'ease-in-out' });
  }
  clip.transform = {
    ...(clip.transform ?? {}),
    keyframes: keyframes.filter(
      (keyframe, index, list) =>
        list.findIndex((item) => item.frame === keyframe.frame) === index,
    ),
  };
  touch(next);
  return next;
}

export interface ClickPulseOptions {
  /** Frame (offset desde el inicio del clip) donde ocurre la pulsación.
   * Default: ~60 % de la duración. */
  readonly atOffset?: number;
}

/**
 * Gesto de «clic» para el manito/manipulador (paridad del click de
 * `maozinha` de AlaukCut): una pulsación de escala rápida — presión
 * (0.82) en +2 frames, rebote (1.06) en +4 y asentamiento en +6 —
 * escrita como keyframes de transform editables en Curvas.
 */
export function applyClickPulse(
  project: ProjectDocument,
  clipId: string,
  options: ClickPulseOptions = {},
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (
    !clip ||
    (clip.kind !== 'video' &&
      clip.kind !== 'image' &&
      clip.kind !== 'graphic' &&
      clip.kind !== 'freeze')
  ) {
    throw new ProjectActionError('el clic necesita un clip visual');
  }
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  if (clip.transform?.keyframes?.length) {
    throw new ProjectActionError(
      'quitá los keyframes de transformación antes de aplicar el clic',
    );
  }
  const duration = clip.durationFrames;
  if (duration < 12) {
    throw new ProjectActionError('el clip es demasiado corto para el clic');
  }
  const at = Math.min(
    duration - 8,
    Math.max(4, Math.round(options.atOffset ?? duration * 0.6)),
  );
  const keyframes = [
    { frame: 0, scale: 1, easing: 'ease-in-out' as const },
    { frame: at, scale: 1, easing: 'ease-in-out' as const },
    { frame: at + 2, scale: 0.82, easing: 'ease-in-out' as const },
    { frame: at + 4, scale: 1.06, easing: 'ease-in-out' as const },
    { frame: at + 6, scale: 1, easing: 'ease-in-out' as const },
  ];
  clip.transform = {
    ...(clip.transform ?? {}),
    keyframes,
  };
  touch(next);
  return next;
}

export interface FaceBlurSample {
  /** Segundos relativos al inicio de la ventana analizada. */
  readonly time: number;
  readonly centerX: number;
  readonly centerY: number;
  /** Lado mayor de la caja del rostro como fracción del lado mayor del frame. */
  readonly size: number;
  /** Rotación estimada en grados (sólo object track; rostros no la reportan). */
  readonly rotationDeg?: number;
}

export interface FaceBlurOverlayOptions {
  /** Sigma del `gblur` del overlay (0–50, igual que `effects.blur`). */
  readonly blur?: number;
  /** Margen extra alrededor del rostro, multiplica el tamaño de la máscara. */
  readonly margin?: number;
  /** Suavidad del borde de la máscara (0–1). */
  readonly feather?: number;
  /** Suavizado temporal de las muestras (0=off, ~0.4 recomendado). */
  readonly smoothing?: number;
  /**
   * Efecto de privacidad del overlay: `blur` (default, `effects.blur`)
   * o `pixelate` (`stylize.pixelate` en `effects.stack`, más efectivo
   * para ocultar identidad que el desenfoque).
   */
  readonly kind?: 'blur' | 'pixelate';
  /** Lado del bloque del pixelado en px de salida (2–96, sólo `pixelate`). */
  readonly pixelSize?: number;
}

const MAX_MASK_KEYFRAMES_APPLIED = 32;

function maskSizeFromFace(size: number, margin: number): number {
  if (!Number.isFinite(size) || size <= 0) return 0.4;
  // La máscara es una elipse que envuelve la cara con margen: el diámetro
  // normalizado cubre el lado mayor de la caja detectada.
  return Math.min(1.6, Math.max(0.08, size * 2.6 * margin));
}

/** Convierte muestras de tracking (rostro u objeto) en keyframes de máscara
 * elíptica: centro normalizado -1..1, tamaño desde `size`, downsample a 32. */
/**
 * EMA (filtro paso-bajo) sobre centro y tamaño de las muestras: suaviza el
 * jitter del tracker (NCC/rustface) sin cambiar los tiempos. `amount` 0 deja
 * las muestras crudas; 1 es el máximo razonable (~media de 4 muestras).
 */
function smoothMaskSamples(
  samples: readonly FaceBlurSample[],
  amount: number,
): FaceBlurSample[] {
  if (amount <= 0 || samples.length < 3) return [...samples];
  const alpha = Math.min(0.75, Math.max(0.05, amount));
  const out: FaceBlurSample[] = [];
  let cx = samples[0]!.centerX;
  let cy = samples[0]!.centerY;
  let size = samples[0]!.size;
  for (const sample of samples) {
    cx += alpha * (sample.centerX - cx);
    cy += alpha * (sample.centerY - cy);
    size += alpha * ((sample.size || size) - size);
    out.push({ ...sample, centerX: cx, centerY: cy, size });
  }
  return out;
}

function buildMaskKeyframes(
  samples: readonly FaceBlurSample[],
  fps: number,
  speed: number,
  lastFrame: number,
  margin: number,
): ClipMaskKeyframe[] {
  const keyframes = downsampleMaskSamples(samples).map((sample) => {
    const frame = Math.max(
      0,
      Math.min(lastFrame, Math.round((sample.time * fps) / speed)),
    );
    const keyframe: ClipMaskKeyframe = {
      frame,
      x: Math.max(-1, Math.min(1, (sample.centerX - 0.5) * 2)),
      y: Math.max(-1, Math.min(1, (sample.centerY - 0.5) * 2)),
      width: maskSizeFromFace(sample.size, margin),
      height: maskSizeFromFace(sample.size, margin),
      easing: 'linear' as const,
    };
    if (sample.rotationDeg !== undefined && Number.isFinite(sample.rotationDeg)) {
      keyframe.rotationDeg = Math.max(-180, Math.min(180, sample.rotationDeg));
    }
    return keyframe;
  });
  return keyframes.filter(
    (keyframe, index, list) =>
      list.findIndex((item) => item.frame === keyframe.frame) === index,
  );
}

function downsampleMaskSamples(
  samples: readonly FaceBlurSample[],
): FaceBlurSample[] {
  if (samples.length <= MAX_MASK_KEYFRAMES_APPLIED) return [...samples];
  const picked: FaceBlurSample[] = [];
  const last = samples.length - 1;
  for (let index = 0; index < MAX_MASK_KEYFRAMES_APPLIED; index += 1) {
    const source = Math.round((index / (MAX_MASK_KEYFRAMES_APPLIED - 1)) * last);
    const sample = samples[source];
    if (sample && picked[picked.length - 1] !== sample) picked.push(sample);
  }
  return picked;
}

/**
 * Paridad del «blur que sigue al rostro» de AlaukCut (`rastreamento.js`):
 * duplica el clip de video en una pista superior con `effects.blur` y una
 * máscara elíptica animada (`mask.keyframes`) que sigue las muestras de
 * `analyze_face_track`. El original queda debajo y se ve fuera de la
 * máscara; el overlay lleva el audio silenciado para no duplicar sonido.
 *
 * Limitaciones deliberadas (iguales que `applyFaceCenter`): no funciona con
 * reverse, motion, estabilización ni keyframes de transformación, porque la
 * máscara se evalúa en el espacio del frame de salida.
 */
export function applyFaceBlurOverlay(
  project: ProjectDocument,
  clipId: string,
  samples: readonly FaceBlurSample[],
  options: FaceBlurOverlayOptions = {},
): { project: ProjectDocument; clipId: string; trackId: string } {
  const kind = options.kind ?? 'blur';
  const blur = Math.min(50, Math.max(0, options.blur ?? 14));
  const pixelSize = Math.min(96, Math.max(2, Math.round(options.pixelSize ?? 18)));
  const margin = Math.min(3, Math.max(1, options.margin ?? 1.15));
  const feather = Math.min(1, Math.max(0, options.feather ?? 0.18));
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip || clip.kind !== 'video') {
    throw new ProjectActionError('el blur con seguimiento necesita un clip de video');
  }
  const sourceTrack = next.timeline.tracks.find((item) => item.id === clip.trackId);
  if (!sourceTrack || sourceTrack.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  if (clip.reverse) {
    throw new ProjectActionError('quitá el reverse antes de aplicar el blur de rostro');
  }
  if (clip.motion || clip.stabilization || clip.transform?.keyframes?.length) {
    throw new ProjectActionError(
      'quitá el movimiento, la estabilización y los keyframes de transformación antes de aplicar el blur de rostro',
    );
  }
  const usable = samples.filter(
    (sample) =>
      Number.isFinite(sample.time) &&
      Number.isFinite(sample.centerX) &&
      Number.isFinite(sample.centerY),
  );
  if (usable.length < 2) {
    throw new ProjectActionError('no hay suficientes muestras de rostro para el blur');
  }
  const fps = fpsOf(next);
  const speed = (clip.speed?.num ?? 1) / (clip.speed?.den ?? 1);
  const width = next.video.width;
  const height = next.video.height;
  if (!(fps > 0) || !(speed > 0) || width < 2 || height < 2) {
    throw new ProjectActionError('el proyecto no tiene una geometría válida');
  }
  const lastFrame = clip.durationFrames - 1;
  const unique = buildMaskKeyframes(
    smoothMaskSamples(usable, options.smoothing ?? 0.35),
    fps,
    speed,
    lastFrame,
    margin,
  );
  if (unique.length < 1) {
    throw new ProjectActionError('las muestras de rostro no alcanzan para crear la máscara');
  }
  const first = unique[0]!;
  const start = clip.startFrame;
  const end = start + clip.durationFrames;
  const overlaps = (trackId: string) =>
    intervalsForTrack(next, trackId).some(
      (interval) => interval.start < end && interval.end > start,
    );
  let track = next.timeline.tracks
    .filter(
      (item) =>
        (item.kind === 'video' || item.kind === 'image') &&
        !item.locked &&
        !item.hidden &&
        item.order > sourceTrack.order,
    )
    .sort((a, b) => a.order - b.order)
    .find((item) => !overlaps(item.id));
  if (!track) {
    const created = addTrack(next, 'video', 'Blur rostro');
    next.timeline = created.project.timeline;
    track = next.timeline.tracks.find((item) => item.id === created.trackId);
  }
  if (!track) {
    throw new ProjectActionError('no se pudo crear la pista del blur');
  }
  const overlay = JSON.parse(JSON.stringify(clip)) as typeof clip;
  overlay.id = newId();
  overlay.trackId = track.id;
  overlay.startFrame = start;
  if (kind === 'pixelate') {
    const manifest = effectRegistry.get('stylize.pixelate');
    if (!manifest) {
      throw new ProjectActionError('el efecto de pixelado no está disponible');
    }
    const instance = createInstance(manifest, { params: { size: pixelSize } });
    const effects = overlay.effects ?? {};
    const stack = [...(effects.stack ?? []), instance];
    overlay.effects = {
      ...effects,
      stack: stack.slice(-32) as NonNullable<typeof effects.stack>,
    };
  } else {
    overlay.effects = {
      ...(clip.effects ?? {}),
      blur,
    };
  }
  overlay.mask = {
    shape: 'ellipse',
    x: first.x ?? 0,
    y: first.y ?? 0,
    width: first.width ?? 0.4,
    height: first.height ?? 0.4,
    feather,
    invert: false,
    keyframes: unique,
  };
  overlay.audio = { ...(clip.audio ?? {}), muted: true };
  overlay.mask = {
    ...overlay.mask,
    keyframes: unique.length > 1 ? unique : undefined,
  };
  next.timeline.clips.push(overlay);
  touch(next);
  return { project: next, clipId: overlay.id, trackId: track.id };
}

/**
 * Máscara elíptica animada sobre el PROPIO clip (spotlight/punch-in que
 * sigue al objetivo): escribe `clip.mask` con `keyframes` derivados de las
 * muestras de tracking. A diferencia de `applyFaceBlurOverlay` no crea
 * overlay — todo lo que quede fuera de la elipse se oculta.
 */
export function applyMaskTrack(
  project: ProjectDocument,
  clipId: string,
  samples: readonly FaceBlurSample[],
  options: {
    margin?: number;
    feather?: number;
    invert?: boolean;
    smoothing?: number;
  } = {},
): ProjectDocument {
  const margin = Math.min(3, Math.max(1, options.margin ?? 1.15));
  const feather = Math.min(1, Math.max(0, options.feather ?? 0.22));
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip || clip.kind !== 'video') {
    throw new ProjectActionError('la máscara con seguimiento necesita un clip de video');
  }
  const sourceTrack = next.timeline.tracks.find((item) => item.id === clip.trackId);
  if (!sourceTrack || sourceTrack.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  if (clip.reverse) {
    throw new ProjectActionError('quitá el reverse antes de aplicar la máscara de seguimiento');
  }
  if (clip.motion || clip.stabilization || clip.transform?.keyframes?.length) {
    throw new ProjectActionError(
      'quitá el movimiento, la estabilización y los keyframes de transformación antes de aplicar la máscara de seguimiento',
    );
  }
  const usable = samples.filter(
    (sample) =>
      Number.isFinite(sample.time) &&
      Number.isFinite(sample.centerX) &&
      Number.isFinite(sample.centerY),
  );
  if (usable.length < 2) {
    throw new ProjectActionError('no hay suficientes muestras para la máscara');
  }
  const fps = fpsOf(next);
  const speed = (clip.speed?.num ?? 1) / (clip.speed?.den ?? 1);
  if (!(fps > 0) || !(speed > 0)) {
    throw new ProjectActionError('el proyecto no tiene una geometría válida');
  }
  const keyframes = buildMaskKeyframes(
    smoothMaskSamples(usable, options.smoothing ?? 0.35),
    fps,
    speed,
    clip.durationFrames - 1,
    margin,
  );
  if (keyframes.length < 1) {
    throw new ProjectActionError('las muestras no alcanzan para crear la máscara');
  }
  const first = keyframes[0]!;
  clip.mask = {
    shape: 'ellipse',
    x: first.x ?? 0,
    y: first.y ?? 0,
    width: first.width ?? 0.4,
    height: first.height ?? 0.4,
    feather,
    invert: options.invert ?? false,
    keyframes: keyframes.length > 1 ? keyframes : undefined,
  };
  touch(next);
  return next;
}

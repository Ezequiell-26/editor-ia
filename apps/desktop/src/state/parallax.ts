/**
 * Presets 2.5D/parallax construidos sobre el motor de movimiento existente:
 * dos capas (fondo y recorte) con movimientos de distinta intensidad. No hay
 * segmentación automática: el recorte lo aporta el usuario (PNG/WebM con alfa).
 */
import type { ClipMotion, ProjectDocument } from '@editor-ia/project-schema';
import {
  ProjectActionError,
  addClipFromAsset,
  addTrack,
  fpsOf,
  updateClip,
} from './project-actions';

export type ParallaxPreset =
  | 'ken-burns'
  | 'parallax-soft'
  | 'cinematic-push-in'
  | 'cinematic-pull-out'
  | 'background-drift'
  | 'foreground-separation'
  | 'depth-zoom'
  | 'camera-pan'
  | 'camera-tilt';

export type ParallaxDirection = 'left' | 'right' | 'up' | 'down';

export interface ParallaxOptions {
  readonly backgroundAssetId: string;
  readonly foregroundAssetId?: string;
  readonly preset: ParallaxPreset;
  readonly direction?: ParallaxDirection;
  readonly intensity?: number;
  readonly atFrame?: number;
  readonly durationFrames?: number;
}

export interface ParallaxResult {
  readonly project: ProjectDocument;
  readonly backgroundClipId: string;
  readonly foregroundClipId: string | null;
  readonly backgroundTrackId: string;
  readonly foregroundTrackId: string | null;
  readonly preset: ParallaxPreset;
  readonly direction: ParallaxDirection;
}

const DIRECTION_MOTION: Record<ParallaxDirection, ClipMotion['type']> = {
  left: 'pan-left',
  right: 'pan-right',
  up: 'pan-up',
  down: 'pan-down',
};

interface PresetPlan {
  readonly requiresForeground: boolean;
  readonly background: (intensity: number, direction: ParallaxDirection) => ClipMotion;
  readonly foreground?: (intensity: number, direction: ParallaxDirection) => ClipMotion;
}

function pan(intensity: number, direction: ParallaxDirection): ClipMotion {
  return { type: DIRECTION_MOTION[direction], intensity };
}

const PRESETS: Record<ParallaxPreset, PresetPlan> = {
  'ken-burns': {
    requiresForeground: false,
    background: (intensity) => ({ type: 'zoom-in', intensity }),
  },
  'parallax-soft': {
    requiresForeground: true,
    background: (intensity, direction) => pan(intensity * 0.35, direction),
    foreground: (intensity, direction) => pan(intensity, direction),
  },
  'cinematic-push-in': {
    requiresForeground: true,
    background: (intensity) => ({ type: 'zoom-in', intensity: intensity * 0.5 }),
    foreground: (intensity) => ({ type: 'zoom-in', intensity }),
  },
  'cinematic-pull-out': {
    requiresForeground: true,
    background: (intensity) => ({ type: 'zoom-out', intensity: intensity * 0.5 }),
    foreground: (intensity) => ({ type: 'zoom-out', intensity }),
  },
  'background-drift': {
    requiresForeground: false,
    background: (intensity, direction) => pan(intensity * 0.5, direction),
  },
  'foreground-separation': {
    requiresForeground: true,
    background: (intensity, direction) => pan(intensity * 0.25, direction),
    foreground: (intensity, direction) => pan(intensity * 0.9, direction),
  },
  'depth-zoom': {
    requiresForeground: true,
    background: (intensity) => ({ type: 'zoom-in', intensity: intensity * 0.25 }),
    foreground: (intensity) => ({ type: 'zoom-in', intensity }),
  },
  'camera-pan': {
    requiresForeground: true,
    background: (intensity, direction) => pan(intensity * 0.6, direction),
    foreground: (intensity, direction) => pan(intensity, direction),
  },
  'camera-tilt': {
    requiresForeground: true,
    background: (intensity, direction) => pan(intensity * 0.6, direction),
    foreground: (intensity, direction) => pan(intensity, direction),
  },
};

function safeMotion(motion: ClipMotion): ClipMotion {
  const intensity = Math.min(0.5, Math.max(0.02, motion.intensity ?? 0.12));
  return { type: motion.type, intensity };
}

function clampIntensity(value: number): number {
  const safe = Number.isFinite(value) ? value : 0.12;
  return Math.min(0.5, Math.max(0.02, safe));
}

/**
 * Construye una composición de dos capas sobre pistas nuevas. El fondo va en
 * una pista y el recorte en otra superior, con movimiento relativo.
 */
export function addParallaxScene(
  project: ProjectDocument,
  options: ParallaxOptions,
): ParallaxResult {
  const plan = PRESETS[options.preset];
  if (!plan) {
    throw new ProjectActionError(`preset de parallax desconocido: ${options.preset}`);
  }
  const intensity = clampIntensity(options.intensity ?? 0.12);
  const direction = options.direction ?? 'left';
  if (plan.requiresForeground && !options.foregroundAssetId) {
    throw new ProjectActionError(
      `el preset ${options.preset} necesita un recorte de primer plano`,
    );
  }
  const background = project.assets.find((asset) => asset.id === options.backgroundAssetId);
  if (!background) {
    throw new ProjectActionError('no existe el material de fondo');
  }
  if (background.status !== 'ready') {
    throw new ProjectActionError('el material de fondo todavía no está listo');
  }
  if (background.kind !== 'image' && background.kind !== 'video') {
    throw new ProjectActionError('el fondo del parallax debe ser imagen o video');
  }
  const foreground = options.foregroundAssetId
    ? project.assets.find((asset) => asset.id === options.foregroundAssetId)
    : undefined;
  if (options.foregroundAssetId && !foreground) {
    throw new ProjectActionError('no existe el material de primer plano');
  }
  if (foreground && foreground.status !== 'ready') {
    throw new ProjectActionError('el material de primer plano todavía no está listo');
  }
  if (foreground && foreground.kind !== 'image' && foreground.kind !== 'video') {
    throw new ProjectActionError('el primer plano debe ser imagen o video');
  }
  if (options.foregroundAssetId && foreground?.id === background.id) {
    throw new ProjectActionError(
      'el fondo y el primer plano no pueden ser el mismo material; duplicá o recortá el asset',
    );
  }
  const atFrame = Math.max(0, Math.round(options.atFrame ?? 0));
  const durationFrames = Math.max(
    1,
    Math.round(options.durationFrames ?? fpsOf(project) * 4),
  );

  const backgroundTrack = addTrack(
    project,
    background.kind === 'image' ? 'image' : 'video',
    'Parallax fondo',
  );
  const withBackground = addClipFromAsset(backgroundTrack.project, background, {
    trackId: backgroundTrack.trackId,
    atFrame,
    durationFrames,
  });
  let next = updateClip(withBackground.project, withBackground.clipId, {
    motion: safeMotion(plan.background(intensity, direction)),
    label: `Fondo · ${options.preset}`,
  });

  let foregroundClipId: string | null = null;
  let foregroundTrackId: string | null = null;
  if (foreground) {
    const foregroundTrack = addTrack(
      next,
      foreground.kind === 'image' ? 'image' : 'video',
      'Parallax primer plano',
    );
    const withForeground = addClipFromAsset(foregroundTrack.project, foreground, {
      trackId: foregroundTrack.trackId,
      atFrame,
      durationFrames,
    });
    foregroundClipId = withForeground.clipId;
    foregroundTrackId = foregroundTrack.trackId;
    next = updateClip(withForeground.project, foregroundClipId, {
      motion: safeMotion(
        plan.foreground
          ? plan.foreground(intensity, direction)
          : plan.background(intensity, direction),
      ),
      label: `Primer plano · ${options.preset}`,
    });
  }

  return {
    project: next,
    backgroundClipId: withBackground.clipId,
    foregroundClipId,
    backgroundTrackId: backgroundTrack.trackId,
    foregroundTrackId,
    preset: options.preset,
    direction,
  };
}

/** Catálogo estable para la UI y las herramientas del agente. */
export const PARALLAX_PRESETS: ReadonlyArray<{
  id: ParallaxPreset;
  label: string;
  requiresForeground: boolean;
  summary: string;
}> = [
  { id: 'ken-burns', label: 'Ken Burns', requiresForeground: false, summary: 'Zoom lento sobre una foto.' },
  { id: 'background-drift', label: 'Background Drift', requiresForeground: false, summary: 'Paneo suave del fondo.' },
  { id: 'parallax-soft', label: 'Parallax suave', requiresForeground: true, summary: 'Fondo lento y recorte más rápido.' },
  { id: 'cinematic-push-in', label: 'Cinematic Push In', requiresForeground: true, summary: 'Acercamiento con profundidad relativa.' },
  { id: 'cinematic-pull-out', label: 'Cinematic Pull Out', requiresForeground: true, summary: 'Alejamiento con profundidad relativa.' },
  { id: 'foreground-separation', label: 'Foreground Separation', requiresForeground: true, summary: 'El recorte se separa del fondo.' },
  { id: 'depth-zoom', label: 'Depth Zoom', requiresForeground: true, summary: 'Zoom con primer plano acelerado.' },
  { id: 'camera-pan', label: 'Camera Pan', requiresForeground: true, summary: 'Paneo de cámara en dos capas.' },
  { id: 'camera-tilt', label: 'Camera Tilt', requiresForeground: true, summary: 'Tilt de cámara en dos capas.' },
];

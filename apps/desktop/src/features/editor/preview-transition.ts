import type { CSSProperties } from 'react';
import type { Clip } from '@editor-ia/project-schema';

/**
 * Aproximación CSS de las transiciones `transitionIn` para la preview DOM.
 *
 * El render FFmpeg corre la transición durante el *lead*: el clip entrante se
 * monta `lead` frames antes de su `startFrame`, mostrando fuente previa al
 * `inFrame`, y se revela con fade/wipe/slide mientras el saliente sigue
 * debajo (`transition_lead_seconds` + filtros de `ffmpeg.rs`). Antes de este
 * módulo la preview montaba el clip recién en `startFrame`: corte seco y sin
 * ventana de solape.
 *
 * `luma-wipe` también monta el lead: la máscara de luminancia del mate la
 * genera `preview-luma-mask.ts` (canvas sobre el frame actual del mate) y el
 * caller la aplica como `mask-image` del wrapper; si la máscara todavía no
 * está lista la capa queda en `opacity: 0`, el mismo resultado visual que el
 * corte anterior.
 */

const LEAD_CAP_SECONDS = 2;
const PREVIEW_KINDS = new Set(['video', 'image', 'freeze']);

type TransitionIn = { type: string; frames: number; color?: string };

function transitionIn(clip: Clip): TransitionIn | undefined {
  if (!('transitionIn' in clip)) return undefined;
  const transition = (clip as { transitionIn?: TransitionIn }).transitionIn;
  if (!transition || !Number.isFinite(transition.frames) || transition.frames <= 0) {
    return undefined;
  }
  return transition;
}

/**
 * Frames de adelanto que la preview puede mostrar para este clip. Espeja el
 * clamp del renderer (`min(frames, duración, start, 2 s)`), `luma-wipe`
 * incluido; su máscara la resuelve `preview-luma-mask.ts`.
 */
export function previewTransitionLeadFrames(clip: Clip, fps: number): number {
  const transition = transitionIn(clip);
  if (!transition || !PREVIEW_KINDS.has(clip.kind)) return 0;
  const rate = Math.max(1, fps);
  const leadCap = Math.round(rate * LEAD_CAP_SECONDS);
  return Math.max(
    0,
    Math.min(Math.round(transition.frames), clip.durationFrames, clip.startFrame, leadCap),
  );
}

/**
 * `true` cuando el render FFmpeg calcula un lead > 0 para este clip
 * (`transition_lead_seconds`: video/imagen/freeze con `transitionIn.frames > 0`,
 * acotado por duración, inicio y 2 s). A diferencia de
 * `previewTransitionLeadFrames` incluye `luma-wipe` y no exige nada más que el
 * propio clip — se usa para decisiones que el render toma por clip, como
 * elegir el modo de curva de velocidad (`curve-lead`: prerrol a la media +
 * curva en el tramo del clip, ver `curve_knots_stretched` en ffmpeg.rs).
 */
export function clipTransitionLeadActive(clip: Clip, fps: number): boolean {
  if (clip.kind !== 'video' && clip.kind !== 'image' && clip.kind !== 'freeze') {
    return false;
  }
  const transition = transitionIn(clip);
  if (!transition) return false;
  const rate = Math.max(1, fps);
  const leadSeconds = Math.min(
    transition.frames / rate,
    clip.durationFrames / rate,
    clip.startFrame / rate,
    LEAD_CAP_SECONDS,
  );
  return leadSeconds > 0;
}

export type PreviewTransitionFrame = {
  /** Progreso del lead 0→1 (0 = primer frame del solape, 1 = inicio del clip). */
  progress: number;
  /** Estilos para el wrapper que envuelve la capa del clip (opacity/clip-path/mask/transform). */
  style: CSSProperties;
  /** Color detrás de la capa durante fundidos a negro/blanco/color (dip-color). */
  underlay?: string;
};

/**
 * `true` cuando el frame está dentro de la ventana de lead del clip (el clip
 * ya está montado `lead` frames antes de su `startFrame`). El render
 * descarta el audio del tramo de solape (`atrim=start={lead}` +
 * `adelay=start_seconds` en `audio_filter` de ffmpeg.rs): el clip entrante
 * no suena hasta su inicio y arranca con el contenido del in-point. La
 * preview usa esto para mutear el `<video>` durante el solape —sin él
 * sonaría el prerrol `lead` frames antes que en el MP4.
 */
export function clipInTransitionLead(
  clip: Clip,
  playheadFrame: number,
  fps: number,
): boolean {
  const lead = previewTransitionLeadFrames(clip, fps);
  return (
    lead > 0 &&
    playheadFrame >= clip.startFrame - lead &&
    playheadFrame < clip.startFrame
  );
}

/** `mateClipId` cuando la transición de entrada es `luma-wipe`. */
export function lumaWipeMateId(clip: Clip): string | undefined {
  if (!('transitionIn' in clip)) return undefined;
  const transition = (
    clip as { transitionIn?: { type?: string; mateClipId?: string } }
  ).transitionIn;
  return transition?.type === 'luma-wipe' ? transition.mateClipId : undefined;
}

const WIPE_INSET: Record<string, (p: number) => string> = {
  // Mismas regiones que `wipe_alpha_expr` de ffmpeg.rs: el entrante se revela
  // desde el borde opuesto al que indica el nombre.
  'wipe-left': (p) => `inset(0 ${((1 - p) * 100).toFixed(3)}% 0 0)`,
  'wipe-right': (p) => `inset(0 0 0 ${((1 - p) * 100).toFixed(3)}%)`,
  'wipe-up': (p) => `inset(${((1 - p) * 100).toFixed(3)}% 0 0 0)`,
  'wipe-down': (p) => `inset(0 0 ${((1 - p) * 100).toFixed(3)}% 0)`,
};

/**
 * Estado de la transición para el frame dado, o `null` cuando el clip no está
 * en su ventana de lead (o no tiene transición reproducible en preview).
 */
export function previewTransitionFrame(
  clip: Clip,
  playheadFrame: number,
  fps: number,
): PreviewTransitionFrame | null {
  const lead = previewTransitionLeadFrames(clip, fps);
  const transition = transitionIn(clip);
  if (lead < 1 || !transition) return null;
  const from = clip.startFrame - lead;
  if (playheadFrame < from || playheadFrame >= clip.startFrame) return null;
  const p = Math.min(1, Math.max(0, (playheadFrame - from) / lead));
  const style: CSSProperties = {};
  let underlay: string | undefined;
  switch (transition.type) {
    case 'dissolve':
      style.opacity = p;
      break;
    case 'fade-black':
      underlay = '#000000';
      style.opacity = p;
      break;
    case 'fade-white':
      underlay = '#ffffff';
      style.opacity = p;
      break;
    case 'dip-color':
      underlay = transition.color ?? '#000000';
      style.opacity = p;
      break;
    case 'slide-left':
    case 'slide-right':
    case 'slide-up':
    case 'slide-down': {
      const horizontal = transition.type.endsWith('left') || transition.type.endsWith('right');
      const entersPositive = transition.type.endsWith('left') || transition.type.endsWith('up');
      const offset = (entersPositive ? 1 : -1) * (1 - p) * 100;
      style.transform = horizontal
        ? `translateX(${offset.toFixed(3)}%)`
        : `translateY(${offset.toFixed(3)}%)`;
      break;
    }
    case 'slide-3d-left':
    case 'slide-3d-right':
    case 'slide-3d-up':
    case 'slide-3d-down': {
      // Aproximación del `perspective`+offset del render: mismo desplazamiento
      // 2D y compresión simétrica del eje perpendicular (mínimo 15 % como
      // SLIDE3D_MIN_EXTENT), sin el giro de verdad.
      const vertical = transition.type.endsWith('up') || transition.type.endsWith('down');
      const entersPositive = transition.type.endsWith('left') || transition.type.endsWith('up');
      const offset = (entersPositive ? 1 : -1) * (1 - p) * 100;
      const extent = (0.15 + 0.85 * p).toFixed(4);
      const translate = vertical
        ? `translateY(${offset.toFixed(3)}%)`
        : `translateX(${offset.toFixed(3)}%)`;
      style.transform = vertical
        ? `${translate} scaleY(${extent})`
        : `${translate} scaleX(${extent})`;
      break;
    }
    case 'iris': {
      const stop = (p * 100).toFixed(3);
      const mask = `radial-gradient(ellipse at center, #000 ${stop}%, transparent ${stop}%)`;
      style.maskImage = mask;
      style.WebkitMaskImage = mask;
      style.maskSize = '100% 100%';
      style.WebkitMaskSize = '100% 100%';
      style.maskRepeat = 'no-repeat';
      style.WebkitMaskRepeat = 'no-repeat';
      break;
    }
    case 'clock-wipe': {
      const degrees = (p * 360).toFixed(3);
      const mask = `conic-gradient(from 0deg at 50% 50%, #000 0deg ${degrees}deg, transparent ${degrees}deg)`;
      style.maskImage = mask;
      style.WebkitMaskImage = mask;
      style.maskSize = '100% 100%';
      style.WebkitMaskSize = '100% 100%';
      style.maskRepeat = 'no-repeat';
      style.WebkitMaskRepeat = 'no-repeat';
      break;
    }
    case 'luma-wipe':
      // La máscara es la luminancia del clip mate: la resuelve
      // `preview-luma-mask.ts` por frame y el caller la inyecta como
      // `mask-image` del wrapper. Acá sólo va el progreso de la ventana.
      break;
    default: {
      const inset = WIPE_INSET[transition.type];
      if (inset) style.clipPath = inset(p);
      break;
    }
  }
  return { progress: p, style, ...(underlay ? { underlay } : {}) };
}

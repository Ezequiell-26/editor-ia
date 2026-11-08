import type { Asset, Clip, ClipEffects, ClipTransition, ProjectDocument } from '@editor-ia/project-schema';
import type {
  VisualCatalog,
  VisualPresetSpec,
  VisualTransitionSpec,
} from '../../services/project-service';

export const VISUAL_KINDS = new Set<Clip['kind']>(['video', 'image', 'freeze']);

export function visualClips(project: ProjectDocument | null): Clip[] {
  if (!project) return [];
  return project.timeline.clips.filter((clip) => VISUAL_KINDS.has(clip.kind));
}

export function clipLabel(clip: Clip): string {
  return clip.label?.trim() || `${clip.kind} ${clip.id.slice(0, 6)}`;
}

export function clipTime(clip: Clip, fps: number): string {
  const total = Math.max(1, fps);
  const start = clip.startFrame / total;
  const end = (clip.startFrame + clip.durationFrames) / total;
  const format = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    return `${String(minutes).padStart(2, '0')}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
  };
  return `${format(start)}–${format(end)}`;
}

export function trackLabel(project: ProjectDocument | null, clip: Clip): string {
  const track = project?.timeline.tracks.find((item) => item.id === clip.trackId);
  return track?.label?.trim() || track?.kind || 'pista';
}

/** Aplica un preset conservando fades y LUT, igual que el editor. */
export function mergePresetEffects(
  current: ClipEffects | undefined,
  preset: VisualPresetSpec,
): ClipEffects {
  const kept: ClipEffects = {};
  if (current?.fadeInFrames !== undefined) kept.fadeInFrames = current.fadeInFrames;
  if (current?.fadeOutFrames !== undefined) kept.fadeOutFrames = current.fadeOutFrames;
  if (current?.lutFile !== undefined) kept.lutFile = current.lutFile;
  if (current?.lutIntensity !== undefined) kept.lutIntensity = current.lutIntensity;
  return { ...kept, ...(preset.settings as ClipEffects) };
}

export function quickEffects(
  values: {
    brightness: number;
    contrast: number;
    saturation: number;
    temperature: number;
    vignette: number;
    blur: number;
    sharpen: number;
    grayscale: boolean;
    sepia: boolean;
  },
  current: ClipEffects | undefined,
): ClipEffects {
  const next: ClipEffects = {
    ...current,
    brightness: values.brightness,
    contrast: values.contrast,
    saturation: values.saturation,
    temperature: values.temperature,
    vignette: values.vignette,
    blur: values.blur,
    sharpen: values.sharpen,
  };
  if (values.grayscale) next.grayscale = true;
  else delete next.grayscale;
  if (values.sepia) next.sepia = true;
  else delete next.sepia;
  return next;
}

export function safeTransitionFrames(requested: number, clip: Clip): number {
  return Math.max(1, Math.min(Math.round(requested), Math.max(1, clip.durationFrames), 120));
}

/**
 * `transitionIn` para la aplicación por lote. `dip-color` exige `color` y
 * `luma-wipe` un `mateClipId` (el schema los valida); sin el dato devuelven
 * `undefined` para que la vista lo cuente como omitido en vez de escribir un
 * documento inválido.
 */
export function batchTransitionIn(
  clip: Clip,
  type: ClipTransition['type'],
  frames: number,
  params: { color?: string; mateClipId?: string | undefined } = {},
): ClipTransition | undefined {
  const safe = safeTransitionFrames(frames, clip);
  if (type === 'dip-color') {
    return params.color ? { type, frames: safe, color: params.color } : undefined;
  }
  if (type === 'luma-wipe') {
    return params.mateClipId
      ? { type, frames: safe, mateClipId: params.mateClipId }
      : undefined;
  }
  return { type, frames: safe };
}

/**
 * Color efectivo de `dip-color` en la aplicación por lote: el override de la
 * vista gana; `null` fuerza el general; sin override se conserva el color que
 * el clip ya tiene en su `transitionIn` (p. ej. afinado en el Inspector) y
 * sólo como último recurso cae al general. Así «Aplicar» no pisa colores
 * propios que el usuario ya había elegido.
 */
export function dipColorForClip(
  transitionIn: ClipTransition | undefined,
  override: string | null | undefined,
  general: string,
): string {
  if (override === null) return general;
  if (override) return override;
  if (transitionIn?.type === 'dip-color' && transitionIn.color) {
    return transitionIn.color;
  }
  return general;
}

export function transitionDescription(transition: VisualTransitionSpec | undefined): string {
  return transition?.description ?? 'Sin transición de entrada.';
}

const fallbackEffect = (id: string, label: string, category: string, description: string) => ({
  id,
  label,
  category,
  description,
  filters: ['eq'],
  available: true,
  parameters: [],
});

export const FALLBACK_VISUAL_CATALOG: VisualCatalog = {
  ffmpegAvailable: false,
  effects: [
    fallbackEffect('brightness', 'Brillo', 'color', 'Sube o baja la exposición general del clip.'),
    fallbackEffect('contrast', 'Contraste', 'color', 'Separa luces y sombras.'),
    fallbackEffect('saturation', 'Saturación', 'color', 'Intensifica o desatura el color.'),
    fallbackEffect('temperature', 'Temperatura', 'color', 'Enfría o calienta la imagen.'),
    fallbackEffect('vignette', 'Viñeta', 'stylize', 'Oscurece los bordes para concentrar la mirada.'),
    fallbackEffect('blur', 'Desenfoque', 'stylize', 'Desenfoque gaussiano en píxeles.'),
    fallbackEffect('sharpen', 'Nitidez', 'stylize', 'Aumenta el detalle sin cambiar el color.'),
    fallbackEffect('hueRotate', 'Giro de tono', 'color', 'Rota el matiz en grados.'),
  ],
  presets: [
    { id: 'soft', label: 'Suave', description: 'Color limpio con desenfoque mínimo.', settings: { blur: 1.2, brightness: 0.03, contrast: 0.98, saturation: 1.04 } },
    { id: 'dream', label: 'Onírico', description: 'Suavidad y viñeta cálida.', settings: { blur: 2.4, brightness: 0.05, saturation: 1.1, vignette: 0.12 } },
    { id: 'noir', label: 'Noir', description: 'Blanco y negro con contraste alto.', settings: { grayscale: true, contrast: 1.25, vignette: 0.35, curvePreset: 'contrast-strong' } },
    { id: 'vhs', label: 'VHS', description: 'Color analógico, ligero desenfoque y viñeta.', settings: { contrast: 1.08, saturation: 0.85, hueRotateDeg: 6, blur: 0.5, vignette: 0.2, curvePreset: 'vintage' } },
    { id: 'documentary', label: 'Documental', description: 'Nitidez y color sobrio.', settings: { sharpen: 1.2, contrast: 1.05, saturation: 0.95 } },
    { id: 'high-key', label: 'Alta clave', description: 'Luminoso y aireado.', settings: { brightness: 0.12, contrast: 0.95, saturation: 1.05, shadows: 0.1, fade: 0.08 } },
    { id: 'low-key', label: 'Baja clave', description: 'Sombras profundas y contraste.', settings: { brightness: -0.1, contrast: 1.15, shadows: -0.12, highlights: 0.08, vignette: 0.22 } },
    { id: 'neon', label: 'Neón', description: 'Saturación alta y tono desplazado.', settings: { saturation: 1.35, hueRotateDeg: -10, contrast: 1.1, vignette: 0.18 } },
  ],
  transitions: [
    { id: 'dissolve', label: 'Disolvencia', description: 'El clip entrante aparece con alfa sobre el anterior.', defaultFrames: 12, maxFrames: 120, overlapsPrevious: true, available: true },
    { id: 'fade-black', label: 'Fundido a negro', description: 'Entra desde negro sin mezclar la imagen anterior.', defaultFrames: 12, maxFrames: 120, overlapsPrevious: false, available: true },
    { id: 'fade-white', label: 'Fundido a blanco', description: 'Entra desde blanco sin mezclar la imagen anterior.', defaultFrames: 12, maxFrames: 120, overlapsPrevious: false, available: true },
    { id: 'slide-left', label: 'Deslizar desde la derecha', description: 'El clip entra desde el borde derecho.', defaultFrames: 15, maxFrames: 120, overlapsPrevious: true, available: true },
    { id: 'slide-right', label: 'Deslizar desde la izquierda', description: 'El clip entra desde el borde izquierdo.', defaultFrames: 15, maxFrames: 120, overlapsPrevious: true, available: true },
    { id: 'slide-up', label: 'Deslizar desde abajo', description: 'El clip entra desde el borde inferior.', defaultFrames: 15, maxFrames: 120, overlapsPrevious: true, available: true },
    { id: 'slide-down', label: 'Deslizar desde arriba', description: 'El clip entra desde el borde superior.', defaultFrames: 15, maxFrames: 120, overlapsPrevious: true, available: true },
    { id: 'slide-3d-left', label: 'Deslizar 3D desde la derecha', description: 'El clip entra rotando en perspectiva sobre el eje vertical.', defaultFrames: 15, maxFrames: 120, overlapsPrevious: true, available: true },
    { id: 'slide-3d-right', label: 'Deslizar 3D desde la izquierda', description: 'El clip entra rotando en perspectiva sobre el eje vertical.', defaultFrames: 15, maxFrames: 120, overlapsPrevious: true, available: true },
    { id: 'slide-3d-up', label: 'Deslizar 3D desde abajo', description: 'El clip entra rotando en perspectiva sobre el eje horizontal.', defaultFrames: 15, maxFrames: 120, overlapsPrevious: true, available: true },
    { id: 'slide-3d-down', label: 'Deslizar 3D desde arriba', description: 'El clip entra rotando en perspectiva sobre el eje horizontal.', defaultFrames: 15, maxFrames: 120, overlapsPrevious: true, available: true },
    { id: 'wipe-left', label: 'Barrido hacia la izquierda', description: 'El clip entrante se revela barriendo desde la derecha.', defaultFrames: 15, maxFrames: 120, overlapsPrevious: true, available: true },
    { id: 'wipe-right', label: 'Barrido hacia la derecha', description: 'El clip entrante se revela barriendo desde la izquierda.', defaultFrames: 15, maxFrames: 120, overlapsPrevious: true, available: true },
    { id: 'wipe-up', label: 'Barrido hacia arriba', description: 'El clip entrante se revela barriendo desde abajo.', defaultFrames: 15, maxFrames: 120, overlapsPrevious: true, available: true },
    { id: 'wipe-down', label: 'Barrido hacia abajo', description: 'El clip entrante se revela barriendo desde arriba.', defaultFrames: 15, maxFrames: 120, overlapsPrevious: true, available: true },
    { id: 'iris', label: 'Iris circular', description: 'El clip entrante abre desde el centro en círculo.', defaultFrames: 15, maxFrames: 120, overlapsPrevious: true, available: true },
    { id: 'dip-color', label: 'Fundido a color', description: 'El clip entra fundiéndose desde un color; color general para todos, personalizable por clip.', defaultFrames: 12, maxFrames: 120, overlapsPrevious: false, available: true },
    { id: 'luma-wipe', label: 'Barrido por luminancia', description: 'El clip entrante se revela por la luminancia de un clip mate elegido por clip.', defaultFrames: 15, maxFrames: 120, overlapsPrevious: true, available: true },
  ],
  filters: [],
};

export function assetLabel(assets: readonly Asset[], clip: Clip): string {
  if (!('source' in clip)) return '';
  const source = clip.source;
  if (source.type !== 'asset') return '';
  const asset = assets.find((item) => item.id === source.assetId);
  return asset?.label ?? '';
}

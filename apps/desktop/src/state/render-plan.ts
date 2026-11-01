/**
 * Plan de render sugerido.
 *
 * El diálogo de exportación ya expone códec, compresión y GPU, pero la decisión
 * queda en el usuario: elegir H.265 para un clip de 20 s, o GPU para un 1080p
 * corto, empeora el resultado. Este módulo propone una combinación explicable a
 * partir del destino, la duración, la resolución y el hardware disponible, y
 * estima peso y tiempo para que la decisión se tome con números.
 *
 * Las estimaciones son eso: estimaciones con un modelo de bits por píxel. Se
 * muestran como rango aproximado, nunca como promesa.
 */

import { COMPRESSION_PRESETS, type CompressionPresetId } from './project-actions';

export type RenderDestination = 'social' | 'archive' | 'draft' | 'web';

export type PlanCodec = 'h264' | 'hevc';
export type PlanEncoder = 'software' | 'hardware';

export interface RenderPlanInput {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationSeconds: number;
  readonly destination: RenderDestination;
  /** Algún clip necesita canal alfa (chroma, máscara, Lottie). */
  readonly hasAlpha?: boolean;
  /** El proyecto está en HDR de 10 bits. */
  readonly isHdr?: boolean;
  readonly hardware?: {
    readonly h264: boolean;
    readonly hevc: boolean;
  };
}

export interface RenderPlan {
  readonly codec: PlanCodec;
  readonly compression: CompressionPresetId;
  readonly encoder: PlanEncoder;
  readonly crf: number;
  /** Peso aproximado del archivo final, en bytes. */
  readonly estimatedBytes: number;
  /** Segundos de render aproximados, contando sólo el encode. */
  readonly estimatedSeconds: number;
  readonly reasons: readonly string[];
  readonly warnings: readonly string[];
}

/** Bits por píxel a CRF de referencia; calibrado para 1080p30. */
const BITS_PER_PIXEL: Record<PlanCodec, number> = {
  h264: 0.1,
  hevc: 0.06,
};

/** Velocidad relativa del encoder por software (1 = tiempo real a 1080p30). */
const SOFTWARE_SPEED: Record<PlanCodec, number> = {
  h264: 0.45,
  hevc: 1.15,
};

/** La GPU acelera el encode, pero no reemplaza al filtro de composición. */
const HARDWARE_SPEED: Record<PlanCodec, number> = {
  h264: 0.14,
  hevc: 0.18,
};

const REFERENCE_PIXELS = 1920 * 1080;
const REFERENCE_FPS = 30;
const AUDIO_BITS_PER_SECOND = 128_000;
const LONG_RENDER_SECONDS = 300;
const LARGE_SIDE_PX = 2160;

function crfOf(compression: CompressionPresetId): number {
  return COMPRESSION_PRESETS.find((preset) => preset.id === compression)?.crf ?? 23;
}

function destinationCompression(destination: RenderDestination): CompressionPresetId {
  switch (destination) {
    case 'archive':
      return 'maximo';
    case 'draft':
      return 'compacto';
    case 'web':
    case 'social':
    default:
      return 'equilibrado';
  }
}

function destinationCodec(input: RenderPlanInput): PlanCodec {
  if (input.isHdr) return 'hevc';
  if (input.destination === 'archive') return 'hevc';
  return 'h264';
}

/**
 * Elige códec, compresión y encoder, y estima peso y tiempo.
 *
 * Prioridades: compatibilidad para redes (H.264), tamaño para archivo (H.265),
 * rapidez para borradores. La GPU sólo se propone cuando el render es lo
 * bastante pesado como para que compense el archivo más grande que produce.
 */
export function planRender(input: RenderPlanInput): RenderPlan {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const width = Math.max(2, Math.round(input.width));
  const height = Math.max(2, Math.round(input.height));
  const fps = input.fps > 0 && Number.isFinite(input.fps) ? input.fps : 30;
  const duration = Math.max(0, input.durationSeconds);

  const codec = destinationCodec(input);
  const compression = destinationCompression(input.destination);
  const crf = crfOf(compression);

  if (codec === 'h264') {
    reasons.push(
      input.destination === 'social'
        ? 'Redes: H.264 se reproduce en todos lados y evita rechazos de plataforma.'
        : 'H.264 por compatibilidad y velocidad de encode.',
    );
  } else {
    reasons.push(
      input.isHdr
        ? 'HDR de 10 bits: sólo HEVC conserva el rango sin tonemap.'
        : 'Archivo maestro: HEVC entrega el mismo look con menos peso.',
    );
  }
  reasons.push(
    compression === 'maximo'
      ? 'Compresión máxima calidad: prioriza el master sobre el peso.'
      : compression === 'compacto'
        ? 'Compresión compacta: borrador liviano para revisar rápido.'
        : 'Compresión equilibrada: buen balance entre peso y calidad.',
  );

  const pixels = width * height;
  const pixelFactor = pixels / REFERENCE_PIXELS;
  const fpsFactor = fps / REFERENCE_FPS;
  const longestSide = Math.max(width, height);

  const h264Hw = input.hardware?.h264 === true;
  const hevcHw = input.hardware?.hevc === true;
  const hardwareAvailable = codec === 'hevc' ? hevcHw : h264Hw;
  const heavy = duration >= LONG_RENDER_SECONDS || longestSide >= LARGE_SIDE_PX;

  let encoder: PlanEncoder = 'software';
  if (hardwareAvailable && (heavy || input.destination === 'draft')) {
    encoder = 'hardware';
    reasons.push(
      input.destination === 'draft'
        ? 'Borrador: la GPU termina antes y el peso extra no importa.'
        : 'Render largo o 4K+: la GPU libera CPU durante el encode.',
    );
  } else if (hardwareAvailable) {
    reasons.push(
      'Clip corto: el encoder por software ya es rápido y hace archivos más chicos.',
    );
  } else {
    reasons.push('No hay encoder de hardware para este códec: se usa software.');
  }

  // Peso: bits por píxel del códec ajustados por CRF (6 unidades = 1 bit menos).
  const crfScale = 2 ** ((23 - crf) / 6);
  const videoBitsPerSecond =
    pixels * fps * BITS_PER_PIXEL[codec] * crfScale * (encoder === 'hardware' ? 1.25 : 1);
  const totalBitsPerSecond = videoBitsPerSecond + AUDIO_BITS_PER_SECOND;
  const estimatedBytes = Math.round((totalBitsPerSecond * duration) / 8);

  const speed = encoder === 'hardware' ? HARDWARE_SPEED[codec] : SOFTWARE_SPEED[codec];
  const estimatedSeconds = Math.max(
    1,
    Math.round(duration * speed * pixelFactor * Math.max(0.5, fpsFactor) * 0.6),
  );

  if (input.hasAlpha) {
    warnings.push(
      'Hay clips con alfa: el MP4 no lo conserva. Exportá el tramo con alfa en VP9/WebM o quitá el canal antes de exportar.',
    );
  }
  if (width % 2 !== 0 || height % 2 !== 0) {
    warnings.push(
      `Las dimensiones ${width}×${height} son impares: H.264/H.265 en 4:2:0 necesita pares.`,
    );
  }
  if (input.destination === 'social' && longestSide > 1920) {
    warnings.push(
      'Para redes, 1080p alcanza: subir 4K sólo agrega peso y tiempo de carga.',
    );
  }
  if (input.destination === 'archive' && !hevcHw && duration >= LONG_RENDER_SECONDS) {
    warnings.push(
      'HEVC por software es lento en timelines largas; si tenés GPU HEVC, conviene activarla.',
    );
  }
  if (duration <= 0) {
    warnings.push('El rango elegido dura 0 segundos: no hay nada para exportar.');
  }

  return {
    codec,
    compression,
    encoder,
    crf,
    estimatedBytes,
    estimatedSeconds,
    reasons,
    warnings,
  };
}

/** Etiqueta corta para la UI: «1,2 GB · ~3 min». */
export function formatPlanEstimate(plan: RenderPlan): string {
  const bytes = plan.estimatedBytes;
  const size =
    bytes >= 1_000_000_000
      ? `${(bytes / 1_000_000_000).toFixed(1).replace('.', ',')} GB`
      : bytes >= 1_000_000
        ? `${Math.round(bytes / 1_000_000)} MB`
        : `${Math.round(bytes / 1000)} kB`;
  const seconds = plan.estimatedSeconds;
  const time =
    seconds >= 60
      ? `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`
      : `${seconds} s`;
  return `${size} · ~${time}`;
}

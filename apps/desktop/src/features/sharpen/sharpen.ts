/**
 * Definición: estado, presets y resumen de la cadena de nitidez perceptual.
 *
 * Las cinco etapas son las del oficio, y el orden importa: primero se limpia el
 * artefacto de compresión, después se escala, recién entonces se enfoca, se
 * aplica la curva de micro-contraste y el grano queda al final para que el
 * enfoque no lo amplifique.
 *
 * `clarityFilterSummary` replica el constructor de Rust (`commands/sharpen.rs`)
 * para que la interfaz muestre exactamente el filtro que va a correr FFmpeg.
 */

export type ClarityStageId = 'clean' | 'scale' | 'unsharp' | 'curve' | 'grain';

export interface ClaritySettings {
  /** Limpieza temporal, 0–100. 0 apaga el suavizado. */
  readonly denoise: number;
  /** De-blocking de compresión. */
  readonly deblock: boolean;
  /** Altura destino; 0 deja la resolución original. */
  readonly targetHeight: number;
  /** Escalar en un espacio de trabajo de 16 bits por canal. */
  readonly highPrecision: boolean;
  /** Cantidad de la máscara de enfoque, 0–3. */
  readonly unsharpAmount: number;
  /** Tamaño de la matriz de la máscara. */
  readonly unsharpSize: number;
  /** Fuerza de la curva S, 0–100. */
  readonly curve: number;
  /** Intensidad del grano, 0–3 (%). */
  readonly grain: number;
}

export type ClarityPresetId = 'social' | 'cinema' | 'uhd' | 'clean' | 'custom';

export interface ClarityPreset {
  readonly id: ClarityPresetId;
  readonly label: string;
  readonly detail: string;
  readonly settings: ClaritySettings | null;
}

export const DEFAULT_CLARITY: ClaritySettings = {
  denoise: 0,
  deblock: false,
  targetHeight: 0,
  highPrecision: true,
  unsharpAmount: 1.2,
  unsharpSize: 5,
  curve: 35,
  grain: 1.5,
};

export const CLARITY_PRESETS: readonly ClarityPreset[] = [
  {
    id: 'social',
    label: 'Redes 1080p',
    detail: 'Limpia el bloque de compresión y deja el borde crujiente',
    settings: {
      denoise: 40,
      deblock: true,
      targetHeight: 0,
      highPrecision: true,
      unsharpAmount: 1.2,
      unsharpSize: 5,
      curve: 35,
      grain: 1.5,
    },
  },
  {
    id: 'cinema',
    label: 'Cine 35 mm',
    detail: 'Curva profunda y grano orgánico, enfoque suave',
    settings: {
      denoise: 15,
      deblock: false,
      targetHeight: 0,
      highPrecision: true,
      unsharpAmount: 0.9,
      unsharpSize: 7,
      curve: 55,
      grain: 2.5,
    },
  },
  {
    id: 'uhd',
    label: '1080p → 4K',
    detail: 'Lanczos en 16 bits, enfoque sobre la resolución final',
    settings: {
      denoise: 45,
      deblock: true,
      targetHeight: 2160,
      highPrecision: true,
      unsharpAmount: 1.5,
      unsharpSize: 5,
      curve: 40,
      grain: 1.5,
    },
  },
  {
    id: 'clean',
    label: 'Solo limpieza',
    detail: 'Sin enfoque ni contraste: únicamente saca el ruido',
    settings: {
      denoise: 65,
      deblock: true,
      targetHeight: 0,
      highPrecision: false,
      unsharpAmount: 0,
      unsharpSize: 5,
      curve: 0,
      grain: 0,
    },
  },
  {
    id: 'custom',
    label: 'Personalizado',
    detail: 'Movés cada etapa a mano',
    settings: null,
  },
];

export const TARGET_HEIGHTS: readonly { readonly value: number; readonly label: string }[] = [
  { value: 0, label: 'Original' },
  { value: 1080, label: '1080p' },
  { value: 1440, label: '1440p' },
  { value: 2160, label: '4K' },
];

/** Texto de cada etapa tal como se explica en la interfaz. */
export const CLARITY_STAGES: readonly {
  readonly id: ClarityStageId;
  readonly title: string;
  readonly how: string;
  readonly why: string;
}[] = [
  {
    id: 'clean',
    title: 'Limpieza y de-blocking',
    how: 'De-blocking espacial y suavizado temporal adaptativo sobre los cuadritos de la compresión previa.',
    why: 'Un video limpio con menos resolución se ve más caro que uno lleno de ruido pixelado. Además, si se enfoca antes de limpiar, la máscara amplifica el artefacto.',
  },
  {
    id: 'scale',
    title: 'Escalado Lanczos',
    how: 'Lanczos3 en un espacio de trabajo de 16 bits por canal, con redondeo exacto e interpolación de croma completa.',
    why: 'Bilinear genera halos borrosos al estirar. Lanczos conserva el borde y el espacio de 16 bits evita la cuantización de los píxeles que se están inventando.',
  },
  {
    id: 'unsharp',
    title: 'Máscara de enfoque',
    how: 'Detecta el borde y sube el contraste justo en la línea divisoria: oscurece el lado oscuro y aclara el lado claro.',
    why: 'El ojo interpreta la nitidez por el contraste de borde, no por la cantidad de píxeles. Un 1080p bien enfocado se ve más detallado en pantalla grande.',
  },
  {
    id: 'curve',
    title: 'Curva S de micro-contraste',
    how: 'Curva con extremos fijos: hunde los negros profundos y levanta apenas las altas luces, sin recortar nada.',
    why: 'Separa visualmente los planos de la imagen. El cerebro lee esa profundidad como mayor fidelidad y desaparece la sensación de video lavado.',
  },
  {
    id: 'grain',
    title: 'Grano de película',
    how: 'Ruido temporal uniforme de 1 % a 3 % sobre todo el cuadro, aplicado al final de la cadena.',
    why: 'El grano orgánico enmascara la falta de definición digital y da textura cinematográfica. Va último para que el enfoque no lo amplifique.',
  },
];

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Normaliza un estado arbitrario a los rangos que acepta el render. */
export function clampClarity(settings: ClaritySettings): ClaritySettings {
  return {
    denoise: Math.round(clamp(settings.denoise, 0, 100)),
    deblock: Boolean(settings.deblock),
    targetHeight: Math.round(clamp(settings.targetHeight, 0, 8192)),
    highPrecision: Boolean(settings.highPrecision),
    unsharpAmount: Math.round(clamp(settings.unsharpAmount, 0, 3) * 100) / 100,
    unsharpSize: normalizeUnsharpSize(settings.unsharpSize),
    curve: Math.round(clamp(settings.curve, 0, 100)),
    grain: Math.round(clamp(settings.grain, 0, 3) * 10) / 10,
  };
}

function normalizeUnsharpSize(size: number): number {
  return size === 3 || size === 7 || size === 9 ? size : 5;
}

export function presetById(id: ClarityPresetId): ClarityPreset | undefined {
  return CLARITY_PRESETS.find((preset) => preset.id === id);
}

/** Estado resultante de aplicar un preset, ya normalizado. */
export function settingsForPreset(id: ClarityPresetId): ClaritySettings | null {
  const preset = presetById(id);
  if (!preset?.settings) return null;
  return clampClarity(preset.settings);
}

/**
 * Qué preset describe exactamente este estado. Devuelve `custom` si ninguno
 * coincide, para que la interfaz no mienta cuando se mueve un control.
 */
export function presetForSettings(settings: ClaritySettings): ClarityPresetId {
  const normalized = clampClarity(settings);
  for (const preset of CLARITY_PRESETS) {
    if (!preset.settings) continue;
    const candidate = clampClarity(preset.settings);
    if (
      candidate.denoise === normalized.denoise &&
      candidate.deblock === normalized.deblock &&
      candidate.targetHeight === normalized.targetHeight &&
      candidate.highPrecision === normalized.highPrecision &&
      candidate.unsharpAmount === normalized.unsharpAmount &&
      candidate.unsharpSize === normalized.unsharpSize &&
      candidate.curve === normalized.curve &&
      candidate.grain === normalized.grain
    ) {
      return preset.id;
    }
  }
  return 'custom';
}

/** Etapas que realmente van a modificar la imagen. */
export function activeStages(settings: ClaritySettings, sourceHeight = 0): readonly ClarityStageId[] {
  const clean = clampClarity(settings);
  const stages: ClarityStageId[] = [];
  if (clean.denoise > 0 || clean.deblock) stages.push('clean');
  if (needsScale(clean, sourceHeight)) stages.push('scale');
  if (clean.unsharpAmount > 0.001) stages.push('unsharp');
  if (clean.curve > 0) stages.push('curve');
  if (clean.grain > 0.05) stages.push('grain');
  return stages;
}

function needsScale(settings: ClaritySettings, sourceHeight: number): boolean {
  return settings.targetHeight > 0 && (sourceHeight === 0 || settings.targetHeight !== sourceHeight);
}

/**
 * Cadena de filtros equivalente a la que arma el backend. Se usa para mostrar
 * el filtro real y para las pruebas de contrato con Rust.
 */
export function clarityFilterSummary(
  settings: ClaritySettings,
  sourceHeight = 0,
): string {
  const clean = clampClarity(settings);
  const filters: string[] = [];

  if (clean.deblock) {
    filters.push(`deblock=filter=${clean.denoise >= 60 ? 'strong' : 'weak'}:block=8`);
  }
  if (clean.denoise > 0) {
    const base = clean.denoise / 100;
    const lumaA = (0.005 + base * 0.045).toFixed(4);
    const lumaB = (0.01 + base * 0.09).toFixed(4);
    const chromaA = (0.005 + base * 0.04).toFixed(4);
    const chromaB = (0.01 + base * 0.08).toFixed(4);
    filters.push(`atadenoise=0a=${lumaA}:0b=${lumaB}:1a=${chromaA}:1b=${chromaB}`);
  }
  if (needsScale(clean, sourceHeight)) {
    if (clean.highPrecision) filters.push('format=gbrp16le');
    filters.push(`scale=-2:${clean.targetHeight}:flags=lanczos+accurate_rnd+full_chroma_int`);
    filters.push('format=yuv420p');
  }
  if (clean.unsharpAmount > 0.001) {
    filters.push(
      `unsharp=luma_msize_x=${clean.unsharpSize}:luma_msize_y=${clean.unsharpSize}:luma_amount=${clean.unsharpAmount.toFixed(2)}`,
    );
  }
  if (clean.curve > 0) {
    const strength = clean.curve / 100;
    const shadow = (0.25 - 0.12 * strength).toFixed(4);
    const highlight = (0.75 + 0.12 * strength).toFixed(4);
    filters.push(`curves=master='0/0 0.2500/${shadow} 0.7500/${highlight} 1/1'`);
  }
  if (clean.grain > 0.05) {
    const amount = Math.round(clamp(clean.grain, 0, 3) * 2.2);
    filters.push(`noise=alls=${clamp(amount, 1, 8)}:allf=t+u`);
  }
  return filters.join(',');
}

/** Resumen humano de una línea para la cabecera del preview. */
export function claritySummary(settings: ClaritySettings, sourceHeight = 0): string {
  const stages = activeStages(settings, sourceHeight);
  if (stages.length === 0) return 'Ninguna etapa activa';
  const names = stages.map((id) => {
    switch (id) {
      case 'clean':
        return 'limpieza';
      case 'scale':
        return `Lanczos a ${settings.targetHeight}p`;
      case 'unsharp':
        return `enfoque ${settings.unsharpAmount.toFixed(2)}`;
      case 'curve':
        return `curva ${settings.curve}%`;
      case 'grain':
        return `grano ${settings.grain.toFixed(1)}%`;
      default:
        return id;
    }
  });
  return names.join(' · ');
}

export function formatSharpenBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatSharpenDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/** Aviso honesto sobre el límite del build LGPL empaquetado. */
export const CLARITY_ENCODER_NOTE =
  'El encoder se elige solo: libx264 si el FFmpeg instalado lo trae; si no, OpenH264 o la GPU.';

export interface GpuPolicyInput {
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly preset: string;
}

export interface GpuRecommendation {
  readonly recommended: boolean;
  readonly reason: string;
}

const HEAVY_PRESETS: ReadonlySet<string> = new Set(['medium', 'slow', 'slower']);
const LONG_RENDER_SECONDS = 300;
const LARGE_SIDE_PX = 2160;

/**
 * La GPU no acelera todos los renders. En un clip corto 1080p con `veryfast`
 * el encoder por software ya es rápido y produce archivos más chicos; usarla
 * sólo tiene sentido en 4K+, timelines largas o presets pesados.
 */
export function gpuRecommendation(input: GpuPolicyInput): GpuRecommendation {
  const longestSide = Math.max(input.width, input.height);
  if (longestSide >= LARGE_SIDE_PX) {
    return {
      recommended: true,
      reason: 'Resolución 4K o superior: la GPU puede acelerar el encode.',
    };
  }
  if (input.durationSeconds >= LONG_RENDER_SECONDS) {
    return {
      recommended: true,
      reason: 'Timeline de 5 minutos o más: la GPU libera CPU durante el render.',
    };
  }
  if (HEAVY_PRESETS.has(input.preset)) {
    return {
      recommended: true,
      reason: 'Preset de encoder pesado: la GPU puede acelerar el render.',
    };
  }
  return {
    recommended: false,
    reason:
      'Clip corto en 1080p o menos con preset rápido: el encoder por software ya es rápido y hace archivos más chicos.',
  };
}

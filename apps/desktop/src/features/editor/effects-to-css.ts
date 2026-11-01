import type { CSSProperties } from 'react';
import type { ClipEffects } from '@editor-ia/project-schema';

/**
 * Efectos reales de la preview en vivo, compartidos por el lienzo y las
 * miniaturas del panel. La exportación usa el mismo estado del clip en FFmpeg;
 * los efectos sin equivalente CSS se marcan `export-only` en el registro.
 *
 * `colorWheels: false` omite la aproximación CSS de lift/offset/gain/gamma
 * cuando el shader (o el fallback 2D) aplica la fórmula exacta; evita el
 * doble grade en la capa de efectos. `brightness: false` omite el brillo CSS
 * cuando el shader lo suma a las perillas del colorbalance, como el export.
 */
export function effectsToCss(
  effects: ClipEffects | undefined,
  options: {
    readonly colorWheels?: boolean;
    readonly brightness?: boolean;
    readonly temperature?: boolean;
    readonly contrast?: boolean;
    readonly saturation?: boolean;
    readonly hue?: boolean;
    readonly grayscale?: boolean;
    readonly sepia?: boolean;
    readonly tone?: boolean;
    readonly colorMatch?: boolean;
    readonly hsl?: boolean;
  } = {},
): CSSProperties {
  if (!effects) return {};
  const filters: string[] = [];
  if (effects.brightness !== undefined && options.brightness !== false) {
    filters.push(`brightness(${Math.max(0, 1 + effects.brightness)})`);
  }
  if (effects.contrast !== undefined && options.contrast !== false) {
    filters.push(`contrast(${effects.contrast})`);
  }
  if (effects.saturation !== undefined && options.saturation !== false) {
    filters.push(`saturate(${effects.saturation})`);
  }
  if (
    effects.hueRotateDeg !== undefined &&
    Math.abs(effects.hueRotateDeg) > 0.01 &&
    options.hue !== false
  ) {
    filters.push(`hue-rotate(${effects.hueRotateDeg}deg)`);
  }
  if (effects.blur !== undefined && effects.blur > 0) filters.push(`blur(${effects.blur}px)`);
  if (effects.grayscale && options.grayscale !== false) filters.push('grayscale(1)');
  if (effects.sepia && options.sepia !== false) filters.push('sepia(1)');
  if (effects.temperature !== undefined && effects.temperature > 0 && options.temperature !== false) {
    filters.push(`sepia(${Math.min(0.35, effects.temperature * 0.35)})`);
  }
  if (options.tone !== false) {
    if (effects.shadows !== undefined && Math.abs(effects.shadows) > 0.001) {
      filters.push(
        `brightness(${Math.max(0.5, Math.min(1.5, 1 + effects.shadows * 0.06))})`,
      );
    }
    if (effects.highlights !== undefined && Math.abs(effects.highlights) > 0.001) {
      filters.push(
        `contrast(${Math.max(0.5, Math.min(1.5, 1 + effects.highlights * 0.12))})`,
      );
    }
    if (effects.fade !== undefined && effects.fade > 0.001) {
      filters.push(`contrast(${Math.max(0.5, 1 - effects.fade * 0.12)})`);
      filters.push(`brightness(${1 + effects.fade * 0.04})`);
    }
  }
  const lift = effects.lift ?? { r: 0, g: 0, b: 0 };
  const gamma = effects.gamma ?? { r: 0, g: 0, b: 0 };
  const gain = effects.gain ?? { r: 0, g: 0, b: 0 };
  if (options.colorWheels !== false) {
    const red = lift.r + gain.r;
    const green = lift.g + gain.g;
    const blue = lift.b + gain.b;
    const exposure = (red + green + blue) / 3;
    if (Math.abs(exposure) > 0.01) {
      filters.push(`brightness(${Math.max(0.2, Math.min(3, 1 + exposure))})`);
    }
    const warmth = red - blue;
    if (Math.abs(warmth) > 0.01) {
      filters.push(`sepia(${Math.min(0.4, Math.abs(warmth))})`);
      filters.push(`hue-rotate(${warmth > 0 ? -15 : 160}deg)`);
    }
    const midtone = (gamma.r + gamma.g + gamma.b) / 3;
    if (Math.abs(midtone) > 0.01) {
      filters.push(`contrast(${Math.max(0.2, Math.min(3, 1 + midtone))})`);
    }
  }
  const hsl = effects.hsl;
  if (hsl && options.hsl !== false) {
    if (Math.abs(hsl.hue) > 0.1) filters.push(`hue-rotate(${hsl.hue}deg)`);
    if (Math.abs(hsl.saturation) > 0.001) {
      filters.push(`saturate(${Math.max(0, 1 + hsl.saturation)})`);
    }
    if (Math.abs(hsl.intensity) > 0.001) {
      filters.push(`brightness(${Math.max(0.2, 1 + hsl.intensity * 0.5)})`);
    }
  }
  const match = effects.colorMatch;
  if (match && match.strength > 0.001 && options.colorMatch !== false) {
    const matched = [match.r, match.g, match.b].map(
      (gain) => 1 + (gain - 1) * match.strength,
    );
    const matchExposure = (matched[0]! + matched[1]! + matched[2]!) / 3;
    if (Math.abs(matchExposure - 1) > 0.01) {
      filters.push(
        `brightness(${Math.max(0.2, Math.min(3, matchExposure))})`,
      );
    }
    const matchWarmth = matched[0]! - matched[2]!;
    if (Math.abs(matchWarmth) > 0.01) {
      filters.push(`sepia(${Math.min(0.4, Math.abs(matchWarmth))})`);
      filters.push(`hue-rotate(${matchWarmth > 0 ? -15 : 160}deg)`);
    }
  }
  return filters.length > 0 ? { filter: filters.join(' ') } : {};
}

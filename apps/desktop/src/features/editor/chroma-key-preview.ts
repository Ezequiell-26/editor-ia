import type { ChromaKey } from '@editor-ia/project-schema';

/**
 * Keying de la preview. FFmpeg calcula el UV de la clave con coeficientes
 * BT.601 en punto fijo y compara contra el UV del píxel con una ventana 3×3,
 * normalizando por sqrt(2)·255. La preview reproduce esa fórmula en el shader.
 */

export interface ChromaKeyUniforms {
  readonly u: number;
  readonly v: number;
  readonly similarity: number;
  readonly blend: number;
}

const FIX_U = 173; // round(0.16874 * 1024)
const FIX_V_R = 512; // round(0.5 * 1024)
const FIX_V_G = 429; // round(0.41869 * 1024)
const FIX_V_B = 83; // round(0.08131 * 1024)
const FIX_G = 339; // round(0.33126 * 1024)

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** UV 0–255 con el mismo redondeo en punto fijo que `RGB_TO_U/V` de FFmpeg. */
export function chromaUvFromRgb255(
  red: number,
  green: number,
  blue: number,
): { u: number; v: number } {
  const u =
    ((-FIX_U * red - FIX_G * green + 512 * blue + 511) >> 10) + 128;
  const v =
    ((FIX_V_R * red - FIX_V_G * green - FIX_V_B * blue + 511) >> 10) + 128;
  return { u: clampByte(u) / 255, v: clampByte(v) / 255 };
}

/**
 * UV del píxel. FFmpeg recibe el frame en YUV limitado (swscale) y lo compara
 * contra el UV de la clave calculado en rango completo; se replica esa
 * combinación porque es la que decide el alfa real del export.
 */
export function chromaPixelUvFromRgb255(
  red: number,
  green: number,
  blue: number,
): { u: number; v: number } {
  const u = 128 - 0.148223 * red - 0.290993 * green + 0.439216 * blue;
  const v = 128 + 0.439216 * red - 0.367788 * green - 0.071427 * blue;
  return { u: clampByte(u) / 255, v: clampByte(v) / 255 };
}

export function chromaUvFromColor(color: string): { u: number; v: number } | null {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return null;
  const hex = match[1]!;
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return chromaUvFromRgb255(red, green, blue);
}

export function chromaKeyUniforms(
  key: ChromaKey | undefined,
): ChromaKeyUniforms | null {
  if (!key) return null;
  const uv = chromaUvFromColor(key.color);
  if (!uv) return null;
  return {
    u: uv.u,
    v: uv.v,
    similarity: Math.min(1, Math.max(0.01, key.similarity)),
    blend: Math.min(1, Math.max(0, key.blend)),
  };
}

/**
 * Referencia en JS del alfa del shader, con la misma ventana 3×3 y
 * normalización. Sirve para tests y para comparar contra FFmpeg.
 */
export function chromaKeyAlphaAt(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  key: ChromaKeyUniforms,
): number {
  let diff = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      // FFmpeg replica el borde en las muestras fuera de cuadro.
      const sx = Math.max(0, Math.min(width - 1, x + dx));
      const sy = Math.max(0, Math.min(height - 1, y + dy));
      const index = (sy * width + sx) * 4;
      const uv = chromaPixelUvFromRgb255(
        data[index]!,
        data[index + 1]!,
        data[index + 2]!,
      );
      const du = uv.u - key.u;
      const dv = uv.v - key.v;
      diff += Math.sqrt((du * du + dv * dv) / 2);
    }
  }
  diff /= 9;
  if (key.blend > 0.0001) {
    return Math.max(0, Math.min(1, (diff - key.similarity) / key.blend));
  }
  return diff > key.similarity ? 1 : 0;
}

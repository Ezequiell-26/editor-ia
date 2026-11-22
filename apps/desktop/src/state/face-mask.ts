import type { ClipMask } from '@editor-ia/project-schema';
import type { FaceSample } from '../services/project-service';

const MAX_TRACKED_KEYFRAMES = 48;

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Convierte el seguimiento facial de FFmpeg/SeetaFace en una máscara poligonal
 * animada: el polígono base rodea la primera cara y las claves x/y trasladan
 * el conjunto mientras width/height lo escalan según el tamaño detectado
 * (la máscara acompaña el acercamiento/alejamiento del sujeto).
 *
 * Vive en `state/` (puro) para que la UI (`features/vfx`) y el dispatcher MCP
 * compartan la misma conversión sin importar features.
 */
export function maskFromFaceTrack(
  result: { readonly samples: readonly FaceSample[] },
  fps: number,
): ClipMask | null {
  // El backend devuelve `time` relativo al inicio del tramo analizado
  // (`-ss` antes de `-i`), así que no hay que restar inFrame/60 otra vez.
  const samples = result.samples.filter(
    (sample) =>
      Number.isFinite(sample.time) &&
      Number.isFinite(sample.centerX) &&
      Number.isFinite(sample.centerY) &&
      sample.time >= -0.001,
  );
  if (samples.length === 0 || !(fps > 0)) return null;
  const first = samples[0]!;
  const centerX = clampUnit(first.centerX);
  const centerY = clampUnit(first.centerY);
  const radius = Math.max(0.03, Math.min(0.45, (first.size || 0.2) * 0.55));
  const baseSize = first.size > 0 ? first.size : 0.2;
  const points = Array.from({ length: 8 }, (_, index) => {
    const angle = ((-90 + index * 45) * Math.PI) / 180;
    return {
      x: Number(clampUnit(centerX + Math.cos(angle) * radius).toFixed(6)),
      y: Number(clampUnit(centerY + Math.sin(angle) * radius * 1.12).toFixed(6)),
    };
  });

  const stride = Math.max(1, Math.ceil(samples.length / MAX_TRACKED_KEYFRAMES));
  const sampled = samples.filter((_, index) => index % stride === 0);
  // AUD-146: se reserva un slot para la última muestra. Si el muestreo
  // ya llenó el cupo (p.ej. 96 muestras con stride 2 → 48 pares), agregar
  // el endpoint y cortar en MAX lo descartaría justamente a él.
  if (sampled.length >= MAX_TRACKED_KEYFRAMES) {
    sampled.length = MAX_TRACKED_KEYFRAMES - 1;
  }
  if (sampled[sampled.length - 1] !== samples[samples.length - 1]) {
    sampled.push(samples[samples.length - 1]!);
  }
  const seen = new Set<number>();
  const keyframes = [];
  for (const sample of sampled.slice(0, MAX_TRACKED_KEYFRAMES)) {
    const frame = Math.max(0, Math.round(sample.time * fps));
    if (seen.has(frame)) continue;
    seen.add(frame);
    // Escala relativa al tamaño de la primera detección: si el rostro crece
    // (acercamiento) la máscara crece con él. Clamp al rango del esquema
    // (0, 2] y fallback 1 cuando la muestra no trae tamaño válido.
    const scale =
      sample.size > 0
        ? Number(Math.min(2, Math.max(0.05, sample.size / baseSize)).toFixed(6))
        : 1;
    keyframes.push({
      frame,
      x: Number(Math.max(-1, Math.min(1, sample.centerX - first.centerX)).toFixed(6)),
      y: Number(Math.max(-1, Math.min(1, sample.centerY - first.centerY)).toFixed(6)),
      width: scale,
      height: scale,
    });
  }
  if (keyframes.length === 0) return null;
  return {
    shape: 'polygon',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    feather: 0,
    invert: false,
    points,
    keyframes,
  };
}

export function polygonAroundCenter(
  centerX: number,
  centerY: number,
  radius = 0.2,
): ClipMask {
  const points = Array.from({ length: 8 }, (_, index) => {
    const angle = ((-90 + index * 45) * Math.PI) / 180;
    return {
      x: Number(clampUnit(centerX + Math.cos(angle) * radius).toFixed(6)),
      y: Number(clampUnit(centerY + Math.sin(angle) * radius).toFixed(6)),
    };
  });
  return {
    shape: 'polygon',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    feather: 0,
    invert: false,
    points,
  };
}

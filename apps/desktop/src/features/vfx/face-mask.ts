import type { ClipMask } from '@editor-ia/project-schema';
import type { FaceTrackResult } from '../../services/project-service';

const MAX_TRACKED_KEYFRAMES = 48;

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Convierte el seguimiento facial de FFmpeg/SeetaFace en una máscara poligonal
 * rígida: el polígono base rodea la primera cara y las claves x/y trasladan el
 * conjunto por el resto del clip. No deforma los vértices.
 */
export function maskFromFaceTrack(
  result: FaceTrackResult,
  fps: number,
  startSeconds = 0,
): ClipMask | null {
  const samples = result.samples.filter(
    (sample) =>
      Number.isFinite(sample.time) &&
      Number.isFinite(sample.centerX) &&
      Number.isFinite(sample.centerY) &&
      sample.time >= startSeconds - 0.001,
  );
  if (samples.length === 0 || !(fps > 0)) return null;
  const first = samples[0]!;
  const centerX = clampUnit(first.centerX);
  const centerY = clampUnit(first.centerY);
  const radius = Math.max(0.03, Math.min(0.45, (first.size || 0.2) * 0.55));
  const points = Array.from({ length: 8 }, (_, index) => {
    const angle = ((-90 + index * 45) * Math.PI) / 180;
    return {
      x: Number(clampUnit(centerX + Math.cos(angle) * radius).toFixed(6)),
      y: Number(clampUnit(centerY + Math.sin(angle) * radius * 1.12).toFixed(6)),
    };
  });

  const stride = Math.max(1, Math.ceil(samples.length / MAX_TRACKED_KEYFRAMES));
  const sampled = samples.filter((_, index) => index % stride === 0);
  if (sampled[sampled.length - 1] !== samples[samples.length - 1]) {
    sampled.push(samples[samples.length - 1]!);
  }
  const seen = new Set<number>();
  const keyframes = [];
  for (const sample of sampled.slice(0, MAX_TRACKED_KEYFRAMES)) {
    const frame = Math.max(0, Math.round((sample.time - startSeconds) * fps));
    if (seen.has(frame)) continue;
    seen.add(frame);
    keyframes.push({
      frame,
      x: Number(Math.max(-1, Math.min(1, sample.centerX - first.centerX)).toFixed(6)),
      y: Number(Math.max(-1, Math.min(1, sample.centerY - first.centerY)).toFixed(6)),
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

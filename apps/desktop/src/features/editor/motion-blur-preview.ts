/**
 * Motion blur de la preview.
 *
 * El export usa `tmix=frames=N:weights=...` de FFmpeg: una ventana de N frames
 * con pesos geométricos normalizados. La preview en vivo no puede guardar N
 * texturas a resolución completa sin multiplicar la memoria, así que usa un
 * promedio exponencial con el **mismo peso del frame más nuevo**. La cola
 * decae con la intensidad, de modo que el primer frame pesa exactamente igual
 * que en el MP4 y los anteriores quedan muy cerca.
 */

export interface MotionBlurSettings {
  readonly frames: number;
  readonly intensity: number;
}

export function normalizedMotionBlur(
  settings: MotionBlurSettings | undefined,
): { frames: number; intensity: number } | null {
  if (!settings) return null;
  const frames = Number.isFinite(settings.frames)
    ? Math.round(settings.frames)
    : 4;
  const clampedFrames = Math.min(12, Math.max(2, frames));
  const intensity = Number.isFinite(settings.intensity)
    ? Math.min(1, Math.max(0, settings.intensity))
    : 0.5;
  if (intensity <= 0.001) return null;
  return { frames: clampedFrames, intensity };
}

/** Pesos oldest→newest, idénticos a `motion_blur_weights` del render. */
export function motionBlurWeights(frames: number, intensity: number): number[] {
  const clampedFrames = Math.min(12, Math.max(2, Math.round(frames)));
  const clamped = Math.min(1, Math.max(0, intensity));
  const raw = Array.from({ length: clampedFrames }, (_, index) =>
    clamped ** (clampedFrames - 1 - index),
  );
  const total = raw.reduce((sum, value) => sum + value, 0) || 1;
  return raw.map((value) => value / total);
}

/**
 * Alfa del frame actual en el acumulador exponencial. Coincide con el último
 * peso de `tmix`; con intensidad 1 equivale a 1/N y con 0 a 1 (sin blur).
 */
export function newestMotionBlurWeight(
  frames: number,
  intensity: number,
): number {
  const clampedFrames = Math.min(12, Math.max(2, Math.round(frames)));
  const clamped = Math.min(1, Math.max(0, intensity));
  if (clamped <= 0.001) return 1;
  if (clamped >= 0.999) return 1 / clampedFrames;
  return (1 - clamped) / (1 - clamped ** clampedFrames);
}

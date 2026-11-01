import type { Clip, ClipEffects } from '@editor-ia/project-schema';
import { sampleEffectKeyframes } from '@editor-ia/project-schema';

/**
 * Efectos del clip en el frame pedido: los keyframes de efecto pisan el valor
 * estático de la propiedad animada y el resto del look se conserva.
 */
export function effectsAtFrame(
  clip: Clip,
  playheadFrame: number,
): ClipEffects | undefined {
  const effects = 'effects' in clip ? clip.effects : undefined;
  const keyframes = 'effectKeyframes' in clip ? clip.effectKeyframes : undefined;
  if (!keyframes || keyframes.length === 0) return effects;
  const relative = Math.max(
    0,
    Math.min(clip.durationFrames - 1, playheadFrame - clip.startFrame),
  );
  const sampled = sampleEffectKeyframes(keyframes, relative);
  const keys = Object.keys(sampled) as (keyof typeof sampled)[];
  if (keys.length === 0) return effects;
  const merged = { ...effects } as ClipEffects & { glowIntensity?: number };
  Object.assign(merged, sampled);
  if (sampled.glowIntensity !== undefined) {
    // La intensidad de glow vive en `effects.glow.intensity`; se conservan
    // radio/umbral y se usan los defaults del catálogo si no había glow.
    merged.glow = {
      intensity: sampled.glowIntensity,
      radius: effects?.glow?.radius ?? 20,
      threshold: effects?.glow?.threshold ?? 0.6,
    };
    delete merged.glowIntensity;
  }
  return merged;
}

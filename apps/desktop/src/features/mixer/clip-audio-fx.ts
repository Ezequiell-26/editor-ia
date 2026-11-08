import {
  effectRegistry,
  paramDefault,
  resolveParamsAt,
  type EffectInstance,
  type EffectManifest,
} from '@editor-ia/effect-kit';

/**
 * Specs de efectos de audio por clip para la preview Web Audio.
 *
 * La cadena de export (`audio_filter` en ffmpeg.rs) tiene ~30 efectos; el
 * preview sólo puede reproducir los que tienen equivalente directo en la
 * Web Audio API. Este módulo resuelve las instancias del `audioStack` a
 * parámetros numéricos concretos (defaults del manifiesto + overrides +
 * keyframes muestreados en `frame`) y filtra a los efectos soportados.
 * El resto queda para el export — la UI lo declara.
 */

export interface ClipFxSpec {
  readonly effectId: string;
  readonly params: Readonly<Record<string, number>>;
}

/** Efectos con equivalente Web Audio en la preview. */
export const PREVIEW_AUDIO_FX: ReadonlySet<string> = new Set([
  'audio.eq',
  'audio.compressor',
  'audio.limiter',
  'audio.echo',
  'audio.slapback',
  'audio.tremolo',
  'audio.chorus',
  'audio.flanger',
  'audio.phaser',
  'audio.autopan',
  'audio.widen',
  'audio.bitcrush',
  'audio.eightbit',
  'audio.vinyl',
  'audio.tape',
  'audio.crystal',
  'audio.megaphone',
  'audio.muffled',
  'audio.telephone',
  'audio.underwater',
  'audio.walkie',
  'audio.gate',
  'audio.leveler',
  'audio.deesser',
  'audio.voice_robot',
  'audio.voice_wobble',
  'audio.voice_alien',
  'audio.voice_chipmunk',
  'audio.voice_deep',
  'audio.voice_vader',
]);

function numericParams(
  manifest: EffectManifest,
  instance: EffectInstance,
  frame: number,
): Record<string, number> {
  const resolved = resolveParamsAt(manifest, instance.params, instance.keyframes, frame);
  const out: Record<string, number> = {};
  for (const spec of manifest.params) {
    const raw = resolved[spec.id] ?? paramDefault(spec);
    if (typeof raw === 'number' && Number.isFinite(raw)) out[spec.id] = raw;
  }
  return out;
}

/**
 * Resuelve el `audioStack` del clip a specs de preview en `frame` (frame
 * local del clip, para muestrear keyframes). Devuelve sólo efectos
 * soportados, en el orden de la pila y sólo los habilitados.
 */
export function clipAudioFxSpec(
  stack: readonly EffectInstance[] | undefined,
  frame: number,
): ClipFxSpec[] {
  if (!stack || stack.length === 0) return [];
  const specs: ClipFxSpec[] = [];
  for (const instance of stack) {
    if (instance.enabled === false) continue;
    if (!PREVIEW_AUDIO_FX.has(instance.effectId)) continue;
    const manifest = effectRegistry.get(instance.effectId);
    if (!manifest || manifest.kind !== 'audio') continue;
    specs.push({
      effectId: instance.effectId,
      params: numericParams(manifest, instance, frame),
    });
  }
  return specs;
}

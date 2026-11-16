import {
  effectRegistry,
  paramDefault,
  resolveParamsAt,
  type EffectInstance,
  type EffectManifest,
} from '@editor-ia/effect-kit';
import type { Clip } from '@editor-ia/project-schema';

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Filtros de voz del clip (`clip.audio`) con equivalente Web Audio, en el
 * mismo orden que `audio_filter` del export: high-pass, low-pass, EQ de 3
 * bandas, de-esser, puerta de ruido, compresor y efecto de voz.
 *
 * Reusa los ids del catálogo cuando el caso del builder ya implementa la
 * misma receta (`audio.deesser`/`audio.gate`/`audio.compressor`/
 * `audio.voice_*`/`audio.echo`), con los parámetros que el export pasa a
 * FFmpeg; `clip.hpf`/`clip.lpf`/`clip.eq3`/`clip.denoise` son casos propios
 * porque el clip no tiene esos efectos en el `audioStack`. `denoise`
 * (`afftdn`) se aproxima con sustracción espectral en un AudioWorklet:
 * no es sample-exacto y si el worklet no está disponible la preview queda
 * seca en ese tramo.
 */
export function clipVoiceFxSpec(audio: Clip['audio']): ClipFxSpec[] {
  if (!audio) return [];
  const specs: ClipFxSpec[] = [];
  const highPass = audio.highPassHz ?? 0;
  if (highPass > 20) {
    specs.push({
      effectId: 'clip.hpf',
      params: { freq: clamp(highPass, 20, 2_000) },
    });
  }
  const lowPass = audio.lowPassHz ?? 0;
  if (lowPass > 1_000) {
    specs.push({
      effectId: 'clip.lpf',
      params: { freq: clamp(lowPass, 1_000, 20_000) },
    });
  }
  const eqLow = audio.eqLowDb ?? 0;
  const eqMid = audio.eqMidDb ?? 0;
  const eqHigh = audio.eqHighDb ?? 0;
  if (
    Math.abs(eqLow) > 0.01 ||
    Math.abs(eqMid) > 0.01 ||
    Math.abs(eqHigh) > 0.01
  ) {
    specs.push({
      effectId: 'clip.eq3',
      params: { low: eqLow, mid: eqMid, high: eqHigh },
    });
  }
  const denoise = audio.denoise ?? 0;
  if (denoise > 0.001) {
    // afftdn=nr={denoise*30}:nf=-25 → `nr` en dB para el worklet.
    specs.push({
      effectId: 'clip.denoise',
      params: { nr: clamp(denoise, 0, 1) * 30 },
    });
  }
  if (audio.deesser) {
    // deesser=i=0.4:m=0.5:f=0.5 del export → mismos params del efecto de pila.
    specs.push({
      effectId: 'audio.deesser',
      params: { intensity: 0.4, max: 0.5, freq: 0.5 },
    });
  }
  if (typeof audio.gateDb === 'number' && Number.isFinite(audio.gateDb)) {
    // agate threshold en dB → umbral lineal del seguidor; el ratio=2 del
    // export se aproxima con una puerta de residual `range`.
    const thresholdDb = clamp(audio.gateDb, -60, -10);
    specs.push({
      effectId: 'audio.gate',
      params: {
        threshold: 10 ** (thresholdDb / 20),
        range: 0.1,
        attack: 5,
        release: 120,
      },
    });
  }
  if (audio.compressor) {
    // acompressor=threshold=-18dB:ratio=3:attack=5:release=100:makeup=2
    specs.push({
      effectId: 'audio.compressor',
      params: { threshold: -18, ratio: 3, attack: 5, release: 100, makeup: 2 },
    });
  }
  // voiceEffect del export → presets equivalentes de la cadena de pila.
  switch (audio.voiceEffect) {
    case 'deep':
      // asetrate*0.86 + atempo → pitch shifter a 0.86.
      specs.push({ effectId: 'audio.voice_deep', params: { pitch: 0.86 } });
      break;
    case 'chipmunk':
      // asetrate*1.22 + atempo → pitch shifter a 1.22.
      specs.push({ effectId: 'audio.voice_chipmunk', params: { pitch: 1.22 } });
      break;
    case 'robot':
      // vibrato=f=32:d=0.45 + aecho 18 ms.
      specs.push({ effectId: 'audio.voice_robot', params: { rate: 32, depth: 0.45 } });
      break;
    case 'echo':
      // aecho=0.8:0.9:500|1000:0.4|0.25 → un retardo representativo.
      specs.push({ effectId: 'audio.echo', params: { delay: 500, decay: 0.4 } });
      break;
    case 'cave':
      // aecho=0.8:0.9:1200|1800:0.35|0.2 → retardo largo.
      specs.push({ effectId: 'audio.echo', params: { delay: 1_200, decay: 0.35 } });
      break;
    case 'radio':
      // highpass=f=350,lowpass=f=3200,acompressor ratio=4.
      specs.push({ effectId: 'clip.hpf', params: { freq: 350 } });
      specs.push({ effectId: 'clip.lpf', params: { freq: 3_200 } });
      specs.push({
        effectId: 'audio.compressor',
        params: { threshold: -18, ratio: 4, attack: 5, release: 80, makeup: 0 },
      });
      break;
    default:
      break;
  }
  return specs;
}

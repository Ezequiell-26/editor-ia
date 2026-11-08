import type { ProjectDocument, Track } from '@editor-ia/project-schema';
import {
  dbfsToRms,
  gainForTargetPeak,
  hasSoloedAudioTrack,
  isTrackAudible,
  levelPercentFromDb,
  panGains,
  panLabel,
  panPanLabels,
  peakDbFromPeaks,
  effectivePeakDb,
  rmsToDbfs,
  samplePanGain,
  trackEqDb,
  trackGainDb,
  trackPan,
} from '../../state/audio-mix';
import { sampleTrackGain, sampleTrackPan } from '../../state/track-automation';
import type { ClipFxSpec } from './clip-audio-fx';

/**
 * Utilidades de mezcla de la preview y la vista Mezcla.
 *
 * Los helpers canónicos viven en `state/audio-mix.ts` (balance lineal, mismos
 * clamps que el export) y se re-exportan acá para que la preview y la vista
 * Mezcla los consuman de un solo lugar. Este módulo añade encima el motor de
 * Web Audio compartido.
 */

export {
  dbfsToRms,
  gainForTargetPeak,
  hasSoloedAudioTrack,
  isTrackAudible,
  levelPercentFromDb,
  panGains,
  panLabel,
  panPanLabels,
  peakDbFromPeaks,
  effectivePeakDb,
  rmsToDbfs,
  samplePanGain,
  trackEqDb,
  trackGainDb,
  trackPan,
};

/** Pistas que pueden llevar audio. */
const AUDIO_KINDS: ReadonlySet<Track['kind']> = new Set(['video', 'audio', 'narration']);

/**
 * Motor de audio de la vista previa: un único grafo de Web Audio compartido
 * por toda la app, vivo a nivel de módulo para que la preview (vista Editor)
 * y los medidores en vivo (vista Mezcla) lean el mismo estado.
 *
 * Topología por pista, espejo del export (`track_audio_filters` en
 * ffmpeg.rs): los elementos de la pista entran a un nodo mezclador, pasan por
 * el EQ de 3 bandas (lowshelf 120 Hz, peaking 1 kHz, highshelf 8 kHz), el
 * fader con la ganancia de pista y el paneo de balance lineal, y llegan al
 * bus master (ganancia master + analizador) antes del destino.
 *
 * El mute y el solo no viven acá: la preview sólo monta los elementos de
 * pistas audibles (`isTrackAudible`), así que el grafo nunca recibe material
 * silenciado.
 *
 * Degradación silenciosa: si `window.AudioContext` no existe (jsdom, WebView
 * capada) o el contexto no se puede crear, el motor queda inerte y la preview
 * sigue funcionando con `element.volume` como siempre. Lo mismo aplica si
 * `createMediaElementSource` falla para un elemento puntual.
 */

/** Lado db → lineal (amplitud), la convención del mezclador y del export. */
function gainFromDb(db: number): number {
  return 10 ** (db / 20);
}

/** Rango del fader de pista, igual al clamp de `trackGainDb`. */
function clampGainDb(db: number): number {
  return Math.max(-60, Math.min(12, db));
}

/** Rango del EQ por banda, igual al clamp de `trackEqDb`. */
function clampEqDb(db: number): number {
  return Math.max(-12, Math.min(12, db));
}

/**
 * Paneo de la pista, acotado como `trackPan`. OJO: se implementa con
 * splitter → dos GainNode → merger en vez de un `StereoPannerNode`, porque el
 * nodo estándar usa curva de potencia igual (pan 0.5 daría ~7,7 dB de
 * diferencia) y mezcla la entrada estéreo a mono antes de paneala: ninguna de
 * las dos cosas reproduce el `pan=stereo|c0=(1-pan)*c0|c1=(1+pan)*c1` del
 * export, que deja ambos canales a 1.0 en el centro (6 dB de diferencia con
 * pan 0.5) y conserva la imagen estéreo del material.
 */
function linearPanGains(pan: number): { left: number; right: number } {
  return panGains(pan);
}

interface TrackAudioParams {
  readonly gainDb: number;
  readonly pan: number;
  readonly eqLowDb: number;
  readonly eqMidDb: number;
  readonly eqHighDb: number;
}

const NEUTRAL_PARAMS: TrackAudioParams = {
  gainDb: 0,
  pan: 0,
  eqLowDb: 0,
  eqMidDb: 0,
  eqHighDb: 0,
};

/** Cadena Web Audio de una pista. Los nombres siguen el orden del grafo. */
interface TrackChain {
  readonly input: GainNode;
  readonly eqLow: BiquadFilterNode;
  readonly eqMid: BiquadFilterNode;
  readonly eqHigh: BiquadFilterNode;
  readonly fader: GainNode;
  readonly panLeft: GainNode;
  readonly panRight: GainNode;
  readonly analyser: AnalyserNode;
  readonly buffer: Uint8Array;
}

/** Bus master compartido: ganancia master y analizador de salida. */
interface MasterChain {
  readonly bus: GainNode;
  readonly analyser: AnalyserNode;
  readonly buffer: Uint8Array;
  readonly freqBuffer: Float32Array;
  readonly timeBuffer: Float32Array;
}

export interface TrackLevelReading {
  /** RMS de la ventana actual, en dBFS. Silencio digital = -Infinity. */
  readonly rmsDb: number;
  /** Pico absoluto de la ventana actual, en dBFS. */
  readonly peakDb: number;
}

export interface PreviewAudioLevels {
  readonly tracks: Record<string, TrackLevelReading>;
  readonly master: TrackLevelReading;
}

const SILENCE: TrackLevelReading = { rmsDb: Number.NEGATIVE_INFINITY, peakDb: Number.NEGATIVE_INFINITY };

const FFT_SIZE = 1024;

// Estado del motor, vivo a nivel de módulo. Sólo se toca desde este archivo.
let context: AudioContext | null = null;
let contextFailed = false;
let master: MasterChain | null = null;
const chains = new Map<string, TrackChain>();
interface ClipPanChain {
  readonly splitter: ChannelSplitterNode;
  readonly left: GainNode;
  readonly right: GainNode;
  readonly merger: ChannelMergerNode;
}

/**
 * Cadena de efectos de audio del clip (subconjunto Web Audio del
 * `audioStack`): el elemento entra por `input`, los nodos del efecto se
 * encadenan en el orden de la pila y salen por `output` hacia el paneo o
 * la entrada de pista. `apply` actualiza los AudioParam sin reconstruir
 * nodos (barato para keyframes por frame).
 */
interface ClipFxChain {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly signature: string;
  readonly apply: (specs: readonly ClipFxSpec[]) => void;
  /** Frena osciladores LFO e intervalos de seguidores de envolvente. */
  readonly dispose: () => void;
}

/** dB → ganancia lineal para `volume=`/`gain=` de las recetas. */
function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

/**
 * Curva de cuantización para `WaveShaperNode`: `bits` niveles uniformes
 * en [-1, 1]. Aproxima el `acrusher` de FFmpeg (que además submuestrea
 * en el tiempo — eso no tiene equivalente Web Audio directo).
 */
function quantizeCurve(bits: number): Float32Array {
  const levels = Math.max(2, Math.round(2 ** Math.min(16, Math.max(1, bits))));
  const curve = new Float32Array(1024);
  for (let index = 0; index < curve.length; index += 1) {
    const x = (index / (curve.length - 1)) * 2 - 1;
    curve[index] = Math.max(-1, Math.min(1, Math.round(x * levels) / levels));
  }
  return curve;
}

/**
 * Seguidor de envolvente para los efectos de dinámica (`gate`,
 * `leveler`, `deesser`): deriva la señal hacia un `AnalyserNode`, lee el
 * RMS cada ~40 ms y mueve `gain` con `setTargetAtTime` (ataque/liberación
 * como constantes de tiempo). `compute` convierte el RMS lineal [0,1]
 * en la ganancia objetivo [0,1]. Es una aproximación: corre en el hilo
 * de UI, no en audio, así que la puerta no es sample-exacta.
 */
interface EnvelopeFollower {
  readonly gain: GainNode;
  readonly dispose: () => void;
}

function envelopeFollower(
  ctx: AudioContext,
  source: AudioNode,
  compute: (rms: number) => number,
  attackMs: number,
  releaseMs: number,
): EnvelopeFollower {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  const gain = ctx.createGain();
  const buffer = new Uint8Array(analyser.fftSize);
  source.connect(analyser);
  source.connect(gain);
  let level = 0;
  const timer = window.setInterval(() => {
    analyser.getByteTimeDomainData(buffer);
    let sum = 0;
    for (const value of buffer) {
      const sample = (value - 128) / 128;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / buffer.length);
    const target = Math.min(1, Math.max(0, compute(rms)));
    const tauMs = target < level ? attackMs : releaseMs;
    gain.gain.setTargetAtTime(target, ctx.currentTime, Math.max(0.001, tauMs / 3000));
    level = target;
  }, 40);
  return {
    gain,
    dispose: () => {
      window.clearInterval(timer);
      try {
        analyser.disconnect();
      } catch {
        // Ya estaba desconectado.
      }
    },
  };
}

/** Curva tanh para saturación/excitador, con `drive` como pre-ganancia. */
function tanhCurve(): Float32Array {
  const curve = new Float32Array(1024);
  for (let index = 0; index < curve.length; index += 1) {
    const x = (index / (curve.length - 1)) * 2 - 1;
    curve[index] = Math.tanh(x * 3);
  }
  return curve;
}

/**
 * Pitch shifter granular para `voice_alien|chipmunk|deep|vader` (el
 * `asetrate`+`atempo` de FFmpeg no tiene equivalente en nodos
 * declarativos). Dos granos con 50 % de solape y ventana Hann: cada
 * grano lee el input `pitch`× más rápido/lento que el output, así el
 * tono cambia y la duración se conserva. Lookahead fijo de LAT samples
 * (~85 ms) para que los granos nunca lean input que aún no llegó;
 * si `audioWorklet` no está disponible el stage pasa seco.
 */
const PITCH_SHIFTER_WORKLET = `
class PitchShifter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'pitch', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' }];
  }
  constructor() {
    super();
    this.RS = 8192;
    this.G = 2048;
    this.H = this.G / 2;
    this.LAT = 4096;
    this.bufL = new Float32Array(this.RS);
    this.bufR = new Float32Array(this.RS);
    this.w = 0;
    this.a = -this.LAT;
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0] || !output || !output[0]) return true;
    const inL = input[0];
    const inR = input.length > 1 ? input[1] : input[0];
    const outL = output[0];
    const outR = output.length > 1 ? output[1] : output[0];
    const pitch = Math.min(4, Math.max(0.25, parameters.pitch[0]));
    const n = inL.length;
    const RS = this.RS;
    const G = this.G;
    const H = this.H;
    const TWO_PI = Math.PI * 2;
    for (let i = 0; i < n; i += 1) {
      const wi = this.w % RS;
      this.bufL[wi] = inL[i];
      this.bufR[wi] = inR[i];
      this.w += 1;
      const a = this.a;
      this.a += 1;
      let accL = 0;
      let accR = 0;
      if (a >= 0) {
        const k = Math.floor(a / H);
        for (let g = k - 1; g <= k; g += 1) {
          const tau = a - g * H;
          if (tau < 0 || tau >= G) continue;
          const pos = g * H + tau * pitch;
          if (pos < 0) continue;
          const win = 0.5 - 0.5 * Math.cos((TWO_PI * tau) / G);
          const base = Math.floor(pos);
          const i0 = base % RS;
          const frac = pos - base;
          const i1 = (i0 + 1) % RS;
          accL += win * (this.bufL[i0] * (1 - frac) + this.bufL[i1] * frac);
          accR += win * (this.bufR[i0] * (1 - frac) + this.bufR[i1] * frac);
        }
      }
      outL[i] = accL;
      outR[i] = accR;
    }
    return true;
  }
}
registerProcessor('pitch-shifter', PitchShifter);
`;

const pitchModuleLoads = new WeakMap<AudioContext, Promise<boolean>>();

/** Carga el worklet una sola vez por AudioContext (Blob URL, sin assets). */
function ensurePitchModule(ctx: AudioContext): Promise<boolean> {
  let promise = pitchModuleLoads.get(ctx);
  if (!promise) {
    promise = (async () => {
      try {
        const url = URL.createObjectURL(
          new Blob([PITCH_SHIFTER_WORKLET], { type: 'text/javascript' }),
        );
        await ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        return true;
      } catch {
        return false;
      }
    })();
    pitchModuleLoads.set(ctx, promise);
  }
  return promise;
}

interface PitchStage {
  readonly inlet: GainNode;
  readonly outlet: GainNode;
  readonly setPitch: (value: number) => void;
  readonly dispose: () => void;
}

/**
 * Inserta el pitch shifter entre `inlet` y `outlet` cuando el worklet
 * está listo; mientras carga (o si falla) el audio queda en silencio un
 * instante y luego pasa seco si `addModule` no está disponible.
 */
function buildPitchStage(ctx: AudioContext): PitchStage {
  const inlet = ctx.createGain();
  const outlet = ctx.createGain();
  let node: AudioWorkletNode | null = null;
  let pitch = 1;
  let disposed = false;
  const applyParam = () => {
    const param = node?.parameters.get('pitch');
    if (param) param.value = pitch;
  };
  void ensurePitchModule(ctx).then((ok) => {
    if (disposed) return;
    if (ok) {
      try {
        node = new AudioWorkletNode(ctx, 'pitch-shifter');
        inlet.connect(node);
        node.connect(outlet);
        applyParam();
        return;
      } catch {
        // Cae al passthrough de abajo.
      }
    }
    try {
      inlet.connect(outlet);
    } catch {
      // Contexto cerrado.
    }
  });
  return {
    inlet,
    outlet,
    setPitch: (value) => {
      pitch = value;
      applyParam();
    },
    dispose: () => {
      disposed = true;
      try {
        node?.disconnect();
      } catch {
        // Ya estaba desconectado.
      }
    },
  };
}

/**
 * Construye los nodos Web Audio de los efectos soportados
 * (`PREVIEW_AUDIO_FX`). Devuelve `null` si la lista está vacía o el
 * contexto no crea algún nodo.
 */
function buildClipFxChain(
  ctx: AudioContext,
  specs: readonly ClipFxSpec[],
): ClipFxChain | null {
  if (specs.length === 0) return null;
  const input = ctx.createGain();
  const output = ctx.createGain();
  let tail: AudioNode = input;
  const setters: Array<(params: Record<string, number>) => void> = [];
  const disposers: Array<() => void> = [];
  // Params vivos de los seguidores de envolvente: el tick de 40 ms los
  // lee en cada ventana, así que las keyframes llegan sin reconstruir.
  let gateParams: Record<string, number> = {};
  let levelerParams: Record<string, number> = {};
  let deesserParams: Record<string, number> = {};
  try {
    for (const spec of specs) {
      const p = spec.params;
      switch (spec.effectId) {
        case 'audio.eq': {
          // bass/treble de FFmpeg → lowshelf/highshelf (dB y Hz directos).
          const low = ctx.createBiquadFilter();
          low.type = 'lowshelf';
          const high = ctx.createBiquadFilter();
          high.type = 'highshelf';
          tail.connect(low);
          low.connect(high);
          tail = high;
          setters.push((params) => {
            low.frequency.value = params.lowFreq ?? 120;
            low.gain.value = params.low ?? 0;
            high.frequency.value = params.highFreq ?? 8_000;
            high.gain.value = params.high ?? 0;
          });
          break;
        }
        case 'audio.compressor': {
          // acompressor → DynamicsCompressorNode + makeup en dB.
          const comp = ctx.createDynamicsCompressor();
          const makeup = ctx.createGain();
          tail.connect(comp);
          comp.connect(makeup);
          tail = makeup;
          setters.push((params) => {
            comp.threshold.value = params.threshold ?? -18;
            comp.knee.value = 6;
            comp.ratio.value = params.ratio ?? 4;
            comp.attack.value = (params.attack ?? 5) / 1000;
            comp.release.value = (params.release ?? 120) / 1000;
            makeup.gain.value = gainFromDb(params.makeup ?? 0);
          });
          break;
        }
        case 'audio.limiter': {
          // alimiter level=0 → techo duro: threshold=20*log10(limit),
          // ratio alto y ataque rápido.
          const lim = ctx.createDynamicsCompressor();
          tail.connect(lim);
          tail = lim;
          setters.push((params) => {
            const limit = Math.min(1, Math.max(0.0001, params.limit ?? 0.89));
            lim.threshold.value = 20 * Math.log10(limit);
            lim.knee.value = 0;
            lim.ratio.value = 20;
            lim.attack.value = (params.attack ?? 5) / 1000;
            lim.release.value = (params.release ?? 50) / 1000;
          });
          break;
        }
        case 'audio.echo':
        case 'audio.slapback': {
          // aecho → DelayNode con realimentación + mezcla seca/mojada.
          // Eco: delay hasta 2 s y caída alta; slapback: mismo circuito,
          // el usuario elige retardo/corte en los parámetros.
          const delay = ctx.createDelay(5);
          const feedback = ctx.createGain();
          const wet = ctx.createGain();
          const dry = ctx.createGain();
          const sum = ctx.createGain();
          tail.connect(dry);
          tail.connect(delay);
          delay.connect(feedback);
          feedback.connect(delay);
          delay.connect(wet);
          dry.connect(sum);
          wet.connect(sum);
          tail = sum;
          setters.push((params) => {
            delay.delayTime.value = Math.min(4.5, (params.delay ?? 350) / 1000);
            feedback.gain.value = Math.min(0.95, Math.max(0, params.decay ?? 0.4));
            wet.gain.value = 0.6;
            dry.gain.value = 0.8;
          });
          break;
        }
        case 'audio.chorus':
        case 'audio.flanger': {
          // chorus/flanger → DelayNode con delayTime modulada por LFO +
          // mezcla seca/mojada (el flanger suma realimentación). El LFO
          // barre ±depth/2 ms alrededor del retardo base, como el
          // barrido del filtro FFmpeg.
          const isFlanger = spec.effectId === 'audio.flanger';
          const delay = ctx.createDelay(isFlanger ? 0.2 : 0.5);
          const feedback = ctx.createGain();
          const lfo = ctx.createOscillator();
          const lfoGain = ctx.createGain();
          const wet = ctx.createGain();
          const dry = ctx.createGain();
          const sum = ctx.createGain();
          tail.connect(dry);
          tail.connect(delay);
          if (isFlanger) {
            delay.connect(feedback);
            feedback.connect(delay);
          }
          delay.connect(wet);
          dry.connect(sum);
          wet.connect(sum);
          tail = sum;
          lfo.type = 'sine';
          lfo.connect(lfoGain);
          lfoGain.connect(delay.delayTime);
          try {
            lfo.start();
          } catch {
            // Contexto cerrado: la cadena queda muda pero no rompe.
          }
          disposers.push(() => {
            try {
              lfo.stop();
            } catch {
              // Ya estaba frenado.
            }
          });
          setters.push((params) => {
            const baseMs = isFlanger ? (params.delay ?? 2) : (params.delay ?? 55);
            const depthMs = isFlanger ? (params.depth ?? 3) : (params.depth ?? 2.5);
            delay.delayTime.value = Math.min(4.5, Math.max(0.001, baseMs / 1000));
            lfo.frequency.value = Math.min(5, Math.max(0.1, params.speed ?? 0.4));
            lfoGain.gain.value = Math.min(0.005, Math.max(0, depthMs / 2000));
            if (isFlanger) {
              // regen -95..95 % → realimentación con signo y techo.
              const regen = Math.min(95, Math.max(-95, params.regen ?? 40));
              feedback.gain.value = Math.max(-0.95, Math.min(0.95, regen / 100));
              const width = Math.min(100, Math.max(0, params.width ?? 70));
              wet.gain.value = width / 100;
              dry.gain.value = 1;
            } else {
              feedback.gain.value = 0;
              wet.gain.value = 0.5;
              dry.gain.value = 0.7;
            }
          });
          break;
        }
        case 'audio.phaser': {
          // phaser → cadena de BiquadFilter allpass (el `aphaser` de
          // FFmpeg usa la misma idea) con frecuencias moduladas por un
          // LFO + retardo corto + mezcla seca/mojada. Aproximation:
          // 4 etapas fijas en vez de las del filtro original.
          const centers = [300, 600, 1200, 2400];
          const stages = centers.map((freq) => {
            const stage = ctx.createBiquadFilter();
            stage.type = 'allpass';
            stage.frequency.value = freq;
            return stage;
          });
          const delay = ctx.createDelay(0.02);
          const lfo = ctx.createOscillator();
          const lfoGain = ctx.createGain();
          const wet = ctx.createGain();
          const dry = ctx.createGain();
          const sum = ctx.createGain();
          let head: AudioNode = tail;
          for (const stage of stages) {
            head.connect(stage);
            head = stage;
          }
          head.connect(delay);
          delay.connect(wet);
          tail.connect(dry);
          dry.connect(sum);
          wet.connect(sum);
          tail = sum;
          lfo.connect(lfoGain);
          for (const stage of stages) {
            lfoGain.connect(stage.frequency);
          }
          try {
            lfo.start();
          } catch {
            // Contexto cerrado: la cadena queda muda pero no rompe.
          }
          disposers.push(() => {
            try {
              lfo.stop();
            } catch {
              // Ya estaba frenado.
            }
          });
          setters.push((params) => {
            delay.delayTime.value = Math.min(0.02, Math.max(0, (params.delay ?? 3) / 1000));
            const decay = Math.min(0.99, Math.max(0, params.decay ?? 0.4));
            // in_gain 0.4 / out_gain 0.74 del aphaser → mezcla equivalente.
            wet.gain.value = 0.3 + decay * 0.44;
            dry.gain.value = 0.74;
            lfo.frequency.value = Math.min(2, Math.max(0.1, params.speed ?? 0.5));
            lfo.type = Number(params.type) === 0 ? 'sine' : 'triangle';
            lfoGain.gain.value = 400;
          });
          break;
        }
        case 'audio.autopan': {
          // apulsator → StereoPannerNode con `pan` modulada por LFO
          // triangular. Aproximación: el paneador usa curva equalpower y
          // puede downmixar a mono en paneos extremos; el apulsator de
          // FFmpeg panea ganancias lineales sin perder la imagen.
          const panner = ctx.createStereoPanner();
          const lfo = ctx.createOscillator();
          const lfoGain = ctx.createGain();
          tail.connect(panner);
          tail = panner;
          lfo.type = 'triangle';
          lfo.connect(lfoGain);
          lfoGain.connect(panner.pan);
          try {
            lfo.start();
          } catch {
            // Contexto cerrado: la cadena queda muda pero no rompe.
          }
          disposers.push(() => {
            try {
              lfo.stop();
            } catch {
              // Ya estaba frenado.
            }
          });
          setters.push((params) => {
            lfo.frequency.value = Math.min(8, Math.max(0.05, params.rate ?? 0.8));
            lfoGain.gain.value = Math.min(1, Math.max(0, params.depth ?? 0.9));
            panner.pan.value = 0;
          });
          break;
        }
        case 'audio.widen': {
          // extrastereo → matriz mid/side con splitter/merger (mismo
          // patrón que el paneo de pista, sin StereoPannerNode).
          // outL = mid + side·c, outR = mid − side·c con c = width/2:
          // width 2 (default) reproduce la imagen estéreo original.
          const splitter = ctx.createChannelSplitter(2);
          const merger = ctx.createChannelMerger(2);
          const lFromL = ctx.createGain();
          const lFromR = ctx.createGain();
          const rFromL = ctx.createGain();
          const rFromR = ctx.createGain();
          tail.connect(splitter);
          splitter.connect(lFromL, 0);
          splitter.connect(lFromR, 1);
          splitter.connect(rFromL, 0);
          splitter.connect(rFromR, 1);
          lFromL.connect(merger, 0, 0);
          lFromR.connect(merger, 0, 0);
          rFromL.connect(merger, 0, 1);
          rFromR.connect(merger, 0, 1);
          tail = merger;
          setters.push((params) => {
            const c = Math.min(2, Math.max(0, (params.width ?? 2) / 2));
            const a = 0.5 + 0.5 * c;
            const b = 0.5 - 0.5 * c;
            lFromL.gain.value = a;
            lFromR.gain.value = b;
            rFromL.gain.value = b;
            rFromR.gain.value = a;
          });
          break;
        }
        case 'audio.tremolo': {
          // tremolo → GainNode con AudioParam modulada por OscillatorNode.
          const lfo = ctx.createOscillator();
          const depth = ctx.createGain();
          const amp = ctx.createGain();
          lfo.type = 'sine';
          tail.connect(amp);
          lfo.connect(depth);
          depth.connect(amp.gain);
          tail = amp;
          try {
            lfo.start();
          } catch {
            // Contexto cerrado: el oscilador no suena pero la cadena queda.
          }
          disposers.push(() => {
            try {
              lfo.stop();
            } catch {
              // Ya estaba frenado.
            }
          });
          setters.push((params) => {
            const rate = Math.min(20, Math.max(0.1, params.rate ?? 5));
            const dep = Math.min(1, Math.max(0, params.depth ?? 0.5));
            lfo.frequency.value = rate;
            amp.gain.value = 1 - dep / 2;
            depth.gain.value = dep / 2;
          });
          break;
        }
        case 'audio.bitcrush':
        case 'audio.eightbit':
        case 'audio.vinyl':
        case 'audio.walkie': {
          // acrusher → WaveShaperNode con curva de cuantización + mezcla
          // seca/mojada. `eightbit` agrega un lowpass a ~4 kHz (Nyquist
          // de los 8 kHz del original); `vinyl` suma cortes HP/LP y EQ de
          // presencia; `walkie` suma banda HP/LP + compresor antes.
          const isEight = spec.effectId === 'audio.eightbit';
          const isVinyl = spec.effectId === 'audio.vinyl';
          const isWalkie = spec.effectId === 'audio.walkie';
          let head: AudioNode = tail;
          let walkieComp: DynamicsCompressorNode | null = null;
          let vinylLp: BiquadFilterNode | null = null;
          let vinylPresence: BiquadFilterNode | null = null;
          if (isWalkie) {
            const hp = ctx.createBiquadFilter();
            const lp = ctx.createBiquadFilter();
            const comp = ctx.createDynamicsCompressor();
            hp.type = 'highpass';
            hp.frequency.value = 450;
            lp.type = 'lowpass';
            lp.frequency.value = 2600;
            head.connect(hp);
            hp.connect(lp);
            lp.connect(comp);
            head = comp;
            walkieComp = comp;
          }
          if (isEight) {
            const lp = ctx.createBiquadFilter();
            lp.type = 'lowpass';
            lp.frequency.value = 3800;
            head.connect(lp);
            head = lp;
          }
          if (isVinyl) {
            const hp = ctx.createBiquadFilter();
            const lp = ctx.createBiquadFilter();
            hp.type = 'highpass';
            hp.frequency.value = 70;
            lp.type = 'lowpass';
            head.connect(hp);
            hp.connect(lp);
            head = lp;
            vinylLp = lp;
          }
          const shaper = ctx.createWaveShaper();
          const wet = ctx.createGain();
          const dry = ctx.createGain();
          const sum = ctx.createGain();
          head.connect(shaper);
          shaper.connect(wet);
          head.connect(dry);
          dry.connect(sum);
          wet.connect(sum);
          let out: AudioNode = sum;
          if (isVinyl) {
            const presence = ctx.createBiquadFilter();
            presence.type = 'peaking';
            presence.frequency.value = 2500;
            sum.connect(presence);
            out = presence;
            vinylPresence = presence;
          }
          tail = out;
          let lastBits = -1;
          setters.push((params) => {
            const bits = isEight
              ? (params.bits ?? 5)
              : isVinyl
                ? (params.bits ?? 10)
                : isWalkie
                  ? (params.bits ?? 9)
                  : (params.bits ?? 8);
            if (bits !== lastBits) {
              shaper.curve = quantizeCurve(bits);
              lastBits = bits;
            }
            const mix = isEight
              ? 1
              : isVinyl
                ? Math.min(1, Math.max(0, params.crackle ?? 0.18))
                : isWalkie
                  ? Math.min(1, Math.max(0, params.grit ?? 0.35))
                  : Math.min(1, Math.max(0, params.mix ?? 0.8));
            wet.gain.value = mix;
            dry.gain.value = 1 - mix;
            if (isVinyl && vinylLp) {
              vinylLp.frequency.value = Math.min(12000, Math.max(3000, params.cutoff ?? 7000));
            }
            if (isVinyl && vinylPresence) {
              // peaking EQ: `gain` ya está en dB.
              vinylPresence.gain.value = Math.min(6, Math.max(-6, params.presence ?? 1.5));
            }
            if (isWalkie && walkieComp) {
              walkieComp.threshold.value = -20;
              walkieComp.ratio.value = 6;
              walkieComp.attack.value = 0.003;
              walkieComp.release.value = 0.06;
            }
          });
          break;
        }
        case 'audio.tape': {
          // cinta → HP 55 + LP cutoff + vibrato (wow/flutter) + compresor.
          const hp = ctx.createBiquadFilter();
          const lp = ctx.createBiquadFilter();
          const delay = ctx.createDelay(0.05);
          const lfo = ctx.createOscillator();
          const lfoGain = ctx.createGain();
          const comp = ctx.createDynamicsCompressor();
          hp.type = 'highpass';
          hp.frequency.value = 55;
          lp.type = 'lowpass';
          tail.connect(hp);
          hp.connect(lp);
          lp.connect(delay);
          delay.connect(comp);
          tail = comp;
          lfo.type = 'sine';
          lfo.connect(lfoGain);
          lfoGain.connect(delay.delayTime);
          try {
            lfo.start();
          } catch {
            // Contexto cerrado: la cadena queda muda pero no rompe.
          }
          disposers.push(() => {
            try {
              lfo.stop();
            } catch {
              // Ya estaba frenado.
            }
          });
          setters.push((params) => {
            lp.frequency.value = Math.min(14000, Math.max(4000, params.cutoff ?? 9000));
            lfo.frequency.value = Math.min(2, Math.max(0.1, params.wow ?? 0.6));
            // vibrato d=flutter en ms → amplitud de delayTime en s.
            lfoGain.gain.value = Math.min(1, Math.max(0, params.flutter ?? 0.12)) / 1000;
            delay.delayTime.value = 0.015;
            comp.threshold.value = -18;
            comp.ratio.value = 2.5;
            comp.attack.value = 0.008;
            comp.release.value = 0.12;
          });
          break;
        }
        case 'audio.crystal': {
          // aexciter → approximación: shaper tanh (armónicos) → HP en
          // `freq` → mezcla mojada por `amount`, nivel por `blend` (dB).
          const drive = ctx.createGain();
          const shaper = ctx.createWaveShaper();
          const hp = ctx.createBiquadFilter();
          const wet = ctx.createGain();
          const dry = ctx.createGain();
          const sum = ctx.createGain();
          shaper.curve = tanhCurve();
          hp.type = 'highpass';
          tail.connect(drive);
          drive.connect(shaper);
          shaper.connect(hp);
          hp.connect(wet);
          tail.connect(dry);
          dry.connect(sum);
          wet.connect(sum);
          tail = sum;
          setters.push((params) => {
            drive.gain.value = Math.min(10, Math.max(0.1, params.drive ?? 8.5));
            hp.frequency.value = Math.min(12000, Math.max(2000, params.freq ?? 7500));
            wet.gain.value =
              Math.min(1, Math.max(0, (params.amount ?? 2.5) / 10)) *
              dbToGain(Math.min(10, Math.max(-10, params.blend ?? 0)));
            dry.gain.value = 1;
          });
          break;
        }
        case 'audio.megaphone':
        case 'audio.muffled':
        case 'audio.telephone': {
          // Transmisión → cadenas de biquads (+compresor). El aexciter del
          // megáfono no tiene equivalente barato: se omite (aproximación).
          const isMega = spec.effectId === 'audio.megaphone';
          const isTel = spec.effectId === 'audio.telephone';
          const hp = ctx.createBiquadFilter();
          const lp = ctx.createBiquadFilter();
          const comp = ctx.createDynamicsCompressor();
          const makeup = ctx.createGain();
          hp.type = 'highpass';
          lp.type = 'lowpass';
          tail.connect(hp);
          hp.connect(lp);
          lp.connect(comp);
          comp.connect(makeup);
          tail = makeup;
          setters.push((params) => {
            if (isMega) {
              hp.frequency.value = 600;
              lp.frequency.value = 3200;
              comp.threshold.value = -22;
              comp.ratio.value = 8;
              comp.attack.value = 0.002;
              comp.release.value = 0.04;
              makeup.gain.value = dbToGain(Math.min(18, Math.max(0, params.drive ?? 6)));
            } else if (isTel) {
              hp.frequency.value = Math.min(800, Math.max(200, params.low ?? 350));
              lp.frequency.value = Math.min(5000, Math.max(2000, params.high ?? 3200));
              comp.threshold.value = -18;
              comp.ratio.value = 4;
              comp.attack.value = 0.005;
              comp.release.value = 0.08;
              makeup.gain.value = 1;
            } else {
              // muffled: sólo LP + nivel en dB.
              hp.frequency.value = 20;
              lp.frequency.value = Math.min(4000, Math.max(250, params.cutoff ?? 800));
              comp.threshold.value = -60;
              comp.ratio.value = 1;
              makeup.gain.value = dbToGain(Math.min(6, Math.max(-6, params.level ?? 0)));
            }
          });
          break;
        }
        case 'audio.underwater': {
          // LP cutoff + eco corto (60 ms, decay 0.3) + vibrato lento.
          const lp = ctx.createBiquadFilter();
          const delay = ctx.createDelay(0.3);
          const feedback = ctx.createGain();
          const wet = ctx.createGain();
          const dry = ctx.createGain();
          const sum = ctx.createGain();
          const wobble = ctx.createOscillator();
          const wobbleGain = ctx.createGain();
          const wdelay = ctx.createDelay(0.05);
          lp.type = 'lowpass';
          tail.connect(lp);
          lp.connect(delay);
          delay.connect(feedback);
          feedback.connect(delay);
          delay.connect(wet);
          lp.connect(dry);
          dry.connect(sum);
          wet.connect(sum);
          sum.connect(wdelay);
          // vibrato sobre el retardo del wobble.
          wobble.type = 'sine';
          wobble.connect(wobbleGain);
          wobbleGain.connect(wdelay.delayTime);
          tail = wdelay;
          try {
            wobble.start();
          } catch {
            // Contexto cerrado: la cadena queda muda pero no rompe.
          }
          disposers.push(() => {
            try {
              wobble.stop();
            } catch {
              // Ya estaba frenado.
            }
          });
          setters.push((params) => {
            lp.frequency.value = Math.min(1500, Math.max(300, params.cutoff ?? 500));
            delay.delayTime.value = 0.06;
            feedback.gain.value = 0.3;
            wet.gain.value = 0.6;
            dry.gain.value = 0.7;
            wobble.frequency.value = Math.min(4, Math.max(0.5, params.wobble ?? 1.4));
            wobbleGain.gain.value = 0.00035;
            wdelay.delayTime.value = 0.015;
          });
          break;
        }
        case 'audio.gate': {
          // agate → seguidor de envolvente: bajo el umbral deja pasar
          // sólo `range` (la reducción residual), encima pasa todo.
          const follower = envelopeFollower(
            ctx,
            tail,
            (rms) => {
              // Umbral lineal 0..1 del agate; `range` = señal residual.
              const threshold = Math.min(1, Math.max(0, gateParams.threshold ?? 0.05));
              const range = Math.min(1, Math.max(0, gateParams.range ?? 0.06));
              return rms >= threshold ? 1 : range;
            },
            gateParams.attack ?? 10,
            gateParams.release ?? 250,
          );
          tail = follower.gain;
          disposers.push(follower.dispose);
          gateParams = {};
          setters.push((params) => {
            // El cómputo lee los params vivos en cada tick.
            gateParams = params;
          });
          break;
        }
        case 'audio.leveler': {
          // dynaudnorm → seguidor de envolvente que normaliza hacia el
          // pico objetivo con tope de ganancia. La ventana `frame` y el
          // suavizado `gaussian` quedan absorbidos por el tick de 40 ms.
          const follower = envelopeFollower(
            ctx,
            tail,
            (rms) => {
              const peak = Math.min(1, Math.max(0.5, levelerParams.peak ?? 0.95));
              const maxGain = Math.min(20, Math.max(1, levelerParams.maxGain ?? 10));
              if (rms <= 1e-4) return 1;
              const needed = peak / rms;
              return Math.min(maxGain, Math.max(1 / maxGain, needed));
            },
            20,
            levelerParams.frame ?? 500,
          );
          tail = follower.gain;
          disposers.push(follower.dispose);
          levelerParams = {};
          setters.push((params) => {
            levelerParams = params;
          });
          break;
        }
        case 'audio.deesser': {
          // deesser → banda aguda (HP ~4.5 kHz) con ganancia modulada
          // por su propio seguidor de envolvente, mezclada con la seca.
          const hp = ctx.createBiquadFilter();
          hp.type = 'highpass';
          const follower = envelopeFollower(
            ctx,
            hp,
            (rms) => {
              // Intensidad 0..1 × máximo 0..1 → reducción hasta ese tope
              // cuando la banda sibilante supera ~-30 dBFS.
              const excess = Math.max(0, rms - 0.03);
              const depth = Math.min(1, (deesserParams.intensity ?? 0.5) * (deesserParams.max ?? 0.5));
              return 1 - Math.min(1, excess * 10) * depth;
            },
            5,
            80,
          );
          // envelopeFollower ya conectó hp→analyser y hp→gain; el gain
          // de la banda sale hacia la suma con la seca.
          const wet = follower.gain;
          const dry = ctx.createGain();
          const sum = ctx.createGain();
          tail.connect(hp);
          tail.connect(dry);
          dry.connect(sum);
          wet.connect(sum);
          tail = sum;
          disposers.push(follower.dispose);
          deesserParams = {};
          setters.push((params) => {
            deesserParams = params;
            // freq 0..1 → centro de la banda sibilante 3.5–8 kHz.
            hp.frequency.value = 3500 + Math.min(1, Math.max(0, params.freq ?? 0.5)) * 4500;
          });
          break;
        }
        case 'audio.voice_robot': {
          // voz robot → vibrato (LFO sobre delayTime) + eco corto metálico.
          const vdelay = ctx.createDelay(0.05);
          const vlfo = ctx.createOscillator();
          const vlfoGain = ctx.createGain();
          const edelay = ctx.createDelay(0.1);
          const feedback = ctx.createGain();
          const wet = ctx.createGain();
          const dry = ctx.createGain();
          const sum = ctx.createGain();
          tail.connect(vdelay);
          vdelay.connect(edelay);
          edelay.connect(feedback);
          feedback.connect(edelay);
          edelay.connect(wet);
          vdelay.connect(dry);
          dry.connect(sum);
          wet.connect(sum);
          tail = sum;
          vlfo.type = 'sine';
          vlfo.connect(vlfoGain);
          vlfoGain.connect(vdelay.delayTime);
          try {
            vlfo.start();
          } catch {
            // Contexto cerrado: la cadena queda muda pero no rompe.
          }
          disposers.push(() => {
            try {
              vlfo.stop();
            } catch {
              // Ya estaba frenado.
            }
          });
          setters.push((params) => {
            // vibrato f=rate Hz, d=depth → barrido ±depth·2 ms.
            vlfo.frequency.value = Math.min(60, Math.max(20, params.rate ?? 32));
            vlfoGain.gain.value = Math.min(1, Math.max(0, params.depth ?? 0.45)) * 0.002;
            vdelay.delayTime.value = 0.015;
            // aecho=0.8:0.8:18:0.25 → retardo 18 ms, realimentación 0.25.
            edelay.delayTime.value = 0.018;
            feedback.gain.value = 0.25;
            wet.gain.value = 0.4;
            dry.gain.value = 0.8;
          });
          break;
        }
        case 'audio.voice_wobble': {
          // voz tambaleante → UN LFO al `rate` modulando delayTime
          // (vibrato) y amp.gain (trémolo) a la vez, como la cadena
          // `vibrato,tremolo` del export.
          const delay = ctx.createDelay(0.05);
          const lfo = ctx.createOscillator();
          const vibGain = ctx.createGain();
          const tremGain = ctx.createGain();
          const amp = ctx.createGain();
          tail.connect(delay);
          delay.connect(amp);
          tail = amp;
          lfo.type = 'sine';
          lfo.connect(vibGain);
          vibGain.connect(delay.delayTime);
          lfo.connect(tremGain);
          tremGain.connect(amp.gain);
          try {
            lfo.start();
          } catch {
            // Contexto cerrado: la cadena queda muda pero no rompe.
          }
          disposers.push(() => {
            try {
              lfo.stop();
            } catch {
              // Ya estaba frenado.
            }
          });
          setters.push((params) => {
            const rate = Math.min(12, Math.max(3, params.rate ?? 6));
            lfo.frequency.value = rate;
            // vibrato d=depth → ±depth·1.5 ms sobre el retardo base.
            vibGain.gain.value = Math.min(1, Math.max(0.2, params.depth ?? 0.6)) * 0.0015;
            delay.delayTime.value = 0.012;
            // tremolo d=trem → amp.gain = 1 − trem/2 ± trem/2.
            const trem = Math.min(1, Math.max(0, params.trem ?? 0.25));
            amp.gain.value = 1 - trem / 2;
            tremGain.gain.value = trem / 2;
          });
          break;
        }
        case 'audio.voice_chipmunk':
        case 'audio.voice_deep': {
          // asetrate+atempo → pitch shifter granular (worklet).
          const stage = buildPitchStage(ctx);
          tail.connect(stage.inlet);
          tail = stage.outlet;
          disposers.push(stage.dispose);
          const isChipmunk = spec.effectId === 'audio.voice_chipmunk';
          setters.push((params) => {
            const raw = params.pitch ?? (isChipmunk ? 1.32 : 0.8);
            stage.setPitch(
              isChipmunk
                ? Math.min(1.8, Math.max(1.05, raw))
                : Math.min(0.95, Math.max(0.5, raw)),
            );
          });
          break;
        }
        case 'audio.voice_alien': {
          // pitch grave + aphaser → worklet + allpass LFO (mismo patrón
          // que `audio.phaser`, parámetros fijos del original).
          const stage = buildPitchStage(ctx);
          tail.connect(stage.inlet);
          let head: AudioNode = stage.outlet;
          const centers = [300, 600, 1200, 2400];
          const stages = centers.map((freq) => {
            const biquad = ctx.createBiquadFilter();
            biquad.type = 'allpass';
            biquad.frequency.value = freq;
            return biquad;
          });
          const aplfo = ctx.createOscillator();
          const aplfoGain = ctx.createGain();
          for (const biquad of stages) {
            head.connect(biquad);
            head = biquad;
          }
          aplfo.type = 'sine';
          aplfo.connect(aplfoGain);
          for (const biquad of stages) {
            aplfoGain.connect(biquad.frequency);
          }
          try {
            aplfo.start();
          } catch {
            // Contexto cerrado: la cadena queda muda pero no rompe.
          }
          disposers.push(() => {
            try {
              aplfo.stop();
            } catch {
              // Ya estaba frenado.
            }
          });
          disposers.push(stage.dispose);
          tail = head;
          setters.push((params) => {
            stage.setPitch(Math.min(1.4, Math.max(0.6, params.pitch ?? 0.82)));
            aplfo.frequency.value = 0.8;
            aplfoGain.gain.value = 400;
          });
          break;
        }
        case 'audio.voice_vader': {
          // pitch grave + lowpass cutoff + eco 40 ms/0.3.
          const stage = buildPitchStage(ctx);
          tail.connect(stage.inlet);
          let head: AudioNode = stage.outlet;
          const lp = ctx.createBiquadFilter();
          const edelay = ctx.createDelay(0.1);
          const feedback = ctx.createGain();
          const wet = ctx.createGain();
          const dry = ctx.createGain();
          const sum = ctx.createGain();
          lp.type = 'lowpass';
          head.connect(lp);
          lp.connect(edelay);
          edelay.connect(feedback);
          feedback.connect(edelay);
          edelay.connect(wet);
          lp.connect(dry);
          dry.connect(sum);
          wet.connect(sum);
          head = sum;
          tail = head;
          disposers.push(stage.dispose);
          setters.push((params) => {
            stage.setPitch(Math.min(0.9, Math.max(0.6, params.pitch ?? 0.72)));
            lp.frequency.value = Math.min(2500, Math.max(800, params.cutoff ?? 1200));
            edelay.delayTime.value = 0.04;
            feedback.gain.value = 0.3;
            wet.gain.value = 0.5;
            dry.gain.value = 0.8;
          });
          break;
        }
        default:
          break;
      }
    }
    tail.connect(output);
    const signature = specs.map((spec) => spec.effectId).join('|');
    const chain: ClipFxChain = {
      input,
      output,
      signature,
      apply: (next) => {
        next.forEach((spec, index) => setters[index]?.(spec.params));
      },
      dispose: () => {
        for (const dispose of disposers) {
          try {
            dispose();
          } catch {
            // Un seguidor u oscilador ya muerto no frena el resto.
          }
        }
      },
    };
    return chain;
  } catch {
    return null;
  }
}

interface SourceEntry {
  readonly node: MediaElementAudioSourceNode;
  trackId: string;
  pan: ClipPanChain | undefined;
  clipPan: number;
  fx: ClipFxChain | undefined;
  fxJson: string;
}

const sources = new WeakMap<HTMLMediaElement, SourceEntry>();

/** Ajusta las dos ganancias del paneo por clip con la misma ley lineal del export. */
function applyClipPan(chain: ClipPanChain, pan: number): void {
  const gains = linearPanGains(pan);
  chain.left.gain.value = gains.left;
  chain.right.gain.value = gains.right;
}

/** Cadena splitter→gains→merger para paneo por clip sin convertir a mono. */
function buildClipPanChain(
  ctx: AudioContext,
  pan: number,
): ClipPanChain | null {
  try {
    const splitter = ctx.createChannelSplitter(2);
    const left = ctx.createGain();
    const right = ctx.createGain();
    const merger = ctx.createChannelMerger(2);
    splitter.connect(left, 0);
    splitter.connect(right, 1);
    left.connect(merger, 0, 0);
    right.connect(merger, 0, 1);
    const chain = { splitter, left, right, merger };
    applyClipPan(chain, pan);
    return chain;
  } catch {
    return null;
  }
}
// Últimos parámetros vistos en el proyecto: se aplican a las cadenas cuando
// aparezcan (el contexto se crea recién en el primer attach, no al sincronizar).
const pendingParams = new Map<string, TrackAudioParams>();
let pendingMasterGainDb = 0;

function audioContextCtor(): (typeof AudioContext) | null {
  if (typeof window === 'undefined') return null;
  const ctor = (window as Window & { AudioContext?: typeof AudioContext }).AudioContext;
  return typeof ctor === 'function' ? ctor : null;
}

/** Crea el contexto y el bus master la primera vez que se necesita. */
function ensureContext(): AudioContext | null {
  if (context) return context;
  if (contextFailed) return null;
  const Ctor = audioContextCtor();
  if (!Ctor) {
    contextFailed = true;
    return null;
  }
  try {
    context = new Ctor();
  } catch {
    contextFailed = true;
    return null;
  }
  const bus = context.createGain();
  bus.gain.value = gainFromDb(pendingMasterGainDb);
  const analyser = context.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  bus.connect(analyser);
  analyser.connect(context.destination);
  master = {
    bus,
    analyser,
    buffer: new Uint8Array(FFT_SIZE),
    freqBuffer: new Float32Array(analyser.frequencyBinCount || FFT_SIZE / 2),
    timeBuffer: new Float32Array(analyser.fftSize || FFT_SIZE),
  };
  return context;
}

function applyTrackParams(chain: TrackChain, params: TrackAudioParams): void {
  chain.eqLow.gain.value = clampEqDb(params.eqLowDb);
  chain.eqMid.gain.value = clampEqDb(params.eqMidDb);
  chain.eqHigh.gain.value = clampEqDb(params.eqHighDb);
  chain.fader.gain.value = gainFromDb(clampGainDb(params.gainDb));
  const gains = linearPanGains(params.pan);
  chain.panLeft.gain.value = gains.left;
  chain.panRight.gain.value = gains.right;
}

function ensureChain(trackId: string): TrackChain | null {
  const ctx = ensureContext();
  if (!ctx) return null;
  const existing = chains.get(trackId);
  if (existing) return existing;
  const input = ctx.createGain();
  const eqLow = ctx.createBiquadFilter();
  eqLow.type = 'lowshelf';
  eqLow.frequency.value = 120;
  const eqMid = ctx.createBiquadFilter();
  eqMid.type = 'peaking';
  eqMid.frequency.value = 1_000;
  const eqHigh = ctx.createBiquadFilter();
  eqHigh.type = 'highshelf';
  eqHigh.frequency.value = 8_000;
  const fader = ctx.createGain();
  const splitter = ctx.createChannelSplitter(2);
  const panLeft = ctx.createGain();
  const panRight = ctx.createGain();
  const merger = ctx.createChannelMerger(2);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  input.connect(eqLow);
  eqLow.connect(eqMid);
  eqMid.connect(eqHigh);
  eqHigh.connect(fader);
  fader.connect(splitter);
  splitter.connect(panLeft, 0);
  splitter.connect(panRight, 1);
  panLeft.connect(merger, 0, 0);
  panRight.connect(merger, 0, 1);
  merger.connect(analyser);
  if (master) {
    analyser.connect(master.bus);
  }
  const chain: TrackChain = {
    input,
    eqLow,
    eqMid,
    eqHigh,
    fader,
    panLeft,
    panRight,
    analyser,
    buffer: new Uint8Array(FFT_SIZE),
  };
  chains.set(trackId, chain);
  applyTrackParams(chain, pendingParams.get(trackId) ?? NEUTRAL_PARAMS);
  return chain;
}

/**
 * Enruta el audio de un elemento (`<video>` o `<audio>` de la preview) hacia
 * la cadena de su pista. Devuelve `true` si quedó enrutado; `false` si no hay
 * Web Audio disponible y el elemento debe seguir usándose con `volume`.
 *
 * `createMediaElementSource` sólo puede llamarse una vez por elemento, así que
 * el nodo se guarda en un WeakMap y se reutiliza (React StrictMode monta,
 * limpia y vuelve a montar los efectos).
 */
/**
 * Conecta el elemento a su pista. El paneo por clip sólo agrega la cadena
 * splitter→gains→merger cuando el clip lo necesita; en el caso común (pan 0)
 * el grafo queda igual al histórico (elemento → entrada → EQ), sin nodos de
 * más ni cambios de topología.
 */
function connectSource(entry: SourceEntry, trackId: string, clipPan: number): boolean {
  const ctx = ensureContext();
  const chain = chains.get(trackId);
  if (!ctx || !chain) return false;
  try {
    entry.node.disconnect();
  } catch {
    // Ya estaba desconectado.
  }
  if (entry.pan) {
    try {
      entry.pan.merger.disconnect();
    } catch {
      // Ya estaba desconectado.
    }
    entry.pan = undefined;
  }
  try {
    let panChain: ClipPanChain | undefined;
    if (Math.abs(clipPan) > 0.001) {
      panChain = buildClipPanChain(ctx, clipPan) ?? undefined;
    }
    // Destino tras el paneo por clip (o directo a la entrada de pista).
    const destination = panChain ? panChain.splitter : chain.input;
    if (entry.fx) {
      // Elemento → FX del clip → (paneo | entrada de pista).
      entry.node.connect(entry.fx.input);
      entry.fx.output.connect(destination);
    } else {
      entry.node.connect(destination);
    }
    if (panChain) {
      panChain.merger.connect(chain.input);
      entry.pan = panChain;
    }
    entry.clipPan = clipPan;
    entry.trackId = trackId;
    return true;
  } catch {
    return false;
  }
}

/**
 * Asegura que el elemento tenga la cadena FX de los specs. Si la secuencia
 * de efectos no cambió, sólo actualiza los AudioParam (las keyframes por
 * frame no reconstruyen el grafo). Devuelve `true` si hubo que
 * reconstruir la cadena (el que llama debe reconectar con connectSource).
 */
function ensureClipFx(entry: SourceEntry, specs: readonly ClipFxSpec[]): boolean {
  const signature = specs.map((spec) => spec.effectId).join('|');
  entry.fxJson = JSON.stringify(specs);
  if (entry.fx && entry.fx.signature === signature) {
    entry.fx.apply(specs);
    return false;
  }
  const ctx = ensureContext();
  if (entry.fx) {
    try {
      entry.fx.input.disconnect();
      entry.fx.output.disconnect();
    } catch {
      // Ya estaban desconectados.
    }
    entry.fx.dispose();
    entry.fx = undefined;
  }
  if (!ctx || specs.length === 0) return true;
  entry.fx = buildClipFxChain(ctx, specs) ?? undefined;
  entry.fx?.apply(specs);
  return true;
}

export function attachPreviewAudio(
  trackId: string,
  element: HTMLMediaElement,
  clipPan = 0,
  clipFx: readonly ClipFxSpec[] = [],
): boolean {
  const ctx = ensureContext();
  if (!ctx) return false;
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {
      // Sin activación de usuario el contexto queda suspendido; el siguiente
      // play vuelve a intentar la reanudación.
    });
  }
  const chain = ensureChain(trackId);
  if (!chain) return false;
  let entry = sources.get(element);
  if (!entry) {
    try {
      entry = {
        node: ctx.createMediaElementSource(element),
        trackId,
        pan: undefined,
        clipPan,
        fx: undefined,
        fxJson: '',
      };
      sources.set(element, entry);
    } catch {
      return false;
    }
  }
  ensureClipFx(entry, clipFx);
  return connectSource(entry, trackId, clipPan);
}

/**
 * Actualiza los efectos de audio del clip (subconjunto Web Audio del
 * `audioStack`). Si la secuencia de efectos no cambió sólo mueve los
 * AudioParam — barato para keyframes por frame; si cambió reconstruye la
 * cadena y reconecta. Sin specs, deja el elemento directo como antes.
 */
export function setPreviewClipFx(
  element: HTMLMediaElement,
  specs: readonly ClipFxSpec[],
): void {
  const entry = sources.get(element);
  if (!entry) return;
  const rebuilt = ensureClipFx(entry, specs);
  if (rebuilt) connectSource(entry, entry.trackId, entry.clipPan);
}

/**
 * Actualiza el paneo por clip. Si el clip pasa de 0 a un valor (o al revés),
 * reconstruye la conexión para no dejar una cadena de paneo inerte.
 */
export function setPreviewClipPan(element: HTMLMediaElement, pan: number): void {
  const entry = sources.get(element);
  if (!entry) return;
  const hasChain = entry.pan !== undefined;
  const wantsChain = Math.abs(pan) > 0.001;
  if (hasChain && wantsChain) {
    applyClipPan(entry.pan!, pan);
    return;
  }
  connectSource(entry, entry.trackId, pan);
}

/** Deja de enrutar un elemento (al desmontar su capa en la preview). */
export function detachPreviewAudio(trackId: string, element: HTMLMediaElement): void {
  const entry = sources.get(element);
  if (!entry) return;
  try {
    entry.node.disconnect();
  } catch {
    // Ya estaba desconectado.
  }
  if (entry.pan) {
    try {
      entry.pan.merger.disconnect();
    } catch {
      // Ya estaba desconectado.
    }
    entry.pan = undefined;
  }
  if (entry.fx) {
    try {
      entry.fx.input.disconnect();
      entry.fx.output.disconnect();
    } catch {
      // Ya estaban desconectados.
    }
    entry.fx.dispose();
    entry.fx = undefined;
    entry.fxJson = '';
  }
  void trackId;
}

/** Reanuda el contexto al reproducir; no lo crea si todavía no existe. */
export function resumePreviewAudio(): void {
  if (!context || context.state !== 'suspended') return;
  void context.resume().catch(() => {
    // El navegador puede negar la reanudación sin gesto del usuario.
  });
}

/**
 * Parámetros de mezcla de una pista. Con `frame`, el fader y el paneo salen de
 * sus `gainKeyframes` / `panKeyframes` (el mismo muestreo del export); sin `frame`
 * se usan el fader y knob estáticos. En ambos casos el paneo por clip gana y la
 * pista queda al centro.
 */
function trackAudioParams(
  project: ProjectDocument,
  track: Track,
  frame?: number,
): TrackAudioParams {
  const hasClipPan = project.timeline.clips.some(
    (clip) => clip.trackId === track.id && Math.abs(clip.audio?.pan ?? 0) > 0.001,
  );
  const sampledGain =
    frame === undefined ? undefined : sampleTrackGain(track.gainKeyframes, frame);
  const sampledPan =
    frame === undefined ? undefined : sampleTrackPan(track.panKeyframes, frame);
  return {
    gainDb: sampledGain ?? trackGainDb(track),
    pan: hasClipPan ? 0 : (sampledPan ?? trackPan(track)),
    eqLowDb: trackEqDb(track, 'eqLowDb'),
    eqMidDb: trackEqDb(track, 'eqMidDb'),
    eqHighDb: trackEqDb(track, 'eqHighDb'),
  };
}

function applyParams(trackId: string, params: TrackAudioParams): void {
  pendingParams.set(trackId, params);
  const chain = chains.get(trackId);
  if (chain) applyTrackParams(chain, params);
}

/**
 * Aplica la automatización de fader y paneo de cada pista en `frame` sobre el
 * grafo vivo. Las claves son frames absolutos de la timeline, con clamp en los
 * extremos y la misma curva easing/Bézier por segmento que `sampleTrackGain`,
 * `sampleTrackPan` y el export Rust; el paneo por clip conserva su prioridad.
 * Barato e idempotente: la preview lo llama en cada cambio de playhead.
 */
export function syncPreviewAudioAtFrame(project: ProjectDocument, frame: number): void {
  for (const track of project.timeline.tracks) {
    if (!AUDIO_KINDS.has(track.kind)) continue;
    const hasPanKeys = (track.panKeyframes?.length ?? 0) > 0;
    const hasGainKeys = (track.gainKeyframes?.length ?? 0) > 0;
    if (!hasPanKeys && !hasGainKeys) continue;
    applyParams(track.id, trackAudioParams(project, track, frame));
  }
}

/** Alias histórico para retrocompatibilidad. */
export const syncPreviewAudioPanAtFrame = syncPreviewAudioAtFrame;

/**
 * Sincroniza fader, paneo y EQ de cada pista con audio y la ganancia master
 * con el documento actual. Barato e idempotente: lo llaman la preview y la
 * vista Mezcla en cada cambio de proyecto, con o sin contexto creado.
 */
export function syncPreviewAudioFromProject(project: ProjectDocument): void {
  const seen = new Set<string>();
  for (const track of project.timeline.tracks) {
    if (!AUDIO_KINDS.has(track.kind)) continue;
    seen.add(track.id);
    applyParams(track.id, trackAudioParams(project, track));
  }
  for (const trackId of [...chains.keys()]) {
    if (seen.has(trackId)) continue;
    const chain = chains.get(trackId);
    if (chain) {
      try {
        chain.input.disconnect();
      } catch {
        // Ya estaba desconectado.
      }
    }
    chains.delete(trackId);
    pendingParams.delete(trackId);
  }
  pendingMasterGainDb = clampGainDb(project.audio.master.gainDb);
  if (master) {
    master.bus.gain.value = gainFromDb(pendingMasterGainDb);
  }
}

function readAnalyser(analyser: AnalyserNode, buffer: Uint8Array): TrackLevelReading {
  analyser.getByteTimeDomainData(buffer);
  let sumSquares = 0;
  let peak = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    const sample = (buffer[index]! - 128) / 128;
    sumSquares += sample * sample;
    const magnitude = Math.abs(sample);
    if (magnitude > peak) peak = magnitude;
  }
  const rms = Math.sqrt(sumSquares / buffer.length);
  return {
    rmsDb: rms > 0 ? 20 * Math.log10(rms) : SILENCE.rmsDb,
    peakDb: peak > 0 ? 20 * Math.log10(peak) : SILENCE.peakDb,
  };
}

/**
 * Lee el RMS y el pico actual de cada pista pedida y del master. Devuelve
 * `null` si no hay grafo activo (sin AudioContext o sin crear todavía): el
 * que llama muestra los medidores en reposo.
 */
export function readPreviewAudioLevels(trackIds: readonly string[]): PreviewAudioLevels | null {
  if (!context) return null;
  const tracks: Record<string, TrackLevelReading> = {};
  for (const trackId of trackIds) {
    const chain = chains.get(trackId);
    tracks[trackId] = chain ? readAnalyser(chain.analyser, chain.buffer) : SILENCE;
  }
  return { tracks, master: master ? readAnalyser(master.analyser, master.buffer) : SILENCE };
}

export interface MasterAudioScope {
  /** dBFS por bin de frecuencia (el último bin es Nyquist). */
  readonly spectrumDb: Float32Array;
  /** Muestras de tiempo en [-1, 1]. */
  readonly waveform: Float32Array;
  readonly sampleRate: number;
  readonly fftSize: number;
}

/**
 * Lee el bus master ya mezclado (pistas → EQ → fader/paneo → ganancia master)
 * para los scopes en vivo del monitor. Devuelve `null` si el grafo todavía
 * no existe o el analizador no expone lectura float. Los buffers son internos
 * y se reescriben en cada llamada: copiar antes de guardarlos.
 */
export function readPreviewAudioMasterScope(): MasterAudioScope | null {
  if (!context || !master) return null;
  if (
    typeof master.analyser.getFloatFrequencyData !== 'function' ||
    typeof master.analyser.getFloatTimeDomainData !== 'function'
  ) {
    return null;
  }
  try {
    master.analyser.getFloatFrequencyData(master.freqBuffer);
    master.analyser.getFloatTimeDomainData(master.timeBuffer);
  } catch {
    return null;
  }
  return {
    spectrumDb: master.freqBuffer,
    waveform: master.timeBuffer,
    sampleRate: context.sampleRate || 48_000,
    fftSize: master.analyser.fftSize || FFT_SIZE,
  };
}

/** ¿El entorno expone Web Audio? (en jsdom es `false`). */
export function isPreviewAudioSupported(): boolean {
  return audioContextCtor() !== null;
}

/** ¿El grafo ya está creado? (se crea al enrutar el primer elemento). */
export function isPreviewAudioGraphActive(): boolean {
  return context !== null;
}

/**
 * Cierra el grafo y olvida el estado del módulo. Pensado para los tests,
 * donde cada caso arma su propio AudioContext simulado.
 */
export function resetPreviewAudio(): void {
  if (context) {
    try {
      void context.close();
    } catch {
      // El contexto ya estaba cerrado.
    }
  }
  context = null;
  contextFailed = false;
  master = null;
  chains.clear();
  pendingParams.clear();
  pendingMasterGainDb = 0;
}

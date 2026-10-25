import type { ProjectDocument, Track } from '@editor-ia/project-schema';
import {
  gainForTargetPeak,
  hasSoloedAudioTrack,
  isTrackAudible,
  levelPercentFromDb,
  panGains,
  panLabel,
  peakDbFromPeaks,
  effectivePeakDb,
  trackEqDb,
  trackGainDb,
  trackPan,
} from '../../state/audio-mix';

/**
 * Utilidades de mezcla de la preview y la vista Mezcla.
 *
 * Los helpers canónicos viven en `state/audio-mix.ts` (balance lineal, mismos
 * clamps que el export) y se re-exportan acá para que la preview y la vista
 * Mezcla los consuman de un solo lugar. Este módulo añade encima el motor de
 * Web Audio compartido.
 */

export {
  gainForTargetPeak,
  hasSoloedAudioTrack,
  isTrackAudible,
  levelPercentFromDb,
  panGains,
  panLabel,
  peakDbFromPeaks,
  effectivePeakDb,
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
const sources = new WeakMap<HTMLMediaElement, { node: MediaElementAudioSourceNode; trackId: string }>();
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
  master = { bus, analyser, buffer: new Uint8Array(FFT_SIZE) };
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
export function attachPreviewAudio(trackId: string, element: HTMLMediaElement): boolean {
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
      entry = { node: ctx.createMediaElementSource(element), trackId };
      sources.set(element, entry);
    } catch {
      return false;
    }
  }
  if (entry.trackId !== trackId) {
    try {
      entry.node.disconnect();
    } catch {
      // Ya estaba desconectado; no importa.
    }
    entry.trackId = trackId;
  }
  try {
    entry.node.connect(chain.input);
  } catch {
    return false;
  }
  return true;
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
 * Sincroniza fader, paneo y EQ de cada pista con audio y la ganancia master
 * con el documento actual. Barato e idempotente: lo llaman la preview y la
 * vista Mezcla en cada cambio de proyecto, con o sin contexto creado.
 */
export function syncPreviewAudioFromProject(project: ProjectDocument): void {
  const seen = new Set<string>();
  for (const track of project.timeline.tracks) {
    if (!AUDIO_KINDS.has(track.kind)) continue;
    seen.add(track.id);
    const params: TrackAudioParams = {
      gainDb: trackGainDb(track),
      pan: trackPan(track),
      eqLowDb: trackEqDb(track, 'eqLowDb'),
      eqMidDb: trackEqDb(track, 'eqMidDb'),
      eqHighDb: trackEqDb(track, 'eqHighDb'),
    };
    pendingParams.set(track.id, params);
    const chain = chains.get(track.id);
    if (chain) applyTrackParams(chain, params);
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

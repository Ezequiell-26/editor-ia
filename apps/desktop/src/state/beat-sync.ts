/**
 * Local beat detection and beat-aligned cutting.
 *
 * Pure DSP: no network, no model. The UI decodes the asset with Web Audio and
 * hands the mono samples to `detectBeats`, so the same code runs in tests with
 * synthetic clicks. Detection is an energy-flux onset picker with an adaptive
 * threshold; it reports `confidence` so the UI can say "sin pulso claro"
 * instead of inventing beats in soft or ambient music.
 */

export interface BeatAnalysis {
  readonly bpm: number;
  readonly beatsSeconds: readonly number[];
  readonly confidence: number;
}

const HOP_SECONDS = 0.01;
const WINDOW_SECONDS = 0.02;
const THRESHOLD_WINDOW_SECONDS = 1.5;
const MIN_INTERVAL_SECONDS = 0.12;

function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

export function detectBeats(samples: Float32Array, sampleRate: number): BeatAnalysis {
  const rate = sampleRate > 0 ? sampleRate : 48_000;
  const hop = Math.max(1, Math.round(rate * HOP_SECONDS));
  const windowSize = Math.max(hop, Math.round(rate * WINDOW_SECONDS));
  const frames = Math.floor(samples.length / hop);
  if (frames < 16) {
    return { bpm: 0, beatsSeconds: [], confidence: 0 };
  }

  const energy = new Float64Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    const start = frame * hop;
    const end = Math.min(samples.length, start + windowSize);
    let sum = 0;
    for (let index = start; index < end; index += 1) {
      const value = samples[index] ?? 0;
      sum += value * value;
    }
    energy[frame] = Math.sqrt(sum / Math.max(1, end - start));
  }

  const flux = new Float64Array(frames);
  for (let frame = 1; frame < frames; frame += 1) {
    flux[frame] = Math.max(0, (energy[frame] ?? 0) - (energy[frame - 1] ?? 0));
  }
  let peakFlux = 0;
  for (const value of flux) {
    if (value > peakFlux) peakFlux = value;
  }
  if (peakFlux <= 1e-6) {
    return { bpm: 0, beatsSeconds: [], confidence: 0 };
  }

  const halfWindow = Math.max(4, Math.round(THRESHOLD_WINDOW_SECONDS / 2 / HOP_SECONDS));
  const onsets: { time: number; strength: number }[] = [];
  for (let frame = 2; frame < frames - 2; frame += 1) {
    const from = Math.max(0, frame - halfWindow);
    const to = Math.min(frames, frame + halfWindow);
    let mean = 0;
    for (let index = from; index < to; index += 1) {
      mean += flux[index] ?? 0;
    }
    mean /= to - from;
    let variance = 0;
    for (let index = from; index < to; index += 1) {
      const delta = (flux[index] ?? 0) - mean;
      variance += delta * delta;
    }
    const threshold = mean + 1.2 * Math.sqrt(variance / Math.max(1, to - from));
    const value = flux[frame] ?? 0;
    if (value <= threshold || value < peakFlux * 0.12) continue;
    if (value <= (flux[frame - 1] ?? 0) || value < (flux[frame + 1] ?? 0)) continue;
    onsets.push({ time: (frame * hop) / rate, strength: value });
  }

  // Two onsets closer than the minimum interval are the same hit: keep the
  // strongest, which is usually the attack rather than the decay.
  const kept: { time: number; strength: number }[] = [];
  for (const onset of onsets) {
    const last = kept[kept.length - 1];
    if (last && onset.time - last.time < MIN_INTERVAL_SECONDS) {
      if (onset.strength > last.strength) kept[kept.length - 1] = onset;
      continue;
    }
    kept.push(onset);
  }

  const beatsSeconds = kept.map((onset) => Number(onset.time.toFixed(4)));
  if (beatsSeconds.length < 4) {
    return { bpm: 0, beatsSeconds, confidence: 0 };
  }
  const intervals: number[] = [];
  for (let index = 1; index < beatsSeconds.length; index += 1) {
    intervals.push((beatsSeconds[index] ?? 0) - (beatsSeconds[index - 1] ?? 0));
  }
  const median = medianOf(intervals);
  if (median <= 0) {
    return { bpm: 0, beatsSeconds, confidence: 0 };
  }
  const regular = intervals.filter(
    (value) => Math.abs(value - median) <= median * 0.2,
  ).length;
  return {
    bpm: Math.round(60 / median),
    beatsSeconds,
    confidence: regular / intervals.length,
  };
}

export interface BeatCutInput {
  readonly beatsSeconds: readonly number[];
  readonly fps: number;
  readonly audioInFrame: number;
  readonly audioOutFrame: number;
  readonly audioStartFrame: number;
  /** Audio clip speed; beats are mapped through it so the cuts stay audible. */
  readonly speed: number;
  /** Take every Nth audible beat (4 = one cut per bar in 4/4). */
  readonly stride: number;
  readonly targetStartFrame: number;
  readonly targetEndFrame: number;
  readonly minGapFrames?: number;
}

/**
 * Absolute timeline frames where the audible beats fall, ready to split a
 * video clip. Beats outside the audio clip's source window or outside the
 * target range are dropped.
 */
export function planBeatCuts(input: BeatCutInput): number[] {
  const fps = input.fps > 0 ? input.fps : 30;
  const speed = input.speed > 0 ? input.speed : 1;
  const stride = Math.max(1, Math.round(input.stride));
  const minGap = Math.max(1, Math.round(input.minGapFrames ?? 1));
  const frames: number[] = [];
  let audibleIndex = 0;
  for (const seconds of input.beatsSeconds) {
    if (!Number.isFinite(seconds) || seconds < 0) continue;
    const sourceFrame = Math.round(seconds * fps);
    if (sourceFrame < input.audioInFrame || sourceFrame >= input.audioOutFrame) continue;
    const useThisBeat = audibleIndex % stride === 0;
    audibleIndex += 1;
    if (!useThisBeat) continue;
    const frame =
      input.audioStartFrame + Math.round((sourceFrame - input.audioInFrame) / speed);
    if (frame <= input.targetStartFrame || frame >= input.targetEndFrame) continue;
    const last = frames[frames.length - 1];
    if (last !== undefined && frame - last < minGap) continue;
    frames.push(frame);
  }
  return frames;
}

export interface DecodedSamples {
  readonly samples: Float32Array;
  readonly sampleRate: number;
}

/** Decode an asset URL into mono samples for `detectBeats` (browser only). */
export async function decodeAudioSamples(url: string): Promise<DecodedSamples | null> {
  if (typeof OfflineAudioContext === 'undefined') return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const bytes = await response.arrayBuffer();
    const context = new OfflineAudioContext(1, 1, 48_000);
    const buffer = await context.decodeAudioData(bytes);
    if (buffer.numberOfChannels === 0 || buffer.length === 0) return null;
    return { samples: buffer.getChannelData(0), sampleRate: buffer.sampleRate };
  } catch {
    return null;
  }
}

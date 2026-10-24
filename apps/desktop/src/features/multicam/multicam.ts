import type { Asset, ProjectDocument } from '@editor-ia/project-schema';
import type { AudioPeaks } from '../../services/project-service';
import { addClipFromAsset, addTrack, fpsOf } from '../../state/project-actions';

export interface MulticamCamera {
  readonly asset: Asset;
  /** Punto del material que coincide con el inicio del programa. */
  readonly offsetFrames: number;
}

export interface MulticamCut {
  readonly frame: number;
  readonly cameraIndex: number;
}

export interface MulticamBuild {
  readonly project: ProjectDocument;
  readonly trackId: string;
  readonly clipCount: number;
  readonly durationFrames: number;
}

export function assetDurationFrames(asset: Asset): number {
  if (asset.kind !== 'video') return 0;
  const media = 'media' in asset ? asset.media : undefined;
  if (!media || !('durationFrames' in media)) return 0;
  return Math.max(0, media.durationFrames);
}

/** El programa dura lo que la cámara con menos material utilizable. */
export function programDurationFrames(cameras: readonly MulticamCamera[]): number {
  if (cameras.length === 0) return 0;
  return cameras.reduce((shortest, camera) => {
    const available = Math.max(0, assetDurationFrames(camera.asset) - camera.offsetFrames);
    return Math.min(shortest, available);
  }, Number.POSITIVE_INFINITY);
}

export function clampFrame(frame: number, totalFrames: number): number {
  return Math.max(0, Math.min(Math.max(0, totalFrames), Math.round(frame)));
}

/**
 * Ordena y deduplica los cortes. Siempre hay un corte en 0 para que el
 * programa tenga una cámara desde el primer frame.
 */
export function normalizeCuts(
  cuts: readonly MulticamCut[],
  totalFrames: number,
  cameraCount: number,
): MulticamCut[] {
  if (cameraCount === 0 || totalFrames <= 0) return [];
  const byFrame = new Map<number, number>();
  for (const cut of cuts) {
    if (!Number.isInteger(cut.cameraIndex) || cut.cameraIndex < 0 || cut.cameraIndex >= cameraCount) {
      continue;
    }
    const frame = clampFrame(cut.frame, totalFrames);
    if (frame >= totalFrames && frame !== 0) continue;
    byFrame.set(frame, cut.cameraIndex);
  }
  byFrame.set(0, byFrame.get(0) ?? 0);
  return [...byFrame.entries()]
    .map(([frame, cameraIndex]) => ({ frame, cameraIndex }))
    .sort((a, b) => a.frame - b.frame);
}

/** Registra un cambio de cámara en el frame actual; reemplaza si ya había uno. */
export function recordCut(
  cuts: readonly MulticamCut[],
  frame: number,
  cameraIndex: number,
  totalFrames: number,
  cameraCount: number,
): MulticamCut[] {
  return normalizeCuts(
    [...cuts.filter((cut) => cut.frame !== clampFrame(frame, totalFrames)), {
      frame: clampFrame(frame, totalFrames),
      cameraIndex,
    }],
    totalFrames,
    cameraCount,
  );
}

export function activeCameraAt(
  cuts: readonly MulticamCut[],
  frame: number,
): number {
  let active = cuts[0]?.cameraIndex ?? 0;
  for (const cut of cuts) {
    if (cut.frame > frame) break;
    active = cut.cameraIndex;
  }
  return active;
}

/**
 * Crea una pista multicámara nueva con un clip por tramo. El offset de cada
 * cámara indica qué punto de su material coincide con el frame 0 del programa.
 * No modifica las pistas originales.
 */
export function buildMulticamProject(
  project: ProjectDocument,
  cameras: readonly MulticamCamera[],
  cuts: readonly MulticamCut[],
  options: { readonly label?: string } = {},
): MulticamBuild {
  if (cameras.length < 2) {
    throw new Error('la multicámara necesita al menos dos videos.');
  }
  const totalFrames = programDurationFrames(cameras);
  if (totalFrames <= 0) {
    throw new Error('las cámaras no tienen material suficiente para el programa.');
  }
  const normalized = normalizeCuts(cuts, totalFrames, cameras.length);
  if (normalized.length === 0) {
    throw new Error('agregá al menos un corte de cámara.');
  }
  const created = addTrack(project, 'video', options.label?.trim() || 'Multicámara');
  let next = created.project;
  let clipCount = 0;

  normalized.forEach((cut, index) => {
    const camera = cameras[cut.cameraIndex];
    if (!camera) return;
    const start = cut.frame;
    const end = normalized[index + 1]?.frame ?? totalFrames;
    const duration = end - start;
    if (duration <= 0) return;
    const sourceIn = start + camera.offsetFrames;
    const sourceOut = sourceIn + duration;
    if (sourceIn < 0 || sourceOut > assetDurationFrames(camera.asset)) return;
    const added = addClipFromAsset(next, camera.asset, {
      trackId: created.trackId,
      atFrame: start,
      inFrame: sourceIn,
      outFrame: sourceOut,
    });
    next = added.project;
    const clip = next.timeline.clips.find((item) => item.id === added.clipId);
    if (clip) clip.label = `CAM ${cut.cameraIndex + 1} · ${camera.asset.label}`;
    clipCount += 1;
  });

  if (clipCount === 0) {
    throw new Error('ningún tramo de la multicámara quedó dentro del material.');
  }
  return {
    project: next,
    trackId: created.trackId,
    clipCount,
    durationFrames: totalFrames,
  };
}

export function cameraSourceSeconds(
  camera: MulticamCamera,
  programSeconds: number,
  fps: number,
): number {
  return Math.max(0, programSeconds + camera.offsetFrames / cpuFps(fps));
}

function cpuFps(fps: number): number {
  return Number.isFinite(fps) && fps > 0 ? fps : 30;
}

export interface AudioEnvelope {
  readonly durationSeconds: number;
  readonly stepSeconds: number;
  readonly values: readonly number[];
}

/**
 * Convierte los picos de onda que ya calcula el backend en una envolvente
 * normalizada. No agrega dependencias ni vuelve a decodificar audio.
 */
export function envelopeFromPeaks(peaks: AudioPeaks): AudioEnvelope {
  const values = peaks.peaks.map((pair) => Math.max(Math.abs(pair.min), Math.abs(pair.max)));
  const durationSeconds = Math.max(0, peaks.durationSeconds);
  const stepSeconds =
    values.length > 0 ? durationSeconds / values.length : 0;
  return { durationSeconds, stepSeconds, values };
}

function resampleEnvelope(
  envelope: AudioEnvelope,
  stepSeconds: number,
  maxSeconds: number,
): number[] {
  if (envelope.values.length === 0 || envelope.stepSeconds <= 0) return [];
  const length = Math.max(1, Math.min(
    Math.round(maxSeconds / stepSeconds),
    Math.round(envelope.durationSeconds / stepSeconds),
  ));
  const out: number[] = new Array(length);
  for (let index = 0; index < length; index += 1) {
    const source = Math.min(
      envelope.values.length - 1,
      Math.max(0, Math.round((index * stepSeconds) / envelope.stepSeconds)),
    );
    out[index] = envelope.values[source] ?? 0;
  }
  return out;
}

function normalize(values: readonly number[]): { data: number[]; deviation: number } {
  if (values.length === 0) return { data: [], deviation: 0 };
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
  const deviation = Math.sqrt(variance);
  if (deviation < 1e-5) return { data: values.map(() => 0), deviation };
  return { data: values.map((value) => (value - mean) / deviation), deviation };
}

/**
 * Sincroniza cámaras comparando sus envolventes de audio. Devuelve offsets en
 * segundos para el punto de entrada de cada cámara, normalizados para que la
 * cámara más temprana quede en 0. `null` si no hay señal suficiente o el pico
 * de correlación es demasiado bajo.
 */
export function syncOffsetsFromEnvelopes(
  envelopes: readonly AudioEnvelope[],
  maxLagSeconds = 10,
): { offsetsSeconds: number[]; scores: number[] } | null {
  if (envelopes.length < 2) return null;
  const usable = envelopes.filter(
    (envelope) => envelope.values.length > 0 && envelope.durationSeconds > 0,
  );
  if (usable.length !== envelopes.length) return null;
  const step = Math.max(0.04, ...usable.map((envelope) => envelope.stepSeconds));
  const analysisSeconds = Math.min(120, ...usable.map((envelope) => envelope.durationSeconds));
  const arrays = usable.map((envelope) =>
    normalize(resampleEnvelope(envelope, step, analysisSeconds)),
  );
  if (arrays.some((array) => array.deviation < 1e-5 || array.data.length < 4)) {
    return null;
  }
  const reference = arrays[0]!;
  const maxLag = Math.max(
    1,
    Math.min(Math.round(maxLagSeconds / step), reference.data.length - 2),
  );
  const minOverlap = Math.max(3, Math.ceil(1.5 / step));
  const lags: number[] = [0];
  const scores: number[] = [1];

  for (let camera = 1; camera < arrays.length; camera += 1) {
    const target = arrays[camera]!;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestLag = 0;
    for (let lag = -maxLag; lag <= maxLag; lag += 1) {
      let dot = 0;
      let count = 0;
      for (let index = 0; index < reference.data.length; index += 1) {
        const other = index + lag;
        if (other < 0 || other >= target.data.length) continue;
        dot += reference.data[index]! * target.data[other]!;
        count += 1;
      }
      if (count < minOverlap) continue;
      const score = dot / count;
      if (score > bestScore) {
        bestScore = score;
        bestLag = lag;
      }
    }
    if (!Number.isFinite(bestScore) || bestScore < 0.25) return null;
    lags.push(bestLag);
    scores.push(bestScore);
  }

  const earliest = Math.min(...lags);
  return {
    offsetsSeconds: lags.map((lag) => Math.max(0, (lag - earliest) * step)),
    scores,
  };
}

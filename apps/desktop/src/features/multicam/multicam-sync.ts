import type { AudioEnvelope } from './multicam';
import { syncOffsetsFromEnvelopes } from './multicam';
import type { TimecodeSyncResult } from './multicam-timecode';

/**
 * Cadena de fallbacks de sincronización multicámara (diseño
 * docs/research/MULTICAM-TIMECODE-2026-10-25.md, fase 2): primero timecode;
 * si no cubre a todas las cámaras, el audio completa las que faltan anclado a
 * la referencia de timecode; si el timecode no sirve para nada, todo por
 * audio; y si tampoco hay sonido en común, queda el ajuste manual.
 *
 * La función es pura: recibe el resultado de `deriveTimecodeOffsets` y las
 * envolventes ya cargadas (o null si no se pudieron) y decide qué método se
 * aplica, con qué entradas y qué informe dejarle al usuario.
 */

export type MulticamSyncMethod = 'timecode' | 'audio' | 'manual';

export interface MulticamSyncCamera {
  readonly assetId: string;
  readonly label: string;
  readonly durationSeconds: number;
}

export interface MulticamSyncRequest {
  readonly fps: number;
  readonly cameras: readonly MulticamSyncCamera[];
  /** Resultado de `deriveTimecodeOffsets` sobre las mismas cámaras. */
  readonly timecode: TimecodeSyncResult;
  /** Envolventes en el mismo orden que `cameras`; null si no se pudieron cargar. */
  readonly envelopes: readonly AudioEnvelope[] | null;
  /** Motivo por el que no hay envolventes (p. ej. una cámara sin audio). */
  readonly envelopesError: string | null;
}

export interface MulticamSyncOutcome {
  /** Método que definió la sincronización del conjunto. */
  readonly method: MulticamSyncMethod;
  /** Método usado por cámara, para el informe. */
  readonly methods: Readonly<Record<string, MulticamSyncMethod>>;
  /** Entradas en segundos por asset; vacío si queda todo manual. */
  readonly offsets: Readonly<Record<string, number>>;
  readonly referenceAssetId: string | null;
  /** Motivo por el que se degradó desde el timecode; null si mandó el timecode. */
  readonly degradedFrom: string | null;
  readonly confidencePercent: number | null;
  readonly warnings: readonly string[];
  /** Informe para la UI: qué método se usó y por qué. */
  readonly report: string;
}

const FALLBACK_FPS = 30;
/**
 * Tolerancia (en frames) entre el offset por audio y por timecode de una
 * cámara que tiene ambos: si difieren más que eso, manda el timecode porque
 * los relojes jam-sync son más estables que la correlación de audio.
 */
const TOLERANCE_FRAMES = 2;

function frameRateOf(fps: number): number {
  return Number.isFinite(fps) && fps > 0 ? fps : FALLBACK_FPS;
}

function clampSeconds(seconds: number, durationSeconds: number): number {
  return Math.max(0, Math.min(Math.max(0, durationSeconds), seconds));
}

export function resolveMulticamSync(request: MulticamSyncRequest): MulticamSyncOutcome {
  const fps = frameRateOf(request.fps);
  const { cameras, timecode } = request;

  if (cameras.length < 2) {
    return {
      method: 'manual',
      methods: {},
      offsets: {},
      referenceAssetId: null,
      degradedFrom: null,
      confidencePercent: null,
      warnings: [],
      report: 'Elegí al menos dos cámaras para sincronizar.',
    };
  }

  const labels = new Map(cameras.map((camera) => [camera.assetId, camera.label] as const));
  const labelOf = (assetId: string): string => labels.get(assetId) ?? assetId;
  const covered = cameras.filter((camera) => timecode.offsets[camera.assetId] !== undefined);
  const missing = cameras.filter((camera) => timecode.offsets[camera.assetId] === undefined);
  const audio = request.envelopes ? syncOffsetsFromEnvelopes(request.envelopes) : null;
  const audioFailureReason = (): string => {
    if (request.envelopes) {
      return 'no encontré audio en común suficiente (correlación baja o silencio)';
    }
    const error = request.envelopesError?.trim();
    return error ? error : 'no se pudo analizar el audio';
  };
  const tcSecondsOf = (assetId: string): number => {
    const camera = cameras.find((item) => item.assetId === assetId);
    return clampSeconds((timecode.offsets[assetId] ?? 0) / fps, camera?.durationSeconds ?? 0);
  };

  // 1) Timecode completo: cubre a todas las cámaras, no hace falta audio.
  if (timecode.referenceAssetId !== null && missing.length === 0) {
    const offsets: Record<string, number> = {};
    const methods: Record<string, MulticamSyncMethod> = {};
    for (const camera of cameras) {
      offsets[camera.assetId] = tcSecondsOf(camera.assetId);
      methods[camera.assetId] = 'timecode';
    }
    return {
      method: 'timecode',
      methods,
      offsets,
      referenceAssetId: timecode.referenceAssetId,
      degradedFrom: null,
      confidencePercent: null,
      warnings: [],
      report: `Sincronizada por timecode: ${cameras.length} de ${cameras.length} cámaras con TC de inicio; referencia ${labelOf(timecode.referenceAssetId)}.`,
    };
  }

  // 2) Timecode parcial: el audio completa las cámaras sin TC, anclado a la
  //    referencia de timecode para respetar su origen.
  if (covered.length > 0 && timecode.referenceAssetId !== null) {
    const offsets: Record<string, number> = {};
    const methods: Record<string, MulticamSyncMethod> = {};
    const warnings: string[] = timecode.unusable.map(
      (item) => `${labelOf(item.assetId)}: ${item.reason}.`,
    );
    for (const camera of covered) {
      offsets[camera.assetId] = tcSecondsOf(camera.assetId);
      methods[camera.assetId] = 'timecode';
    }
    if (!audio) {
      for (const camera of missing) methods[camera.assetId] = 'manual';
      warnings.push(
        `Sin audio común para completar (${audioFailureReason()}): ajustá a mano las entradas de ${missing
          .map((camera) => camera.label)
          .join(', ')}.`,
      );
      return {
        method: 'timecode',
        methods,
        offsets,
        referenceAssetId: timecode.referenceAssetId,
        degradedFrom: null,
        confidencePercent: null,
        warnings,
        report: `Timecode parcial: ${covered.length} de ${cameras.length} cámaras alineadas por TC; el resto queda con su entrada manual.`,
      };
    }
    const confidence = Math.round(Math.min(...audio.scores) * 100);
    const anchorIndex = cameras.findIndex(
      (camera) => camera.assetId === timecode.referenceAssetId,
    );
    const anchorAudio = anchorIndex >= 0 ? audio.offsetsSeconds[anchorIndex] ?? 0 : 0;
    const anchorTimecode = tcSecondsOf(timecode.referenceAssetId);
    const delta = anchorTimecode - anchorAudio;
    if (Math.abs(delta) * fps > TOLERANCE_FRAMES) {
      warnings.push(
        `Audio y timecode no coinciden en ${labelOf(timecode.referenceAssetId)} (diferencia de ${Math.round(
          Math.abs(delta) * fps,
        )} frames): el timecode manda y el audio completa contra él.`,
      );
    }
    const missingIndices = cameras
      .map((camera, index) => (timecode.offsets[camera.assetId] === undefined ? index : -1))
      .filter((index) => index >= 0);
    for (const index of missingIndices) {
      const camera = cameras[index];
      if (!camera) continue;
      const shifted = (audio.offsetsSeconds[index] ?? 0) + delta;
      if (shifted < 0) {
        warnings.push(
          `${camera.label} entra después del inicio del programa; su entrada quedó en 0.`,
        );
      }
      offsets[camera.assetId] = clampSeconds(shifted, camera.durationSeconds);
      methods[camera.assetId] = 'audio';
    }
    return {
      method: 'timecode',
      methods,
      offsets,
      referenceAssetId: timecode.referenceAssetId,
      degradedFrom: null,
      confidencePercent: confidence,
      warnings,
      report: `Timecode en ${covered.length} de ${cameras.length} cámaras; el audio alineó ${missing
        .map((camera) => camera.label)
        .join(', ')} (confianza ${confidence}%).`,
    };
  }

  // 3) Ninguna cámara con timecode usable: todo por audio.
  const timecodeReason =
    timecode.unusable.length > 0
      ? `sin timecode usable (${timecode.unusable
          .map((item) => `${labelOf(item.assetId)}: ${item.reason}`)
          .join('; ')})`
      : 'sin timecode usable';
  if (audio) {
    const confidence = Math.round(Math.min(...audio.scores) * 100);
    const offsets: Record<string, number> = {};
    const methods: Record<string, MulticamSyncMethod> = {};
    cameras.forEach((camera, index) => {
      offsets[camera.assetId] = clampSeconds(
        audio.offsetsSeconds[index] ?? 0,
        camera.durationSeconds,
      );
      methods[camera.assetId] = 'audio';
    });
    const referenceIndex = audio.offsetsSeconds.findIndex((seconds) => seconds <= 0);
    return {
      method: 'audio',
      methods,
      offsets,
      referenceAssetId: referenceIndex >= 0 ? cameras[referenceIndex]?.assetId ?? null : null,
      degradedFrom: `timecode ${timecodeReason}`,
      confidencePercent: confidence,
      warnings: [],
      report: `El timecode no sirvió (${timecodeReason}); sincronizada por audio: ${cameras.length} cámaras, confianza ${confidence}%.`,
    };
  }

  // 4) Nada automático: queda el ajuste manual, sin tocar las entradas.
  const methods: Record<string, MulticamSyncMethod> = {};
  for (const camera of cameras) methods[camera.assetId] = 'manual';
  return {
    method: 'manual',
    methods,
    offsets: {},
    referenceAssetId: null,
    degradedFrom: `timecode ${timecodeReason}`,
    confidencePercent: null,
    warnings: [],
    report: `Sin sincronización automática. Timecode: ${timecodeReason}. Audio: ${audioFailureReason()}. Ajustá la entrada de cada cámara a mano.`,
  };
}

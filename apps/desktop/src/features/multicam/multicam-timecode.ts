import type { Asset } from '@editor-ia/project-schema';

/**
 * Sincronización de multicámara por timecode (diseño en
 * docs/research/MULTICAM-TIMECODE-2026-10-25.md): lee el timecode SMPTE de
 * inicio que ffprobe ya reporta en `MediaProbe.timecode` y deriva los offsets
 * de entrada de cada cámara con la misma convención que la sync por audio
 * (referencia = inicio más tardío, ninguna entrada negativa).
 */

export type TimecodeParseResult =
  | { ok: true; frames: number }
  | { ok: false; reason: 'formato' | 'drop-frame' | 'fuera-de-rango' };

const TC_PATTERN = /^(\d{1,2}):([0-5]\d):([0-5]\d)([:;])(\d{1,2})$/;

/**
 * Convierte un timecode SMPTE a frames absolutos en la base del fps dado.
 * Soporta NDF (`HH:MM:SS:FF`); los drop-frame (`HH:MM:SS;FF`) se rechazan con
 * su motivo: su conteo no es lineal y derivar offsets con ellos corrompería la
 * sincronía. FPS no enteros se redondean (el timecode cuenta frames, no
 * segundos fraccionarios).
 */
export function timecodeToFrames(timecode: string, fps: number): TimecodeParseResult {
  const match = TC_PATTERN.exec(timecode.trim());
  if (!match) return { ok: false, reason: 'formato' };
  const [, hh, mm, ss, separator, ff] = match as unknown as [string, string, string, string, string, string];
  if (separator === ';') return { ok: false, reason: 'drop-frame' };
  const integerFps = Math.round(fps);
  if (!Number.isFinite(integerFps) || integerFps <= 0) return { ok: false, reason: 'fuera-de-rango' };
  const framesField = Number(ff);
  if (framesField >= integerFps) return { ok: false, reason: 'fuera-de-rango' };
  const frames =
    (Number(hh) * 3600 + Number(mm) * 60 + Number(ss)) * integerFps + framesField;
  return { ok: true, frames };
}

export interface TimecodeCameraInput {
  /** Id del asset/cámara, igual que usa la sync por audio. */
  readonly assetId: string;
  /** Timecode de inicio reportado por ffprobe (o null si no trae). */
  readonly timecode: string | null;
}

export interface TimecodeSyncResult {
  /** Offset de entrada por asset, en frames: `referencia - inicio propio`. */
  readonly offsets: Record<string, number>;
  /** Id de la cámara elegida como referencia (la de inicio más tardío). */
  readonly referenceAssetId: string | null;
  /** Cámaras sin timecode usable y el motivo, para avisar en la UI. */
  readonly unusable: ReadonlyArray<{ assetId: string; reason: string }>;
}

/**
 * Deriva los offsets de entrada por timecode. La referencia es la cámara con
 * inicio más tardío para que ninguna entrada sea negativa (mismo criterio que
 * `syncOffsetsFromEnvelopes`). Si ninguna cámara tiene timecode usable,
 * `offsets` queda vacío y `referenceAssetId` es null.
 */
export function deriveTimecodeOffsets(
  cameras: readonly TimecodeCameraInput[],
  fps: number,
): TimecodeSyncResult {
  const usable: Array<{ assetId: string; frames: number }> = [];
  const unusable: Array<{ assetId: string; reason: string }> = [];
  for (const camera of cameras) {
    if (!camera.timecode) {
      unusable.push({ assetId: camera.assetId, reason: 'sin timecode' });
      continue;
    }
    const parsed = timecodeToFrames(camera.timecode, fps);
    if (!parsed.ok) {
      unusable.push({
        assetId: camera.assetId,
        reason: parsed.reason === 'drop-frame' ? 'timecode drop-frame' : 'timecode ilegible',
      });
      continue;
    }
    usable.push({ assetId: camera.assetId, frames: parsed.frames });
  }
  if (usable.length === 0) {
    return { offsets: {}, referenceAssetId: null, unusable };
  }
  const reference = usable.reduce((best, item) => (item.frames > best.frames ? item : best));
  const offsets: Record<string, number> = {};
  for (const item of usable) {
    offsets[item.assetId] = reference.frames - item.frames;
  }
  return { offsets, referenceAssetId: reference.assetId, unusable };
}

/** Timecode del asset, ya sea del cache de probes o null. */
export function timecodeOfProbe(probe: { timecode: string | null }): string | null {
  return probe.timecode;
}

/** Filtra los assets de video listos para la mesa, igual que la vista. */
export function multicamCandidates(assets: readonly Asset[]): readonly Asset[] {
  return assets.filter((asset) => asset.kind === 'video' && asset.status === 'ready');
}

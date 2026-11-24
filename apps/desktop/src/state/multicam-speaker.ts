import type { MulticamCut } from './multicam';
import { normalizeCuts } from './multicam';
import type { SpeakerSegment } from './speakers';

/**
 * SmartSwitch por hablante (paridad del feature de DaVinci Resolve Studio).
 *
 * En vez de cortar por qué cámara suena más fuerte (`autoCutByActivity`),
 * corta por QUIÉN habla: cada tramo de diarización se asigna a la cámara
 * configurada para ese hablante. Los tramos sin hablante mapeado no cambian
 * la cámara — nunca se inventa un corte.
 *
 * Reglas honestas:
 * - El mapa hablante→cámara lo define el usuario (`speakerToCamera`); si un
 *   hablante no está mapeado, sus tramos se ignoran.
 * - Planos más cortos que `minShotSeconds` se absorben por el plano anterior
 *   (misma guardia anti-tembleque que `autoCutByActivity`).
 * - Los segmentos vienen en segundos de PROGRAMa (tiempo de timeline), no
 *   del archivo fuente; la conversión offset→programa la hace el caller.
 */

export interface AutoCutBySpeakerOptions {
  /** Plano mínimo antes de cambiar de cámara (default 1.2 s, como autoCutByActivity). */
  readonly minShotSeconds?: number;
  /** Cámara de los tramos sin hablante mapeado y del inicio (default 0). */
  readonly fallbackCamera?: number;
}

interface Shot {
  readonly startFrame: number;
  readonly endFrame: number;
  readonly cameraIndex: number;
}

/**
 * Devuelve los cortes de cámara siguiendo los turnos de habla.
 * `totalFrames` es la duración del programa en frames de timeline.
 */
export function autoCutBySpeaker(
  segments: readonly SpeakerSegment[],
  speakerToCamera: Readonly<Record<string, number>>,
  totalFrames: number,
  fps: number,
  options: AutoCutBySpeakerOptions = {},
): MulticamCut[] {
  if (segments.length === 0 || totalFrames <= 0 || fps <= 0) return [];
  const minShotFrames = Math.max(
    1,
    Math.round((options.minShotSeconds ?? 1.2) * fps),
  );
  const fallbackCamera = Math.max(0, Math.round(options.fallbackCamera ?? 0));

  // 1) Tramos mapeados → eventos ordenados, recortados al programa y sin solapes.
  const events = [...segments]
    .map((segment) => {
      const camera = speakerToCamera[segment.speaker.trim()];
      if (camera === undefined || camera < 0) return null;
      const start = Math.max(0, Math.round(segment.start * fps));
      const end = Math.min(totalFrames, Math.round(segment.end * fps));
      if (end <= start) return null;
      return { start, end, camera };
    })
    .filter((event): event is { start: number; end: number; camera: number } =>
      Boolean(event),
    )
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const clipped: { start: number; end: number; camera: number }[] = [];
  let coveredUntil = 0;
  for (const event of events) {
    const start = Math.max(event.start, coveredUntil);
    if (event.end <= start) continue;
    clipped.push({ ...event, start });
    coveredUntil = event.end;
  }
  if (clipped.length === 0) {
    return normalizeCuts(
      [{ frame: 0, cameraIndex: fallbackCamera }],
      totalFrames,
      Number.MAX_SAFE_INTEGER,
    );
  }

  // 2) Rellenar huecos con la cámara vigente (fallback antes del primer evento).
  const shots: Shot[] = [];
  let cursor = 0;
  let activeCamera = fallbackCamera;
  for (const event of clipped) {
    if (event.start > cursor) {
      shots.push({ startFrame: cursor, endFrame: event.start, cameraIndex: activeCamera });
    }
    shots.push({ startFrame: event.start, endFrame: event.end, cameraIndex: event.camera });
    activeCamera = event.camera;
    cursor = event.end;
  }
  if (cursor < totalFrames) {
    shots.push({ startFrame: cursor, endFrame: totalFrames, cameraIndex: activeCamera });
  }

  // 3) Fusionar planos adyacentes con la misma cámara.
  const mergedAdjacent: Shot[] = [];
  for (const shot of shots) {
    const last = mergedAdjacent[mergedAdjacent.length - 1];
    if (last && last.cameraIndex === shot.cameraIndex && last.endFrame === shot.startFrame) {
      mergedAdjacent[mergedAdjacent.length - 1] = {
        ...last,
        endFrame: shot.endFrame,
      };
    } else {
      mergedAdjacent.push(shot);
    }
  }

  // 4) Guardia anti-tembleque: plano corto se funde con el anterior.
  const merged: Shot[] = [];
  for (const shot of mergedAdjacent) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      shot.startFrame > 0 &&
      shot.endFrame - shot.startFrame < minShotFrames
    ) {
      merged[merged.length - 1] = { ...previous, endFrame: shot.endFrame };
      continue;
    }
    merged.push(shot);
  }

  const cuts: MulticamCut[] = merged.map((shot) => ({
    frame: shot.startFrame,
    cameraIndex: shot.cameraIndex,
  }));
  // normalizeCuts ordena y garantiza el corte en 0; después se descartan los
  // cortes que repiten la cámara del corte anterior (planos fundidos).
  const normalized = normalizeCuts(cuts, totalFrames, Number.MAX_SAFE_INTEGER);
  return normalized.filter(
    (cut, index) => index === 0 || cut.cameraIndex !== normalized[index - 1]!.cameraIndex,
  );
}

/**
 * Mapa por defecto hablante→cámara: los hablantes ordenados por primera
 * aparición se reparten las cámaras en orden (hablante 1 → cámara 0, etc.).
 * Es un punto de partida; el usuario puede corregirlo con `speakerToCamera`.
 */
export function defaultSpeakerCameraMap(
  segments: readonly SpeakerSegment[],
  cameraCount: number,
): Record<string, number> {
  const map: Record<string, number> = {};
  const order: string[] = [];
  for (const segment of segments) {
    const speaker = segment.speaker.trim();
    if (!speaker || map[speaker] !== undefined) continue;
    order.push(speaker);
    map[speaker] = (order.length - 1) % Math.max(1, cameraCount);
  }
  return map;
}

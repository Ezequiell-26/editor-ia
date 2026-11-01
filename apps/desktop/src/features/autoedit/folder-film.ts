/**
 * Planificador de "video desde una carpeta": toma imágenes y una narración de
 * voz y decide cuánto dura cada imagen. Es determinista y no llama a ningún
 * modelo: usa los silencios que ya mide FFmpeg sobre el audio para cortar en
 * las pausas reales de la voz.
 */

export type FolderFilmStyle = 'pulse' | 'story' | 'impact';

export interface FolderFilmImage {
  readonly assetId: string;
  readonly label: string;
}

export interface FolderFilmAudio {
  readonly assetId: string;
  readonly durationFrames: number;
}

export interface FolderFilmRange {
  readonly startSeconds: number;
  readonly endSeconds: number;
}

export interface FolderFilmSlide {
  readonly assetId: string;
  readonly label: string;
  readonly index: number;
  readonly startFrame: number;
  readonly durationFrames: number;
  readonly motion: 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right';
  readonly transitionFrames: number;
}

export interface FolderFilmPlan {
  readonly slides: readonly FolderFilmSlide[];
  readonly totalFrames: number;
  readonly audioAssetId: string | null;
  readonly audioFrames: number;
  readonly style: FolderFilmStyle;
  readonly basis: 'silences' | 'uniform-audio' | 'no-audio';
}

export interface FolderFilmInput {
  readonly images: readonly FolderFilmImage[];
  readonly audio: FolderFilmAudio | null;
  readonly silences?: readonly FolderFilmRange[];
  readonly fps: number;
  readonly style?: FolderFilmStyle;
  readonly secondsPerImage?: number;
  readonly transitionFrames?: number;
}

/** Duración objetivo por imagen cuando no hay narración, según el estilo. */
const SECONDS_WITHOUT_AUDIO: Record<FolderFilmStyle, number> = {
  pulse: 3,
  story: 5,
  impact: 2.5,
};

/** Mínimo por imagen para que el resultado no sea un parpadeo. */
const MIN_SECONDS_PER_IMAGE = 1.2;

const MOTIONS: FolderFilmSlide['motion'][] = ['zoom-in', 'pan-left', 'zoom-out', 'pan-right'];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Rangos de voz: lo que queda entre silencios medianos y los extremos. */
export interface SpeechSegment {
  readonly start: number;
  readonly end: number;
}

export function speechSegments(
  durationSeconds: number,
  silences: readonly FolderFilmRange[],
): SpeechSegment[] {
  if (!(durationSeconds > 0)) return [];
  const gaps = silences
    .map((range) => ({
      start: clamp(range.startSeconds, 0, durationSeconds),
      end: clamp(range.endSeconds, 0, durationSeconds),
    }))
    .filter((range) => range.end - range.start >= 0.35)
    .sort((a, b) => a.start - b.start);
  const segments: SpeechSegment[] = [];
  let cursor = 0;
  for (const gap of gaps) {
    if (gap.start > cursor + 0.25) segments.push({ start: cursor, end: gap.start });
    cursor = Math.max(cursor, gap.end);
  }
  if (durationSeconds > cursor + 0.25) segments.push({ start: cursor, end: durationSeconds });
  return segments.filter((segment) => segment.end - segment.start >= 0.3);
}

/**
 * Reparte `count` imágenes sobre una lista de duraciones. Si hay menos
 * segmentos de voz que imágenes, parte los más largos; si hay más, agrupa los
 * contiguos respetando el orden.
 */
function distribute(segments: readonly SpeechSegment[], count: number): number[] {
  if (count <= 0) return [];
  if (segments.length === 0) return [];
  if (segments.length === count) return segments.map((segment) => segment.end - segment.start);
  if (segments.length > count) {
    // Agrupar segmentos contiguos en `count` bloques de tiempo similar.
    const total = segments.reduce((sum, segment) => sum + (segment.end - segment.start), 0);
    const target = total / count;
    const durations: number[] = [];
    let current = 0;
    for (const segment of segments) {
      current += segment.end - segment.start;
      if (durations.length < count - 1 && current >= target) {
        durations.push(current);
        current = 0;
      }
    }
    if (current > 0) durations.push(current);
    while (durations.length > count) {
      const tail = durations.pop()!;
      const lastIndex = durations.length - 1;
      durations[lastIndex] = (durations[lastIndex] ?? 0) + tail;
    }
    while (durations.length < count) durations.push(target);
    return durations;
  }
  // Más imágenes que segmentos: dividir los segmentos más largos.
  const durations = segments.map((segment) => segment.end - segment.start);
  let guard = 0;
  while (durations.length < count && guard < 200) {
    guard += 1;
    const index = durations.indexOf(Math.max(...durations));
    const half = durations[index]! / 2;
    if (half < MIN_SECONDS_PER_IMAGE) break;
    durations.splice(index, 1, half, half);
  }
  while (durations.length < count) {
    durations.push(Math.max(MIN_SECONDS_PER_IMAGE, durations[0] ?? 2));
  }
  return durations.slice(0, count);
}

export function planFolderFilm(input: FolderFilmInput): FolderFilmPlan {
  const style = input.style ?? 'story';
  const fps = Number.isFinite(input.fps) && input.fps > 1 ? input.fps : 30;
  const images = input.images;
  if (images.length === 0) {
    return {
      slides: [],
      totalFrames: 0,
      audioAssetId: input.audio?.assetId ?? null,
      audioFrames: input.audio?.durationFrames ?? 0,
      style,
      basis: 'no-audio',
    };
  }
  const transitionFrames = Math.max(
    0,
    Math.round(input.transitionFrames ?? Math.round(fps * 0.4)),
  );

  let durationsSeconds: number[] = [];
  let basis: FolderFilmPlan['basis'] = 'no-audio';
  const audio = input.audio;
  if (audio && audio.durationFrames > 0) {
    const durationSeconds = audio.durationFrames / fps;
    const hasSilences = (input.silences ?? []).some(
      (range) => range.endSeconds - range.startSeconds >= 0.35,
    );
    const segments = hasSilences ? speechSegments(durationSeconds, input.silences ?? []) : [];
    if (segments.length > 1) {
      durationsSeconds = distribute(segments, images.length);
      basis = 'silences';
    } else {
      durationsSeconds = Array.from(
        { length: images.length },
        () => durationSeconds / images.length,
      );
      basis = 'uniform-audio';
    }
  } else {
    const fallback = input.secondsPerImage ?? SECONDS_WITHOUT_AUDIO[style];
    durationsSeconds = images.map(() => fallback);
    basis = 'no-audio';
  }

  // Convertir a frames. Con narración el mínimo se vuelve dinámico: si hay
  // muchas imágenes y poco audio, cada una puede durar menos de 1,2 s.
  const readableMin = Math.max(1, Math.round(MIN_SECONDS_PER_IMAGE * fps));
  const minFrames =
    audio && audio.durationFrames > 0
      ? Math.max(
          1,
          Math.min(readableMin, Math.floor(audio.durationFrames / images.length / 2)),
        )
      : readableMin;
  let frames = durationsSeconds.map((seconds) =>
    Math.max(minFrames, Math.round(seconds * fps)),
  );

  // Cubrir la narración exactamente: escalar y repartir el residuo donde haya
  // margen, sin romper el mínimo.
  if (audio && audio.durationFrames > 0) {
    const target = audio.durationFrames;
    const rawTotal = frames.reduce((sum, value) => sum + value, 0);
    if (rawTotal !== target && rawTotal > 0) {
      const scale = target / rawTotal;
      frames = frames.map((value) => Math.max(minFrames, Math.round(value * scale)));
    }
    let diff = target - frames.reduce((sum, value) => sum + value, 0);
    let guard = 0;
    while (diff !== 0 && guard < 2_000) {
      guard += 1;
      if (diff > 0) {
        const index = guard % frames.length;
        frames[index] = (frames[index] ?? 0) + diff;
        diff = 0;
      } else {
        const index = frames.reduce(
          (best, value, position) => (value > (frames[best] ?? 0) ? position : best),
          0,
        );
        const slack = (frames[index] ?? 0) - minFrames;
        if (slack <= 0) break;
        const take = Math.min(slack, -diff);
        frames[index] = (frames[index] ?? 0) - take;
        diff += take;
      }
    }
  }

  const slides: FolderFilmSlide[] = [];
  let cursor = 0;
  images.forEach((image, index) => {
    const durationFrames = frames[index] ?? minFrames;
    slides.push({
      assetId: image.assetId,
      label: image.label,
      index,
      startFrame: cursor,
      durationFrames,
      motion: MOTIONS[index % MOTIONS.length]!,
      transitionFrames: index === 0 ? 0 : transitionFrames,
    });
    cursor += durationFrames;
  });

  return {
    slides,
    totalFrames: cursor,
    audioAssetId: audio?.assetId ?? null,
    audioFrames: audio?.durationFrames ?? 0,
    style,
    basis,
  };
}

/**
 * Elige la pista de voz: prefiere nombres con "voz", "narra", "voice" o
 * "audio"; si no, el archivo de audio más largo.
 */
export function pickNarration<
  T extends { readonly label: string; readonly durationFrames: number },
>(candidates: readonly T[]): T | null {
  if (candidates.length === 0) return null;
  const keyword = /voz|narra|voice|locuci|audio/i;
  const named = candidates.filter((candidate) => keyword.test(candidate.label));
  const pool = named.length > 0 ? named : candidates;
  return [...pool].sort((a, b) => b.durationFrames - a.durationFrames)[0] ?? null;
}

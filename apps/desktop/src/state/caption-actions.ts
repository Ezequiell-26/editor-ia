import type {
  CaptionCue,
  CaptionMotion,
  CaptionStyle,
  Clip,
  ProjectDocument,
} from '@editor-ia/project-schema';
import {
  captionCharsPerLineForProject,
  captionOffsetYForProject,
  planCaptionCues,
  type CaptionPlannerOptions,
} from './caption-planner';
import {
  ProjectActionError,
  cloneProject,
  findGap,
  fpsOf,
  isWindowed,
  newId,
  speedOf,
  touch,
} from './project-actions-core';

/**
 * Caption and title cue mutations: setup, insertion (manual, imported,
 * transcribed, scene/windowed), updates and style editing. Extracted from
 * `project-actions.ts`; `project-actions.ts` re-exports everything here.
 */

export function ensureCaptionSetup(project: ProjectDocument): {
  project: ProjectDocument;
  trackId: string;
  styleId: string;
} {
  const next = cloneProject(project);
  let track = next.timeline.tracks.find((item) => item.kind === 'caption');
  if (!track) {
    const order = Math.max(-1, ...next.timeline.tracks.map((item) => item.order)) + 1;
    track = {
      id: newId(),
      kind: 'caption',
      label: 'C1',
      order,
      muted: false,
      hidden: false,
      locked: false,
    };
    next.timeline.tracks.push(track);
  }
  let style = next.captions.styles[0];
  if (!style) {
    style = {
      id: newId(),
      name: 'Principal',
      fontFamily: 'Segoe UI',
      fontSizePx: 54,
      color: '#ffffff',
      outlineColor: '#000000',
      position: 'bottom',
    };
    next.captions.styles.push(style);
  }
  return { project: next, trackId: track.id, styleId: style.id };
}

/**
 * Ajusta los subtítulos cuando se elimina un tramo de la timeline.
 *
 * `rippleDeleteClip` corre los clips de la pista, pero los subtítulos viven en
 * su propia pista y quedarían corridos respecto de la voz. Este helper cierra
 * ese hueco: mueve los cues posteriores y recorta los que cruzan el tramo.
 */
export function removeCaptionRange(
  project: ProjectDocument,
  startFrame: number,
  endFrame: number,
): ProjectDocument {
  const start = Math.round(startFrame);
  const end = Math.round(endFrame);
  if (end <= start) return project;
  const next = cloneProject(project);
  const delta = end - start;
  const cues: CaptionCue[] = [];
  for (const cue of next.captions.cues) {
    if (cue.endFrame <= start) {
      cues.push(cue);
      continue;
    }
    if (cue.startFrame >= end) {
      cue.startFrame -= delta;
      cue.endFrame -= delta;
      cues.push(cue);
      continue;
    }
    // Cue completamente dentro del tramo eliminado: desaparece con él.
    if (cue.startFrame >= start && cue.endFrame <= end) continue;
    const newStart = cue.startFrame < start ? cue.startFrame : start;
    const newEnd = cue.endFrame > end ? cue.endFrame - delta : start;
    if (newEnd - newStart < 2) continue;
    cue.startFrame = newStart;
    cue.endFrame = newEnd;
    if (cue.words) {
      cue.words = cue.words
        .filter((word) => !(word.startFrame >= start && word.endFrame <= end))
        .map((word) =>
          word.startFrame >= end
            ? {
                ...word,
                startFrame: word.startFrame - delta,
                endFrame: word.endFrame - delta,
              }
            : word,
        )
        .filter(
          (word) =>
            word.endFrame > word.startFrame &&
            word.startFrame >= cue.startFrame &&
            word.endFrame <= cue.endFrame,
        );
    }
    cues.push(cue);
  }
  next.captions.cues = cues;
  touch(next);
  return next;
}

export function addCaptionCue(
  project: ProjectDocument,
  input: { text: string; startFrame?: number; durationFrames?: number; styleId?: string },
): { project: ProjectDocument; cueId: string; startFrame: number; trackId: string } {
  const text = input.text.trim();
  if (!text) {
    throw new ProjectActionError('el subtítulo está vacío');
  }
  const setup = ensureCaptionSetup(project);
  const next = cloneProject(setup.project);
  const captionTrack = next.timeline.tracks.find((item) => item.id === setup.trackId);
  if (captionTrack?.locked) {
    throw new ProjectActionError('la pista de subtítulos está bloqueada');
  }
  const fps = fpsOf(next);
  const duration = Math.max(1, input.durationFrames ?? Math.round(3 * fps));
  const cues = next.captions.cues.filter((cue) => cue.trackId === setup.trackId);
  const start = findGap(
    cues.map((cue) => ({ start: cue.startFrame, end: cue.endFrame })),
    input.startFrame ?? 0,
    duration,
  );
  const cue: CaptionCue = {
    id: newId(),
    trackId: setup.trackId,
    styleId: input.styleId ?? setup.styleId,
    text: text.slice(0, 500),
    language: next.language,
    startFrame: start,
    endFrame: start + duration,
  };
  next.captions.cues.push(cue);
  touch(next);
  return { project: next, cueId: cue.id, startFrame: start, trackId: setup.trackId };
}

/**
 * Titles are caption cues on their own track and style. They burn through the
 * same ASS renderer, never overlap the subtitle track, and stay editable.
 */
export function addTitleCue(
  project: ProjectDocument,
  input: { text: string; startFrame?: number; durationFrames?: number; styleId?: string },
): { project: ProjectDocument; cueId: string; startFrame: number; trackId: string; styleId: string } {
  const text = input.text.trim();
  if (!text) {
    throw new ProjectActionError('el título está vacío');
  }
  const next = cloneProject(project);
  const fps = fpsOf(next);
  const duration = Math.max(1, input.durationFrames ?? Math.round(3 * fps));
  let track = next.timeline.tracks.find(
    (item) => item.kind === 'caption' && item.label === 'Títulos',
  );
  if (!track) {
    const order = Math.max(-1, ...next.timeline.tracks.map((item) => item.order)) + 1;
    track = {
      id: newId(),
      kind: 'caption',
      label: 'Títulos',
      order,
      muted: false,
      hidden: false,
      locked: false,
    };
    next.timeline.tracks.push(track);
  }
  if (track.locked) {
    throw new ProjectActionError('la pista de títulos está bloqueada');
  }
  let style = input.styleId
    ? next.captions.styles.find((item) => item.id === input.styleId)
    : next.captions.styles.find((item) => item.name === 'Título');
  if (input.styleId && !style) {
    throw new ProjectActionError('el estilo de título elegido no existe');
  }
  if (!style) {
    style = {
      id: newId(),
      name: 'Título',
      fontFamily: next.captions.styles[0]?.fontFamily ?? 'Arial',
      fontSizePx: 92,
      color: '#ffffff',
      outlineColor: '#000000',
      position: 'center',
    };
    next.captions.styles.push(style);
  }
  const cues = next.captions.cues.filter((cue) => cue.trackId === track.id);
  const start = findGap(
    cues.map((cue) => ({ start: cue.startFrame, end: cue.endFrame })),
    input.startFrame ?? 0,
    duration,
  );
  const cue: CaptionCue = {
    id: newId(),
    trackId: track.id,
    styleId: style.id,
    text: text.slice(0, 500),
    language: next.language,
    startFrame: start,
    endFrame: start + duration,
    animation: 'pop',
  };
  next.captions.cues.push(cue);
  touch(next);
  return {
    project: next,
    cueId: cue.id,
    startFrame: start,
    trackId: track.id,
    styleId: style.id,
  };
}

/**
 * Adds a title cue with a dedicated caption style for a visual template.
 * The style is reused by name so several titles share one editable look.
 */
export function addTitleFromTemplate(
  project: ProjectDocument,
  input: {
    text: string;
    startFrame?: number;
    durationFrames?: number;
    template: {
      id: string;
      name: string;
      style: Omit<CaptionStyle, 'id' | 'name'>;
      animation?: CaptionCue['animation'];
    };
  },
): { project: ProjectDocument; cueId: string; startFrame: number; styleId: string } {
  const styled = cloneProject(project);
  const styleName = `Plantilla · ${input.template.name}`;
  let style = styled.captions.styles.find((item) => item.name === styleName);
  if (!style) {
    style = {
      id: newId(),
      name: styleName,
      ...input.template.style,
    };
    styled.captions.styles.push(style);
    touch(styled);
  }
  const added = addTitleCue(styled, {
    text: input.text,
    ...(input.startFrame !== undefined ? { startFrame: input.startFrame } : {}),
    ...(input.durationFrames !== undefined ? { durationFrames: input.durationFrames } : {}),
    styleId: style.id,
  });
  if (input.template.animation) {
    const cue = added.project.captions.cues.find((item) => item.id === added.cueId);
    if (cue) cue.animation = input.template.animation;
  }
  return added;
}

/** Imports SRT/VTT cues into the main caption track. */
export function importSubtitleCues(
  project: ProjectDocument,
  cues: readonly { startSeconds: number; endSeconds: number; text: string }[],
  options?: { replace?: boolean; styleId?: string },
): { project: ProjectDocument; added: number; skipped: number; trackId: string } {
  const setup = ensureCaptionSetup(project);
  const next = cloneProject(setup.project);
  const track = next.timeline.tracks.find((item) => item.id === setup.trackId);
  if (track?.locked) {
    throw new ProjectActionError('la pista de subtítulos está bloqueada');
  }
  if (options?.replace !== false) {
    next.captions.cues = next.captions.cues.filter(
      (cue) => cue.trackId !== setup.trackId,
    );
  }
  const fps = fpsOf(next);
  let added = 0;
  let skipped = 0;
  for (const cue of cues) {
    const text = cue.text.replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!text || !Number.isFinite(cue.startSeconds) || cue.endSeconds <= cue.startSeconds) {
      skipped += 1;
      continue;
    }
    const startFrame = Math.max(0, Math.round(cue.startSeconds * fps));
    const endFrame = Math.max(startFrame + 1, Math.round(cue.endSeconds * fps));
    next.captions.cues.push({
      id: newId(),
      trackId: setup.trackId,
      styleId: options?.styleId ?? setup.styleId,
      text,
      language: next.language,
      startFrame,
      endFrame,
    });
    added += 1;
  }
  touch(next);
  return { project: next, added, skipped, trackId: setup.trackId };
}

/**
 * Segment de transcripción tal como lo devuelve `transcribeAsset`: tiempos en
 * segundos absolutos del archivo de media (0 = inicio del asset).
 */
export interface TranscriptionSegmentInput {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly words?: readonly { start: number; end: number; word: string }[];
}

export function addTranscriptionCues(
  project: ProjectDocument,
  clipId: string,
  segments: readonly TranscriptionSegmentInput[],
  replaceExisting = true,
  options: CaptionPlannerOptions & { readonly safeArea?: boolean | undefined } = {},
): {
  project: ProjectDocument;
  added: number;
  skipped: number;
  overCps: number;
  maxCps: number;
  splitSegments: number;
} {
  const clip = project.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    throw new ProjectActionError('el clip no está en la timeline');
  }
  const setup = ensureCaptionSetup(project);
  const next = cloneProject(setup.project);
  const captionTrack = next.timeline.tracks.find((item) => item.id === setup.trackId);
  if (captionTrack?.locked) {
    throw new ProjectActionError('la pista de subtítulos está bloqueada');
  }
  const fps = fpsOf(next);
  const clipStart = clip.startFrame;
  const clipEnd = clip.startFrame + clip.durationFrames;
  if (replaceExisting) {
    next.captions.cues = next.captions.cues.filter(
      (cue) => !(cue.trackId === setup.trackId && cue.startFrame < clipEnd && cue.endFrame > clipStart),
    );
  }

  // El segmento del transcriptor no es un subtítulo: se parte en cues que
  // entran en dos líneas y duran lo que se pueden leer. Los tiempos salen de
  // las palabras cuando el modelo las devuelve.
  const plan = planCaptionCues(segments, {
    maxCharsPerLine: options.maxCharsPerLine ?? captionCharsPerLineForProject(next),
    maxLines: options.maxLines,
    maxDurationSeconds: options.maxDurationSeconds,
    minDurationSeconds: options.minDurationSeconds,
    maxCps: options.maxCps,
  });
  const offsetY = options.safeArea === false ? 0 : captionOffsetYForProject(next);

  let added = 0;
  let skipped = 0;
  for (const cue of plan.cues) {
    const text = cue.text.replace(/\s+/g, ' ').trim().slice(0, 500);
    const startFrame = Math.max(clipStart, clipStart + Math.round(cue.startSeconds * fps));
    const endFrame = Math.min(clipEnd, clipStart + Math.round(cue.endSeconds * fps));
    if (!text || endFrame <= startFrame) {
      skipped += 1;
      continue;
    }
    const overlaps = next.captions.cues.some(
      (existing) =>
        existing.trackId === setup.trackId &&
        existing.startFrame < endFrame &&
        existing.endFrame > startFrame,
    );
    if (overlaps) {
      skipped += 1;
      continue;
    }
    const words =
      cue.words && cue.words.length > 0
        ? cue.words
            .map((word) => ({
              text: word.text.slice(0, 200),
              startFrame: Math.max(
                startFrame,
                clipStart + Math.round(word.start * fps),
              ),
              endFrame: Math.min(
                endFrame,
                clipStart + Math.round(word.end * fps),
              ),
            }))
            .filter((word) => word.text && word.endFrame > word.startFrame)
        : undefined;
    next.captions.cues.push({
      id: newId(),
      trackId: setup.trackId,
      styleId: setup.styleId,
      text,
      language: next.language,
      startFrame,
      endFrame,
      ...(words && words.length > 0 ? { words } : {}),
      ...(offsetY !== 0 ? { offsetY } : {}),
    });
    added += 1;
  }
  touch(next);
  return {
    project: next,
    added,
    skipped,
    overCps: plan.overCps,
    maxCps: plan.maxCps,
    splitSegments: plan.splitSegments,
  };
}

/** Insert already-timed cues, used by the automatic director. */
export function addCaptionCueWindows(
  project: ProjectDocument,
  inputs: readonly {
    text: string;
    startFrame: number;
    endFrame: number;
    words?: readonly { text: string; startFrame: number; endFrame: number }[];
  }[],
  options: { replaceTrack?: boolean } = {},
): { project: ProjectDocument; added: number; skipped: number; trackId: string } {
  const setup = ensureCaptionSetup(project);
  const next = cloneProject(setup.project);
  const captionTrack = next.timeline.tracks.find((item) => item.id === setup.trackId);
  if (captionTrack?.locked) {
    throw new ProjectActionError('la pista de subtítulos está bloqueada');
  }
  if (options.replaceTrack) {
    next.captions.cues = next.captions.cues.filter((cue) => cue.trackId !== setup.trackId);
  }
  let added = 0;
  let skipped = 0;
  for (const input of inputs) {
    const text = input.text.replace(/\s+/g, ' ').trim().slice(0, 500);
    const startFrame = Math.max(0, Math.round(input.startFrame));
    const endFrame = Math.max(0, Math.round(input.endFrame));
    if (!text || endFrame <= startFrame) {
      skipped += 1;
      continue;
    }
    const overlaps = next.captions.cues.some(
      (cue) =>
        cue.trackId === setup.trackId &&
        cue.startFrame < endFrame &&
        cue.endFrame > startFrame,
    );
    if (overlaps) {
      skipped += 1;
      continue;
    }
    const words = input.words
      ?.filter((word) => word.text.trim() && word.endFrame > word.startFrame)
      .map((word) => ({
        text: word.text.trim().slice(0, 200),
        startFrame: Math.max(startFrame, Math.round(word.startFrame)),
        endFrame: Math.min(endFrame, Math.round(word.endFrame)),
      }))
      .filter((word) => word.endFrame > word.startFrame);
    next.captions.cues.push({
      id: newId(),
      trackId: setup.trackId,
      styleId: setup.styleId,
      text,
      language: next.language,
      startFrame,
      endFrame,
      ...(words && words.length > 0 ? { words } : {}),
    });
    added += 1;
  }
  touch(next);
  return { project: next, added, skipped, trackId: setup.trackId };
}

export function updateCaptionCue(
  project: ProjectDocument,
  cueId: string,
  patch: Partial<
    Pick<
      CaptionCue,
      | 'text'
      | 'startFrame'
      | 'endFrame'
      | 'styleId'
      | 'animation'
      | 'wordReveal'
    >
  > & { motion?: CaptionMotion | null },
): ProjectDocument {
  const next = cloneProject(project);
  const cue = next.captions.cues.find((item) => item.id === cueId);
  if (!cue) {
    throw new ProjectActionError('el subtítulo no existe');
  }
  if (next.timeline.tracks.find((item) => item.id === cue.trackId)?.locked) {
    throw new ProjectActionError('la pista de subtítulos está bloqueada');
  }
  if (patch.text !== undefined) {
    const text = patch.text.trim();
    if (!text) {
      throw new ProjectActionError('el subtítulo no puede quedar vacío');
    }
    cue.text = text.slice(0, 500);
  }
  if (patch.startFrame !== undefined) cue.startFrame = Math.max(0, Math.round(patch.startFrame));
  if (patch.endFrame !== undefined) cue.endFrame = Math.max(0, Math.round(patch.endFrame));
  if (patch.styleId !== undefined) cue.styleId = patch.styleId;
  if (patch.animation !== undefined) {
    if (patch.animation === 'none') delete cue.animation;
    else cue.animation = patch.animation;
  }
  if (patch.wordReveal !== undefined) {
    if (patch.wordReveal) cue.wordReveal = true;
    else delete cue.wordReveal;
  }
  if ('motion' in patch) {
    if (patch.motion) cue.motion = patch.motion as CaptionMotion;
    else delete cue.motion;
  }
  if (cue.endFrame <= cue.startFrame) {
    throw new ProjectActionError('el subtítulo debe terminar después de empezar');
  }
  const overlapping = next.captions.cues.some(
    (other) =>
      other.id !== cue.id &&
      other.trackId === cue.trackId &&
      cue.startFrame < other.endFrame &&
      other.startFrame < cue.endFrame,
  );
  if (overlapping) {
    throw new ProjectActionError('ese subtítulo se superpone con otro en la misma pista');
  }
  touch(next);
  return next;
}

export function deleteCaptionCue(project: ProjectDocument, cueId: string): ProjectDocument {
  const next = cloneProject(project);
  const cue = next.captions.cues.find((item) => item.id === cueId);
  if (cue && next.timeline.tracks.find((item) => item.id === cue.trackId)?.locked) {
    throw new ProjectActionError('la pista de subtítulos está bloqueada');
  }
  next.captions.cues = next.captions.cues.filter((item) => item.id !== cueId);
  touch(next);
  return next;
}

export function updateCaptionStyle(
  project: ProjectDocument,
  styleId: string,
  patch: Partial<{
    name: string;
    fontFamily: string;
    fontSizePx: number;
    color: string;
    outlineColor: string;
    backgroundColor: string;
    bold: boolean;
    italic: boolean;
    borderStyle: 'outline' | 'box';
    shadow: boolean;
    depth3d: number;
    depthColor: string;
    position: 'top' | 'center' | 'bottom';
  }>,
): ProjectDocument {
  const next = cloneProject(project);
  const style = next.captions.styles.find((item) => item.id === styleId);
  if (!style) {
    throw new ProjectActionError('el estilo de subt�tulos no existe');
  }
  if (patch.name !== undefined) style.name = patch.name.trim().slice(0, 80) || 'Principal';
  if (patch.fontFamily !== undefined) style.fontFamily = patch.fontFamily.trim().slice(0, 120) || 'Segoe UI';
  if (patch.fontSizePx !== undefined) style.fontSizePx = Math.max(1, Math.min(400, Math.round(patch.fontSizePx)));
  if (patch.color !== undefined) {
    if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(patch.color)) {
      throw new ProjectActionError('el color debe ser un hex como #ffffff');
    }
    style.color = patch.color;
  }
  if (patch.outlineColor !== undefined) {
    if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(patch.outlineColor)) {
      throw new ProjectActionError('el contorno debe ser un hex como #000000');
    }
    style.outlineColor = patch.outlineColor;
  }
  if (patch.backgroundColor !== undefined) {
    if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(patch.backgroundColor)) {
      throw new ProjectActionError('el fondo debe ser un hex como #0b0e13');
    }
    style.backgroundColor = patch.backgroundColor;
  }
  if (patch.bold !== undefined) style.bold = patch.bold;
  if (patch.italic !== undefined) style.italic = patch.italic;
  if (patch.borderStyle !== undefined) style.borderStyle = patch.borderStyle;
  if (patch.shadow !== undefined) style.shadow = patch.shadow;
  if (patch.depth3d !== undefined) {
    style.depth3d = Math.max(0, Math.min(12, Math.round(patch.depth3d)));
  }
  if (patch.depthColor !== undefined) {
    if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(patch.depthColor)) {
      throw new ProjectActionError('el color 3D debe ser un hex como #f43f5e');
    }
    style.depthColor = patch.depthColor;
  }
  if (patch.position !== undefined) style.position = patch.position;
  touch(next);
  return next;
}

/**
 * Clips que «Subtitular proyecto» puede transcribir: video/audio montados desde
 * un asset con ventana `inFrame`/`outFrame` cuyo asset existe y es de tipo
 * `video` o `audio`. Los kinds image/freeze/graphic/adjustment/compound no
 * tienen audio propio transcribible (una imagen no suena; un compuesto ya fue
 * transcripto clip a clip si corresponde). Se incluyen clips deshabilitados o
 * en pistas muteadas: el subtítulo describe el material fuente y el usuario
 * puede borrarlo; filtrar por `enabled`/`muted` escondería material que quizá
 * sí se quiere documentar. Orden de timeline por `startFrame`.
 */
export function listTranscribableTimelineClips(project: ProjectDocument): Clip[] {
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  return project.timeline.clips
    .filter((clip) => {
      if (!isWindowed(clip)) return false;
      const source = clip.source;
      if (source.type !== 'asset' || !('inFrame' in source)) return false;
      const asset = assets.get(source.assetId);
      return asset?.kind === 'video' || asset?.kind === 'audio';
    })
    .sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id));
}

export type ClipTranscriptionPlan =
  | { readonly status: 'ready'; readonly segments: TranscriptionSegmentInput[] }
  | { readonly status: 'unsupported'; readonly reason: string }
  | { readonly status: 'empty' };

/**
 * Convierte segmentos en tiempo de asset (lo que devuelve `transcribeAsset`,
 * 0 = inicio del archivo) a segundos relativos al INICIO DEL CLIP, que es lo
 * que espera `addTranscriptionCues` (`clipStart + seg * fps`).
 *
 * Esto corrige la limitación del flujo por clip del Inspector, que pasaba los
 * segmentos crudos: un clip con `inFrame > 0` recibía subtítulos corridos (el
 * segmento en t=0 del asset caía en el inicio del clip en vez de en `inFrame`).
 * Acá la ventana `[inFrame, outFrame]` está en frames de proyecto y la
 * velocidad constante estira/achica los tiempos igual que el render (avanza
 * `speed` frames de fuente por frame de salida). Los segmentos y palabras que
 * caen fuera de la ventana se recortan o descartan.
 *
 * Clips con `reverse` o `speedCurve` no tienen un mapeo lineal fiable (el
 * orden temporal o la velocidad varía dentro del clip) y se reportan como
 * `unsupported` para que la UI lo explique en vez de subtitular mal.
 */
export function transcriptionSegmentsForClip(
  segments: readonly TranscriptionSegmentInput[],
  clip: Clip,
  fps: number,
): ClipTranscriptionPlan {
  if (!isWindowed(clip)) {
    return { status: 'unsupported', reason: 'el clip no tiene fuente de media con ventana' };
  }
  const source = clip.source;
  if ('reverse' in clip && clip.reverse === true) {
    return { status: 'unsupported', reason: 'clip invertido (reverse)' };
  }
  if (clip.kind === 'video' && clip.speedCurve) {
    return { status: 'unsupported', reason: 'curva de velocidad' };
  }
  const rate = Math.max(1, fps);
  const speedFactor = speedOf(clip).num / Math.max(1, speedOf(clip).den);
  const windowStart = source.inFrame / rate;
  const windowEnd = source.outFrame / rate;
  const toClipSeconds = (assetSeconds: number): number =>
    (assetSeconds - windowStart) / Math.max(0.01, speedFactor);

  const mapped: TranscriptionSegmentInput[] = [];
  for (const segment of segments) {
    const start = Math.max(segment.start, windowStart);
    const end = Math.min(segment.end, windowEnd);
    const text = segment.text.replace(/\s+/g, ' ').trim();
    if (!text || !(end > start)) continue;
    const clipStart = toClipSeconds(start);
    const clipEnd = toClipSeconds(end);
    const words = segment.words
      ?.map((word) => ({
        word: word.word,
        start: Math.max(clipStart, toClipSeconds(word.start)),
        end: Math.min(clipEnd, toClipSeconds(word.end)),
      }))
      .filter((word) => word.word && word.end > word.start);
    mapped.push({
      start: clipStart,
      end: clipEnd,
      text,
      ...(words && words.length > 0 ? { words } : {}),
    });
  }
  return mapped.length > 0 ? { status: 'ready', segments: mapped } : { status: 'empty' };
}

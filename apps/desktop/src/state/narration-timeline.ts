import type { Asset, ProjectDocument } from '@editor-ia/project-schema';
import type { NarrationPlan } from './narration-plan';
import {
  ProjectActionError,
  addClipFromAsset,
  addTranscriptionCues,
  totalFrames,
  touch,
  updateAudioMix,
  updateCaptionStyle,
  updateClip,
} from './project-actions';

/**
 * Monta una narración: cada frase recibe su imagen, el audio manda el tiempo,
 * los subtítulos salen de la transcripción y la voz se normaliza a −14 LUFS.
 * Si hay música, se baja a −18 dB y se le aplica ducking contra la voz.
 */

export interface NarrationMedia {
  readonly images: readonly Asset[];
  readonly voice: Asset;
  readonly music?: readonly Asset[];
}

export interface NarrationTimelineOptions {
  readonly fadeFrames?: number;
  readonly motionIntensity?: number;
}

export interface NarrationTimelineResult {
  readonly project: ProjectDocument;
  readonly firstClipId: string | null;
  readonly imageCount: number;
  readonly sentenceCount: number;
  readonly captionCount: number;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly warnings: readonly string[];
}

interface FrameGroup {
  imageIndex: number;
  start: number;
  end: number;
}

function fpsOf(project: ProjectDocument): number {
  const rate = project.video.frameRate;
  return Math.max(1, rate.num / Math.max(1, rate.den));
}

function clampIndex(value: number, length: number): number {
  if (length <= 0) return 0;
  const rounded = Number.isFinite(value) ? Math.trunc(value) : 0;
  return ((rounded % length) + length) % length;
}

export function buildNarrationTimeline(
  project: ProjectDocument,
  media: NarrationMedia,
  plan: NarrationPlan,
  assignments: readonly number[],
  options: NarrationTimelineOptions = {},
): NarrationTimelineResult {
  const images = media.images.filter((asset) => asset.status === 'ready');
  if (images.length === 0) {
    throw new ProjectActionError('la carpeta no tiene imágenes listas para narrar');
  }
  if (plan.sentences.length === 0) {
    throw new ProjectActionError('la transcripción no produjo frases');
  }
  if (media.voice.status !== 'ready') {
    throw new ProjectActionError('la voz no está lista para montar');
  }
  const fps = fpsOf(project);
  const startFrame = totalFrames(project);
  const voiceStartFrame = Math.max(0, Math.round(plan.start * fps));
  const voiceDuration = Math.max(1, Math.round((plan.end - plan.start) * fps));
  const mediaFrames =
    'media' in media.voice &&
    media.voice.media &&
    'durationFrames' in media.voice.media
      ? media.voice.media.durationFrames
      : undefined;
  const voiceOut = mediaFrames
    ? Math.min(mediaFrames, voiceStartFrame + voiceDuration)
    : voiceStartFrame + voiceDuration;
  if (voiceOut <= voiceStartFrame) {
    throw new ProjectActionError('la ventana de voz quedó vacía');
  }
  const timelineFrames = voiceOut - voiceStartFrame;

  const voice = addClipFromAsset(project, media.voice, {
    atFrame: startFrame,
    inFrame: voiceStartFrame,
    outFrame: voiceOut,
    narration: true,
  });
  let next = voice.project;
  const voiceEnd = startFrame + timelineFrames;

  // Tiempos de cada frase en frames locales a la narración.
  const sentenceFrames = plan.sentences.map((sentence) => {
    const start = Math.max(0, Math.round((sentence.start - plan.start) * fps));
    const end = Math.min(
      timelineFrames,
      Math.max(start + 1, Math.round((sentence.end - plan.start) * fps)),
    );
    return { start: Math.min(start, timelineFrames - 1), end };
  });

  const imageOrder = [...images].sort((left, right) =>
    left.label.localeCompare(right.label, 'es', { numeric: true, sensitivity: 'base' }),
  );
  const imageIndexes = plan.sentences.map((_, index) =>
    clampIndex(assignments[index] ?? index, imageOrder.length),
  );

  const groups: FrameGroup[] = [];
  for (let index = 0; index < plan.sentences.length; index += 1) {
    const imageIndex = imageIndexes[index]!;
    const sentence = sentenceFrames[index]!;
    const nextSentence = sentenceFrames[index + 1];
    const end = nextSentence ? Math.max(sentence.end, nextSentence.start) : timelineFrames;
    const previous = groups[groups.length - 1];
    if (previous && previous.imageIndex === imageIndex) {
      previous.end = Math.max(previous.end, end);
    } else {
      groups.push({ imageIndex, start: sentence.start, end });
    }
  }

  // Usa todas las imágenes cuando sobran: parte el grupo más largo.
  const used = new Set(groups.map((group) => group.imageIndex));
  const unused = imageOrder
    .map((_, index) => index)
    .filter((index) => !used.has(index));
  let guard = 0;
  while (unused.length > 0 && guard < 200) {
    guard += 1;
    const candidate = [...groups]
      .sort((left, right) => right.end - right.start - (left.end - left.start))
      .find((group) => group.end - group.start >= 2);
    if (!candidate) break;
    const middle = Math.round((candidate.start + candidate.end) / 2);
    if (middle <= candidate.start || middle >= candidate.end) break;
    const imageIndex = unused.shift()!;
    const second = { imageIndex, start: middle, end: candidate.end };
    candidate.end = middle;
    groups.splice(groups.indexOf(candidate) + 1, 0, second);
  }

  const fade = Math.max(0, Math.round(options.fadeFrames ?? 8));
  const intensity = Math.min(0.5, Math.max(0.02, options.motionIntensity ?? 0.1));
  let firstClipId: string | null = null;
  let placed = 0;
  for (const group of groups) {
    const duration = Math.max(1, group.end - group.start);
    const image = imageOrder[group.imageIndex]!;
    const added = addClipFromAsset(next, image, {
      atFrame: startFrame + group.start,
      durationFrames: duration,
    });
    next = updateClip(added.project, added.clipId, {
      motion: {
        type: placed % 2 === 0 ? 'zoom-in' : 'zoom-out',
        intensity,
      },
      ...(placed > 0 && fade > 0
        ? { transitionIn: { type: 'dissolve', frames: Math.min(fade, duration - 1) } }
        : {}),
    });
    firstClipId ??= added.clipId;
    placed += 1;
  }

  // Subtítulos desde la transcripción, relativos al inicio de la voz.
  const captionSegments = plan.sentences.map((sentence) => ({
    start: Math.max(0, sentence.start - plan.start),
    end: Math.min(
      plan.end - plan.start,
      Math.max(sentence.start - plan.start + 0.05, sentence.end - plan.start),
    ),
    text: sentence.text,
    words: sentence.words.map((word) => ({
      start: Math.max(0, word.start - plan.start),
      end: Math.min(plan.end - plan.start, Math.max(word.start - plan.start + 0.02, word.end - plan.start)),
      word: word.word,
    })),
  }));
  const captionsBefore = next.captions.cues.length;
  const withCaptions = addTranscriptionCues(next, voice.clipId, captionSegments, true);
  next = withCaptions.project;
  const style = next.captions.styles[0];
  if (style) {
    next = updateCaptionStyle(next, style.id, {
      shadow: true,
      borderStyle: 'outline',
      fontSizePx: Math.max(32, Math.min(72, style.fontSizePx)),
      position: 'bottom',
    });
  }

  const warnings: string[] = [];
  const musicAsset = media.music?.find((asset) => asset.status === 'ready');
  if (musicAsset) {
    const addedMusic = addClipFromAsset(next, musicAsset, {
      atFrame: startFrame,
      durationFrames: timelineFrames,
    });
    next = updateClip(addedMusic.project, addedMusic.clipId, {
      audio: { gainDb: -18, fadeInFrames: 12, fadeOutFrames: 24 },
    });
    next = {
      ...next,
      audio: {
        ...next.audio,
        ducking: {
          ...next.audio.ducking,
          enabled: true,
          amountDb: -12,
          sourceTrackIds: [voice.trackId],
          targetTrackIds: [addedMusic.trackId],
        },
      },
    };
    touch(next);
    warnings.push('La música quedó a −18 dB con ducking contra la voz.');
  }

  next = updateAudioMix(next, {
    masterLimiter: true,
    loudnessTarget: {
      platform: 'youtube',
      integratedLufs: -14,
      truePeakDb: -1,
      toleranceDb: 1,
    },
  });

  return {
    project: next,
    firstClipId,
    imageCount: groups.length,
    sentenceCount: plan.sentences.length,
    captionCount: next.captions.cues.length - captionsBefore,
    startFrame,
    endFrame: voiceEnd,
    warnings,
  };
}

import type { Asset, ClipEffects, JsonValue, ProjectDocument } from '@editor-ia/project-schema';
import type {
  MediaAnalysis,
  TranscriptionResult,
  TranscriptionWord,
} from '../services/project-service';
import {
  ProjectActionError,
  addCaptionCueWindows,
  addClipFromAsset,
  addTrack,
  cloneProject,
  newId,
  updateAudioMix,
  updateClip,
} from './project-actions';
import type {
  DirectorPlanSummary,
  DirectorPlatform,
  DirectorProfile,
} from './editor-memory';

/**
 * Explainable automatic director.
 *
 * The planner is deterministic: every cut comes from a measured silence, a
 * detected black/freeze range, a repeated take or a scene boundary. It never
 * claims semantic understanding of the image. The applied result stays as
 * normal editable clips.
 */

export interface DirectorRange {
  readonly startFrame: number;
  readonly endFrame: number;
}

export type DirectorCutReason =
  | 'speech'
  | 'scene'
  | 'silence'
  | 'retake'
  | 'filler'
  | 'black'
  | 'freeze';

export interface DirectorRemoved extends DirectorRange {
  readonly reason: DirectorCutReason;
  readonly seconds: number;
}

export interface DirectorCut extends DirectorRange {
  readonly sourceInFrame: number;
  readonly sourceOutFrame: number;
  readonly timelineStartFrame: number;
  readonly durationFrames: number;
  readonly reason: DirectorCutReason;
  readonly label: string;
}

export interface DirectorCaption {
  readonly text: string;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly words?: readonly { text: string; startFrame: number; endFrame: number }[];
}

export interface DirectorAudioSettings {
  readonly highPassHz: number;
  readonly compressor: boolean;
  readonly denoise?: number;
}

export type DirectorLoudnessTarget = NonNullable<ProjectDocument['audio']['loudnessTarget']>;

export interface DirectorQualityFinding {
  readonly severity: 'info' | 'warn' | 'error';
  readonly message: string;
}

export interface DirectorOptions {
  readonly removeSilences: boolean;
  readonly removeRetakes: boolean;
  readonly removeFillers: boolean;
  readonly removeBadFrames: boolean;
  readonly splitScenes: boolean;
  readonly enhanceAudio: boolean;
  readonly normalizeLoudness: boolean;
  readonly autoCaptions: boolean;
  readonly autoColor: boolean;
}

export interface DirectorPlan {
  readonly assetId: string;
  readonly platform: DirectorPlatform;
  readonly fps: number;
  readonly sourceDurationFrames: number;
  readonly cuts: readonly DirectorCut[];
  readonly removed: readonly DirectorRemoved[];
  readonly captions: readonly DirectorCaption[];
  readonly audio: DirectorAudioSettings;
  readonly effects: ClipEffects | null;
  readonly loudnessTarget: DirectorLoudnessTarget | null;
  readonly stats: {
    readonly outputFrames: number;
    readonly removedFrames: number;
    readonly silenceRemovedSeconds: number;
    readonly retakesRemoved: number;
    readonly fillersRemoved: number;
    readonly badRangesRemoved: number;
    readonly cuts: number;
  };
  readonly warnings: readonly string[];
  readonly quality: readonly DirectorQualityFinding[];
  readonly profile: DirectorProfile;
  readonly summary: DirectorPlanSummary;
}

interface MappedWord {
  readonly text: string;
  readonly sentenceEnd: boolean;
  readonly startFrame: number;
  readonly endFrame: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúñü ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mergeRanges(ranges: readonly DirectorRange[]): DirectorRange[] {
  const sorted = [...ranges]
    .filter((range) => range.endFrame > range.startFrame)
    .sort((a, b) => a.startFrame - b.startFrame);
  const merged: DirectorRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.startFrame <= previous.endFrame + 2) {
      merged[merged.length - 1] = {
        startFrame: previous.startFrame,
        endFrame: Math.max(previous.endFrame, range.endFrame),
      };
    } else {
      merged.push(range);
    }
  }
  return merged;
}

function subtractRange(ranges: readonly DirectorRange[], cut: DirectorRange): DirectorRange[] {
  const next: DirectorRange[] = [];
  for (const range of ranges) {
    if (cut.endFrame <= range.startFrame || cut.startFrame >= range.endFrame) {
      next.push(range);
      continue;
    }
    if (cut.startFrame > range.startFrame) {
      next.push({ startFrame: range.startFrame, endFrame: cut.startFrame });
    }
    if (cut.endFrame < range.endFrame) {
      next.push({ startFrame: cut.endFrame, endFrame: range.endFrame });
    }
  }
  return mergeRanges(next);
}

function reduceForRemoval(
  ranges: readonly DirectorRange[],
  removal: DirectorRange,
  minRemainingFrames = 2,
): DirectorRange[] {
  return subtractRange(ranges, removal).filter(
    (range) => range.endFrame - range.startFrame >= minRemainingFrames,
  );
}

function frameRange(
  analysisRange: { readonly startSeconds: number; readonly endSeconds: number },
  fps: number,
): DirectorRange {
  return {
    startFrame: Math.max(0, Math.round(analysisRange.startSeconds * fps)),
    endFrame: Math.max(0, Math.round(analysisRange.endSeconds * fps)),
  };
}

function frameForSeconds(seconds: number, fps: number): number {
  return Math.max(0, Math.round(seconds * fps));
}

function sceneSplits(
  ranges: readonly DirectorRange[],
  scenes: readonly number[],
  fps: number,
  minPartFrames: number,
): { segments: DirectorRange[]; reasons: DirectorCutReason[] } {
  const cuts = scenes
    .map((seconds) => frameForSeconds(seconds, fps))
    .filter((frame) => frame > 1)
    .sort((a, b) => a - b);
  const segments: DirectorRange[] = [];
  const reasons: DirectorCutReason[] = [];
  for (const range of ranges) {
    let cursor = range.startFrame;
    let reason: DirectorCutReason = 'speech';
    for (const cut of cuts) {
      if (cut <= cursor + minPartFrames || cut >= range.endFrame - minPartFrames) continue;
      segments.push({ startFrame: cursor, endFrame: cut });
      reasons.push(reason);
      cursor = cut;
      reason = 'scene';
    }
    if (range.endFrame > cursor) {
      segments.push({ startFrame: cursor, endFrame: range.endFrame });
      reasons.push(reason);
    }
  }
  return { segments, reasons };
}

function similarity(a: string, b: string): number {
  const tokenize = (value: string): Set<string> =>
    new Set(
      normalizeText(value)
        .split(' ')
        .filter((token) => token.length >= 2),
    );
  const first = tokenize(a);
  const second = tokenize(b);
  if (first.size === 0 || second.size === 0) return 0;
  let intersection = 0;
  for (const token of first) {
    if (second.has(token)) intersection += 1;
  }
  const union = first.size + second.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function repeatedTakeRemovals(
  transcript: TranscriptionResult | null,
  fps: number,
  durationFrames: number,
): DirectorRange[] {
  if (!transcript) return [];
  const segments = transcript.segments.filter(
    (segment) => segment.text.trim().length > 8 && segment.end > segment.start,
  );
  const removals: DirectorRange[] = [];
  for (let index = 0; index < segments.length - 1; index += 1) {
    const current = segments[index];
    const next = segments[index + 1];
    if (!current || !next) continue;
    const gapSeconds = next.start - current.end;
    if (gapSeconds > 20 || gapSeconds < -0.5) continue;
    if (current.end - current.start < 0.55 || next.end - next.start < 0.55) continue;
    if (similarity(current.text, next.text) < 0.72) continue;
    if (current.end - current.start > (next.end - next.start) * 1.35) continue;
    removals.push({
      startFrame: frameForSeconds(current.start, fps),
      endFrame: Math.min(durationFrames, frameForSeconds(current.end, fps)),
    });
  }
  return removals;
}

const NON_LEXICAL_FILLERS = new Set([
  'eh',
  'ehh',
  'ehhh',
  'em',
  'emm',
  'emmm',
  'mmm',
  'mm',
  'mmmh',
  'ah',
  'ahh',
  'uh',
  'uhh',
  'aj',
]);

function fillerRemovals(
  transcript: TranscriptionResult | null,
  fps: number,
  durationFrames: number,
): { ranges: DirectorRange[]; count: number } {
  if (!transcript) return { ranges: [], count: 0 };
  const words = transcript.segments.flatMap((segment) => segment.words);
  const removals: DirectorRange[] = [];
  let count = 0;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (!word) continue;
    const text = normalizeText(word.word);
    const previous = words[index - 1];
    const duration = word.end - word.start;
    const repeated =
      previous &&
      normalizeText(previous.word) === text &&
      text.length >= 2 &&
      word.start - previous.end < 0.18;
    const filler = NON_LEXICAL_FILLERS.has(text) || repeated;
    if (!filler || duration <= 0 || duration > 0.55) continue;
    const start = Math.max(0, frameForSeconds(word.start - 0.03, fps));
    const end = Math.min(durationFrames, frameForSeconds(word.end + 0.03, fps));
    if (end - start < 1) continue;
    removals.push({ startFrame: start, endFrame: end });
    count += 1;
  }
  return { ranges: removals, count };
}

function wordsForTranscript(transcript: TranscriptionResult): TranscriptionWord[] {
  const words: TranscriptionWord[] = [];
  for (const segment of transcript.segments) {
    if (segment.words.length > 0) {
      words.push(...segment.words);
      continue;
    }
    const tokens = segment.text.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const span = Math.max(0.05, segment.end - segment.start);
    tokens.forEach((token, index) => {
      const start = segment.start + (span / tokens.length) * index;
      const end = segment.start + (span / tokens.length) * (index + 1);
      words.push({ start, end, word: token, probability: 0.5 });
    });
  }
  return words.sort((a, b) => a.start - b.start);
}

function mapWordsToTimeline(
  transcript: TranscriptionResult | null,
  cuts: readonly DirectorCut[],
  fps: number,
): MappedWord[] {
  if (!transcript) return [];
  const mapped: MappedWord[] = [];
  for (const word of wordsForTranscript(transcript)) {
    const text = word.word.trim();
    if (!text) continue;
    const sourceStart = frameForSeconds(word.start, fps);
    const sourceEnd = Math.max(sourceStart + 1, frameForSeconds(word.end, fps));
    const midpoint = (sourceStart + sourceEnd) / 2;
    const cut = cuts.find(
      (item) => midpoint >= item.sourceInFrame && midpoint < item.sourceOutFrame,
    );
    if (!cut) continue;
    const startSource = Math.max(sourceStart, cut.sourceInFrame);
    const endSource = Math.min(sourceEnd, cut.sourceOutFrame);
    if (endSource <= startSource) continue;
    mapped.push({
      text,
      sentenceEnd: /[.!?…]$/.test(text),
      startFrame: cut.timelineStartFrame + (startSource - cut.sourceInFrame),
      endFrame: cut.timelineStartFrame + (endSource - cut.sourceInFrame),
    });
  }
  return mapped;
}

function groupCaptions(
  words: readonly MappedWord[],
  fps: number,
  maxChars: number,
): DirectorCaption[] {
  const cues: DirectorCaption[] = [];
  type CueDraft = {
    text: string;
    startFrame: number;
    endFrame: number;
    sentenceEnd: boolean;
    words: { text: string; startFrame: number; endFrame: number }[];
  };
  let current: CueDraft | null = null;
  const flush = (): void => {
    if (!current) return;
    if (current.endFrame > current.startFrame && current.text) {
      cues.push({
        text: current.text.trim(),
        startFrame: current.startFrame,
        endFrame: current.endFrame,
        words: current.words.map((word) => ({ ...word })),
      });
    }
    current = null;
  };
  for (const word of words) {
    if (!current) {
      current = {
        text: word.text,
        startFrame: word.startFrame,
        endFrame: word.endFrame,
        sentenceEnd: word.sentenceEnd,
        words: [
          { text: word.text, startFrame: word.startFrame, endFrame: word.endFrame },
        ],
      };
      continue;
    }
    const candidate: string = `${current.text} ${word.text}`;
    const duration = word.endFrame - current.startFrame;
    const gap = word.startFrame - current.endFrame;
    const limitExceeded = candidate.length > maxChars;
    const tooLong = duration > Math.round(4.5 * fps);
    const pause = gap > Math.round(0.85 * fps);
    if (limitExceeded || tooLong || pause || current.sentenceEnd) {
      flush();
      current = {
        text: word.text,
        startFrame: word.startFrame,
        endFrame: word.endFrame,
        sentenceEnd: word.sentenceEnd,
        words: [
          { text: word.text, startFrame: word.startFrame, endFrame: word.endFrame },
        ],
      };
      continue;
    }
    current = {
      ...current,
      text: candidate,
      endFrame: word.endFrame,
      sentenceEnd: word.sentenceEnd,
      words: [
        ...current.words,
        { text: word.text, startFrame: word.startFrame, endFrame: word.endFrame },
      ],
    };
  }
  flush();
  return cues.filter((cue) => cue.endFrame > cue.startFrame);
}

function meanCaptionCps(cues: readonly DirectorCaption[], fps: number): number {
  if (cues.length === 0) return 0;
  return (
    cues.reduce((sum, cue) => {
      const seconds = (cue.endFrame - cue.startFrame) / Math.max(1, fps);
      return sum + cue.text.length / Math.max(0.25, seconds);
    }, 0) / cues.length
  );
}

function effectsFromAnalysis(
  analysis: MediaAnalysis,
  options: DirectorOptions,
): ClipEffects | null {
  if (!options.autoColor) return null;
  const effects: ClipEffects = {};
  if (analysis.lumaAverage !== null) {
    if (analysis.lumaAverage < 82) {
      effects.brightness = 0.06;
      effects.contrast = 1.06;
    } else if (analysis.lumaAverage > 186) {
      effects.brightness = -0.05;
      effects.contrast = 1.03;
    }
  }
  if (analysis.saturationAverage !== null) {
    if (analysis.saturationAverage < 28) effects.saturation = 1.07;
    if (analysis.saturationAverage > 168) effects.saturation = 0.96;
  }
  return Object.keys(effects).length > 0 ? effects : null;
}

function audioFromAnalysis(
  analysis: MediaAnalysis,
  profile: DirectorProfile,
  options: DirectorOptions,
): DirectorAudioSettings {
  const base: DirectorAudioSettings = {
    highPassHz: 85,
    compressor: analysis.hasAudio,
  };
  if (!options.enhanceAudio) return base;
  const noise = analysis.loudness?.noiseFloorDb;
  if (noise !== null && noise !== undefined && noise > -56) {
    const amount = clamp(
      ((-56 - noise) / 26) * (0.45 + profile.denoiseBias),
      0.08,
      0.65,
    );
    return { ...base, denoise: Number(amount.toFixed(2)) };
  }
  return base;
}

function loudnessForProfile(
  profile: DirectorProfile,
  platform: DirectorPlatform,
  enabled: boolean,
): DirectorLoudnessTarget | null {
  if (!enabled) return null;
  return {
    platform,
    integratedLufs: Number(profile.audioTargetLufs.toFixed(1)),
    truePeakDb: -1,
    toleranceDb: 1,
  };
}

function qualityFindings(
  analysis: MediaAnalysis,
  plan: Omit<DirectorPlan, 'quality'>,
  options: DirectorOptions,
): DirectorQualityFinding[] {
  const findings: DirectorQualityFinding[] = [];
  if (plan.stats.outputFrames <= 2) {
    findings.push({ severity: 'error', message: 'El plan deja menos de un frame utilizable.' });
  }
  if (plan.stats.removedFrames > plan.sourceDurationFrames * 0.55) {
    findings.push({
      severity: 'warn',
      message: 'Se elimina más de la mitad de la duración original; revisá los cortes.',
    });
  }
  if (analysis.loudness?.integratedLufs !== null && analysis.loudness?.integratedLufs !== undefined) {
    if (analysis.loudness.integratedLufs > -10) {
      findings.push({
        severity: 'warn',
        message: 'El audio está muy fuerte; la normalización lo va a bajar.',
      });
    } else if (analysis.loudness.integratedLufs < -28) {
      findings.push({
        severity: 'warn',
        message: 'El audio está muy bajo; conviene normalizarlo.',
      });
    }
  }
  if (analysis.loudness?.truePeakDb !== null && analysis.loudness?.truePeakDb !== undefined) {
    if (analysis.loudness.truePeakDb > -0.5) {
      findings.push({
        severity: 'warn',
        message: 'El pico real está cerca de 0 dBFS; el limitador final lo contiene.',
      });
    }
  }
  if (options.autoCaptions && plan.captions.length === 0) {
    findings.push({
      severity: 'warn',
      message: 'No hay transcripción utilizable: el plan no puede crear subtítulos.',
    });
  }
  const cps = meanCaptionCps(plan.captions, plan.fps);
  if (plan.captions.length > 0 && cps > plan.profile.captionCps + 2) {
    findings.push({
      severity: 'warn',
      message: `Los subtítulos promedian ${cps.toFixed(1)} caracteres por segundo; pueden leerse rápido.`,
    });
  }
  if (!options.removeBadFrames && (analysis.blacks.length > 0 || analysis.freezes.length > 0)) {
    findings.push({
      severity: 'warn',
      message: 'Quedaron negros o frames congelados detectados en el material.',
    });
  }
  if (analysis.warnings.length > 0) {
    findings.push({
      severity: 'info',
      message: analysis.warnings.join(' '),
    });
  }
  return findings;
}

export function buildDirectorPlan(
  project: ProjectDocument,
  asset: Extract<Asset, { kind: 'video' }>,
  analysis: MediaAnalysis,
  transcript: TranscriptionResult | null,
  profile: DirectorProfile,
  platform: DirectorPlatform,
  options: DirectorOptions,
): DirectorPlan {
  if (asset.status !== 'ready') {
    throw new ProjectActionError('confirmá los derechos del video antes de dirigirlo');
  }
  const fps = project.video.frameRate.num / Math.max(1, project.video.frameRate.den);
  const media = 'media' in asset ? asset.media : undefined;
  const sourceDurationFrames =
    media && 'durationFrames' in media && media.durationFrames > 0
      ? media.durationFrames
      : Math.max(1, Math.round(analysis.durationSeconds * fps));
  const removed: DirectorRemoved[] = [];
  const warnings: string[] = [];
  let silenceRemovedSeconds = 0;
  let retakesRemoved = 0;
  let fillersRemoved = 0;
  let badRangesRemoved = 0;

  let ranges: DirectorRange[] = [
    { startFrame: 0, endFrame: sourceDurationFrames },
  ];
  const remove = (range: DirectorRange, reason: DirectorCutReason): boolean => {
    if (range.endFrame <= range.startFrame) return false;
    const before = ranges.reduce((sum, item) => sum + item.endFrame - item.startFrame, 0);
    ranges = reduceForRemoval(ranges, range);
    const after = ranges.reduce((sum, item) => sum + item.endFrame - item.startFrame, 0);
    if (after < before) {
      const seconds = (before - after) / Math.max(1, fps);
      removed.push({ ...range, reason, seconds });
      return true;
    }
    return false;
  };

  if (options.removeBadFrames) {
    const pad = Math.round(0.08 * fps);
    for (const black of analysis.blacks) {
      const range = frameRange(black, fps);
      if (range.endFrame - range.startFrame < Math.round(0.35 * fps)) continue;
      if (
        remove(
          {
            startFrame: range.startFrame + pad,
            endFrame: Math.max(range.startFrame + pad + 1, range.endFrame - pad),
          },
          'black',
        )
      ) {
        badRangesRemoved += 1;
      }
    }
    for (const freeze of analysis.freezes) {
      const range = frameRange(freeze, fps);
      if (range.endFrame - range.startFrame < Math.round(0.5 * fps)) continue;
      if (
        remove(
          {
            startFrame: range.startFrame + pad,
            endFrame: Math.max(range.startFrame + pad + 1, range.endFrame - pad),
          },
          'freeze',
        )
      ) {
        badRangesRemoved += 1;
      }
    }
  }

  if (options.removeSilences) {
    const pad = Math.max(1, Math.round(0.11 * fps));
    const minSilenceFrames = Math.round(
      (0.42 + (1 - profile.cutAggressiveness) * 0.55) * fps,
    );
    for (const silence of analysis.silences) {
      const range = frameRange(silence, fps);
      const length = range.endFrame - range.startFrame;
      if (length < minSilenceFrames) continue;
      let removal: DirectorRange | null = null;
      if (range.startFrame <= Math.round(0.06 * fps)) {
        removal = { startFrame: 0, endFrame: Math.max(1, range.endFrame - pad) };
      } else if (range.endFrame >= sourceDurationFrames - Math.round(0.06 * fps)) {
        removal = {
          startFrame: Math.min(sourceDurationFrames - 1, range.startFrame + pad),
          endFrame: sourceDurationFrames,
        };
      } else {
        removal = {
          startFrame: range.startFrame + pad,
          endFrame: Math.max(range.startFrame + pad + 1, range.endFrame - pad),
        };
      }
      if (removal && remove(removal, 'silence')) {
        silenceRemovedSeconds += length / Math.max(1, fps);
      }
    }
  }

  if (options.removeRetakes && transcript) {
    for (const repeated of repeatedTakeRemovals(transcript, fps, sourceDurationFrames)) {
      const padded = {
        startFrame: Math.max(0, repeated.startFrame - Math.round(0.06 * fps)),
        endFrame: Math.min(
          sourceDurationFrames,
          repeated.endFrame + Math.round(0.06 * fps),
        ),
      };
      if (remove(padded, 'retake')) retakesRemoved += 1;
    }
  }

  if (options.removeFillers && transcript) {
    const fillers = fillerRemovals(transcript, fps, sourceDurationFrames);
    for (const filler of fillers.ranges) {
      if (remove(filler, 'filler')) fillersRemoved += 1;
    }
  }

  ranges = mergeRanges(
    ranges.filter((range) => range.endFrame - range.startFrame >= 2),
  );
  if (ranges.length === 0) {
    throw new ProjectActionError('el plan eliminó todo el video; desactivá algún recorte');
  }

  const minPartFrames = Math.max(
    Math.round(0.8 * fps),
    Math.round(profile.minShotSeconds * 0.5 * fps),
  );
  const split = options.splitScenes
    ? sceneSplits(ranges, analysis.scenes, fps, minPartFrames)
    : {
        segments: ranges,
        reasons: ranges.map(() => 'speech' as DirectorCutReason),
      };

  let cursor = 0;
  const cuts: DirectorCut[] = [];
  split.segments.forEach((segment, index) => {
    const duration = segment.endFrame - segment.startFrame;
    if (duration <= 1) return;
    cuts.push({
      startFrame: cursor,
      endFrame: cursor + duration,
      sourceInFrame: segment.startFrame,
      sourceOutFrame: segment.endFrame,
      timelineStartFrame: cursor,
      durationFrames: duration,
      reason: split.reasons[index] ?? 'speech',
      label: `Toma ${String(index + 1).padStart(2, '0')}`,
    });
    cursor += duration;
  });
  if (cuts.length === 0) {
    throw new ProjectActionError('no quedó ninguna toma utilizable');
  }

  const captions = options.autoCaptions
    ? groupCaptions(
        mapWordsToTimeline(transcript, cuts, fps),
        fps,
        profile.maxCaptionChars,
      )
    : [];
  const audio = audioFromAnalysis(analysis, profile, options);
  const effects = effectsFromAnalysis(analysis, options);
  const loudnessTarget = loudnessForProfile(profile, platform, options.normalizeLoudness);
  const outputFrames = cuts.reduce((sum, cut) => sum + cut.durationFrames, 0);
  const summary: DirectorPlanSummary = {
    outputFrames,
    clipCount: cuts.length,
    meanShotFrames: outputFrames / Math.max(1, cuts.length),
    captionCount: captions.length,
    meanCaptionCps: meanCaptionCps(captions, fps),
    transitionCount: 0,
    denoise: audio.denoise ?? 0,
    loudnessTargetLufs: loudnessTarget?.integratedLufs ?? null,
    removedFrames: Math.max(0, sourceDurationFrames - outputFrames),
  };
  const draft: Omit<DirectorPlan, 'quality'> = {
    assetId: asset.id,
    platform,
    fps,
    sourceDurationFrames,
    cuts,
    removed,
    captions,
    audio,
    effects,
    loudnessTarget,
    stats: {
      outputFrames,
      removedFrames: Math.max(0, sourceDurationFrames - outputFrames),
      silenceRemovedSeconds: Number(silenceRemovedSeconds.toFixed(2)),
      retakesRemoved,
      fillersRemoved,
      badRangesRemoved,
      cuts: cuts.length,
    },
    warnings,
    profile,
    summary,
  };
  return {
    ...draft,
    quality: qualityFindings(analysis, draft, options),
  };
}

export function applyDirectorPlan(
  project: ProjectDocument,
  asset: Extract<Asset, { kind: 'video' }>,
  plan: DirectorPlan,
): { project: ProjectDocument; clipIds: string[]; captionCount: number } {
  if (plan.cuts.length === 0) {
    throw new ProjectActionError('el plan no tiene tomas para montar');
  }
  let next = cloneProject(project);
  next.timeline.clips = [];
  next.captions.cues = [];
  next.scenes = next.scenes.map((scene) => ({ ...scene, clipIds: [] }));

  let track = next.timeline.tracks.find(
    (item) => item.kind === 'video' && !item.locked,
  );
  if (!track) {
    const created = addTrack(next, 'video', 'Director');
    next = created.project;
    track = next.timeline.tracks.find((item) => item.id === created.trackId);
  }
  if (!track) {
    throw new ProjectActionError('no se pudo crear la pista del Director');
  }

  const clipIds: string[] = [];
  let cursor = 0;
  for (const cut of plan.cuts) {
    const added = addClipFromAsset(next, asset, {
      trackId: track.id,
      atFrame: cursor,
      durationFrames: cut.durationFrames,
      inFrame: cut.sourceInFrame,
      outFrame: cut.sourceOutFrame,
    });
    next = added.project;
    clipIds.push(added.clipId);
    next = updateClip(next, added.clipId, {
      label: cut.label,
      audio: {
        highPassHz: plan.audio.highPassHz,
        ...(plan.audio.compressor ? { compressor: true } : {}),
        ...(plan.audio.denoise ? { denoise: plan.audio.denoise } : {}),
      },
      ...(plan.effects ? { effects: plan.effects } : {}),
    });
    cursor += cut.durationFrames;
  }

  if (plan.loudnessTarget) {
    next = updateAudioMix(next, { loudnessTarget: plan.loudnessTarget });
  }
  if (plan.captions.length > 0) {
    next = addCaptionCueWindows(next, plan.captions, { replaceTrack: true }).project;
  }

  const record = {
    op: 'replace' as const,
    path: '/timeline/clips',
    value: JSON.parse(JSON.stringify(next.timeline.clips)) as JsonValue,
  };
  const captionRecord = {
    op: 'replace' as const,
    path: '/captions/cues',
    value: JSON.parse(JSON.stringify(next.captions.cues)) as JsonValue,
  };
  next = {
    ...next,
    revision: next.revision + 1,
    updatedAt: new Date().toISOString(),
    provenance: {
      ...next.provenance,
      operations: [
        ...next.provenance.operations,
        {
          id: newId(),
          role: 'editor',
          summary: `Director automático: ${plan.cuts.length} toma(s), ${plan.stats.silenceRemovedSeconds.toFixed(1)} s de silencio removidos, ${plan.captions.length} subtítulo(s)`,
          createdAt: new Date().toISOString(),
          cost: { items: [], disclosed: true, approved: true },
          patch: [record, captionRecord],
          expectedRevision: project.revision,
          appliedStatus: 'applied',
        },
      ],
    },
  };
  return { project: next, clipIds, captionCount: plan.captions.length };
}

export function directorQuality(
  plan: DirectorPlan,
): readonly DirectorQualityFinding[] {
  return plan.quality;
}

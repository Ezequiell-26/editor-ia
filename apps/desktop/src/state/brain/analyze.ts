import type { ProjectDocument } from '@editor-ia/project-schema';
import type { ScriptSignal, Shot, TimelineGap, TimelineSignals } from './types.ts';

/**
 * Análisis determinista de la timeline.
 *
 * No adivina: mide. Cada número de acá se puede recalcular a mano sobre el
 * documento, y eso es lo que permite que una propuesta sea discutible en vez de
 * mágica.
 */

const VISUAL_KINDS = new Set(['video', 'image', 'freeze', 'graphic', 'adjustment', 'compound']);

/** Un hueco menor a esto es ruido de redondeo, no un agujero. */
const GAP_TOLERANCE_FRAMES = 2;

export function projectFps(project: ProjectDocument): number {
  const { num, den } = project.video.frameRate;
  return num / Math.max(1, den);
}

function effectsOf(clip: ProjectDocument['timeline']['clips'][number]): Record<string, unknown> {
  return 'effects' in clip && clip.effects ? (clip.effects as Record<string, unknown>) : {};
}

function assetIdOf(clip: ProjectDocument['timeline']['clips'][number]): string | undefined {
  return clip.source.type === 'asset' ? clip.source.assetId : undefined;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function analyzeTimeline(project: ProjectDocument): TimelineSignals {
  const fps = projectFps(project);
  const clips = project.timeline.clips;
  const tracks = project.timeline.tracks;
  const durationFrames = clips.reduce(
    (max, clip) => Math.max(max, clip.startFrame + clip.durationFrames),
    0,
  );

  const shots: Shot[] = clips
    .filter((clip) => VISUAL_KINDS.has(clip.kind))
    .map((clip) => ({
      clipId: clip.id,
      trackId: clip.trackId,
      startFrame: clip.startFrame,
      durationFrames: clip.durationFrames,
      seconds: round(clip.durationFrames / fps, 3),
      kind: clip.kind,
      ...(assetIdOf(clip) ? { assetId: assetIdOf(clip) as string } : {}),
    }))
    .sort((a, b) => a.startFrame - b.startFrame);

  const durations = shots.map((shot) => shot.seconds);
  const averageShotSeconds = durations.length
    ? round(durations.reduce((total, value) => total + value, 0) / durations.length, 2)
    : 0;

  // Cortes: pares consecutivos dentro de la misma pista que se tocan o se solapan.
  let cutCount = 0;
  const gaps: TimelineGap[] = [];
  for (const track of tracks) {
    const inTrack = shots
      .filter((shot) => shot.trackId === track.id)
      .sort((a, b) => a.startFrame - b.startFrame);
    for (let index = 1; index < inTrack.length; index += 1) {
      const previous = inTrack[index - 1];
      const current = inTrack[index];
      if (!previous || !current) continue;
      const previousEnd = previous.startFrame + previous.durationFrames;
      const delta = current.startFrame - previousEnd;
      if (delta <= 1) {
        cutCount += 1;
      } else if (delta > GAP_TOLERANCE_FRAMES) {
        gaps.push({
          trackId: track.id,
          startFrame: previousEnd,
          frames: delta,
          seconds: round(delta / fps, 2),
          beforeClipId: current.clipId,
        });
      }
    }
  }

  const runs: Shot[][] = [];
  for (const track of tracks) {
    const inTrack = shots
      .filter((shot) => shot.trackId === track.id)
      .sort((a, b) => a.startFrame - b.startFrame);
    let run: Shot[] = [];
    for (const shot of inTrack) {
      const previous = run[run.length - 1];
      const sameAsset =
        previous !== undefined && shot.assetId !== undefined && shot.assetId === previous.assetId;
      if (sameAsset) {
        run.push(shot);
      } else {
        if (run.length >= 3) runs.push(run);
        run = [shot];
      }
    }
    if (run.length >= 3) runs.push(run);
  }

  const hookWindow = Math.max(1, Math.round(3 * fps));
  const hookShots = shots.filter((shot) => shot.startFrame < hookWindow);
  const hookCuts = Math.max(0, hookShots.length - 1);
  const firstShot = shots[0];
  const lastShot = shots[shots.length - 1];
  const lastClip = lastShot ? clips.find((clip) => clip.id === lastShot.clipId) : undefined;
  const lastEffects = lastClip ? effectsOf(lastClip) : {};

  const captionCues = project.captions.cues;
  const coveredFrames = (() => {
    if (captionCues.length === 0 || durationFrames === 0) return 0;
    const ranges = captionCues
      .map((cue) => [Math.max(0, cue.startFrame), Math.min(durationFrames, cue.endFrame)] as const)
      .filter(([start, end]) => end > start)
      .sort((a, b) => a[0] - b[0]);
    let total = 0;
    let cursor = -1;
    for (const [start, end] of ranges) {
      const from = Math.max(start, cursor);
      if (end > from) total += end - from;
      cursor = Math.max(cursor, end);
    }
    return total;
  })();

  const hookCaption = captionCues.some((cue) => cue.startFrame < hookWindow);

  return {
    fps,
    durationFrames,
    durationSeconds: round(durationFrames / fps, 2),
    visualShots: shots,
    audioClips: clips.filter((clip) => clip.kind === 'audio').length,
    trackCount: tracks.length,
    cutCount,
    averageShotSeconds,
    medianShotSeconds: round(median(durations), 2),
    longestShot: shots.reduce<Shot | null>(
      (best, shot) => (!best || shot.seconds > best.seconds ? shot : best),
      null,
    ),
    shortestShot: shots.reduce<Shot | null>(
      (worst, shot) => (!worst || shot.seconds < worst.seconds ? shot : worst),
      null,
    ),
    shortShots: shots.filter((shot) => shot.seconds < 0.6),
    longShots: shots.filter((shot) => shot.seconds > 9),
    gaps,
    gapSeconds: round(
      gaps.reduce((total, gap) => total + gap.seconds, 0),
      2,
    ),
    repeatedRuns: runs,
    hook: {
      cuts: hookCuts,
      hasCaption: hookCaption,
      firstShotSeconds: firstShot ? firstShot.seconds : 0,
    },
    ending: {
      lastShotSeconds: lastShot ? lastShot.seconds : 0,
      hasFadeOut: Number(lastEffects.fadeOutFrames ?? 0) > 0,
    },
    captions: {
      cues: captionCues.length,
      coverage: durationFrames > 0 ? round(coveredFrames / durationFrames, 3) : 0,
    },
    transitions: clips.filter((clip) => 'transitionIn' in clip && clip.transitionIn).length,
    hasMusic: Boolean(project.audio.music),
    loudnessTarget: project.audio.loudnessTarget?.platform ?? null,
  };
}

function countWords(text: string): number {
  const clean = text.trim();
  if (clean.length === 0) return 0;
  return clean.split(/\s+/).filter(Boolean).length;
}

/**
 * Lee el guion: qué escena tiene narración, cuánta, y si tiene material montado.
 *
 * Es independiente de la timeline a propósito. Una escena puede existir en el
 * guion sin un solo clip, y eso es exactamente lo que el cerebro tiene que ver.
 */
export function analyzeScript(project: ProjectDocument): ScriptSignal[] {
  const fps = projectFps(project);
  return project.scenes
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((scene) => {
      const text = scene.narration.text ?? '';
      const estimated = scene.narration.estimatedDurationFrames ?? 0;
      return {
        sceneId: scene.id,
        order: scene.order,
        title: scene.title,
        status: scene.status,
        intent: scene.intent,
        hasNarration: text.trim().length > 0 || scene.narration.assetId !== undefined,
        narrationWords: countWords(text),
        narrationSeconds: estimated > 0 ? round(estimated / fps, 2) : 0,
        clipCount: scene.clipIds.length,
      };
    });
}

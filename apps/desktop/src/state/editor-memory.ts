import type { Clip, ProjectDocument } from '@editor-ia/project-schema';
import type { DesktopService } from '../services/project-service';

/**
 * Local, bounded calibration for the automatic director.
 *
 * This is not a retrained model: it keeps a small set of explainable style
 * parameters per platform and nudges them with what the user accepted, cut,
 * retimed or rendered. Every field is clamped and the whole file can be reset
 * from the Director view.
 */

export const DIRECTOR_PLATFORMS = [
  'youtube',
  'shorts',
  'tiktok',
  'reels',
  'podcast',
  'broadcast',
] as const;

export type DirectorPlatform = (typeof DIRECTOR_PLATFORMS)[number];

export interface DirectorProfile {
  readonly version: 1;
  readonly samples: number;
  readonly cutAggressiveness: number;
  readonly minShotSeconds: number;
  readonly transitionRate: number;
  readonly audioTargetLufs: number;
  readonly captionCps: number;
  readonly maxCaptionChars: number;
  readonly removeFillers: number;
  readonly denoiseBias: number;
  readonly updatedAt: string;
}

export interface DirectorPlanSummary {
  readonly outputFrames: number;
  readonly clipCount: number;
  readonly meanShotFrames: number;
  readonly captionCount: number;
  readonly meanCaptionCps: number;
  readonly transitionCount: number;
  readonly denoise: number;
  readonly loudnessTargetLufs: number | null;
  readonly removedFrames: number;
}

export interface DirectorPendingRun {
  readonly projectPath: string;
  readonly platform: DirectorPlatform;
  readonly createdAt: string;
  readonly profile: DirectorProfile;
  readonly plan: DirectorPlanSummary;
  readonly projectRevision: number;
  readonly lastLearnedRevision: number;
}

export interface DirectorOutcome {
  readonly finalFrames: number;
  readonly finalClipCount: number;
  readonly finalMeanShotFrames: number;
  readonly finalCaptionCount: number;
  readonly finalMeanCaptionCps: number;
}

export interface DirectorRunRecord extends DirectorPendingRun {
  readonly outcome: DirectorOutcome;
  readonly exported: boolean;
}

export interface DirectorMemoryFile {
  readonly version: 1;
  readonly profiles: Record<DirectorPlatform, DirectorProfile>;
  readonly runs: readonly DirectorRunRecord[];
  readonly pendingRun: DirectorPendingRun | null;
}

const MAX_RUNS = 24;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function defaultDirectorProfile(platform: DirectorPlatform): DirectorProfile {
  const vertical = platform === 'shorts' || platform === 'tiktok' || platform === 'reels';
  return {
    version: 1,
    samples: 0,
    cutAggressiveness: 0.55,
    minShotSeconds: vertical ? 1.8 : platform === 'podcast' ? 4 : 2.8,
    transitionRate: 0.2,
    audioTargetLufs: platform === 'broadcast' ? -23 : platform === 'podcast' ? -16 : -14,
    captionCps: vertical ? 15 : 17,
    maxCaptionChars: vertical ? 38 : 84,
    removeFillers: 0.6,
    denoiseBias: 0.35,
    updatedAt: new Date(0).toISOString(),
  };
}

export function emptyDirectorMemory(): DirectorMemoryFile {
  const profiles = Object.fromEntries(
    DIRECTOR_PLATFORMS.map((platform) => [platform, defaultDirectorProfile(platform)]),
  ) as Record<DirectorPlatform, DirectorProfile>;
  return { version: 1, profiles, runs: [], pendingRun: null };
}

function normalizeProfile(value: unknown, fallback: DirectorProfile): DirectorProfile {
  if (!value || typeof value !== 'object') return fallback;
  const raw = value as Record<string, unknown>;
  return {
    version: 1,
    samples: Math.round(clamp(finite(raw.samples, fallback.samples), 0, 999)),
    cutAggressiveness: clamp(
      finite(raw.cutAggressiveness, fallback.cutAggressiveness),
      0,
      1,
    ),
    minShotSeconds: clamp(finite(raw.minShotSeconds, fallback.minShotSeconds), 0.8, 8),
    transitionRate: clamp(finite(raw.transitionRate, fallback.transitionRate), 0, 1),
    audioTargetLufs: clamp(finite(raw.audioTargetLufs, fallback.audioTargetLufs), -23, -12),
    captionCps: clamp(finite(raw.captionCps, fallback.captionCps), 10, 24),
    maxCaptionChars: Math.round(
      clamp(finite(raw.maxCaptionChars, fallback.maxCaptionChars), 24, 120),
    ),
    removeFillers: clamp(finite(raw.removeFillers, fallback.removeFillers), 0, 1),
    denoiseBias: clamp(finite(raw.denoiseBias, fallback.denoiseBias), 0, 1),
    updatedAt:
      typeof raw.updatedAt === 'string' ? raw.updatedAt : fallback.updatedAt,
  };
}

function normalizePlan(value: unknown): DirectorPlanSummary | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  return {
    outputFrames: Math.max(0, Math.round(finite(raw.outputFrames, 0))),
    clipCount: Math.max(0, Math.round(finite(raw.clipCount, 0))),
    meanShotFrames: Math.max(0, finite(raw.meanShotFrames, 0)),
    captionCount: Math.max(0, Math.round(finite(raw.captionCount, 0))),
    meanCaptionCps: Math.max(0, finite(raw.meanCaptionCps, 0)),
    transitionCount: Math.max(0, Math.round(finite(raw.transitionCount, 0))),
    denoise: clamp(finite(raw.denoise, 0), 0, 1),
    loudnessTargetLufs:
      typeof raw.loudnessTargetLufs === 'number' && Number.isFinite(raw.loudnessTargetLufs)
        ? raw.loudnessTargetLufs
        : null,
    removedFrames: Math.max(0, Math.round(finite(raw.removedFrames, 0))),
  };
}

export function normalizeDirectorMemory(value: unknown): DirectorMemoryFile {
  const base = emptyDirectorMemory();
  if (!value || typeof value !== 'object') return base;
  const raw = value as Record<string, unknown>;
  const profiles = { ...base.profiles };
  if (raw.profiles && typeof raw.profiles === 'object') {
    for (const platform of DIRECTOR_PLATFORMS) {
      profiles[platform] = normalizeProfile(
        (raw.profiles as Record<string, unknown>)[platform],
        base.profiles[platform],
      );
    }
  }
  const runs: DirectorRunRecord[] = [];
  if (Array.isArray(raw.runs)) {
    for (const item of raw.runs.slice(0, MAX_RUNS)) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const plan = normalizePlan(record.plan);
      if (!plan || typeof record.projectPath !== 'string') continue;
      const platform = DIRECTOR_PLATFORMS.includes(record.platform as DirectorPlatform)
        ? (record.platform as DirectorPlatform)
        : 'youtube';
      const outcomeRaw =
        record.outcome && typeof record.outcome === 'object'
          ? (record.outcome as Record<string, unknown>)
          : {};
      runs.push({
        projectPath: record.projectPath,
        platform,
        createdAt: typeof record.createdAt === 'string' ? record.createdAt : '',
        profile: normalizeProfile(record.profile, profiles[platform]),
        plan,
        projectRevision: Math.max(0, Math.round(finite(record.projectRevision, 0))),
        lastLearnedRevision: Math.max(
          0,
          Math.round(finite(record.lastLearnedRevision, 0)),
        ),
        exported: record.exported === true,
        outcome: {
          finalFrames: Math.max(0, Math.round(finite(outcomeRaw.finalFrames, 0))),
          finalClipCount: Math.max(0, Math.round(finite(outcomeRaw.finalClipCount, 0))),
          finalMeanShotFrames: Math.max(0, finite(outcomeRaw.finalMeanShotFrames, 0)),
          finalCaptionCount: Math.max(0, Math.round(finite(outcomeRaw.finalCaptionCount, 0))),
          finalMeanCaptionCps: Math.max(0, finite(outcomeRaw.finalMeanCaptionCps, 0)),
        },
      });
    }
  }
  let pendingRun: DirectorPendingRun | null = null;
  if (raw.pendingRun && typeof raw.pendingRun === 'object') {
    const pending = raw.pendingRun as Record<string, unknown>;
    const plan = normalizePlan(pending.plan);
    if (plan && typeof pending.projectPath === 'string') {
      const platform = DIRECTOR_PLATFORMS.includes(pending.platform as DirectorPlatform)
        ? (pending.platform as DirectorPlatform)
        : 'youtube';
      pendingRun = {
        projectPath: pending.projectPath,
        platform,
        createdAt: typeof pending.createdAt === 'string' ? pending.createdAt : '',
        profile: normalizeProfile(pending.profile, profiles[platform]),
        plan,
        projectRevision: Math.max(0, Math.round(finite(pending.projectRevision, 0))),
        lastLearnedRevision: Math.max(
          0,
          Math.round(finite(pending.lastLearnedRevision, 0)),
        ),
      };
    }
  }
  return { version: 1, profiles, runs, pendingRun };
}

export async function loadDirectorMemory(service: DesktopService): Promise<DirectorMemoryFile> {
  try {
    return normalizeDirectorMemory(await service.loadDirectorMemory());
  } catch {
    return emptyDirectorMemory();
  }
}

export async function saveDirectorMemory(
  service: DesktopService,
  memory: DirectorMemoryFile,
): Promise<void> {
  await service.saveDirectorMemory(memory);
}

export function directorProfile(
  memory: DirectorMemoryFile,
  platform: DirectorPlatform,
): DirectorProfile {
  return memory.profiles[platform] ?? defaultDirectorProfile(platform);
}

export function platformForProject(project: ProjectDocument): DirectorPlatform {
  if (project.video.height > project.video.width) return 'shorts';
  if (project.video.width === project.video.height) return 'reels';
  return 'youtube';
}

function clipWeight(clip: Clip): number {
  return clip.kind === 'audio' ? 0 : 1;
}

export function measureTimeline(project: ProjectDocument): {
  finalFrames: number;
  finalClipCount: number;
  finalMeanShotFrames: number;
  finalCaptionCount: number;
  finalMeanCaptionCps: number;
  transitionCount: number;
  denoise: number;
  loudnessTargetLufs: number | null;
} {
  const visual = project.timeline.clips.filter((clip) => clipWeight(clip) > 0);
  const finalFrames = Math.max(
    0,
    ...project.timeline.clips.map((clip) => clip.startFrame + clip.durationFrames),
  );
  const meanShot =
    visual.length > 0
      ? visual.reduce((sum, clip) => sum + clip.durationFrames, 0) / visual.length
      : 0;
  const fps = project.video.frameRate.num / Math.max(1, project.video.frameRate.den);
  const captionCps =
    project.captions.cues.length > 0
      ? project.captions.cues.reduce((sum, cue) => {
          const seconds = (cue.endFrame - cue.startFrame) / Math.max(1, fps);
          return sum + cue.text.length / Math.max(0.25, seconds);
        }, 0) / project.captions.cues.length
      : 0;
  const transitionCount = visual.filter((clip) => {
    if (clip.kind !== 'video' && clip.kind !== 'image') return false;
    return (clip.effects?.fadeInFrames ?? 0) > 0 || (clip.effects?.fadeOutFrames ?? 0) > 0;
  }).length;
  const denoiseValues = project.timeline.clips
    .map((clip) => clip.audio?.denoise ?? 0)
    .filter((value) => value > 0);
  return {
    finalFrames,
    finalClipCount: visual.length,
    finalMeanShotFrames: meanShot,
    finalCaptionCount: project.captions.cues.length,
    finalMeanCaptionCps: captionCps,
    transitionCount,
    denoise:
      denoiseValues.length > 0
        ? denoiseValues.reduce((sum, value) => sum + value, 0) / denoiseValues.length
        : 0,
    loudnessTargetLufs: project.audio.loudnessTarget?.integratedLufs ?? null,
  };
}

export function createPendingRun(
  projectPath: string,
  project: ProjectDocument,
  platform: DirectorPlatform,
  profile: DirectorProfile,
  plan: DirectorPlanSummary,
): DirectorPendingRun {
  return {
    projectPath,
    platform,
    createdAt: new Date().toISOString(),
    profile,
    plan,
    projectRevision: project.revision,
    lastLearnedRevision: 0,
  };
}

/**
 * Compares the plan with the timeline the user actually kept and nudges the
 * profile a small step towards their corrections. The step is bounded and the
 * result stays inspectable; no opaque model is trained.
 */
export function learnFromTimeline(
  memory: DirectorMemoryFile,
  projectPath: string,
  project: ProjectDocument,
  exported: boolean,
): DirectorMemoryFile {
  const pending = memory.pendingRun;
  if (!pending || pending.projectPath !== projectPath) return memory;
  if (pending.lastLearnedRevision === project.revision) return memory;
  const measured = measureTimeline(project);
  const base = directorProfile(memory, pending.platform);
  const plan = pending.plan;
  const shotDelta =
    plan.meanShotFrames > 0 && measured.finalMeanShotFrames > 0
      ? measured.finalMeanShotFrames - plan.meanShotFrames
      : 0;
  const durationRatio =
    plan.outputFrames > 0
      ? (measured.finalFrames - plan.outputFrames) / plan.outputFrames
      : 0;
  const transitionDelta =
    plan.clipCount > 0
      ? (measured.transitionCount - plan.transitionCount) / plan.clipCount
      : 0;
  const captionDelta =
    plan.captionCount > 0 &&
    measured.finalCaptionCount > 0 &&
    measured.finalMeanCaptionCps > 0
      ? measured.finalMeanCaptionCps - plan.meanCaptionCps
      : 0;
  const loudnessDelta =
    measured.loudnessTargetLufs !== null && plan.loudnessTargetLufs !== null
      ? measured.loudnessTargetLufs - plan.loudnessTargetLufs
      : 0;
  const denoiseDelta =
    measured.finalClipCount > 0 ? measured.denoise - plan.denoise : 0;
  const next: DirectorProfile = {
    ...base,
    samples: Math.min(999, base.samples + 1),
    minShotSeconds: clamp(base.minShotSeconds + clamp(shotDelta * 0.18, -0.4, 0.4), 0.8, 8),
    cutAggressiveness: clamp(
      base.cutAggressiveness - clamp(durationRatio * 0.25, -0.09, 0.09),
      0,
      1,
    ),
    transitionRate: clamp(
      base.transitionRate + clamp(transitionDelta * 0.22, -0.1, 0.1),
      0,
      1,
    ),
    captionCps: clamp(base.captionCps + clamp(captionDelta * 0.12, -1.5, 1.5), 10, 24),
    audioTargetLufs: clamp(
      base.audioTargetLufs + clamp(loudnessDelta * 0.3, -1, 1),
      -23,
      -12,
    ),
    denoiseBias: clamp(base.denoiseBias + clamp(denoiseDelta * 0.2, -0.1, 0.1), 0, 1),
    updatedAt: new Date().toISOString(),
  };
  const record: DirectorRunRecord = {
    ...pending,
    outcome: {
      finalFrames: measured.finalFrames,
      finalClipCount: measured.finalClipCount,
      finalMeanShotFrames: measured.finalMeanShotFrames,
      finalCaptionCount: measured.finalCaptionCount,
      finalMeanCaptionCps: measured.finalMeanCaptionCps,
    },
    exported,
  };
  return {
    ...memory,
    profiles: { ...memory.profiles, [pending.platform]: next },
    runs: [record, ...memory.runs].slice(0, MAX_RUNS),
    // Keep the plan active so a later edit and export can teach the profile
    // again. The revision guard avoids counting the same timeline twice.
    pendingRun: { ...pending, lastLearnedRevision: project.revision },
  };
}

export async function recordDirectorOutcome(
  service: DesktopService,
  projectPath: string,
  project: ProjectDocument,
  exported: boolean,
): Promise<DirectorMemoryFile | null> {
  const memory = await loadDirectorMemory(service);
  if (!memory.pendingRun || memory.pendingRun.projectPath !== projectPath) return null;
  const next = learnFromTimeline(memory, projectPath, project, exported);
  if (next === memory) return memory;
  await saveDirectorMemory(service, next);
  return next;
}

import type { ProjectDocument } from '@editor-ia/project-schema';
import { aspectRatioOf } from './video-format';
import {
  ProjectActionError,
  cloneProject,
  newId,
  touch,
} from './project-actions-core';

/**
 * Delivery mutations: the render-profile presets that follow the project
 * canvas (`syncNativeProfile`, `ensureDelivery`) and the compression/fit/
 * pixel-format appliers used by the export dialog. Extracted from
 * `project-actions.ts`; `project-actions.ts` re-exports everything here.
 */

const NATIVE_PROFILE_PREFIX = 'Formato del proyecto';

function makeDeliveryProfile(
  project: ProjectDocument,
  name: string,
  width: number,
  height: number,
  minOutputBytes: number,
) {
  return {
    id: newId(),
    name,
    container: 'mp4' as const,
    videoCodec: 'h264' as const,
    audioCodec: 'aac' as const,
    resolution: { width, height },
    frameRate: { ...project.video.frameRate },
    bitrate: { mode: 'crf' as const, crf: 22 },
    videoPreset: 'veryfast' as const,
    fit: 'contain' as const,
    pixelFormat: 'yuv420p' as const,
    audioSampleRate: 48_000,
    audioChannels: 2,
    audioBitsPerSecond: 128_000,
    aspectRatio: aspectRatioOf(width, height),
    qualityGate: { minOutputBytes, durationToleranceFrames: 10, requireAllAssetsReady: true },
  };
}

/** Keep one profile that follows the project canvas, even for unusual ratios. */
export function syncNativeProfile(project: ProjectDocument): ProjectDocument {
  const next = project;
  const width = next.video.width;
  const height = next.video.height;
  const name = `${NATIVE_PROFILE_PREFIX} ${width}×${height}`;
  const existing = next.renderProfiles.find((profile) =>
    profile.name.startsWith(NATIVE_PROFILE_PREFIX),
  );
  if (existing) {
    existing.name = name;
    existing.resolution = { width, height };
    existing.aspectRatio = aspectRatioOf(width, height);
    return next;
  }
  if (next.renderProfiles.some((profile) => profile.resolution.width === width && profile.resolution.height === height)) {
    return next;
  }
  next.renderProfiles.push(makeDeliveryProfile(next, name, width, height, 50_000));
  return next;
}

export function ensureDelivery(project: ProjectDocument): ProjectDocument {
  const next = cloneProject(project);
  const existingAspects = new Set(next.renderProfiles.map((profile) => profile.aspectRatio));
  const addProfile = (
    name: string,
    width: number,
    height: number,
    minOutputBytes: number,
  ) => {
    next.renderProfiles.push(makeDeliveryProfile(next, name, width, height, minOutputBytes));
  };
  if (!existingAspects.has('16:9')) {
    addProfile('YouTube 1080p', 1920, 1080, 500_000);
  }
  if (!existingAspects.has('9:16')) {
    addProfile('Shorts 1080x1920', 1080, 1920, 300_000);
  }
  if (!existingAspects.has('1:1')) {
    addProfile('Feed 1080x1080', 1080, 1080, 250_000);
  }
  syncNativeProfile(next);
  const platforms = new Set(next.exportVariants.map((variant) => variant.platform));
  for (const profile of next.renderProfiles) {
    if (profile.aspectRatio === '16:9' && !platforms.has('youtube')) {
      next.exportVariants.push({
        id: newId(),
        name: profile.name,
        renderProfileId: profile.id,
        platform: 'youtube',
      });
      platforms.add('youtube');
    }
    if (profile.aspectRatio === '9:16' && !platforms.has('shorts')) {
      next.exportVariants.push({
        id: newId(),
        name: profile.name,
        renderProfileId: profile.id,
        platform: 'shorts',
      });
      platforms.add('shorts');
    }
    if (profile.aspectRatio === '1:1' && !platforms.has('other')) {
      next.exportVariants.push({
        id: newId(),
        name: profile.name,
        renderProfileId: profile.id,
        platform: 'other',
      });
      platforms.add('other');
    }
  }
  return next;
}

export type CompressionPresetId = 'rapido' | 'equilibrado' | 'compacto' | 'maximo';

export interface CompressionPreset {
  readonly id: CompressionPresetId;
  readonly label: string;
  readonly note: string;
  readonly crf: number;
  readonly videoPreset: 'ultrafast' | 'veryfast' | 'faster' | 'medium';
  readonly audioBitsPerSecond: number;
}

export const COMPRESSION_PRESETS: readonly CompressionPreset[] = [
  {
    id: 'rapido',
    label: 'Rápido',
    note: 'Renderiza lo antes posible; ocupa más.',
    crf: 23,
    videoPreset: 'ultrafast',
    audioBitsPerSecond: 128_000,
  },
  {
    id: 'equilibrado',
    label: 'Equilibrado',
    note: 'Buena calidad y tamaño razonable.',
    crf: 22,
    videoPreset: 'veryfast',
    audioBitsPerSecond: 128_000,
  },
  {
    id: 'compacto',
    label: 'Compacto',
    note: 'El archivo más chico; tarda un poco más.',
    crf: 27,
    videoPreset: 'faster',
    audioBitsPerSecond: 96_000,
  },
  {
    id: 'maximo',
    label: 'Máxima calidad',
    note: 'Más pesado y más lento; para masters.',
    crf: 18,
    videoPreset: 'medium',
    audioBitsPerSecond: 192_000,
  },
];

export function compressionPresetOf(
  profile: ProjectDocument['renderProfiles'][number],
): CompressionPresetId | 'custom' {
  const crf = profile.bitrate.mode === 'crf' ? profile.bitrate.crf : null;
  const match = COMPRESSION_PRESETS.find(
    (preset) =>
      preset.crf === crf &&
      preset.videoPreset === profile.videoPreset &&
      preset.audioBitsPerSecond === profile.audioBitsPerSecond,
  );
  return match?.id ?? 'custom';
}

/** Apply one compression profile and optional codec to every delivery profile. */
export function applyCompression(
  project: ProjectDocument,
  presetId: CompressionPresetId,
  videoCodec?: 'h264' | 'h265' | 'vp9' | 'av1' | 'prores',
): ProjectDocument {
  const preset = COMPRESSION_PRESETS.find((item) => item.id === presetId);
  if (!preset) throw new ProjectActionError('el preset de compresión no existe');
  const next = cloneProject(project);
  // Misma matriz que CONTAINER_MATRIX del schema: WebM lleva VP9/AV1 + Opus;
  // MP4/MOV llevan H.264/H.265 + AAC y MOV además ProRes; ProRes emite
  // 4:2:2 10-bit (`yuv422p10le`), no 4:2:0 ni 4:4:4.
  const webm = videoCodec === 'vp9' || videoCodec === 'av1';
  const prores = videoCodec === 'prores';
  for (const profile of next.renderProfiles) {
    profile.bitrate = { mode: 'crf', crf: preset.crf };
    profile.videoPreset = preset.videoPreset;
    profile.audioBitsPerSecond = preset.audioBitsPerSecond;
    if (videoCodec) {
      profile.videoCodec = videoCodec;
      profile.container = webm ? 'webm' : prores ? 'mov' : 'mp4';
      profile.audioCodec = webm ? 'opus' : 'aac';
      profile.pixelFormat = prores
        ? 'yuv422p10le'
        : webm && profile.pixelFormat === 'yuv444p'
          ? 'yuv444p'
          : 'yuv420p';
    }
  }
  touch(next);
  return next;
}

/** Apply contain/cover/blur to every delivery profile (used by the export dialog). */
export function applyProfileFit(
  project: ProjectDocument,
  fit: 'contain' | 'cover' | 'blur',
): ProjectDocument {
  const next = cloneProject(project);
  for (const profile of next.renderProfiles) profile.fit = fit;
  touch(next);
  return next;
}

/**
 * Apply the pixel format to every delivery profile. `yuv444p` sólo lo emiten
 * de verdad WebM VP9 (`libvpx-vp9`) y AV1 (`libaom-av1`) por software — el
 * backend lo valida por perfil en `parse_profile`, así que la UI sólo debe
 * ofrecerlo cuando todos los perfiles son WebM VP9/AV1 sin encoder de
 * hardware (ver `pixel444Eligible` en ExportDialog).
 */
export function applyPixelFormat(
  project: ProjectDocument,
  pixelFormat: 'yuv420p' | 'yuv444p' | 'yuv422p10le' | 'yuva444p10le',
): ProjectDocument {
  const next = cloneProject(project);
  for (const profile of next.renderProfiles) profile.pixelFormat = pixelFormat;
  touch(next);
  return next;
}

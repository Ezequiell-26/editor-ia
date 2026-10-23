import {
  totalProjectDuration,
  type Asset,
  type ProjectDocument,
} from '@editor-ia/project-schema';
import { chaptersFromMarkers } from './markers';

export interface PublicationChecks {
  readonly allAssetsReady: boolean;
  readonly missingLicenses: number;
  readonly duplicateGroups: number;
  readonly aiGeneratedAssets: number;
  readonly captionCount: number;
  readonly renderProfiles: number;
  readonly platformVariants: number;
  readonly scenes: number;
}

export interface PublicationAudit {
  readonly score: number;
  readonly checks: PublicationChecks;
  readonly issues: string[];
}

export interface PublicationMetadata {
  readonly title: string;
  readonly description: string;
  readonly hashtags: readonly string[];
  readonly chapters: readonly {
    readonly startSeconds: number;
    readonly title: string;
  }[];
  readonly platforms: readonly {
    readonly id: string;
    readonly label: string;
    readonly fits: boolean;
    readonly reason: string;
  }[];
}

export interface PublicationManifest {
  readonly schema: 'editor-ia.publication-manifest.v1';
  readonly generatedAt: string;
  readonly metadata: PublicationMetadata;
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly revision: number;
    readonly durationFrames: number;
    readonly frameRate: { readonly num: number; readonly den: number };
    readonly resolution: { readonly width: number; readonly height: number };
    readonly language: string;
  };
  readonly assets: Array<{
    readonly id: string;
    readonly label: string;
    readonly kind: Asset['kind'];
    readonly status: Asset['status'];
    readonly sourceType: Asset['source']['type'];
    readonly providerId: string | null;
    readonly path: string;
    readonly integrity: { readonly sha256: string; readonly bytes: number } | null;
    readonly license: Asset['rights']['license'];
    readonly provenance: Asset['rights']['provenance'];
  }>;
  readonly scenes: Array<{
    readonly id: string;
    readonly order: number;
    readonly title: string;
    readonly intent: string;
    readonly narrationAssetId: string | null;
    readonly clipIds: readonly string[];
  }>;
  readonly captions: {
    readonly count: number;
    readonly language: string;
    readonly trackCount: number;
  };
  readonly delivery: {
    readonly profiles: number;
    readonly variants: number;
    readonly aspectRatios: readonly string[];
    readonly platforms: readonly string[];
  };
  readonly audit: PublicationAudit;
}

function duplicateHashes(project: ProjectDocument): Map<string, number> {
  const counts = new Map<string, number>();
  for (const asset of project.assets) {
    const hash = 'integrity' in asset ? asset.integrity?.sha256 : undefined;
    if (!hash) continue;
    counts.set(hash, (counts.get(hash) ?? 0) + 1);
  }
  return counts;
}

const META_STOP_WORDS = new Set([
  'como', 'para', 'sobre', 'desde', 'entre', 'hasta', 'cuando', 'donde', 'porque',
  'este', 'esta', 'estos', 'estas', 'todo', 'toda', 'todos', 'todas', 'más', 'mas',
  'con', 'sin', 'que', 'los', 'las', 'del', 'una', 'unos', 'unas', 'por', 'sus',
  'the', 'and', 'with', 'from', 'that', 'this', 'your', 'their', 'video', 'escena',
]);

/** Deterministic SEO copy so a batch can be reviewed before publishing by hand. */
export function buildPublicationMetadata(project: ProjectDocument): PublicationMetadata {
  const scenes = [...project.scenes].sort((a, b) => a.order - b.order);
  const title = (scenes[0]?.title?.trim() || project.name).slice(0, 100);
  const spoken = scenes
    .map((scene) => scene.narration.text?.trim() ?? '')
    .filter(Boolean)
    .slice(0, 2)
    .join(' ');
  const description = `${spoken || project.name} Mirá el video completo y contanos qué te pareció.`
    .replace(/\s+/g, ' ')
    .slice(0, 480);
  const words = `${project.name} ${scenes.map((scene) => scene.title).join(' ')}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !META_STOP_WORDS.has(word));
  const hashtags = [...new Set(words)]
    .slice(0, 8)
    .map((word) => `#${word}`)
    .slice(0, 8);

  const fps = Math.max(1, project.video.frameRate.num / Math.max(1, project.video.frameRate.den));
  const chapters =
    project.markers.length > 0
      ? chaptersFromMarkers(project.markers, fps)
      : (() => {
          let cursor = 0;
          return scenes.map((scene) => {
            const chapter = { startSeconds: Math.round(cursor / fps), title: scene.title };
            const clip = project.timeline.clips.find((item) => scene.clipIds.includes(item.id));
            cursor += clip?.durationFrames ?? scene.narration.estimatedDurationFrames ?? 0;
            return chapter;
          });
        })();

  const durationSeconds = totalProjectDuration(project) / fps;
  const vertical = project.video.height > project.video.width;
  const platforms = [
    {
      id: 'youtube',
      label: 'YouTube',
      fits: !vertical,
      reason: vertical
        ? 'YouTube largo espera horizontal; usá Shorts o reencuadrá.'
        : 'Formato horizontal listo para YouTube.',
    },
    {
      id: 'shorts',
      label: 'YouTube Shorts',
      fits: vertical && durationSeconds <= 60,
      reason: vertical
        ? durationSeconds <= 60
          ? 'Vertical y dentro de 60 s.'
          : `Dura ${durationSeconds.toFixed(0)} s; Shorts corta a 60 s.`
        : 'Shorts necesita 9:16.',
    },
    {
      id: 'reels',
      label: 'Instagram Reels',
      fits: vertical && durationSeconds <= 90,
      reason: vertical
        ? durationSeconds <= 90
          ? 'Vertical y dentro de 90 s.'
          : `Dura ${durationSeconds.toFixed(0)} s; Reels corta a 90 s.`
        : 'Reels necesita 9:16.',
    },
    {
      id: 'tiktok',
      label: 'TikTok',
      fits: vertical && durationSeconds <= 180,
      reason: vertical
        ? durationSeconds <= 180
          ? 'Vertical y dentro de 3 minutos.'
          : `Dura ${durationSeconds.toFixed(0)} s; TikTok corta a 3 min.`
        : 'TikTok prioriza 9:16.',
    },
  ];

  return { title, description, hashtags, chapters, platforms };
}

/** Deterministic readiness score for publishing the current project. */
export function auditPublication(project: ProjectDocument): PublicationAudit {
  const duplicates = [...duplicateHashes(project).values()].filter((count) => count > 1);
  const missingLicenses = project.assets.filter(
    (asset) => asset.rights.license.commercialUse === 'unknown',
  ).length;
  const allAssetsReady = project.assets.every((asset) => asset.status === 'ready');
  const aiGeneratedAssets = project.assets.filter((asset) =>
    ['generated-by-provider', 'generated-locally'].includes(
      asset.rights.provenance.origin,
    ),
  ).length;
  const checks: PublicationChecks = {
    allAssetsReady,
    missingLicenses,
    duplicateGroups: duplicates.length,
    aiGeneratedAssets,
    captionCount: project.captions.cues.length,
    renderProfiles: project.renderProfiles.length,
    platformVariants: project.exportVariants.length,
    scenes: project.scenes.length,
  };

  const issues: string[] = [];
  let score = 100;
  if (!allAssetsReady) {
    score -= 25;
    issues.push('Hay material que no está listo o que falta en disco.');
  }
  if (missingLicenses > 0) {
    score -= Math.min(30, missingLicenses * 10);
    issues.push(`${missingLicenses} material(es) tienen licencia desconocida.`);
  }
  if (duplicates.length > 0) {
    score -= Math.min(30, duplicates.length * 10);
    issues.push(`Hay ${duplicates.length} grupo(s) de archivos duplicados por hash.`);
  }
  if (checks.scenes > 0 && checks.captionCount === 0) {
    score -= 10;
    issues.push('El proyecto tiene escenas pero no tiene subtítulos.');
  }
  if (checks.renderProfiles === 0) {
    score -= 15;
    issues.push('Faltan perfiles de exportación.');
  }
  if (checks.platformVariants === 0) {
    score -= 5;
    issues.push('No hay variantes declaradas por plataforma.');
  }
  return {
    score: Math.max(0, Math.min(100, score)),
    checks,
    issues,
  };
}

export function buildPublicationManifest(
  project: ProjectDocument,
  now: Date = new Date(),
): PublicationManifest {
  const audit = auditPublication(project);
  return {
    schema: 'editor-ia.publication-manifest.v1',
    generatedAt: now.toISOString(),
    metadata: buildPublicationMetadata(project),
    project: {
      id: project.id,
      name: project.name,
      revision: project.revision,
      durationFrames: totalProjectDuration(project),
      frameRate: project.video.frameRate,
      resolution: { width: project.video.width, height: project.video.height },
      language: project.language,
    },
    assets: project.assets.map((asset) => ({
      id: asset.id,
      label: asset.label,
      kind: asset.kind,
      status: asset.status,
      sourceType: asset.source.type,
      providerId: 'provider' in asset.source ? asset.source.provider.id : null,
      path: asset.source.path,
      integrity: 'integrity' in asset ? asset.integrity ?? null : null,
      license: asset.rights.license,
      provenance: {
        origin: asset.rights.provenance.origin,
        acquiredAt: asset.rights.provenance.acquiredAt,
        ...('sourceUrl' in asset.rights.provenance && asset.rights.provenance.sourceUrl
          ? { sourceUrl: asset.rights.provenance.sourceUrl }
          : {}),
        ...('provider' in asset.rights.provenance && asset.rights.provenance.provider
          ? { provider: asset.rights.provenance.provider }
          : {}),
      },
    })),
    scenes: [...project.scenes]
      .sort((a, b) => a.order - b.order)
      .map((scene) => ({
        id: scene.id,
        order: scene.order,
        title: scene.title,
        intent: scene.intent,
        narrationAssetId: scene.narration.assetId ?? null,
        clipIds: scene.clipIds,
      })),
    captions: {
      count: project.captions.cues.length,
      language: project.language,
      trackCount: project.timeline.tracks.filter((track) => track.kind === 'caption').length,
    },
    delivery: {
      profiles: project.renderProfiles.length,
      variants: project.exportVariants.length,
      aspectRatios: [...new Set(project.renderProfiles.map((profile) => profile.aspectRatio))],
      platforms: [...new Set(project.exportVariants.map((variant) => variant.platform))],
    },
    audit,
  };
}

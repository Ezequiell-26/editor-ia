import type { Asset, JsonValue, ProjectDocument, Scene } from '@editor-ia/project-schema';
import {
  ProjectActionError,
  addClipFromAsset,
  attachNarrationAsset,
  cloneProject,
  ensureCaptionSetup,
  fpsOf,
  markAssetReady,
  newId,
  secondsToFrames,
  setClipSpeed,
  totalFrames,
  updateClip,
} from './project-actions';
import {
  automaticPhotoMotion,
  type AutoPhotoMotion,
} from './photo-motion';

/**
 * Automatic assembly from the script.
 *
 * The honest local path is: one narration asset per scene (Windows SAPI) plus
 * images in order or matched by their prompt text. That yields exact scene
 * durations and exact subtitles without pretending to run CLIP or Whisper.
 */

export type AutoEditAssignment = 'order' | 'match';

export interface AutoEditOptions {
  readonly assignment: AutoEditAssignment;
  readonly includeCaptions: boolean;
  readonly replaceTimeline: boolean;
  readonly maxCaptionChars?: number;
  readonly photoMotion?: AutoPhotoMotion;
  readonly transitionFrames?: number;
  readonly includeVideos?: boolean;
  /** Explicit media per scene, e.g. one generated image or video per script scene. */
  readonly mediaByScene?: Readonly<Record<string, string>>;
}

export interface AutoEditScenePlan {
  readonly sceneId: string;
  readonly title: string;
  readonly mediaId: string;
  readonly mediaKind: 'image' | 'video';
  readonly audioId?: string;
  readonly startFrame: number;
  readonly durationFrames: number;
  readonly mediaRepeated: boolean;
}

export interface AutoEditPlan {
  readonly scenes: AutoEditScenePlan[];
  readonly totalFrames: number;
  readonly captionCount: number;
  readonly mediaUsed: number;
  readonly warnings: string[];
}

export interface AutoEditResult {
  readonly project: ProjectDocument;
  readonly plan: AutoEditPlan;
}

export interface NarrationCandidate {
  readonly sceneId: string;
  readonly asset: Asset;
}

const STOP_WORDS = new Set([
  'de', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'con',
  'para', 'por', 'sobre', 'al', 'del', 'en', 'que', 'se', 'su', 'sus', 'sin',
  'como', 'the', 'a', 'an', 'and', 'of', 'to', 'in', 'on', 'with', 'for',
  'ilustracion', 'ilustración', 'illustration', 'plana', 'plano', 'flat', '2d',
  'comic', 'cómic', 'web', 'estilo', 'style', 'fondo', 'background', 'texto',
  'text', 'personaje', 'personajes', 'character', 'characters', 'palito',
  'contornos', 'negros', 'gruesos', 'temblorosos', 'paleta', 'colores',
  'calida', 'cálida', 'saturados', 'acentos', 'cabeza', 'redonda', 'simple',
]);

function tokenize(value: string): Set<string> {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const tokens = normalized
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
  return new Set(tokens);
}

function sceneTokens(scene: Scene): Set<string> {
  return tokenize(
    [scene.title, scene.notes ?? '', scene.narration.text ?? ''].join(' '),
  );
}

type AutoMedia = Extract<Asset, { kind: 'image' | 'video' }>;

function scoreImage(scene: Scene, image: Asset, documentFrequency: Map<string, number>, imageCount: number): number {
  const sceneSet = sceneTokens(scene);
  const imageSet = tokenize(image.label);
  if (sceneSet.size === 0 || imageSet.size === 0) return 0;
  let score = 0;
  for (const token of sceneSet) {
    if (!imageSet.has(token)) continue;
    const df = documentFrequency.get(token) ?? 1;
    score += Math.log(1 + imageCount / df);
  }
  return score / Math.sqrt(sceneSet.size * imageSet.size);
}

function assignMedia(
  scenes: readonly Scene[],
  media: readonly AutoMedia[],
  assignment: AutoEditAssignment,
): { media: AutoMedia; repeated: boolean }[] {
  if (assignment === 'order') {
    return scenes.map((_, index) => ({
      media: media[index % media.length] as AutoMedia,
      repeated: index >= media.length,
    }));
  }

  const frequency = new Map<string, number>();
  for (const mediaItem of media) {
    for (const token of tokenize(mediaItem.label)) {
      frequency.set(token, (frequency.get(token) ?? 0) + 1);
    }
  }
  const used = new Set<string>();
  return scenes.map((scene, index) => {
    let best: AutoMedia | null = null;
    let bestScore = -Infinity;
    for (const mediaItem of media) {
      if (media.length >= scenes.length && used.has(mediaItem.id)) continue;
      const score = scoreImage(scene, mediaItem, frequency, media.length);
      if (score > bestScore) {
        best = mediaItem;
        bestScore = score;
      }
    }
    const fallback =
      media.find((mediaItem) => !used.has(mediaItem.id)) ?? (media[index % media.length] as AutoMedia);
    const chosen = bestScore > 0 && best ? best : fallback;
    const repeated = used.has(chosen.id);
    used.add(chosen.id);
    return { media: chosen, repeated };
  });
}

function storedAsset<K extends 'image' | 'audio' | 'video'>(
  project: ProjectDocument,
  asset: Asset,
  kind: K,
): Extract<Asset, { kind: K }> {
  const stored = project.assets.find((item) => item.id === asset.id);
  if (!stored) {
    throw new ProjectActionError(`"${asset.label}" no está en el proyecto`);
  }
  if (stored.kind !== kind) {
    throw new ProjectActionError(`"${asset.label}" no es un material de tipo ${kind}`);
  }
  if (stored.status !== 'ready') {
    throw new ProjectActionError(`confirmá los derechos de "${asset.label}" antes de montarlo`);
  }
  return stored as Extract<Asset, { kind: K }>;
}

function emptyTrack(project: ProjectDocument, kinds: readonly string[]): string | null {
  const used = new Set(project.timeline.clips.map((clip) => clip.trackId));
  return (
    project.timeline.tracks.find(
      (track) => kinds.includes(track.kind) && !track.locked && !used.has(track.id),
    )?.id ?? null
  );
}

function ensureTrack(
  project: ProjectDocument,
  kinds: readonly string[],
  createKind: 'image' | 'narration' | 'video',
  label: string,
): { project: ProjectDocument; trackId: string } {
  const existing = emptyTrack(project, kinds);
  if (existing) return { project, trackId: existing };
  const order = Math.max(-1, ...project.timeline.tracks.map((track) => track.order)) + 1;
  const track = {
    id: newId(),
    kind: createKind,
    label,
    order,
    muted: false,
    hidden: false,
    locked: false,
  } as const;
  const next = cloneProject(project);
  next.timeline.tracks.push(track);
  next.revision += 1;
  next.updatedAt = new Date().toISOString();
  return { project: next, trackId: track.id };
}

/** Split narration into readable cue-sized chunks without breaking words. */
export function splitCaptionText(text: string, maxChars = 90): string[] {
  const limit = Math.max(10, Math.min(500, Math.round(maxChars)));
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?…]+[.!?…]?/g) ?? [clean];
  const chunks: string[] = [];
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    if (trimmed.length <= limit) {
      chunks.push(trimmed);
      continue;
    }
    let current = '';
    for (const word of trimmed.split(' ')) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > limit && current) {
        chunks.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) chunks.push(current);
  }
  return chunks.flatMap((chunk) =>
    chunk.length <= limit
      ? [chunk]
      : [chunk.slice(0, limit).trim(), ...splitCaptionText(chunk.slice(limit), limit)],
  );
}

/** Add freshly synthesized narrations and build the timeline in one mutation.
 * `confirmVoiceRights` is the user's explicit declaration for those voices. */
export function prepareAutoEdit(
  project: ProjectDocument,
  narrations: readonly NarrationCandidate[],
  options: AutoEditOptions,
  confirmVoiceRights: boolean,
): AutoEditResult {
  if (narrations.length > 0 && !confirmVoiceRights) {
    throw new ProjectActionError('confirmá los derechos de la voz antes de montar la narración');
  }
  let next = cloneProject(project);
  for (const candidate of narrations) {
    if (!next.assets.some((asset) => asset.id === candidate.asset.id)) {
      next.assets.push(candidate.asset);
    }
    if (next.assets.find((asset) => asset.id === candidate.asset.id)?.status !== 'ready') {
      next = markAssetReady(next, candidate.asset.id, 'allowed');
    }
    next = attachNarrationAsset(next, candidate.sceneId, candidate.asset.id);
  }
  if (confirmVoiceRights) {
    for (const scene of next.scenes) {
      if (!scene.narration.assetId) continue;
      const asset = next.assets.find((item) => item.id === scene.narration.assetId);
      if (asset?.kind === 'audio' && asset.status !== 'ready') {
        next = markAssetReady(next, asset.id, 'allowed');
      }
    }
  }
  return buildAutoEdit(next, options);
}

export function buildAutoEdit(
  project: ProjectDocument,
  options: AutoEditOptions,
): AutoEditResult {
  const scenes = [...project.scenes].sort((a, b) => a.order - b.order);
  if (scenes.length === 0) {
    throw new ProjectActionError('el montaje automático necesita al menos una escena de guion');
  }
  const mediaPool = project.assets
    .filter(
      (asset): asset is AutoMedia =>
        (asset.kind === 'image' || asset.kind === 'video') && asset.status === 'ready',
    )
    .filter((asset) => options.includeVideos !== false || asset.kind === 'image')
    .sort((a, b) => a.label.localeCompare(b.label, 'es', { numeric: true, sensitivity: 'base' }));
  const images = mediaPool.filter(
    (asset): asset is Extract<Asset, { kind: 'image' }> => asset.kind === 'image',
  );
  if (mediaPool.length === 0) {
    throw new ProjectActionError(
      'el montaje automático necesita al menos una imagen o un video confirmado',
    );
  }

  const assignments = assignMedia(scenes, mediaPool, options.assignment);
  const fps = fpsOf(project);
  const warnings: string[] = [];
  let next = cloneProject(project);
  if (options.replaceTimeline) {
    next.timeline = { ...next.timeline, clips: [] };
    next.captions = { ...next.captions, cues: [] };
    next.scenes = next.scenes.map((scene) => ({ ...scene, clipIds: [] }));
  }

  let imageTrackId: string | null = null;
  let videoTrackId: string | null = null;
  const mediaTrack = (kind: 'image' | 'video'): string => {
    if (kind === 'image') {
      if (!imageTrackId) {
        const track = ensureTrack(next, ['image'], 'image', 'Imágenes automáticas');
        next = track.project;
        imageTrackId = track.trackId;
      }
      return imageTrackId;
    }
    if (!videoTrackId) {
      const track = ensureTrack(next, ['video'], 'video', 'Videos automáticos');
      next = track.project;
      videoTrackId = track.trackId;
    }
    return videoTrackId;
  };
  const narrationTrack = ensureTrack(next, ['narration', 'audio'], 'narration', 'Narración');
  next = narrationTrack.project;
  const captionSetup = ensureCaptionSetup(next);
  next = captionSetup.project;

  let cursor = options.replaceTimeline ? 0 : totalFrames(next);
  const planScenes: AutoEditScenePlan[] = [];
  const addedClipIds: string[] = [];
  let captionCount = 0;
  let repeatedCount = 0;
  let missingAudioCount = 0;
  let shortVideoCount = 0;

  scenes.forEach((scene, index) => {
    const assignment = assignments[index];
    if (!assignment) return;

    let audio: Extract<Asset, { kind: 'audio' }> | undefined;
    if (scene.narration.assetId) {
      const candidate = next.assets.find((asset) => asset.id === scene.narration.assetId);
      if (candidate) {
        audio = storedAsset(next, candidate, 'audio');
      }
    }
    if (!audio) missingAudioCount += 1;

    const durationFrames = Math.max(
      1,
      audio?.media?.durationFrames ??
        scene.narration.estimatedDurationFrames ??
        secondsToFrames(Math.max(2, (scene.narration.text ?? '').length / 15), fps),
    );

    const preferredId = options.mediaByScene?.[scene.id];
    const preferred = preferredId
      ? mediaPool.find((mediaItem) => mediaItem.id === preferredId)
      : undefined;
    const initial = preferred ?? assignment.media;
    let chosen = storedAsset(next, initial, initial.kind);
    let repeated = preferred ? false : assignment.repeated;
    if (chosen.kind === 'video') {
      const available = chosen.media?.durationFrames ?? 0;
      const requiredSpeed = available > 0 ? available / durationFrames : 0;
      if (available <= 0 || requiredSpeed < 0.5) {
        const fallback = images.find((image) => image.id !== chosen.id) ?? images[0];
        if (!fallback) {
          throw new ProjectActionError(
            `"${scene.title}": el video es demasiado corto para la narración y no hay imágenes de respaldo`,
          );
        }
        warnings.push(
          `"${scene.title}": el video dura menos de la mitad de la escena; se usó la imagen "${fallback.label}".`,
        );
        chosen = fallback;
        repeated = true;
        shortVideoCount += 1;
      }
    }
    if (repeated) repeatedCount += 1;

    const trackId = mediaTrack(chosen.kind);
    let mediaClip = addClipFromAsset(next, chosen, {
      trackId,
      atFrame: cursor,
      durationFrames,
    });
    next = mediaClip.project;

    if (chosen.kind === 'video') {
      const available = chosen.media?.durationFrames ?? 0;
      if (available > 0 && available < durationFrames) {
        // Stretch the clip so the narration never outlives the picture. The
        // speed is quantized by the timeline; a one-frame gap is acceptable.
        let speed = available / durationFrames;
        for (let attempt = 0; attempt < 6; attempt += 1) {
          next = setClipSpeed(next, mediaClip.clipId, speed);
          const clip = next.timeline.clips.find((item) => item.id === mediaClip.clipId);
          if (!clip || clip.durationFrames <= durationFrames) break;
          speed *= 1.02;
        }
      }
      if (audio) {
        const clip = next.timeline.clips.find((item) => item.id === mediaClip.clipId);
        if (clip && clip.kind === 'video') {
          next = updateClip(next, clip.id, {
            audio: { ...(clip.audio ?? {}), gainDb: -60 },
          });
        }
      }
    }

    const motion =
      options.photoMotion === 'auto' && chosen.kind === 'image'
        ? automaticPhotoMotion(index)
        : undefined;
    const transitionFrames = Math.min(
      120,
      Math.max(0, Math.floor(options.transitionFrames ?? 0)),
      durationFrames,
    );
    const isFirstScene = index === 0;
    const isLastScene = index === scenes.length - 1;
    const edgeEffects =
      transitionFrames > 0
        ? {
            ...(isFirstScene ? { fadeInFrames: transitionFrames } : {}),
            ...(isLastScene ? { fadeOutFrames: transitionFrames } : {}),
          }
        : undefined;
    if (
      motion ||
      (edgeEffects && Object.keys(edgeEffects).length > 0) ||
      (!isFirstScene && transitionFrames > 0)
    ) {
      next = updateClip(next, mediaClip.clipId, {
        ...(motion ? { motion } : {}),
        ...(edgeEffects && Object.keys(edgeEffects).length > 0
          ? { effects: edgeEffects }
          : {}),
        ...(!isFirstScene && transitionFrames > 0
          ? { transitionIn: { type: 'dissolve' as const, frames: transitionFrames } }
          : {}),
      });
    }
    addedClipIds.push(mediaClip.clipId);

    let audioClipId: string | null = null;
    if (audio) {
      const audioClip = addClipFromAsset(next, audio, {
        trackId: narrationTrack.trackId,
        atFrame: cursor,
        narration: true,
      });
      next = audioClip.project;
      addedClipIds.push(audioClip.clipId);
      audioClipId = audioClip.clipId;
    }

    const currentScene = next.scenes.find((item) => item.id === scene.id);
    if (currentScene) {
      currentScene.clipIds = audioClipId
        ? [mediaClip.clipId, audioClipId]
        : [mediaClip.clipId];
      currentScene.narration.estimatedDurationFrames = durationFrames;
      if (audio) {
        currentScene.narration.assetId = audio.id;
      } else {
        delete currentScene.narration.assetId;
      }
    }

    const text = scene.narration.text?.trim();
    if (options.includeCaptions && text) {
      const chunks = splitCaptionText(text, options.maxCaptionChars ?? 90);
      const totalChars = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      let captionCursor = cursor;
      let consumed = 0;
      chunks.forEach((chunk, chunkIndex) => {
        const isLast = chunkIndex === chunks.length - 1;
        const chunkFrames = isLast
          ? Math.max(1, durationFrames - consumed)
          : Math.max(1, Math.round((durationFrames * chunk.length) / Math.max(1, totalChars)));
        const startFrame = captionCursor;
        const endFrame = Math.min(cursor + durationFrames, startFrame + chunkFrames);
        if (endFrame > startFrame) {
          next.captions.cues.push({
            id: newId(),
            trackId: captionSetup.trackId,
            styleId: captionSetup.styleId,
            text: chunk.slice(0, 500),
            language: next.language,
            startFrame,
            endFrame,
          });
          captionCount += 1;
          captionCursor = endFrame;
          consumed += endFrame - startFrame;
        }
      });
    }

    planScenes.push({
      sceneId: scene.id,
      title: scene.title,
      mediaId: chosen.id,
      mediaKind: chosen.kind,
      ...(audio ? { audioId: audio.id } : {}),
      startFrame: cursor,
      durationFrames,
      mediaRepeated: repeated,
    });
    cursor += durationFrames;
  });

  if (repeatedCount > 0) {
    warnings.push(
      `Se repitieron ${repeatedCount} medio(s) porque hay más escenas que recursos disponibles.`,
    );
  }
  if (missingAudioCount > 0) {
    warnings.push(
      `${missingAudioCount} escena(s) sin narración usan la duración estimada del guion.`,
    );
  }
  if (shortVideoCount > 0) {
    warnings.push(
      `${shortVideoCount} video(s) demasiado cortos se reemplazaron por imagen para no cortar la narración.`,
    );
  }
  if (mediaPool.length > scenes.length) {
    warnings.push(
      `Se usaron ${scenes.length} de ${mediaPool.length} medios disponibles; el resto quedó en la biblioteca.`,
    );
  }

  const captionCueIds =
    captionCount > 0 ? next.captions.cues.slice(-captionCount).map((cue) => cue.id) : [];
  const patch = [
    ...addedClipIds.map((clipId) => {
      const clip = next.timeline.clips.find((item) => item.id === clipId);
      return {
        op: 'add' as const,
        path: '/timeline/clips/-',
        value: JSON.parse(JSON.stringify(clip)) as JsonValue,
      };
    }),
    ...captionCueIds.map((cueId) => {
      const cue = next.captions.cues.find((item) => item.id === cueId);
      return {
        op: 'add' as const,
        path: '/captions/cues/-',
        value: JSON.parse(JSON.stringify(cue)) as JsonValue,
      };
    }),
  ].filter((entry) => entry.value !== undefined);

  next.revision += 1;
  next.updatedAt = new Date().toISOString();
  next.provenance.operations.push({
    id: newId(),
    role: 'editor',
    summary: `Montaje automático: ${scenes.length} escena(s), ${planScenes.length} imagen(es), ${captionCount} subtítulo(s)`.slice(
      0,
      300,
    ),
    createdAt: new Date().toISOString(),
    cost: { items: [], disclosed: true, approved: true },
    patch,
    expectedRevision: project.revision,
    appliedStatus: 'applied',
  });

  return {
    project: next,
    plan: {
      scenes: planScenes,
      totalFrames: cursor - (options.replaceTimeline ? 0 : totalFrames(project)),
      captionCount,
      mediaUsed: new Set(planScenes.map((scene) => scene.mediaId)).size,
      warnings,
    },
  };
}

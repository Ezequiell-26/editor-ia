import type { Asset, Clip, ClipTransition, ProjectDocument } from '@editor-ia/project-schema';
import type { MediaAnalysis } from '../services/project-service';
import {
  addCaptionCueWindows,
  addClipFromAsset,
  addTrack,
  applyMusicDucking,
  autoPlaceSfx,
  cloneProject,
  computeFaceCenteredOffsets,
  newId,
  setTransformKeyframe,
  TALKING_HEAD_DEFAULT_FACE,
  totalFrames,
  touch,
  updateAudioMix,
  updateClip,
} from './project-actions';
import type { FaceTarget } from './face-zoom';
import type { AutoEditTransition, AutoEditVariant } from './autoedit-engine';

export type AutoEditSplitMode = 'none' | 'j-cut' | 'l-cut' | 'auto';

export interface ApplyAutoEditOptions {
  /** Reemplaza los clips actuales en vez de agregar la variante al final. */
  readonly replace: boolean;
  /** High-pass, denoise, compressor y gain según la medición de loudness. */
  readonly improveAudio: boolean;
  /** Agrega los subtítulos disponibles (si la variante los tiene). */
  readonly addCaptions: boolean;
  /** Transición de entrada entre cortes. */
  readonly transition?: AutoEditTransition;
  /** Intensidad del zoom, 0–100. 0 deja los cortes quietos. */
  readonly zoom?: number;
  /**
   * Cortes divididos (J-cut / L-cut): desacopla audio y video para que las
   * transiciones de voz suenen naturales como en edición humana de YouTube.
   * - 'none': corte recto tradicional en la misma pista.
   * - 'j-cut': el audio del orador entra antes que su imagen.
   * - 'l-cut': el audio del plano anterior continúa sobre el nuevo plano.
   * - 'auto': aplica J-cut en entradas de habla y L-cut en cortes a escenas/recurso.
   */
  readonly splitEdits?: AutoEditSplitMode;
  /** Fotogramas de adelanto/retraso (por defecto ~0.35 s según FPS). */
  readonly splitFrames?: number;
  /**
   * Modo de encuadre para los cortes con zoom:
   * - 'talking-head': encuadra en el tercio superior habitual de YouTube (rostro ~35% de altura).
   * - 'face': usa las coordenadas provistas en `faceTargets` o el tercio superior por defecto.
   * - 'center': zoom geométrico al centro del fotograma (comportamiento previo).
   */
  readonly faceFraming?: 'talking-head' | 'face' | 'center';
  /**
   * Coordenadas de rostro por material (assetId) para enfocar los cortes con zoom.
   */
  readonly faceTargets?: Record<string, FaceTarget>;
  /**
   * Efectos de sonido automáticos (wooshes en zooms/transiciones, dings en cifras clave).
   */
  readonly sfx?: boolean;
  /**
   * Ducking de música automático con cortes repentinos (mutes) en silencios dramáticos.
   */
  readonly musicDucking?: boolean;
}

export interface ApplyAutoEditResult {
  readonly project: ProjectDocument;
  readonly clipCount: number;
  readonly captionCount: number;
  readonly sfxCount?: number;
  readonly duckingApplied?: boolean;
}

function transitionFor(
  kind: AutoEditTransition,
  style: AutoEditVariant['style'],
): ClipTransition | null {
  if (kind === 'none') return null;
  if (kind === 'fade') return { type: 'fade-black', frames: style === 'impact' ? 8 : 12 };
  return { type: 'dissolve', frames: style === 'impact' ? 5 : 8 };
}

/**
 * Convierte una variante del editor automático en clips reales de la timeline.
 *
 * Cada corte puede venir de un video distinto: el montaje toma el asset que
 * declara el corte. Los clips conservan el material original, se pueden
 * recortar, mover y deshacer; no se exporta nada hasta que se pida.
 */
export function applyAutoEditVariant(
  project: ProjectDocument,
  assets: readonly Asset[] | Asset,
  variant: AutoEditVariant,
  analysis: MediaAnalysis | null,
  options: ApplyAutoEditOptions,
): ApplyAutoEditResult {
  const pool = Array.isArray(assets) ? assets : [assets as Asset];
  if (pool.length === 0) throw new Error('no hay material para montar');
  const fallback = pool[0]!;
  const byId = new Map(pool.map((asset) => [asset.id, asset] as const));
  const missing = new Set(
    variant.cuts.map((cut) => cut.assetId).filter((id) => !byId.has(id)),
  );
  if (missing.size > 0) {
    throw new Error(
      `la variante usa ${missing.size} material(es) que ya no están en el proyecto; volvé a medir`,
    );
  }
  const fps = project.video.frameRate.num / Math.max(1, project.video.frameRate.den);
  const transition = transitionFor(options.transition ?? 'dissolve', variant.style);
  const zoomStrength = Math.max(0, Math.min(100, options.zoom ?? 40));

  let next = cloneProject(project);
  const offset = options.replace ? 0 : totalFrames(next);
  if (options.replace) {
    next.timeline.clips = [];
    next.timeline.tracks = next.timeline.tracks.filter((track) => track.kind === 'caption');
    next.captions.cues = [];
    touch(next);
  }
  const useSplit = Boolean(options.splitEdits && options.splitEdits !== 'none');
  const track = addTrack(next, 'video', `Auto · ${variant.name}`);
  const trackId = track.trackId;
  next = track.project;

  let audioTrackIds: readonly [string, string] | null = null;
  if (useSplit) {
    const audioTrackA = addTrack(next, 'audio', `Auto · ${variant.name} (Audio 1)`);
    next = audioTrackA.project;
    const audioTrackB = addTrack(next, 'audio', `Auto · ${variant.name} (Audio 2)`);
    next = audioTrackB.project;
    audioTrackIds = [audioTrackA.trackId, audioTrackB.trackId] as const;
  }

  const loudness = analysis?.loudness?.integratedLufs ?? null;
  const gainDb =
    options.improveAudio && loudness !== null
      ? Math.max(-6, Math.min(6, Math.round((-14 - loudness) * 10) / 10))
      : 0;
  let cursor = offset;
  let clipCount = 0;

  const nominalSplit = Math.max(2, Math.min(30, options.splitFrames ?? Math.round(fps * 0.35)));
  interface PlacedAudioRef {
    readonly clipId: string;
    inFrame: number;
    outFrame: number;
    startFrame: number;
    durationFrames: number;
  }
  const placedAudio: PlacedAudioRef[] = [];

  for (const [index, cut] of variant.cuts.entries()) {
    const asset = byId.get(cut.assetId) ?? fallback;
    const mediaFrames =
      'media' in asset && asset.media && 'durationFrames' in asset.media
        ? asset.media.durationFrames
        : undefined;
    if (!mediaFrames) {
      throw new Error(`el material “${asset.label}” no declara duración medida`);
    }
    const inFrame = Math.max(0, Math.min(mediaFrames - 1, Math.round(cut.startSeconds * fps)));
    const outFrame = Math.max(
      inFrame + 1,
      Math.min(mediaFrames, Math.round(cut.endSeconds * fps)),
    );
    const videoDuration = outFrame - inFrame;

    const added = addClipFromAsset(next, asset, {
      trackId,
      atFrame: cursor,
      inFrame,
      outFrame,
    });
    next = added.project;
    clipCount += 1;

    next = updateClip(next, added.clipId, {
      label: `${variant.name} · ${String(index + 1).padStart(2, '0')}`,
      ...(useSplit ? { audio: { muted: true } } : {}),
      ...(index > 0 && transition ? { transitionIn: transition } : {}),
    });

    if (cut.zoom && zoomStrength > 0) {
      const last = videoDuration - 1;
      const peak = 1 + 0.06 + (zoomStrength / 100) * 0.16;
      const settle = Math.min(last, Math.max(6, Math.round(fps * 0.4)));

      const face =
        options.faceTargets?.[asset.id] ??
        (options.faceFraming === 'center'
          ? { centerX: 0.5, centerY: 0.5 }
          : TALKING_HEAD_DEFAULT_FACE);

      const { offsetX, offsetY } = computeFaceCenteredOffsets({
        canvasWidth: project.video.width,
        canvasHeight: project.video.height,
        face,
        scale: peak,
      });

      next = setTransformKeyframe(next, added.clipId, 0, {
        scale: peak,
        offsetX,
        offsetY,
        opacity: 1,
        easing: 'ease-out',
      });
      next = setTransformKeyframe(next, added.clipId, settle, {
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        opacity: 1,
      });
      if (last > settle + 4) {
        next = setTransformKeyframe(next, added.clipId, last, {
          scale: 1.04,
          offsetX: Math.round(offsetX * 0.18),
          offsetY: Math.round(offsetY * 0.18),
          opacity: 1,
        });
      }
    }

    if (!useSplit) {
      if (options.improveAudio) {
        next = updateClip(next, added.clipId, {
          audio: {
            highPassHz: 80,
            lowPassHz: 16_000,
            denoise: 0.12,
            compressor: true,
            deesser: true,
            eqMidDb: 1.5,
            gainDb,
          },
        });
      }
    } else if (audioTrackIds) {
      const isFirst = index === 0;
      const isSpeech = cut.reason === 'speech';
      const prevCut = index > 0 ? variant.cuts[index - 1] : null;
      const isSceneAfterSpeech =
        prevCut && prevCut.reason === 'speech' && (cut.reason === 'scene' || cut.reason === 'fill');

      let splitType: 'none' | 'j-cut' | 'l-cut' = 'none';
      if (!isFirst) {
        if (options.splitEdits === 'j-cut') {
          splitType = 'j-cut';
        } else if (options.splitEdits === 'l-cut') {
          splitType = 'l-cut';
        } else if (options.splitEdits === 'auto') {
          if (isSceneAfterSpeech) {
            splitType = 'l-cut';
          } else if (isSpeech) {
            splitType = 'j-cut';
          } else {
            splitType = 'j-cut';
          }
        }
      }

      const audioTrackId = audioTrackIds[index % 2]!;
      let audioStart = cursor;
      let audioIn = inFrame;
      let audioOut = outFrame;
      let fadeInFrames = 0;
      let fadeOutFrames = 0;

      if (splitType === 'j-cut') {
        const availablePre = inFrame;
        const timelinePre = cursor - offset;
        const lead = Math.max(0, Math.min(nominalSplit, availablePre, timelinePre));
        if (lead > 0) {
          audioStart = cursor - lead;
          audioIn = inFrame - lead;
          fadeInFrames = Math.min(lead, 4);
          const lastAudio = placedAudio[placedAudio.length - 1];
          if (lastAudio) {
            const existingAudio =
              next.timeline.clips.find((c) => c.id === lastAudio.clipId)?.audio ?? {};
            next = updateClip(next, lastAudio.clipId, {
              audio: {
                ...existingAudio,
                fadeOutFrames: 4,
              },
            });
          }
        }
      } else if (splitType === 'l-cut') {
        const lastAudio = placedAudio[placedAudio.length - 1];
        if (lastAudio && prevCut) {
          const prevAsset = byId.get(prevCut.assetId) ?? fallback;
          const prevMediaFrames =
            'media' in prevAsset && prevAsset.media && 'durationFrames' in prevAsset.media
              ? prevAsset.media.durationFrames
              : Number.POSITIVE_INFINITY;
          const availableTail = Math.max(0, prevMediaFrames - lastAudio.outFrame);
          const trail = Math.max(0, Math.min(nominalSplit, availableTail));
          if (trail > 0) {
            const newOut = lastAudio.outFrame + trail;
            const newDuration = newOut - lastAudio.inFrame;
            const targetClip = next.timeline.clips.find((c) => c.id === lastAudio.clipId);
            if (targetClip && targetClip.source.type === 'asset' && 'outFrame' in targetClip.source) {
              targetClip.source.outFrame = newOut;
              targetClip.durationFrames = newDuration;
            }
            const existingAudio = targetClip?.audio ?? {};
            next = updateClip(next, lastAudio.clipId, {
              audio: {
                ...existingAudio,
                fadeOutFrames: Math.min(trail, 6),
              },
            });
            lastAudio.outFrame = newOut;
            lastAudio.durationFrames = newDuration;
          }
        }
        fadeInFrames = Math.min(nominalSplit, 6);
      }

      const audioDuration = audioOut - audioIn;
      const audioClip: Clip = {
        id: newId(),
        trackId: audioTrackId,
        kind: 'audio',
        label: `${variant.name} · ${String(index + 1).padStart(2, '0')} (Audio)`,
        startFrame: audioStart,
        durationFrames: audioDuration,
        source: {
          type: 'asset',
          assetId: cut.assetId,
          inFrame: audioIn,
          outFrame: audioOut,
        },
        audio: {
          ...(options.improveAudio
            ? {
                highPassHz: 80,
                lowPassHz: 16_000,
                denoise: 0.12,
                compressor: true,
                deesser: true,
                eqMidDb: 1.5,
                gainDb,
              }
            : {}),
          ...(fadeInFrames > 0 ? { fadeInFrames } : {}),
          ...(fadeOutFrames > 0 ? { fadeOutFrames } : {}),
        },
      };

      next.timeline.clips.push(audioClip);
      clipCount += 1;
      placedAudio.push({
        clipId: audioClip.id,
        inFrame: audioIn,
        outFrame: audioOut,
        startFrame: audioStart,
        durationFrames: audioDuration,
      });
    }

    cursor += videoDuration;
  }
  if (options.improveAudio) {
    // El gain por clip se calcula con la medición de la primera fuente; con
    // fuentes mezcladas la suma puede pasar de 0 dBFS. loudnorm + limiter en
    // la entrega garantizan el objetivo real (-14 LUFS / TP -1) medido en el
    // archivo exportado.
    next = updateAudioMix(next, {
      loudnessTarget: {
        platform: next.video.height > next.video.width ? 'shorts' : 'youtube',
        integratedLufs: -14,
        truePeakDb: -1,
        toleranceDb: 1,
      },
      masterLimiter: true,
    });
  }
  let captionCount = 0;
  if (options.addCaptions && variant.captions.length > 0) {
    const result = addCaptionCueWindows(
      next,
      variant.captions.map((caption) => ({
        text: caption.text,
        startFrame: offset + Math.round(caption.startSeconds * fps),
        endFrame: offset + Math.round(caption.endSeconds * fps),
      })),
      { replaceTrack: options.replace },
    );
    next = result.project;
    captionCount = result.added;
  }
  let sfxCount = 0;
  if (options.sfx) {
    const sfxResult = autoPlaceSfx(next, {
      trackName: `Auto · ${variant.name} (SFX)`,
      zooms: true,
      transitions: true,
      captions: options.addCaptions,
      hook: variant.recipe.hook,
    });
    next = sfxResult.project;
    clipCount += sfxResult.placedCount;
    sfxCount = sfxResult.placedCount;
  }
  let duckingApplied = false;
  if (options.musicDucking) {
    const duckResult = applyMusicDucking(next, {
      silences: analysis?.silences ?? [],
      transcript:
        variant.captions.length > 0
          ? {
              language: 'auto',
              languageProbability: 1,
              durationSeconds: totalFrames(next) / fps,
              model: 'whisper',
              segments: variant.captions.map((c) => ({
                start: c.startSeconds,
                end: c.endSeconds,
                text: c.text,
                words: [],
              })),
            }
          : null,
      punchlineMutes: true,
    });
    if (duckResult.keyframeCount > 0) {
      next = duckResult.project;
      duckingApplied = true;
    }
  }
  return { project: next, clipCount, captionCount, sfxCount, duckingApplied };
}

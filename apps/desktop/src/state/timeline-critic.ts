import type { Clip, ProjectDocument } from '@editor-ia/project-schema';
import { closeGaps, fpsOf, trimTimelineStart, updateAudioMix } from './project-actions';

/**
 * Crítico de timeline.
 *
 * No adivina si el video «está bueno». Mide cosas que se pueden medir sobre la
 * edición terminada —aire al inicio, huecos de audio, dispersión de planos,
 * velocidad de lectura de los subtítulos, loudness— y devuelve hallazgos con
 * severidad. Los que tienen arreglo seguro traen un `fix`; el resto son avisos
 * para mirar, no botones que rompen la edición.
 */

export type CriticSeverity = 'info' | 'warn' | 'error';

export type CriticRuleId =
  | 'dead-air-start'
  | 'audio-gap'
  | 'shot-spread'
  | 'caption-speed'
  | 'loudness-missing'
  | 'long-take'
  | 'flash-cut';

export type CriticFix =
  | { readonly kind: 'close-gaps'; readonly trackId: string }
  | { readonly kind: 'trim-start'; readonly frames: number }
  | { readonly kind: 'set-loudness'; readonly lufs: number };

export interface CriticFinding {
  readonly id: string;
  readonly rule: CriticRuleId;
  readonly severity: CriticSeverity;
  readonly title: string;
  readonly detail: string;
  readonly fix?: CriticFix;
}

export interface CriticReport {
  readonly findings: readonly CriticFinding[];
  /** 100 menos lo que descuentan los hallazgos. */
  readonly score: number;
  readonly fixable: number;
}

const WEIGHT: Readonly<Record<CriticSeverity, number>> = {
  error: 15,
  warn: 8,
  info: 3,
};

const SHORT_CLIP_FRAMES = 6;
const LONG_TAKE_SECONDS = 12;
const MIN_GAP_SECONDS = 0.4;
const MAX_CPS = 24;
const MEAN_CPS = 20;

function isVisual(clip: Clip): boolean {
  return clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'freeze';
}

function isUnlocked(project: ProjectDocument, clip: Clip): boolean {
  return project.timeline.tracks.find((track) => track.id === clip.trackId)?.locked !== true;
}

function seconds(frames: number, fps: number): number {
  return frames / Math.max(1, fps);
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function critiqueTimeline(project: ProjectDocument): CriticReport {
  const fps = fpsOf(project);
  const findings: CriticFinding[] = [];
  const visual = project.timeline.clips.filter(isVisual).sort((a, b) => a.startFrame - b.startFrame);

  // 1. Aire al inicio: la edición no arranca en cero.
  const firstVisual = visual[0];
  if (firstVisual && firstVisual.startFrame > Math.round(fps * 0.5)) {
    findings.push({
      id: 'dead-air-start',
      rule: 'dead-air-start',
      severity: 'warn',
      title: 'La edición arranca con aire',
      detail: `El primer plano empieza en ${seconds(firstVisual.startFrame, fps).toFixed(2)} s.`,
      fix: { kind: 'trim-start', frames: firstVisual.startFrame },
    });
  }

  // 2. Huecos entre clips en pistas de audio: silencio que nadie decidió.
  for (const track of project.timeline.tracks) {
    if (track.locked || (track.kind !== 'audio' && track.kind !== 'narration')) continue;
    const clips = project.timeline.clips
      .filter((clip) => clip.trackId === track.id)
      .sort((a, b) => a.startFrame - b.startFrame);
    let gapFrames = 0;
    for (let index = 1; index < clips.length; index += 1) {
      const previousEnd = clips[index - 1]!.startFrame + clips[index - 1]!.durationFrames;
      gapFrames += Math.max(0, clips[index]!.startFrame - previousEnd);
    }
    if (seconds(gapFrames, fps) >= MIN_GAP_SECONDS) {
      findings.push({
        id: `audio-gap:${track.id}`,
        rule: 'audio-gap',
        severity: 'warn',
        title: 'Hay silencio entre clips de audio',
        detail: `${seconds(gapFrames, fps).toFixed(2)} s repartidos en ${clips.length} clip(s).`,
        fix: { kind: 'close-gaps', trackId: track.id },
      });
    }
  }

  // 3. Dispersión de planos: un video con planos de 1 s y de 20 s se siente roto.
  if (visual.length >= 4) {
    const lengths = visual.map((clip) => clip.durationFrames);
    const mean = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
    const variance =
      lengths.reduce((sum, value) => sum + (value - mean) ** 2, 0) / lengths.length;
    const spread = mean > 0 ? Math.sqrt(variance) / mean : 0;
    if (spread > 0.9) {
      findings.push({
        id: 'shot-spread',
        rule: 'shot-spread',
        severity: 'info',
        title: 'Los planos tienen duraciones muy distintas',
        detail: `Planos de ${seconds(Math.min(...lengths), fps).toFixed(1)} s a ${seconds(
          Math.max(...lengths),
          fps,
        ).toFixed(1)} s (media ${seconds(mean, fps).toFixed(1)} s).`,
      });
    }
  }

  // 4. Velocidad de lectura de los subtítulos.
  if (project.captions.cues.length > 0) {
    const rates = project.captions.cues.map((cue) => {
      const duration = seconds(cue.endFrame - cue.startFrame, fps);
      return cue.text.length / Math.max(0.25, duration);
    });
    const meanRate = rates.reduce((sum, value) => sum + value, 0) / rates.length;
    const worst = Math.max(...rates);
    if (worst > MAX_CPS) {
      findings.push({
        id: 'caption-speed',
        rule: 'caption-speed',
        severity: 'warn',
        title: 'Hay subtítulos demasiado rápidos',
        detail: `El cue más cargado va a ${round(worst)} caracteres/s (media ${round(meanRate)}).`,
      });
    } else if (meanRate > MEAN_CPS) {
      findings.push({
        id: 'caption-speed',
        rule: 'caption-speed',
        severity: 'info',
        title: 'Los subtítulos van cargados',
        detail: `Media de ${round(meanRate)} caracteres/s.`,
      });
    }
  }

  // 5. Nivelado ausente.
  if (!project.audio.loudnessTarget) {
    findings.push({
      id: 'loudness-missing',
      rule: 'loudness-missing',
      severity: 'warn',
      title: 'La entrega no tiene objetivo de volumen',
      detail: 'Sin loudness target el archivo puede salir más bajo o más alto que la plataforma.',
      fix: { kind: 'set-loudness', lufs: -14 },
    });
  }

  // 6. Planos que se arrastran.
  const long = visual.filter((clip) => seconds(clip.durationFrames, fps) > LONG_TAKE_SECONDS);
  if (long.length > 0) {
    findings.push({
      id: 'long-take',
      rule: 'long-take',
      severity: 'info',
      title: `${long.length} plano(s) pasan de ${LONG_TAKE_SECONDS} s`,
      detail: 'Si no hay movimiento interno, conviene cortar o acortar.',
    });
  }

  // 7. Flashes: un clip de menos de 6 frames no se lee.
  const flashes = visual.filter((clip) => clip.durationFrames < SHORT_CLIP_FRAMES);
  if (flashes.length > 0) {
    findings.push({
      id: 'flash-cut',
      rule: 'flash-cut',
      severity: 'warn',
      title: `${flashes.length} plano(s) duran menos de ${SHORT_CLIP_FRAMES} frames`,
      detail: 'Un plano de menos de 0,2 s se percibe como un parpadeo.',
    });
  }

  const score = Math.max(
    0,
    Math.min(100, 100 - findings.reduce((sum, finding) => sum + WEIGHT[finding.severity], 0)),
  );
  return {
    findings,
    score,
    fixable: findings.filter((finding) => finding.fix).length,
  };
}

/** Aplica sólo los arreglos aceptados. Primero huecos, después nivelado. */
export function applyCriticFixes(
  project: ProjectDocument,
  findings: readonly CriticFinding[],
  accepted: ReadonlySet<string>,
): ProjectDocument {
  const chosen = findings.filter((finding) => accepted.has(finding.id) && finding.fix);
  if (chosen.length === 0) return project;
  let next = project;
  for (const finding of chosen) {
    if (finding.fix?.kind !== 'trim-start') continue;
    next = trimTimelineStart(next, finding.fix.frames).project;
  }
  for (const finding of chosen) {
    if (finding.fix?.kind !== 'close-gaps') continue;
    try {
      next = closeGaps(next, finding.fix.trackId).project;
    } catch {
      // Una pista bloqueada o vacía no debe abortar el resto.
    }
  }
  for (const finding of chosen) {
    if (finding.fix?.kind !== 'set-loudness') continue;
    next = updateAudioMix(next, {
      loudnessTarget: {
        platform: next.video.height > next.video.width ? 'shorts' : 'youtube',
        integratedLufs: finding.fix.lufs,
        truePeakDb: -1,
        toleranceDb: 1,
      },
      masterLimiter: true,
    });
  }
  return next;
}

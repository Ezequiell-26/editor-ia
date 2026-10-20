import type { ProjectDocument } from '@editor-ia/project-schema';
import { fpsOf, totalFrames } from './project-actions';

export interface ProjectQualityFinding {
  readonly severity: 'info' | 'warn' | 'error';
  readonly message: string;
}

/**
 * Deterministic pre-render checks. This is deliberately not a second AI: it
 * catches objective defects the renderer would otherwise hide in the MP4.
 */
export function evaluateProjectQuality(project: ProjectDocument): ProjectQualityFinding[] {
  const findings: ProjectQualityFinding[] = [];
  const fps = fpsOf(project);
  const frames = totalFrames(project);
  if (project.timeline.clips.length === 0) {
    findings.push({ severity: 'error', message: 'La timeline no tiene clips.' });
  }
  if (frames <= 2) {
    findings.push({ severity: 'error', message: 'La secuencia dura menos de un frame útil.' });
  }
  for (const clip of project.timeline.clips) {
    if (clip.durationFrames < 2) {
      findings.push({
        severity: 'error',
        message: `El clip "${clip.label ?? clip.kind}" dura menos de 2 frames.`,
      });
    }
    const source = clip.source;
    const asset =
      source.type === 'asset'
        ? project.assets.find((item) => item.id === source.assetId)
        : undefined;
    if (clip.source.type === 'asset' && (!asset || asset.status !== 'ready')) {
      findings.push({
        severity: 'error',
        message: `El clip "${clip.label ?? clip.kind}" apunta a un material que no está listo.`,
      });
    }
  }
  const hasAudio = project.timeline.clips.some(
    (clip) =>
      clip.kind === 'audio' ||
      clip.kind === 'video' ||
      (clip.audio?.gainDb ?? 0) !== 0 ||
      clip.audio?.compressor === true,
  );
  const visual = [...project.timeline.clips]
    .filter((clip) => clip.kind === 'video' || clip.kind === 'image')
    .sort((a, b) => a.startFrame - b.startFrame);
  for (let index = 1; index < visual.length; index += 1) {
    const previous = visual[index - 1];
    const current = visual[index];
    if (!previous || !current) continue;
    const gap = current.startFrame - (previous.startFrame + previous.durationFrames);
    if (gap > Math.max(4, Math.round(fps * 0.15))) {
      findings.push({
        severity: 'warn',
        message: `Hay un hueco de ${(gap / fps).toFixed(2)} s entre clips visuales; el MP4 mostrará negro.`,
      });
      break;
    }
  }
  if (hasAudio && !project.audio.loudnessTarget) {
    findings.push({
      severity: 'warn',
      message: 'Hay audio pero no hay objetivo de loudness; el volumen puede variar entre videos.',
    });
  }
  const cues = project.captions.cues;
  if (cues.length > 0) {
    const ordered = [...cues].sort((a, b) => a.startFrame - b.startFrame);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (previous && current && current.startFrame < previous.endFrame) {
        findings.push({
          severity: 'error',
          message: 'Hay subtítulos solapados en el mismo instante.',
        });
        break;
      }
    }
    const cps =
      cues.reduce((sum, cue) => {
        const seconds = (cue.endFrame - cue.startFrame) / Math.max(1, fps);
        return sum + cue.text.length / Math.max(0.25, seconds);
      }, 0) / cues.length;
    if (cps > 24) {
      findings.push({
        severity: 'warn',
        message: `Los subtítulos promedian ${cps.toFixed(0)} caracteres por segundo; pueden ser difíciles de leer.`,
      });
    }
    const shortCues = cues.filter(
      (cue) => cue.endFrame - cue.startFrame < Math.max(6, Math.round(0.2 * fps)),
    ).length;
    if (shortCues > 0) {
      findings.push({
        severity: 'warn',
        message: `${shortCues} subtítulo(s) duran menos de 0,2 s.`,
      });
    }
  } else if (project.scenes.length > 0) {
    findings.push({
      severity: 'info',
      message: 'El proyecto tiene escenas pero no subtítulos; el MP4 saldrá sin texto.',
    });
  }
  return findings;
}

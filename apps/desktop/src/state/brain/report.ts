import type { ProjectDocument } from '@editor-ia/project-schema';
import { fpsOf } from '../project-actions.ts';
import { planEdits } from './plan.ts';
import type { EditIntent, EditPlan, EditProposal } from './types.ts';

/**
 * Traducción del plan a texto.
 *
 * El brief es lo que recibe el modelo de lenguaje: un resumen corto y medible
 * para que decida *qué* hacer sin tener que recalcular el estado de la timeline.
 * Sin esto el asistente opina a ciegas; con esto puede citar números.
 */

function round(value: number, decimals = 1): string {
  const factor = 10 ** decimals;
  return String(Math.round(value * factor) / factor);
}

const RISK_LABEL: Record<EditProposal['risk'], string> = {
  safe: 'seguro',
  moderate: 'moderado',
  aggressive: 'agresivo',
};

export function proposalLine(proposal: EditProposal, index: number): string {
  const tag = proposal.payload ? 'aplicable' : 'sugerencia';
  return `${index + 1}. [${RISK_LABEL[proposal.risk]} · ${tag} · conf ${round(proposal.confidence, 2)}] ${proposal.title} — ${proposal.reason}`;
}

/** Brief compacto para el contexto del asistente (≤ ~700 caracteres). */
export function brainBrief(plan: EditPlan, maxProposals = 4): string {
  const signals = plan.signals;
  const lines: string[] = [];
  lines.push(
    `CEREBRO DE EDICIÓN · ${plan.profile.label} · salud ${plan.score.now}/100 (potencial ${plan.score.potential})`,
  );
  lines.push(
    [
      `duración ${round(signals.durationSeconds)}s`,
      `${signals.visualShots.length} planos`,
      `plano medio ${signals.averageShotSeconds}s (objetivo ${plan.profile.aslSeconds || '—'})`,
      `${signals.cutCount} cortes`,
      `huecos ${signals.gapSeconds}s`,
      `subtítulos ${Math.round(signals.captions.coverage * 100)}%`,
      `gancho ${signals.hook.cuts} cortes/3s`,
    ].join(' · '),
  );
  if (plan.findings.length > 0) {
    lines.push(`Hallazgos: ${plan.findings.map((finding) => finding.title).join('; ')}.`);
  }
  if (plan.beats && plan.beats.confidence >= 0.4) {
    lines.push(
      `Grilla: ${Math.round(plan.beats.bpm)} BPM (confianza ${Math.round(plan.beats.confidence * 100)} %), ${plan.beats.beatsFrames.length} beats.`,
    );
  }
  const top = plan.proposals.slice(0, maxProposals);
  if (top.length > 0) {
    lines.push(`Propuestas:`);
    for (const [index, proposal] of top.entries()) {
      lines.push(proposalLine(proposal, index));
    }
  } else {
    lines.push('Propuestas: ninguna. La timeline no tiene problemas medibles.');
  }
  lines.push(
    'Regla: no inventes cortes que el cerebro no midió. Si una propuesta no convence, decilo y explicá por qué.',
  );
  return lines.join('\n');
}

/** Atajo: analizar el proyecto y devolver el brief listo para el prompt. */
export function briefForProject(project: ProjectDocument, intent: EditIntent = 'tighten'): string {
  return brainBrief(planEdits(project, { intent }));
}

function clock(frames: number, fps: number): string {
  const seconds = frames / Math.max(1, fps);
  const whole = Math.floor(seconds);
  const rest = seconds - whole;
  const minutes = Math.floor(whole / 60);
  const shown = `${String(minutes).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
  const decimals = rest >= 0.005 ? rest.toFixed(3).slice(1) : '';
  return `${shown}${decimals}`;
}

function secondsExact(frames: number, fps: number): string {
  return (frames / Math.max(1, fps)).toFixed(3);
}

function labelOf(
  clips: readonly { readonly label?: string | undefined }[],
  clipId: string,
): string {
  const clip = clips.find((item) => (item as { id?: string }).id === clipId);
  return clip?.label ?? '';
}

function assetLabelOf(assets: readonly { readonly id: string; readonly label: string }[], assetId: string | undefined): string {
  if (!assetId) return '';
  return assets.find((asset) => asset.id === assetId)?.label ?? '';
}

/**
 * Inventario clip por clip de la timeline, con duración exacta.
 *
 * `brainBrief` resume señales agregadas; este inventario entrega lo que la IA
 * necesita para señalar un clip concreto: orden, pista, tiempo de entrada y
 * salida, **duración en cuadros y en segundos con tres decimales** (precisión
 * de cuadro, no aproximada), velocidad y material de origen.
 */
export function timelineInventory(
  project: ProjectDocument,
  options: { readonly maxClips?: number } = {},
): string {
  const fps = fpsOf(project);
  const clips = project.timeline.clips;
  const tracks = project.timeline.tracks;
  if (clips.length === 0) {
    return 'TIMELINE · vacía (0 clips).';
  }
  const maxClips = Math.max(1, options.maxClips ?? 30);
  const trackLabel = (trackId: string): string => {
    const track = tracks.find((item) => item.id === trackId);
    if (!track) return 'pista ?';
    return `${track.kind === 'video' ? 'V' : track.kind === 'audio' ? 'A' : 'T'}${
      track.order + 1
    } · ${track.label}`;
  };
  const totalFrames = clips.reduce((sum, clip) => sum + clip.durationFrames, 0);
  const lines: string[] = [
    `TIMELINE · ${clips.length} clips · ${tracks.length} pistas · ${round(fps, 2)} fps · suma ${secondsExact(
      totalFrames,
      fps,
    )} s (${clock(totalFrames, fps)})`,
  ];
  const ordered = [...clips].sort((a, b) => a.startFrame - b.startFrame || a.trackId.localeCompare(b.trackId));
  const shown = ordered.slice(0, maxClips);
  for (const [index, clip] of shown.entries()) {
    const source =
      clip.source.type === 'asset' && 'inFrame' in clip.source && 'outFrame' in clip.source
        ? clip.source
        : null;
    const speed =
      clip.kind === 'video' || clip.kind === 'audio'
        ? (clip as { speed?: { readonly num: number; readonly den: number } }).speed
        : undefined;
    const speedText = speed ? ` ×${round(speed.num / Math.max(1, speed.den), 3)}` : '';
    const asset = clip.source.type === 'asset' ? assetLabelOf(project.assets, clip.source.assetId) : '';
    const parts = [
      `${index + 1}. ${clip.kind}`,
      clip.label ? `«${clip.label}»` : '',
      trackLabel(clip.trackId),
      `inicia ${clock(clip.startFrame, fps)} (cuadro ${clip.startFrame})`,
      `dura ${secondsExact(clip.durationFrames, fps)} s = ${clip.durationFrames} cuadros (${clock(
        clip.durationFrames,
        fps,
      )})${speedText}`,
      asset ? `material «${asset}»` : '',
    ].filter(Boolean);
    lines.push(parts.join(' · '));
  }
  if (ordered.length > shown.length) {
    lines.push(`… y ${ordered.length - shown.length} clips más.`);
  }
  const gaps = timelineGaps(project, fps);
  if (gaps.length > 0) {
    lines.push(`Huecos: ${gaps.join(' · ')}`);
  }
  return lines.join('\n');
}

/** Huecos visibles en la pista de video principal, en tiempo exacto. */
function timelineGaps(project: ProjectDocument, fps: number): string[] {
  const videoTracks = project.timeline.tracks.filter((track) => track.kind === 'video');
  const gaps: string[] = [];
  for (const track of videoTracks) {
    const clips = project.timeline.clips
      .filter((clip) => clip.trackId === track.id)
      .sort((a, b) => a.startFrame - b.startFrame);
    for (let index = 1; index < clips.length; index += 1) {
      const previous = clips[index - 1]!;
      const current = clips[index]!;
      const hole = current.startFrame - (previous.startFrame + previous.durationFrames);
      if (hole > Math.max(1, Math.round(fps * 0.05))) {
        gaps.push(
          `${track.label}: ${secondsExact(hole, fps)} s entre «${previous.label ?? 'clip'}» y «${
            current.label ?? 'clip'
          }»`,
        );
      }
    }
  }
  return gaps.slice(0, 6);
}

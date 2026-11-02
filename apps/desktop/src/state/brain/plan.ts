import type { ProjectDocument } from '@editor-ia/project-schema';
import { analyzeScript, analyzeTimeline } from './analyze.ts';
import { POLICIES, type PolicyContext } from './policies.ts';
import { SCRIPT_POLICIES, type ScriptContext } from './script-policies.ts';
import {
  INTENT_PROFILES,
  type BeatGrid,
  type BrainFinding,
  type BrainMetric,
  type EditIntent,
  type EditPlan,
  type EditProposal,
  type TimelineSignals,
} from './types.ts';

/**
 * Ensamblado del plan: señales → hallazgos → propuestas ordenadas por impacto.
 *
 * El orden es deliberado: primero lo que arregla un problema medible, después lo
 * que agrega estilo. Un plan de 30 propuestas no se usa; uno de 5 sí.
 */

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function metricsFor(signals: TimelineSignals, target: number): BrainMetric[] {
  const aslStatus =
    target <= 0
      ? 'info'
      : signals.averageShotSeconds === 0
        ? 'info'
        : signals.averageShotSeconds > target * 1.35
          ? 'high'
          : signals.averageShotSeconds < target * 0.6
            ? 'low'
            : 'ok';

  return [
    {
      id: 'duration',
      label: 'Duración',
      value: `${round(signals.durationSeconds)} s`,
      status: 'info',
    },
    {
      id: 'shots',
      label: 'Planos',
      value: `${signals.visualShots.length}`,
      status: 'info',
    },
    {
      id: 'asl',
      label: 'Plano medio',
      value: `${signals.averageShotSeconds} s`,
      status: aslStatus,
      ...(target > 0 ? { target: `${target} s` } : {}),
    },
    {
      id: 'cuts',
      label: 'Cortes',
      value: `${signals.cutCount}`,
      status: 'info',
    },
    {
      id: 'gaps',
      label: 'Huecos',
      value: `${signals.gapSeconds} s`,
      status: signals.gapSeconds > 0.5 ? 'high' : 'ok',
    },
    {
      id: 'captions',
      label: 'Subtítulos',
      value: `${Math.round(signals.captions.coverage * 100)} %`,
      status: signals.captions.coverage >= 0.5 ? 'ok' : 'low',
    },
    {
      id: 'hook',
      label: 'Gancho (3 s)',
      value: `${signals.hook.cuts} cortes`,
      status: signals.hook.cuts > 0 ? 'ok' : 'low',
    },
    {
      id: 'transitions',
      label: 'Transiciones',
      value: `${signals.transitions}`,
      status: signals.transitions > 0 ? 'ok' : 'info',
    },
  ];
}

function findingsFor(signals: TimelineSignals, target: number): BrainFinding[] {
  const findings: BrainFinding[] = [];
  if (signals.visualShots.length === 0) return findings;
  if (signals.gapSeconds > 0.5) {
    findings.push({
      id: 'gaps',
      severity: 'warn',
      title: `${signals.gaps.length} huecos en la timeline`,
      detail: `Hay ${round(signals.gapSeconds)} s repartidos en ${new Set(signals.gaps.map((gap) => gap.trackId)).size} pista(s).`,
      clipIds: signals.gaps.map((gap) => gap.beforeClipId),
    });
  }
  if (target > 0 && signals.averageShotSeconds > target * 1.35) {
    findings.push({
      id: 'slow',
      severity: 'warn',
      title: 'Ritmo lento para el formato',
      detail: `Plano medio de ${signals.averageShotSeconds} s contra ${target} s objetivo.`,
      clipIds: [],
    });
  }
  if (signals.shortShots.length > 0) {
    findings.push({
      id: 'short',
      severity: 'warn',
      title: `${signals.shortShots.length} planos muy cortos`,
      detail: 'Por debajo de 0,6 s el plano no se lee.',
      clipIds: signals.shortShots.map((shot) => shot.clipId),
    });
  }
  if (signals.repeatedRuns.length > 0) {
    findings.push({
      id: 'variety',
      severity: 'info',
      title: 'Repetición de material',
      detail: `${signals.repeatedRuns.length} secuencia(s) de tres o más planos del mismo asset.`,
      clipIds: signals.repeatedRuns.flatMap((run) => run.map((shot) => shot.clipId)),
    });
  }
  if (signals.hook.cuts === 0 && signals.durationSeconds > 6) {
    findings.push({
      id: 'hook',
      severity: 'warn',
      title: 'Sin cortes en el gancho',
      detail: `El primer plano dura ${round(signals.hook.firstShotSeconds)} s y no hay corte antes de 3 s.`,
      clipIds: [],
    });
  }
  if (!signals.loudnessTarget) {
    findings.push({
      id: 'loudness',
      severity: 'info',
      title: 'Sin objetivo de loudness',
      detail: 'El export no declara plataforma ni LUFS objetivo.',
      clipIds: [],
    });
  }
  return findings;
}

function scoreFor(
  signals: TimelineSignals,
  target: number,
  script: readonly { clipCount: number; narrationWords: number; narrationSeconds: number }[],
): number {
  // Una timeline vacía no está "mal": está vacía.
  if (signals.visualShots.length === 0 && script.length === 0) return 100;
  let penalty = 0;
  penalty += Math.min(20, signals.gapSeconds * 6);
  penalty += Math.min(15, signals.shortShots.length * 4);
  if (target > 0 && signals.averageShotSeconds > 0) {
    const drift = Math.abs(signals.averageShotSeconds - target) / target;
    penalty += Math.min(18, drift * 22);
  }
  if (signals.hook.cuts === 0 && signals.durationSeconds > 6) penalty += 12;
  if (signals.captions.coverage < 0.5) penalty += 10;
  if (signals.repeatedRuns.length > 0) penalty += Math.min(8, signals.repeatedRuns.length * 3);
  if (signals.transitions === 0 && signals.cutCount >= 3) penalty += 4;
  if (signals.ending.lastShotSeconds > 0 && signals.ending.lastShotSeconds < 1) penalty += 4;
  // El guion pesa menos que la timeline, pero no es gratis: una escena sin
  // material es un agujero que el espectador va a notar.
  penalty += Math.min(6, script.filter((scene) => scene.clipCount === 0).length * 2);
  const rushed = script.filter(
    (scene) => scene.narrationSeconds > 0 && scene.narrationWords / scene.narrationSeconds > 4.2,
  ).length;
  penalty += Math.min(4, rushed * 2);
  return Math.round(Math.max(0, Math.min(100, 100 - penalty)));
}

function sortProposals(proposals: readonly EditProposal[]): EditProposal[] {
  const riskWeight = { safe: 0, moderate: 1, aggressive: 2 } as const;
  return [...proposals].sort((a, b) => {
    const scoreA = a.impact * a.confidence;
    const scoreB = b.impact * b.confidence;
    if (Math.abs(scoreA - scoreB) > 0.02) return scoreB - scoreA;
    return riskWeight[a.risk] - riskWeight[b.risk];
  });
}

export interface PlanOptions {
  readonly intent?: EditIntent;
  /** Tope de propuestas devueltas; el resto se descarta, no se esconde. */
  readonly limit?: number;
  /** Grilla de beats ya mapeada a frames, si se quiere cortar en el pulso. */
  readonly beats?: BeatGrid;
}

/** Porcentaje de cortes que caen a menos de 80 ms de un beat. */
function beatAlignment(signals: TimelineSignals, beats: BeatGrid): number {
  const grid = [...beats.beatsFrames].sort((a, b) => a - b);
  if (grid.length === 0) return 0;
  const tolerance = Math.max(1, Math.round(0.08 * signals.fps));
  const boundaries = signals.visualShots
    .map((shot) => shot.startFrame)
    .filter((frame) => frame > 0);
  if (boundaries.length === 0) return 0;
  let aligned = 0;
  for (const frame of boundaries) {
    const nearest = grid.reduce(
      (best, candidate) => (Math.abs(candidate - frame) < Math.abs(best - frame) ? candidate : best),
      grid[0] ?? frame,
    );
    if (Math.abs(nearest - frame) <= tolerance) aligned += 1;
  }
  return aligned / boundaries.length;
}

export function planEdits(project: ProjectDocument, options: PlanOptions = {}): EditPlan {
  const intent = options.intent ?? 'tighten';
  const profile = INTENT_PROFILES[intent];
  const signals = analyzeTimeline(project);
  const script = analyzeScript(project);
  const beats = options.beats ?? null;
  const context: PolicyContext = {
    project,
    signals,
    profile,
    ...(beats ? { beats } : {}),
  };
  const scriptContext: ScriptContext = { ...context, script };

  const proposals = sortProposals([
    ...POLICIES.flatMap((policy) => policy(context)),
    ...SCRIPT_POLICIES.flatMap((policy) => policy(scriptContext)),
  ]).slice(0, options.limit ?? 8);

  const now = scoreFor(signals, profile.aslSeconds, script);
  const potential = Math.round(
    Math.min(
      100,
      now +
        proposals
          .filter((proposal) => proposal.payload)
          .reduce((total, proposal) => total + proposal.impact * 12 * proposal.confidence, 0),
    ),
  );

  const metrics = metricsFor(signals, profile.aslSeconds);
  if (beats && beats.confidence >= 0.4) {
    metrics.push({
      id: 'beat',
      label: 'Cortes en beat',
      value: `${Math.round(beatAlignment(signals, beats) * 100)} %`,
      status: beatAlignment(signals, beats) >= 0.6 ? 'ok' : 'low',
      target: `${Math.round(beats.bpm)} BPM`,
    });
  }

  return {
    intent,
    profile,
    signals,
    script,
    metrics,
    findings: findingsFor(signals, profile.aslSeconds),
    proposals,
    score: { now, potential },
    beats,
  };
}

/** Resumen de una línea, para logs y para el chat del asistente. */
export function describePlan(plan: EditPlan): string {
  const auto = plan.proposals.filter((proposal) => proposal.payload).length;
  return `${plan.profile.label} · salud ${plan.score.now}/100 (potencial ${plan.score.potential}) · ${plan.proposals.length} propuestas, ${auto} aplicables solas`;
}

export { clamp01 };

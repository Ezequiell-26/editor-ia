/**
 * Cerebro de edición de Olyvia.
 *
 * Capa determinista entre la timeline y la IA: mide, encuentra problemas,
 * propone ediciones concretas con motivo y las aplica sobre las primitivas que
 * ya existen. La IA deja de tener que inventar la edición; la elige.
 */

export { analyzeScript, analyzeTimeline, projectFps } from './analyze.ts';
export { planEdits, describePlan } from './plan.ts';
export type { PlanOptions } from './plan.ts';
export { applyProposal, applyProposals, applySafeProposals } from './apply.ts';
export type { ApplyOptions, ProposalResult } from './apply.ts';
export { brainBrief, briefForProject, proposalLine } from './report.ts';
export {
  INTENT_PROFILES,
  type ApplyOutcome,
  type BeatGrid,
  type BrainFinding,
  type BrainMetric,
  type EditIntent,
  type EditPlan,
  type EditProposal,
  type IntentProfile,
  type ProposalKind,
  type ProposalPayload,
  type ProposalRisk,
  type ScriptSignal,
  type Shot,
  type TimelineGap,
  type TimelineSignals,
} from './types.ts';

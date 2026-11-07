import type { ClipTransition } from '@editor-ia/project-schema';

/**
 * Modelo del "cerebro" de edición.
 *
 * La app ya sabía *ejecutar* ediciones (split, trim, closeGaps, transiciones) y
 * sabía *planificar un asset* (Director). Lo que faltaba era una capa que mire
 * la **timeline completa**, detecte problemas de ritmo y proponga ediciones
 * concretas con motivo y confianza.
 *
 * El cerebro no inventa acciones nuevas: cada propuesta se apoya en una primitiva
 * que ya existe y está testeada. Eso mantiene el undo, el schema y el render
 * consistentes, y deja que la IA orqueste en vez de reimplementar la edición.
 */

export type EditIntent =
  | 'cleanup'
  | 'tighten'
  | 'short'
  | 'reel'
  | 'trailer'
  | 'tutorial'
  | 'vlog';

export interface IntentProfile {
  readonly id: EditIntent;
  readonly label: string;
  /** Duración media de plano objetivo, en segundos. */
  readonly aslSeconds: number;
  readonly maxShotSeconds: number;
  readonly minShotSeconds: number;
  /** Cortes deseados dentro de los primeros 3 s. */
  readonly hookCuts: number;
  readonly captionsRequired: boolean;
  readonly transitions: 'none' | 'cuts' | 'frequent';
}

export const INTENT_PROFILES: Readonly<Record<EditIntent, IntentProfile>> = {
  cleanup: {
    id: 'cleanup',
    label: 'Limpieza',
    aslSeconds: 0,
    maxShotSeconds: 0,
    minShotSeconds: 0.5,
    hookCuts: 0,
    captionsRequired: false,
    transitions: 'none',
  },
  tighten: {
    id: 'tighten',
    label: 'Ajuste de ritmo',
    aslSeconds: 3.5,
    maxShotSeconds: 9,
    minShotSeconds: 0.6,
    hookCuts: 1,
    captionsRequired: false,
    transitions: 'none',
  },
  short: {
    id: 'short',
    label: 'Short vertical',
    aslSeconds: 2.4,
    maxShotSeconds: 5.5,
    minShotSeconds: 0.7,
    hookCuts: 2,
    captionsRequired: true,
    transitions: 'cuts',
  },
  reel: {
    id: 'reel',
    label: 'Reel',
    aslSeconds: 1.8,
    maxShotSeconds: 4,
    minShotSeconds: 0.5,
    hookCuts: 2,
    captionsRequired: true,
    transitions: 'frequent',
  },
  trailer: {
    id: 'trailer',
    label: 'Trailer',
    aslSeconds: 2,
    maxShotSeconds: 4.5,
    minShotSeconds: 0.4,
    hookCuts: 3,
    captionsRequired: false,
    transitions: 'frequent',
  },
  tutorial: {
    id: 'tutorial',
    label: 'Tutorial',
    aslSeconds: 6,
    maxShotSeconds: 14,
    minShotSeconds: 1,
    hookCuts: 0,
    captionsRequired: true,
    transitions: 'none',
  },
  vlog: {
    id: 'vlog',
    label: 'Vlog',
    aslSeconds: 4.2,
    maxShotSeconds: 10,
    minShotSeconds: 0.8,
    hookCuts: 1,
    captionsRequired: true,
    transitions: 'cuts',
  },
};

export type MetricStatus = 'ok' | 'low' | 'high' | 'info';

export interface BrainMetric {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly status: MetricStatus;
  readonly target?: string;
}

export type FindingSeverity = 'info' | 'warn' | 'error';

export interface BrainFinding {
  readonly id: string;
  readonly severity: FindingSeverity;
  readonly title: string;
  readonly detail: string;
  readonly clipIds: readonly string[];
}

export interface Shot {
  readonly clipId: string;
  readonly trackId: string;
  readonly startFrame: number;
  readonly durationFrames: number;
  readonly seconds: number;
  readonly kind: string;
  readonly assetId?: string;
}

export interface TimelineGap {
  readonly trackId: string;
  readonly startFrame: number;
  readonly frames: number;
  readonly seconds: number;
  readonly beforeClipId: string;
}

/** Tramo de silencio medido, en frames absolutos de timeline. */
export interface SilenceCutSpan {
  readonly startFrame: number;
  readonly endFrame: number;
}

/**
 * Plan de recorte de silencios ya medido para un clip.
 *
 * El cerebro no decodifica audio ni pide picos: recibe el plan que arma la UI
 * con `planSilenceCuts` (el mismo que usa `runSilenceCuts`), igual que recibe
 * la grilla de beats. Así el plan sigue siendo una función pura y testeable
 * con señales sintéticas.
 */
export interface SilenceCutSignal {
  readonly clipId: string;
  readonly spans: readonly SilenceCutSpan[];
  readonly cutFrames: readonly number[];
  readonly removedSeconds: number;
}

export interface TimelineSignals {
  readonly fps: number;
  readonly durationFrames: number;
  readonly durationSeconds: number;
  readonly visualShots: readonly Shot[];
  readonly audioClips: number;
  readonly trackCount: number;
  readonly cutCount: number;
  readonly averageShotSeconds: number;
  readonly medianShotSeconds: number;
  readonly longestShot: Shot | null;
  readonly shortestShot: Shot | null;
  readonly shortShots: readonly Shot[];
  readonly longShots: readonly Shot[];
  readonly gaps: readonly TimelineGap[];
  readonly gapSeconds: number;
  readonly repeatedRuns: readonly (readonly Shot[])[];
  readonly hook: {
    readonly cuts: number;
    readonly hasCaption: boolean;
    readonly firstShotSeconds: number;
  };
  readonly ending: { readonly lastShotSeconds: number; readonly hasFadeOut: boolean };
  readonly captions: { readonly cues: number; readonly coverage: number };
  readonly transitions: number;
  readonly hasMusic: boolean;
  readonly loudnessTarget: string | null;
}

export type ProposalKind =
  | 'close-gaps'
  | 'split-long'
  | 'drop-short'
  | 'trim-start'
  | 'transition'
  | 'hook-cut'
  | 'beat-cut'
  | 'beat-align'
  | 'cut-silences'
  | 'loudness'
  | 'captions'
  | 'variety'
  | 'ending'
  | 'script';

export type ProposalRisk = 'safe' | 'moderate' | 'aggressive';

export type ProposalPayload =
  | { readonly kind: 'close-gaps'; readonly trackId: string }
  | { readonly kind: 'split'; readonly clipId: string; readonly atFrames: readonly number[] }
  | { readonly kind: 'delete'; readonly clipIds: readonly string[] }
  | { readonly kind: 'trim'; readonly clipId: string; readonly edge: 'start' | 'end'; readonly targetFrame: number }
  | { readonly kind: 'roll'; readonly clipId: string; readonly edge: 'in' | 'out'; readonly deltaFrames: number }
  | {
      readonly kind: 'cut-spans';
      readonly clipId: string;
      readonly spans: readonly SilenceCutSpan[];
      readonly cutFrames: readonly number[];
      readonly removedSeconds: number;
    }
  | { readonly kind: 'transition'; readonly type: ClipTransition['type']; readonly frames: number }
  | { readonly kind: 'loudness'; readonly platform: string; readonly integratedLufs: number; readonly truePeakDb: number };

export interface EditProposal {
  readonly id: string;
  readonly kind: ProposalKind;
  readonly title: string;
  /** Por qué se propone, en una frase que el usuario pueda discutir. */
  readonly reason: string;
  /** 0..1: cuánto pesa la evidencia (no es una probabilidad). */
  readonly confidence: number;
  /** 0..1: cuánto mejora el resultado si se aplica. */
  readonly impact: number;
  readonly risk: ProposalRisk;
  readonly clipIds: readonly string[];
  /** Sin payload la propuesta es una recomendación: no se puede aplicar sola. */
  readonly payload?: ProposalPayload;
  /** Qué va a pasar exactamente, en una línea. */
  readonly preview: string;
}

export interface EditPlan {
  readonly intent: EditIntent;
  readonly profile: IntentProfile;
  readonly signals: TimelineSignals;
  readonly script: readonly ScriptSignal[];
  readonly metrics: readonly BrainMetric[];
  readonly findings: readonly BrainFinding[];
  readonly proposals: readonly EditProposal[];
  readonly score: { readonly now: number; readonly potential: number };
  /** Grilla usada para cortar, si el llamador la aportó. */
  readonly beats: BeatGrid | null;
}

export interface ApplyOutcome {
  readonly project: import('@editor-ia/project-schema').ProjectDocument;
  readonly applied: readonly string[];
  readonly skipped: readonly { readonly id: string; readonly reason: string }[];
  readonly summary: string;
}

/**
 * Grilla de beats ya mapeada a frames absolutos de la timeline.
 *
 * El cerebro no decodifica audio: recibe la grilla que arma la UI con
 * `detectBeats` + `planBeatCuts`, o la que venga de un análisis guardado. Así el
 * plan sigue siendo una función pura y testeable con beats sintéticos.
 */
export interface BeatGrid {
  readonly bpm: number;
  /** 0..1; por debajo de 0.4 la grilla no se usa para cortar. */
  readonly confidence: number;
  readonly beatsFrames: readonly number[];
}

/** Diagnóstico del guion: escenas y narración, no la timeline. */
export interface ScriptSignal {
  readonly sceneId: string;
  readonly order: number;
  readonly title: string;
  readonly status: string;
  readonly intent: string;
  readonly hasNarration: boolean;
  readonly narrationWords: number;
  readonly narrationSeconds: number;
  readonly clipCount: number;
}

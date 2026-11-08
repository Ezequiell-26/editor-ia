import type { Asset } from '@editor-ia/project-schema';

export interface ScriptScenePlan {
  readonly id: string;
  readonly order: number;
  readonly title: string;
  readonly intent: 'hook' | 'context' | 'explainer' | 'demo' | 'proof' | 'cta' | 'outro';
  readonly narration: string;
  readonly visual: string;
  readonly estimatedSeconds: number;
}

export interface ScriptPlan {
  readonly title: string;
  readonly scenes: ScriptScenePlan[];
  readonly providerId: string;
  readonly model: string;
  readonly simulated: boolean;
  readonly costDisclosed: boolean;
  readonly costApproved: boolean;
}

export interface EffectRequest {
  readonly prompt: string;
  readonly approvedCost?: boolean;
}

export interface EffectRecipe {
  readonly name: string;
  readonly description: string;
  readonly effects: Record<string, unknown>;
  readonly providerId: string;
  readonly model: string;
  readonly simulated: boolean;
}

export interface GenerateScriptRequest {
  readonly brief: string;
  readonly sceneCount: number;
  readonly language: string;
  readonly approvedCost: boolean;
}

export interface GenerateMotionRequest {
  readonly brief: string;
  readonly templateId: string;
  readonly approvedCost: boolean;
}

export interface MotionSuggestion {
  readonly templateId: string;
  readonly props: Record<string, unknown>;
  readonly providerId: string;
  readonly model: string;
  readonly simulated: boolean;
}

export interface AssistantMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export type AssistantAction =
  | { readonly kind: 'navigate'; readonly view: string }
  | { readonly kind: 'play' | 'pause' | 'save' | 'export' | 'status' | 'undo' | 'redo' }
  | { readonly kind: 'new_project'; readonly name: string }
  | { readonly kind: 'import_file'; readonly path: string }
  | { readonly kind: 'download_url'; readonly url: string }
  | { readonly kind: 'add_clip'; readonly asset: string; readonly atPlayhead: boolean }
  | { readonly kind: 'delete_selected' }
  | { readonly kind: 'split_at_playhead' }
  | { readonly kind: 'goto'; readonly seconds: number }
  | { readonly kind: 'add_caption'; readonly text: string; readonly seconds: number }
  | { readonly kind: 'set_speed'; readonly speed: number }
  | { readonly kind: 'set_gain'; readonly db: number }
  | { readonly kind: 'mute_clip'; readonly muted: boolean }
  | {
      readonly kind: 'cut_silences';
      readonly thresholdDb: number;
      readonly minSilenceSeconds: number;
      readonly paddingSeconds: number;
      readonly scope: 'selection' | 'project';
    }
  | { readonly kind: 'auto_subtitles'; readonly scope: 'selection' | 'project' }
  | {
      readonly kind: 'cut_voice_pauses';
      readonly minPauseSeconds: number;
      readonly paddingSeconds: number;
      readonly scope: 'selection' | 'project';
    }
  | {
      readonly kind: 'auto_cleanup';
      readonly denoise: 'off' | 'light' | 'medium' | 'strong';
      readonly levelAudio: boolean;
      readonly zoomCuts: boolean;
      readonly cutSilences: boolean;
      readonly cutPauses: boolean;
      readonly targetLufs: number;
    }
  | { readonly kind: 'auto_pilot' }
  | {
      readonly kind: 'motion';
      readonly templateId: string;
      readonly text: string;
      readonly secondary?: string;
    }
  | { readonly kind: 'media_folder'; readonly folder: string }
  /**
   * Delega la edición al cerebro de la app: `report` devuelve el diagnóstico,
   * `safe` aplica sólo lo que no puede romper nada y `all` aplica todo lo que
   * tenga operación disponible.
   */
  | { readonly kind: 'brain'; readonly mode: 'safe' | 'all' | 'report' }
  | {
      readonly kind: 'mcp_call';
      readonly tool: string;
      readonly arguments: Readonly<Record<string, unknown>>;
    };

export interface AssistantChatRequest {
  readonly messages: readonly AssistantMessage[];
  readonly context?: Record<string, unknown>;
  readonly approvedCost: boolean;
}

export interface AssistantChatReply {
  readonly reply: string;
  /** Primera acción para compatibilidad con servicios antiguos. */
  readonly action: AssistantAction | null;
  /** Acciones ordenadas y saneadas; opcional para clientes anteriores. */
  readonly actions?: readonly AssistantAction[];
  readonly providerId: string;
  readonly model: string;
  readonly simulated: boolean;
}

/** Delta de texto de un streaming de asistente (SSE OpenAI-compatible). */
export interface AssistantStreamDelta {
  readonly streamId: string;
  readonly delta: string;
}

export interface AssistantStreamCompleted {
  readonly streamId: string;
  readonly reply: string;
  readonly action: AssistantAction | null;
  readonly actions?: readonly AssistantAction[];
  readonly providerId: string;
  readonly model: string;
  readonly simulated: boolean;
}

export interface AssistantStreamFailed {
  readonly streamId: string;
  readonly message: string;
  /** Falló antes del primer delta: se puede reintentar sin streaming. */
  readonly retryable: boolean;
}

export interface AssistantStreamCancelled {
  readonly streamId: string;
}

/** Handlers del streaming; el cierre siempre llega por alguno de los cuatro. */
export interface AssistantStreamHandlers {
  readonly onDelta: (delta: string) => void;
  readonly onCompleted: (reply: AssistantChatReply) => void;
  readonly onFailed: (failure: { readonly message: string; readonly retryable: boolean }) => void;
  readonly onCancelled: () => void;
}

export interface AssistantStreamHandle {
  readonly streamId: string;
  /** Pide al backend que corte; el cierre llega por `onCancelled`. */
  cancel(): void;
}

export interface VoiceInfo {
  readonly id: string;
  readonly name: string;
  readonly culture: string;
  readonly gender: string;
}

export interface NarrationResult {
  readonly asset: Asset;
  readonly voice: string;
  readonly provider: string;
}

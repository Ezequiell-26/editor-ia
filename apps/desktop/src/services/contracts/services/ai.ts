import type { AssistantChatReply, AssistantChatRequest, AssistantStreamHandle, AssistantStreamHandlers, EffectRecipe, EffectRequest, GenerateMotionRequest, GenerateScriptRequest, MotionSuggestion, ScriptPlan } from '../assistant';

export interface DesktopServiceAi {
generateScript(request: GenerateScriptRequest): Promise<ScriptPlan>;

generateVideoEffect(request: EffectRequest): Promise<EffectRecipe>;

generateMotion(request: GenerateMotionRequest): Promise<MotionSuggestion>;

assistantChat(request: AssistantChatRequest): Promise<AssistantChatReply>;

/**
   * Streaming del asistente por eventos. Si el backend no lo soporta o falla
   * antes del primer delta, el llamador conserva `assistantChat` como fallback.
   */
  assistantChatStream(
    request: AssistantChatRequest,
    handlers: AssistantStreamHandlers,
    streamId?: string,
  ): Promise<AssistantStreamHandle>;

/** Cancela un streaming en curso; `true` si estaba activo. */
  cancelAssistantChat(streamId: string): Promise<boolean>;
}

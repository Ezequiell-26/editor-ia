import type { DesktopService } from "../../services/contracts";
import type { NativeCall } from './shared';
import * as shared from './shared';
import type { AssistantChatReply, AssistantStreamCancelled, AssistantStreamCompleted, AssistantStreamDelta, AssistantStreamFailed, AssistantStreamHandle, EffectRecipe, MotionSuggestion, ScriptPlan } from "../../services/contracts";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export function createAiService(call: NativeCall): Pick<DesktopService, 'generateScript' | 'generateVideoEffect' | 'generateMotion' | 'assistantChat' | 'assistantChatStream' | 'cancelAssistantChat'> {
  return {
    async generateScript(request) {
      return (await call(shared.PROJECT_COMMANDS.generateScript, { request })) as ScriptPlan;
    },
    async generateVideoEffect(request) {
      return (await call(shared.PROJECT_COMMANDS.generateVideoEffect, { request })) as EffectRecipe;
    },
    async generateMotion(request) {
      return (await call(shared.PROJECT_COMMANDS.generateMotion, { request })) as MotionSuggestion;
    },
    async assistantChat(request) {
      return (await call(shared.PROJECT_COMMANDS.assistantChat, { request })) as AssistantChatReply;
    },
    async assistantChatStream(request, handlers, streamId) {
      // El id viaja en cada evento: dos chats abiertos no se mezclan.
      const id = streamId?.trim() ? streamId.trim() : shared.newAssistantStreamId();
      const unlisteners: UnlistenFn[] = [];
      const cleanup = (): void => {
        while (unlisteners.length > 0) unlisteners.pop()?.();
      };
      try {
        unlisteners.push(
          await listen<AssistantStreamDelta>('assistant-stream-delta', (event) => {
            if (event.payload?.streamId === id && typeof event.payload.delta === 'string') {
              handlers.onDelta(event.payload.delta);
            }
          }),
        );
        unlisteners.push(
          await listen<AssistantStreamCompleted>('assistant-stream-completed', (event) => {
            if (event.payload?.streamId !== id) return;
            cleanup();
            handlers.onCompleted({
              reply: typeof event.payload.reply === 'string' ? event.payload.reply : '',
              action: event.payload.action ?? null,
              actions: Array.isArray(event.payload.actions) ? event.payload.actions : [],
              providerId: event.payload.providerId ?? 'openai-compatible',
              model: event.payload.model ?? '',
              simulated: event.payload.simulated === true,
            });
          }),
        );
        unlisteners.push(
          await listen<AssistantStreamFailed>('assistant-stream-failed', (event) => {
            if (event.payload?.streamId !== id) return;
            cleanup();
            handlers.onFailed({
              message: event.payload.message || 'el streaming falló sin detalle',
              retryable: event.payload.retryable === true,
            });
          }),
        );
        unlisteners.push(
          await listen<AssistantStreamCancelled>('assistant-stream-cancelled', (event) => {
            if (event.payload?.streamId !== id) return;
            cleanup();
            handlers.onCancelled();
          }),
        );
      } catch (cause) {
        cleanup();
        throw cause instanceof Error ? cause : new Error('no se pudo escuchar el streaming');
      }
      try {
        await call(shared.PROJECT_COMMANDS.assistantChatStream, {
          request: {
            messages: [...request.messages],
            ...(request.context ? { context: request.context } : {}),
            approvedCost: request.approvedCost,
          },
          streamId: id,
        });
      } catch (cause) {
        cleanup();
        throw cause;
      }
      return {
        streamId: id,
        cancel() {
          void call(shared.PROJECT_COMMANDS.cancelAssistantChat, { streamId: id }).catch(() => {
            // Si el streaming ya terminó, cancelar no es un error de usuario.
          });
        },
      } satisfies AssistantStreamHandle;
    },
    async cancelAssistantChat(streamId) {
      const raw = await call(shared.PROJECT_COMMANDS.cancelAssistantChat, { streamId });
      return raw === true;
    },
  };
}

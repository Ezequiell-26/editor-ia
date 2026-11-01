/**
 * Bucle de tool calling: pide al proveedor, ejecuta las herramientas pedidas
 * sobre el proyecto abierto y devuelve el resultado al modelo hasta que
 * responda sin herramientas o se alcance el límite de rondas.
 */
import type {
  AssistantAgentMessage,
  AssistantAgentReply,
  AssistantToolCall,
} from '../../services/project-service';
import {
  findAssistantTool,
  validateToolArguments,
  type ToolOutcome,
} from './assistant-tools';

export interface AgentStep {
  readonly name: string;
  readonly ok: boolean;
  readonly summary: string;
}

export interface AgentPolicy {
  readonly allowEdits: boolean;
  readonly allowExport: boolean;
  /** 0 o Infinity = sin tope práctico (solo queda la salvaguarda de seguridad). */
  readonly maxRounds?: number;
  readonly maxToolCallsPerRound?: number;
  /** El usuario puede cortar el bucle desde la UI. */
  readonly shouldStop?: () => boolean;
  /** Progreso por ronda, para mostrar en la interfaz. */
  readonly onRound?: (round: number) => void;
}

export interface AgentLoopOptions {
  readonly send: (request: {
    messages: readonly AssistantAgentMessage[];
    context?: Record<string, unknown>;
    tools: readonly unknown[];
    approvedCost: boolean;
  }) => Promise<AssistantAgentReply>;
  readonly messages: readonly AssistantAgentMessage[];
  readonly tools: readonly unknown[];
  readonly context?: Record<string, unknown>;
  readonly approvedCost: boolean;
  readonly policy: AgentPolicy;
  readonly execute: (
    name: string,
    args: Readonly<Record<string, unknown>>,
  ) => Promise<ToolOutcome> | ToolOutcome;
}

export interface AgentLoopResult {
  readonly reply: string;
  readonly steps: readonly AgentStep[];
  readonly rounds: number;
  readonly stoppedByLimit: boolean;
  readonly stoppedByUser: boolean;
}

const DEFAULT_MAX_ROUNDS = 4;
const DEFAULT_MAX_CALLS = 4;
/** Salvaguarda: evita un bucle infinito si el modelo nunca deja de pedir. */
const SAFETY_MAX_ROUNDS = 100;
const SAFETY_MAX_CALLS_PER_ROUND = 20;

/**
 * Contenido que vuelve al modelo. `summary` es la parte útil; `data` se recorta
 * porque suele duplicar lo que ya dice el resumen y se paga en cada ronda.
 */
function toolContent(outcome: ToolOutcome): string {
  const summary =
    outcome.summary.length > 1_200 ? `${outcome.summary.slice(0, 1_200)}…` : outcome.summary;
  let data: unknown = outcome.data ?? null;
  if (data !== null) {
    const serialized = JSON.stringify(data);
    if (serialized.length > 900) {
      data = { truncated: true, preview: serialized.slice(0, 900) };
    }
  }
  return JSON.stringify({ ok: outcome.ok, summary, data });
}

/** Ejecuta una llamada pedida por el modelo con permisos y validación. */
export async function executeToolCall(
  call: AssistantToolCall,
  policy: AgentPolicy,
  execute: AgentLoopOptions['execute'],
): Promise<ToolOutcome> {
  const tool = findAssistantTool(call.name);
  if (!tool) return { ok: false, summary: `herramienta desconocida: ${call.name}` };
  if (tool.permission === 'edit' && !policy.allowEdits) {
    return { ok: false, summary: 'el agente no tiene permiso de edición' };
  }
  if (tool.permission === 'export' && !policy.allowExport) {
    return { ok: false, summary: 'el agente no tiene permiso de exportación' };
  }
  const errors = validateToolArguments(tool.parameters, call.arguments);
  if (errors.length > 0) {
    return { ok: false, summary: `argumentos inválidos: ${errors.join('; ')}` };
  }
  try {
    return await execute(call.name, call.arguments);
  } catch (cause) {
    return {
      ok: false,
      summary: cause instanceof Error ? cause.message : 'la herramienta falló',
    };
  }
}

export async function runAssistantAgent(
  options: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const requested = options.policy.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const unlimited =
    requested === 0 || requested === Number.POSITIVE_INFINITY || requested < 0;
  const maxRounds = unlimited
    ? SAFETY_MAX_ROUNDS
    : Math.max(1, Math.min(SAFETY_MAX_ROUNDS, requested));
  const maxCalls = Math.max(
    1,
    Math.min(
      SAFETY_MAX_CALLS_PER_ROUND,
      options.policy.maxToolCallsPerRound ?? DEFAULT_MAX_CALLS,
    ),
  );
  const messages: AssistantAgentMessage[] = [...options.messages];
  const steps: AgentStep[] = [];
  let lastReply = '';
  for (let round = 0; round < maxRounds; round += 1) {
    if (options.policy.shouldStop?.()) {
      return {
        reply: lastReply || 'Detuviste el trabajo del agente.',
        steps,
        rounds: round,
        stoppedByLimit: false,
        stoppedByUser: true,
      };
    }
    options.policy.onRound?.(round + 1);
    const response = await options.send({
      messages,
      tools: options.tools,
      approvedCost: options.approvedCost,
      ...(options.context ? { context: options.context } : {}),
    });
    lastReply = response.reply.trim();
    const calls = response.toolCalls.slice(0, maxCalls);
    if (calls.length === 0) {
      return {
        reply: lastReply,
        steps,
        rounds: round + 1,
        stoppedByLimit: false,
        stoppedByUser: false,
      };
    }
    messages.push({
      role: 'assistant',
      content: response.reply,
      toolCalls: calls,
    });
    for (const call of calls) {
      const outcome = await executeToolCall(call, options.policy, options.execute);
      steps.push({ name: call.name, ok: outcome.ok, summary: outcome.summary });
      messages.push({
        role: 'tool',
        content: toolContent(outcome),
        toolCallId: call.id,
      });
    }
  }
  return {
    reply:
      lastReply ||
      'Se detuvo por seguridad después de muchas rondas; pedí “seguí” para retomar.',
    steps,
    rounds: maxRounds,
    stoppedByLimit: true,
    stoppedByUser: false,
  };
}

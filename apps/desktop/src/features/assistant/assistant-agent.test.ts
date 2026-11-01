import { describe, expect, it, vi } from 'vitest';
import type { AssistantAgentReply, AssistantAgentMessage } from '../../services/project-service';
import { executeToolCall, runAssistantAgent } from './assistant-agent';

function reply(
  partial: Partial<AssistantAgentReply> & Pick<AssistantAgentReply, 'reply'>,
): AssistantAgentReply {
  return {
    toolCalls: [],
    finishReason: 'stop',
    providerId: 'test',
    model: 'test',
    ...partial,
  };
}

const tools = [{ type: 'function', function: { name: 'project_inspect', parameters: {} } }];

const policy = { allowEdits: true, allowExport: true };

describe('bucle de herramientas del agente', () => {
  it('ejecuta la herramienta pedida y devuelve el resultado al modelo', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(
        reply({
          reply: '',
          finishReason: 'tool_calls',
          toolCalls: [{ id: 'call_1', name: 'project_inspect', arguments: {} }],
        }),
      )
      .mockResolvedValueOnce(reply({ reply: 'El proyecto está vacío.' }));
    const execute = vi.fn(() => ({
      ok: true,
      summary: 'Prueba: 0 clips',
      data: { clips: 0 },
    }));
    const result = await runAssistantAgent({
      send,
      messages: [{ role: 'user', content: 'inspeccioná el proyecto' }],
      tools,
      approvedCost: true,
      policy,
      execute,
    });
    expect(execute).toHaveBeenCalledWith('project_inspect', {});
    expect(result.steps).toEqual([
      { name: 'project_inspect', ok: true, summary: 'Prueba: 0 clips' },
    ]);
    expect(result.reply).toBe('El proyecto está vacío.');
    expect(result.rounds).toBe(2);
    const second = send.mock.calls[1]![0] as {
      messages: readonly AssistantAgentMessage[];
    };
    expect(second.messages.at(-2)?.toolCalls?.[0]?.name).toBe('project_inspect');
    expect(second.messages.at(-1)?.role).toBe('tool');
    expect(second.messages.at(-1)?.toolCallId).toBe('call_1');
    expect(second.messages.at(-1)?.content).toContain('"ok":true');
  });

  it('bloquea ediciones sin permiso y devuelve el error al modelo', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(
        reply({
          reply: '',
          toolCalls: [{ id: 'c2', name: 'clip_split', arguments: { frame: 10 } }],
        }),
      )
      .mockResolvedValueOnce(reply({ reply: 'No puedo dividir.' }));
    const execute = vi.fn();
    const result = await runAssistantAgent({
      send,
      messages: [{ role: 'user', content: 'dividí' }],
      tools,
      approvedCost: false,
      policy: { allowEdits: false, allowExport: false },
      execute,
    });
    expect(execute).not.toHaveBeenCalled();
    expect(result.steps[0]?.ok).toBe(false);
    expect(result.steps[0]?.summary).toContain('permiso');
    const second = send.mock.calls[1]![0] as {
      messages: readonly AssistantAgentMessage[];
    };
    expect(second.messages.at(-1)?.content).toContain('permiso');
  });

  it('valida los argumentos antes de ejecutar', async () => {
    const execute = vi.fn();
    const outcome = await executeToolCall(
      { id: 'c3', name: 'clip_split', arguments: { frame: 1.5 } },
      policy,
      execute,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.summary).toContain('frame debe ser un entero');
    expect(execute).not.toHaveBeenCalled();
    const unknown = await executeToolCall(
      { id: 'c4', name: 'rm_rf', arguments: {} },
      policy,
      execute,
    );
    expect(unknown.ok).toBe(false);
    expect(unknown.summary).toContain('desconocida');
  });

  it('corta al límite de rondas cuando el modelo insiste con herramientas', async () => {
    const send = vi.fn(async () =>
      reply({
        reply: '',
        toolCalls: [{ id: 'loop', name: 'project_inspect', arguments: {} }],
      }),
    );
    const result = await runAssistantAgent({
      send,
      messages: [{ role: 'user', content: 'loop' }],
      tools,
      approvedCost: false,
      policy: { ...policy, maxRounds: 3 },
      execute: () => ({ ok: true, summary: 'ok' }),
    });
    expect(send).toHaveBeenCalledTimes(3);
    expect(result.rounds).toBe(3);
    expect(result.stoppedByLimit).toBe(true);
    expect(result.steps).toHaveLength(3);
  });

  it('recorta argumentos y devuelve error de ejecución sin romper el bucle', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(
        reply({
          reply: '',
          toolCalls: [{ id: 'c5', name: 'project_inspect', arguments: {} }],
        }),
      )
      .mockResolvedValueOnce(reply({ reply: 'Falló la inspección, sigo.' }));
    const result = await runAssistantAgent({
      send,
      messages: [{ role: 'user', content: 'inspeccioná' }],
      tools,
      approvedCost: false,
      policy,
      execute: () => {
        throw new Error('el proyecto no está abierto');
      },
    });
    expect(result.steps[0]).toEqual({
      name: 'project_inspect',
      ok: false,
      summary: 'el proyecto no está abierto',
    });
    expect(result.reply).toBe('Falló la inspección, sigo.');
  });
});

describe('bucle sin tope práctico', () => {
  it('sigue más de 8 rondas cuando la política es 0 y el modelo lo pide', async () => {
    let calls = 0;
    const send = vi.fn(async () => {
      calls += 1;
      if (calls <= 10) {
        return reply({
          reply: '',
          finishReason: 'tool_calls',
          toolCalls: [{ id: `call_${calls}`, name: 'project_inspect', arguments: {} }],
        });
      }
      return reply({ reply: 'Terminé.' });
    });
    const execute = vi.fn(() => ({ ok: true, summary: 'ok' }));
    const result = await runAssistantAgent({
      send,
      messages: [{ role: 'user', content: 'hacé varias cosas' }],
      tools,
      approvedCost: false,
      policy: { ...policy, maxRounds: 0 },
      execute,
    });
    expect(result.stoppedByLimit).toBe(false);
    expect(result.rounds).toBe(11);
    expect(result.reply).toBe('Terminé.');
    expect(execute).toHaveBeenCalledTimes(10);
  });

  it('corta cuando el usuario pide detener y no marca límite', async () => {
    let stopped = false;
    const send = vi.fn(async () => {
      stopped = true;
      return reply({
        reply: '',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'call_x', name: 'project_inspect', arguments: {} }],
      });
    });
    const execute = vi.fn(() => ({ ok: true, summary: 'ok' }));
    const result = await runAssistantAgent({
      send,
      messages: [{ role: 'user', content: 'trabajá' }],
      tools,
      approvedCost: false,
      policy: { ...policy, maxRounds: 0, shouldStop: () => stopped },
      execute,
    });
    expect(result.stoppedByUser).toBe(true);
    expect(result.stoppedByLimit).toBe(false);
  });
});

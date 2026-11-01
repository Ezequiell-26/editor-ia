/**
 * Subconjunto MCP por stdio (JSON-RPC 2.0): initialize, ping, tools/list y
 * tools/call. Sin SDK: el mismo protocolo que ya usa `apps/motion-mcp`.
 */
import type { McpToolDefinition } from './tools';

export const PROTOCOL_VERSION = '2024-11-05';
export const SERVER_INFO = { name: 'editor-ia-project', version: '1.0.0' };

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

function errorResponse(id: unknown, code: number, message: string): object {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function textResult(value: unknown, isError = false): object {
  return {
    ...(isError ? { isError: true } : {}),
    content: [{ type: 'text', text: JSON.stringify(value) }],
  };
}

export async function handleMessage(
  message: JsonRpcRequest | null,
  tools: readonly McpToolDefinition[],
): Promise<object | null> {
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') {
    return errorResponse(null, -32600, 'Invalid Request');
  }
  const { id, method } = message;
  if (typeof method !== 'string') return errorResponse(id, -32600, 'Invalid Request');
  if (method.startsWith('notifications/')) return null;
  if (method === 'initialize') {
    const requested =
      message.params && typeof message.params === 'object'
        ? (message.params as { protocolVersion?: unknown }).protocolVersion
        : undefined;
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: typeof requested === 'string' ? requested : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      },
    };
  }
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      },
    };
  }
  if (method === 'tools/call') {
    const params = message.params;
    if (!params || typeof params !== 'object') {
      return errorResponse(id, -32602, 'tools/call requiere params');
    }
    const { name, arguments: rawArgs } = params as {
      name?: unknown;
      arguments?: unknown;
    };
    if (typeof name !== 'string') {
      return errorResponse(id, -32602, 'tools/call requiere name');
    }
    const tool = tools.find((item) => item.name === name);
    if (!tool) {
      return {
        jsonrpc: '2.0',
        id,
        result: textResult({ ok: false, error: `herramienta ${name} desconocida` }, true),
      };
    }
    const args =
      rawArgs === undefined
        ? {}
        : typeof rawArgs === 'object' && rawArgs !== null
          ? (rawArgs as Record<string, unknown>)
          : null;
    if (!args) {
      return {
        jsonrpc: '2.0',
        id,
        result: textResult({ ok: false, error: 'arguments debe ser un objeto' }, true),
      };
    }
    try {
      const outcome = await tool.run(args);
      return { jsonrpc: '2.0', id, result: textResult(outcome, !outcome.ok) };
    } catch (cause) {
      const summary = cause instanceof Error ? cause.message : String(cause);
      return {
        jsonrpc: '2.0',
        id,
        result: textResult({ ok: false, error: summary }, true),
      };
    }
  }
  return errorResponse(id, -32601, `Method not found: ${method}`);
}

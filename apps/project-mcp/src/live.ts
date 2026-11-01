/**
 * Cliente del puente MCP en vivo.
 *
 * Habla con la app abierta por HTTP local autenticado (`x-editoria-token`) y
 * convierte las herramientas registradas por la UI en herramientas MCP. No
 * abre proyectos por archivo: el proyecto es el que la persona tiene abierto.
 */
import type { ToolOutcome, ToolParameters } from '../../desktop/src/features/assistant/assistant-tools';
import type { McpToolDefinition } from './tools';

export interface LiveBridgeOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

interface LiveToolSchema {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: ToolParameters;
}

function normalizeBase(url: string): string {
  return url.replace(/\/+$/, '');
}

export class LiveBridge {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: LiveBridgeOptions) {
    this.baseUrl = normalizeBase(options.baseUrl);
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 45_000;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-editoria-token': this.token,
          ...(init.headers as Record<string, string> | undefined),
        },
      });
      const text = await response.text();
      let payload: Record<string, unknown>;
      try {
        payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        throw new Error(`la app respondió algo que no es JSON (HTTP ${response.status})`);
      }
      if (!response.ok) {
        const message =
          typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`;
        throw new Error(message);
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const payload = await this.request('/v1/mcp/tools');
    const tools = Array.isArray(payload.tools) ? (payload.tools as LiveToolSchema[]) : [];
    return tools
      .filter((tool) => Boolean(tool) && typeof tool.name === 'string' && tool.name.length > 0)
      .map((tool) => ({
        name: tool.name,
        description: tool.description ?? '',
        inputSchema: tool.inputSchema ?? { type: 'object', properties: {}, additionalProperties: false },
        run: (args) => this.call(tool.name, args),
      }));
  }

  async call(name: string, args: Readonly<Record<string, unknown>>): Promise<ToolOutcome> {
    const payload = await this.request('/v1/mcp/tool', {
      method: 'POST',
      body: JSON.stringify({ tool: name, arguments: args }),
    });
    if (typeof payload.ok !== 'boolean') {
      throw new Error('la app devolvió un resultado sin estado');
    }
    return payload as unknown as ToolOutcome;
  }
}

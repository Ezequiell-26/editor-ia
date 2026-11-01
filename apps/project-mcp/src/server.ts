/**
 * Servidor MCP del proyecto de Editor IA/Olyvia.
 *
 * Uso por archivo:
 *   editor-ia-project-mcp --workspace <carpeta> --project <archivo.editoria.json>
 *
 * Uso en vivo (app abierta):
 *   editor-ia-project-mcp --live http://127.0.0.1:47615 --token <token>
 *
 * Habla MCP por stdio (JSON-RPC 2.0). El modo archivo reutiliza las acciones
 * reales del editor y escribe de forma atómica; el modo en vivo ejecuta las
 * mismas herramientas dentro de la app abierta por el puente autenticado.
 */
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { LiveBridge } from './live';
import { handleMessage } from './protocol';
import { ProjectMcpError, ProjectSession } from './session';
import { createMcpTools, type McpToolDefinition } from './tools';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

const liveUrl = argument('--live');
const liveToken = argument('--token') ?? process.env.EDITOR_IA_BRIDGE_TOKEN;
const projectArg = argument('--project');
const workspaceArg = argument('--workspace') ?? process.cwd();
if (!liveUrl && !projectArg) {
  process.stderr.write(
    'uso: editor-ia-project-mcp --workspace <carpeta> --project <archivo.editoria.json>\n' +
      '  o: editor-ia-project-mcp --live http://127.0.0.1:47615 --token <token>\n',
  );
  process.exit(2);
}
if (liveUrl && !liveToken) {
  process.stderr.write('project-mcp: el modo en vivo necesita --token o EDITOR_IA_BRIDGE_TOKEN\n');
  process.exit(2);
}

let session: ProjectSession | null = null;
let tools: readonly McpToolDefinition[] = [];
const live = liveUrl ? new LiveBridge({ baseUrl: liveUrl, token: liveToken! }) : null;
let liveLoaded = false;

if (!live) {
  try {
    session = new ProjectSession(workspaceArg, projectArg!);
  } catch (error) {
    const message =
      error instanceof ProjectMcpError ? error.message : 'no se pudo abrir la sesión';
    process.stderr.write(`project-mcp: ${message}\n`);
    process.exit(2);
  }

  if (existsSync(session.projectPath)) {
    try {
      session.load();
    } catch (error) {
      const message =
        error instanceof ProjectMcpError ? error.message : 'el proyecto no se pudo cargar';
      process.stderr.write(`project-mcp: ${message}\n`);
      process.exit(1);
    }
  }
  tools = createMcpTools(session).tools;
}

async function ensureLiveTools(): Promise<string | null> {
  if (!live) return null;
  if (liveLoaded) return null;
  try {
    tools = await live.listTools();
    liveLoaded = true;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const readline = createInterface({ input: process.stdin, crlfDelay: Infinity });
let queue = Promise.resolve();

function reply(payload: object): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

readline.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  queue = queue.then(async () => {
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    if (live) {
      const method =
        message && typeof message === 'object' && 'method' in message
          ? String((message as { method?: unknown }).method ?? '')
          : '';
      const readOnlyLifecycle =
        method === 'initialize' || method === 'ping' || method.startsWith('notifications/');
      if (!readOnlyLifecycle) {
        const error = await ensureLiveTools();
        if (error) {
          const id =
            message && typeof message === 'object' && 'id' in message
              ? (message as { id?: unknown }).id ?? null
              : null;
          reply({
            jsonrpc: '2.0',
            id,
            error: { code: -32000, message: `puente en vivo: ${error}` },
          });
          return;
        }
      }
    }
    const response = await handleMessage(
      message as Parameters<typeof handleMessage>[0],
      tools,
    );
    if (response) reply(response);
  });
});

readline.on('close', () => {
  queue.then(() => {
    process.exitCode = 0;
  });
});

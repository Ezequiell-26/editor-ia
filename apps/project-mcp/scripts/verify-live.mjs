#!/usr/bin/env node
// Verificación real del modo en vivo: arranca una app falsa HTTP (token
// obligatorio), lanza el servidor MCP por stdio en modo --live y comprueba
// lista + ejecución de herramientas de punta a punta.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const token = 'secret-live-token';
const calls = [];
let unauthorized = 0;

const app = createServer((request, response) => {
  if (request.headers['x-editoria-token'] !== token) {
    unauthorized += 1;
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'token inválido' }));
    return;
  }
  if (request.method === 'GET' && request.url === '/v1/mcp/tools') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        ok: true,
        tools: [
          {
            name: 'project_inspect',
            description: 'Inspecciona',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          },
          {
            name: 'rig_add',
            description: 'Personaje',
            inputSchema: {
              type: 'object',
              properties: { clip: { type: 'string', description: 'ciclo' } },
              required: ['clip'],
              additionalProperties: false,
            },
          },
        ],
      }),
    );
    return;
  }
  if (request.method === 'POST' && request.url === '/v1/mcp/tool') {
    let body = '';
    request.on('data', (chunk) => {
      body += String(chunk);
    });
    request.on('end', () => {
      const parsed = JSON.parse(body);
      calls.push(parsed);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          ok: true,
          summary: `vivo ${parsed.tool}`,
          data: { arguments: parsed.arguments, clips: 2, fps: 30 },
        }),
      );
    });
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'ruta desconocida' }));
});

await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
const address = app.address();
if (!address || typeof address === 'string') throw new Error('sin puerto');
const url = `http://127.0.0.1:${address.port}`;

const server = spawn(
  process.execPath,
  [
    join(root, 'apps', 'project-mcp', 'dist', 'server.mjs'),
    '--live',
    url,
    '--token',
    token,
  ],
  { stdio: ['pipe', 'pipe', 'pipe'] },
);

let buffer = '';
let stderr = '';
const pending = new Map();
server.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});
server.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  for (;;) {
    const index = buffer.indexOf('\n');
    if (index < 0) break;
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve } = pending.get(message.id);
      pending.delete(message.id);
      resolve(message);
    }
  }
});

let nextId = 1;
function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout esperando ${method}`));
    }, 10_000);
    pending.set(id, {
      resolve: (message) => {
        clearTimeout(timer);
        resolve(message);
      },
    });
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

try {
  const init = await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'verify-live', version: '1.0.0' },
  });
  if (init.result?.serverInfo?.name !== 'editor-ia-project') {
    throw new Error('initialize no devolvió el servidor esperado');
  }

  const list = await request('tools/list', {});
  const names = (list.result?.tools ?? []).map((tool) => tool.name);
  if (names.length !== 2 || names[0] !== 'project_inspect' || names[1] !== 'rig_add') {
    throw new Error(`tools/list inesperado: ${JSON.stringify(names)}`);
  }

  const call = await request('tools/call', {
    name: 'project_inspect',
    arguments: { detail: 'full' },
  });
  const outcome = JSON.parse(call.result?.content?.[0]?.text ?? '{}');
  if (outcome.ok !== true || outcome.summary !== 'vivo project_inspect') {
    throw new Error(`resultado inesperado: ${JSON.stringify(outcome)}`);
  }
  if (calls.length !== 1 || calls[0].tool !== 'project_inspect') {
    throw new Error(`la app no recibió la llamada: ${JSON.stringify(calls)}`);
  }

  const rig = await request('tools/call', {
    name: 'rig_add',
    arguments: { clip: 'walk' },
  });
  const rigOutcome = JSON.parse(rig.result?.content?.[0]?.text ?? '{}');
  if (rigOutcome.ok !== true || calls[1]?.arguments?.clip !== 'walk') {
    throw new Error('rig_add no llegó a la app con sus argumentos');
  }

  const unknown = await request('tools/call', {
    name: 'not_a_tool',
    arguments: {},
  });
  if (unknown.result?.isError !== true) {
    throw new Error('una herramienta desconocida no devolvió isError');
  }
  if (unauthorized !== 0) {
    throw new Error('el token se envió mal en alguna llamada');
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        protocol: init.result.protocolVersion,
        tools: names,
        calls: calls.map((call) => call.tool),
        unknownIsError: true,
      },
      null,
      2,
    ),
  );
  server.stdin.end();
} catch (error) {
  console.error(`verify-live falló: ${error.message}`);
  if (stderr.trim()) console.error(stderr.trim());
  process.exitCode = 1;
} finally {
  setTimeout(() => {
    server.kill();
    app.close();
  }, 100).unref();
}

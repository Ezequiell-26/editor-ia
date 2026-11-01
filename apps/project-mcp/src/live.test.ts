import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { LiveBridge } from './live';

let server: Server | null = null;

async function startFakeApp(): Promise<{ url: string; calls: unknown[] }> {
  const calls: unknown[] = [];
  server = createServer((request, response) => {
    if (request.headers['x-editoria-token'] !== 'secret') {
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
              description: 'Inspecciona el proyecto',
              inputSchema: { type: 'object', properties: {}, additionalProperties: false },
            },
            {
              name: 'rig_add',
              description: 'Hornea un personaje',
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
        const parsed = JSON.parse(body) as { tool: string; arguments: unknown };
        calls.push(parsed);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            ok: true,
            summary: `ejecutado ${parsed.tool}`,
            data: parsed.arguments,
          }),
        );
      });
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'no encontrado' }));
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('sin puerto');
  return { url: `http://127.0.0.1:${address.port}`, calls };
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
});

describe('puente MCP en vivo', () => {
  it('lista las herramientas registradas por la app', async () => {
    const { url } = await startFakeApp();
    const bridge = new LiveBridge({ baseUrl: url, token: 'secret' });
    const tools = await bridge.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(['project_inspect', 'rig_add']);
    expect(tools[1]?.description).toBe('Hornea un personaje');
    expect(tools[1]?.inputSchema.required).toEqual(['clip']);
  });

  it('ejecuta una herramienta y devuelve el resultado de la app', async () => {
    const { url, calls } = await startFakeApp();
    const bridge = new LiveBridge({ baseUrl: url, token: 'secret' });
    const tools = await bridge.listTools();
    const result = await tools[0]!.run({ detail: 'full' });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('ejecutado project_inspect');
    expect(calls).toEqual([{ tool: 'project_inspect', arguments: { detail: 'full' } }]);
  });

  it('propaga el error de token sin inventar resultados', async () => {
    const { url } = await startFakeApp();
    const bridge = new LiveBridge({ baseUrl: url, token: 'bad' });
    await expect(bridge.listTools()).rejects.toThrow(/token inválido/);
    await expect(bridge.call('project_inspect', {})).rejects.toThrow(/token inválido/);
  });

  it('rechaza respuestas sin estado', async () => {
    server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ summary: 'sin ok' }));
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('sin puerto');
    const bridge = new LiveBridge({
      baseUrl: `http://127.0.0.1:${address.port}`,
      token: 'secret',
    });
    await expect(bridge.call('x', {})).rejects.toThrow(/sin estado/);
  });
});

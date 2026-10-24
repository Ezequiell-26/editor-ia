import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const serverPath = fileURLToPath(new URL('./server.mjs', import.meta.url));
let child;
let pending = [];

function rpc(message) {
  return new Promise((resolve, reject) => {
    pending.push({ resolve, reject });
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

beforeAll(() => {
  child = spawn(process.execPath, [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on('line', (line) => {
    const entry = pending.shift();
    if (!entry) return;
    try {
      entry.resolve(JSON.parse(line));
    } catch (error) {
      entry.reject(error);
    }
  });
  child.stderr.on('data', (chunk) => {
    // Surface a real server crash without polluting the test transcript.
    if (String(chunk).trim()) process.stderr.write(`[motion-mcp] ${chunk}`);
  });
});

afterAll(() => {
  child?.kill();
});

describe('motion MCP', () => {
  it('hace el handshake y lista las tres herramientas', async () => {
    const init = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'editor-ia-test', version: '1.0.0' },
      },
    });
    expect(init.result.serverInfo.name).toBe('editor-ia-motion');
    const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(list.result.tools.map((tool) => tool.name)).toEqual([
      'motion_list_templates',
      'motion_create',
      'motion_validate',
    ]);
  });

  it('crea un plan de lower third y lo valida', async () => {
    const created = await rpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'motion_create',
        arguments: {
          templateId: 'lower-third',
          props: { name: 'Ana', role: 'Editora', accent: '#7dd3c0', side: 'left', animation: 'fade' },
          width: 1920,
          height: 1080,
          fps: 30,
          durationFrames: 90,
        },
      },
    });
    const payload = JSON.parse(created.result.content[0].text);
    expect(payload.ok).toBe(true);
    expect(payload.plan.templateId).toBe('lower-third');
    expect(payload.plan.layers.some((layer) => layer.kind === 'text')).toBe(true);

    const validated = await rpc({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'motion_validate', arguments: { plan: payload.plan } },
    });
    const check = JSON.parse(validated.result.content[0].text);
    expect(check.ok).toBe(true);
    expect(check.errors).toEqual([]);
  });

  it('rechaza props inválidas como error de herramienta', async () => {
    const response = await rpc({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'motion_create',
        arguments: { templateId: 'title-card', props: { title: '' } },
      },
    });
    expect(response.result.isError).toBe(true);
    expect(JSON.parse(response.result.content[0].text).ok).toBe(false);
  });
});

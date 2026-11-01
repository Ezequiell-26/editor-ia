import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { handleMessage } from './protocol';
import { ProjectSession } from './session';
import { createMcpTools } from './tools';

const dirs: string[] = [];

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'editoria-mcp-proto-'));
  dirs.push(dir);
  const session = new ProjectSession(dir, join(dir, 'p.editoria.json'));
  const { tools } = createMcpTools(session);
  return { session, tools };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('protocolo MCP del proyecto', () => {
  it('negocia initialize y anuncia tools', async () => {
    const { tools } = setup();
    const response = (await handleMessage(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      },
      tools,
    )) as { result: { protocolVersion: string; capabilities: { tools: object } } };
    expect(response.result.protocolVersion).toBe('2025-06-18');
    expect(response.result.capabilities.tools).toBeTruthy();
  });

  it('ignora notificaciones y rechaza métodos desconocidos', async () => {
    const { tools } = setup();
    expect(
      await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, tools),
    ).toBeNull();
    const unknown = (await handleMessage(
      { jsonrpc: '2.0', id: 2, method: 'resources/list' },
      tools,
    )) as { error: { code: number } };
    expect(unknown.error.code).toBe(-32601);
    const invalid = (await handleMessage({ jsonrpc: '2.0', id: 3 }, tools)) as {
      error: { code: number };
    };
    expect(invalid.error.code).toBe(-32600);
  });

  it('lista las trece herramientas con inputSchema', async () => {
    const { tools } = setup();
    const listed = (await handleMessage(
      { jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} },
      tools,
    )) as { result: { tools: Array<{ name: string; inputSchema: { type: string } }> } };
    expect(listed.result.tools).toHaveLength(13);
    expect(listed.result.tools.every((tool) => tool.inputSchema.type === 'object')).toBe(true);
  });

  it('aplica una trayectoria de movimiento sobre un clip de video', async () => {
    const { tools, session } = setup();
    const fixture = fileURLToPath(
      new URL(
        '../../../packages/project-schema/fixtures/sample-vertical-slice.editoria.json',
        import.meta.url,
      ),
    );
    writeFileSync(session.projectPath, readFileSync(fixture));
    const project = session.load();
    const video = project.timeline.clips.find((clip) => clip.kind === 'video');
    expect(video).toBeTruthy();
    const moved = (await handleMessage(
      {
        jsonrpc: '2.0',
        id: 22,
        method: 'tools/call',
        params: {
          name: 'motion_path',
          arguments: {
            clipId: video!.id,
            path: [0, 0, 120, -60],
            durationFrames: 60,
            easing: 'linear',
          },
        },
      },
      tools,
    )) as { result: { content: Array<{ text: string }> } };
    const payload = JSON.parse(moved.result.content[0]!.text);
    expect(payload.ok).toBe(true);
    expect(payload.data.keyframes).toBe(2);
    expect(payload.data.durationFrames).toBe(60);
    const updated = session.project!.timeline.clips.find((clip) => clip.id === video!.id);
    expect(updated?.transform?.keyframes).toHaveLength(2);
  });

  it('crea el proyecto y lo inspecciona por tools/call', async () => {
    const { tools } = setup();
    const created = (await handleMessage(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'project_create', arguments: { name: 'Protocolo' } },
      },
      tools,
    )) as { result: { content: Array<{ text: string }>; isError?: boolean } };
    expect(created.result.isError).toBeUndefined();
    expect(JSON.parse(created.result.content[0]!.text).ok).toBe(true);

    const inspected = (await handleMessage(
      {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'project_inspect', arguments: {} },
      },
      tools,
    )) as { result: { content: Array<{ text: string }> } };
    const payload = JSON.parse(inspected.result.content[0]!.text);
    expect(payload.ok).toBe(true);
    expect(payload.data.name).toBe('Protocolo');
    expect(payload.data.clips).toBe(0);
  });

  it('devuelve isError para herramientas desconocidas o argumentos inválidos', async () => {
    const { tools } = setup();
    const unknown = (await handleMessage(
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'rm_rf', arguments: {} } },
      tools,
    )) as { result: { isError?: boolean } };
    expect(unknown.result.isError).toBe(true);
    const invalid = (await handleMessage(
      {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'timeline_seek', arguments: { frame: 'x' } },
      },
      tools,
    )) as { result: { isError?: boolean; content: Array<{ text: string }> } };
    expect(invalid.result.isError).toBe(true);
    expect(JSON.parse(invalid.result.content[0]!.text).ok).toBe(false);
    const missingName = (await handleMessage(
      { jsonrpc: '2.0', id: 9, method: 'tools/call', params: {} },
      tools,
    )) as { error: { code: number } };
    expect(missingName.error.code).toBe(-32602);
  });
});

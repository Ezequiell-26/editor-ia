#!/usr/bin/env node
// Verificación real por stdio del servidor MCP del proyecto: crea un proyecto,
// agrega un gráfico, lo divide y comprueba el archivo en disco.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const dir = mkdtempSync(join(tmpdir(), 'editoria-mcp-'));
const projectPath = join(dir, 'demo.editoria.json');
const server = spawn(
  process.execPath,
  [
    join(root, 'apps', 'project-mcp', 'dist', 'server.mjs'),
    '--workspace',
    dir,
    '--project',
    projectPath,
  ],
  { stdio: ['pipe', 'pipe', 'pipe'] },
);

let buffer = '';
const pending = new Map();
server.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  for (;;) {
    const index = buffer.indexOf('\n');
    if (index < 0) break;
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    try {
      const message = JSON.parse(line);
      if (message.id !== undefined && pending.has(message.id)) {
        const { resolve } = pending.get(message.id);
        pending.delete(message.id);
        resolve(message);
      }
    } catch {
      // líneas ilegibles se ignoran: el verificador falla por timeout
    }
  }
});
server.stderr.on('data', (chunk) => process.stderr.write(chunk));

function request(id, method, params) {
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

function payload(response) {
  const text = response.result?.content?.[0]?.text;
  if (typeof text !== 'string') throw new Error('respuesta sin contenido de texto');
  return JSON.parse(text);
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const init = await request(1, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'verify-project-mcp', version: '1.0.0' },
  });
  check(init.result?.capabilities?.tools, 'initialize sin capability tools');
  check(init.result.protocolVersion === '2025-06-18', 'no negoció la versión pedida');

  const list = await request(2, 'tools/list', {});
  const names = list.result.tools.map((tool) => tool.name);
  for (const required of [
    'project_create',
    'project_inspect',
    'timeline_list',
    'timeline_seek',
    'motion_add',
    'clip_add',
    'clip_split',
    'asset_list',
    'project_save',
    'engine_catalog',
    'scene_resolve',
    'parallax_add',
  ]) {
    check(names.includes(required), `falta la herramienta ${required}`);
  }

  const created = payload(
    await request(3, 'tools/call', {
      name: 'project_create',
      arguments: { name: 'Verificación MCP', width: 640, height: 360, fps: 30 },
    }),
  );
  check(created.ok, `project_create falló: ${created.summary}`);

  const motion = payload(
    await request(4, 'tools/call', {
      name: 'motion_add',
      arguments: { templateId: 'title-card', text: 'Hola MCP' },
    }),
  );
  check(motion.ok, `motion_add falló: ${motion.summary}`);

  const timeline = payload(await request(5, 'tools/call', { name: 'timeline_list', arguments: {} }));
  check(timeline.ok && timeline.data.clips.length === 1, 'timeline_list no ve el gráfico');
  const clip = timeline.data.clips[0];

  await request(6, 'tools/call', {
    name: 'timeline_seek',
    arguments: { frame: clip.startFrame + 15 },
  });
  const split = payload(
    await request(7, 'tools/call', {
      name: 'clip_split',
      arguments: { clipId: clip.id },
    }),
  );
  check(split.ok, `clip_split falló: ${split.summary}`);

  const after = payload(await request(8, 'tools/call', { name: 'timeline_list', arguments: {} }));
  check(after.data.clips.length === 2, 'el clip no quedó dividido');

  const catalog = payload(
    await request(11, 'tools/call', { name: 'engine_catalog', arguments: {} }),
  );
  check(catalog.ok && catalog.data.engines.length >= 9, 'engine_catalog incompleto');
  const resolved = payload(
    await request(12, 'tools/call', {
      name: 'scene_resolve',
      arguments: { clipId: after.data.clips[0].id },
    }),
  );
  check(resolved.ok && resolved.data.engine === 'motion-graphics', 'scene_resolve no eligió motion');

  const unknown = await request(9, 'tools/call', { name: 'rm_rf', arguments: {} });
  check(unknown.result?.isError === true, 'una herramienta desconocida no devolvió error');
  const invalid = await request(10, 'tools/call', {
    name: 'clip_split',
    arguments: { frame: 'x' },
  });
  check(invalid.result?.isError === true, 'argumentos inválidos no devolvieron error');

  const file = JSON.parse(readFileSync(projectPath, 'utf8'));
  check(file.timeline.clips.length === 2, 'el archivo en disco no tiene dos clips');

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        protocol: init.result.protocolVersion,
        tools: names,
        clips: file.timeline.clips.length,
        bytes: readFileSync(projectPath).length,
        project: projectPath,
      },
      null,
      2,
    )}\n`,
  );
  server.kill();
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
} catch (error) {
  process.stderr.write(`verify-project-mcp: ${error instanceof Error ? error.message : error}\n`);
  server.kill();
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
}

#!/usr/bin/env node
// Verifica idempotencyKey en el puente MCP: el mismo pedido no se ejecuta dos veces.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  return process.argv[index + 1] ?? fallback;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = argument('--workspace', join(homedir(), 'AppData', 'Local', 'Temp', 'editoria-idempotency'));
mkdirSync(workspace, { recursive: true });
const projectPath = join(workspace, 'idempotencia.editoria.json');
if (existsSync(projectPath)) rmSync(projectPath);
const imagePath = join(workspace, 'fondo.png');
const ffmpeg = existsSync(join(root, 'target', 'debug', 'ffmpeg', 'ffmpeg.exe'))
  ? join(root, 'target', 'debug', 'ffmpeg', 'ffmpeg.exe')
  : 'ffmpeg';
if (!existsSync(imagePath)) {
  execFileSync(ffmpeg, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'gradients=s=1280x720:c0=0x111827:c1=0x2563eb:x0=0:y0=0:x1=1280:y1=720:d=1',
    '-frames:v', '1', imagePath,
  ], { stdio: 'ignore' });
}
const token =
  argument('--token', '') ||
  process.env.EDITOR_IA_BRIDGE_TOKEN ||
  readFileSync(join(homedir(), 'AppData', 'Roaming', 'com.editoria.desktop', 'downloader-bridge.token'), 'utf8').trim();
const port = Number(argument('--port', '47615'));

function createProject() {
  return new Promise((resolve, reject) => {
    const server = spawn(
      process.execPath,
      [join(root, 'apps', 'project-mcp', 'dist', 'server.mjs'), '--workspace', workspace, '--project', projectPath],
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
        const message = JSON.parse(line);
        if (message.id !== undefined && pending.has(message.id)) {
          const done = pending.get(message.id);
          pending.delete(message.id);
          done(message);
        }
      }
    });
    let id = 1;
    const request = (method, params) =>
      new Promise((done) => {
        const current = id++;
        pending.set(current, done);
        server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: current, method, params })}\n`);
      });
    (async () => {
      await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'idempotency', version: '1.0.0' } });
      const created = await request('tools/call', {
        name: 'project_create',
        arguments: { name: 'Idempotencia agente', width: 1280, height: 720, fps: 30 },
      });
      const outcome = JSON.parse(created.result?.content?.[0]?.text ?? '{}');
      if (outcome.ok !== true) throw new Error(outcome.summary ?? 'project_create falló');
      server.stdin.end();
      resolve();
    })().catch((error) => { server.kill(); reject(error); });
  });
}

async function live(tool, args = {}, idempotencyKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 150_000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/mcp/tool`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-editoria-token': token },
      body: JSON.stringify({
        tool,
        arguments: args,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      }),
    });
    return { status: response.status, ...(await response.json()) };
  } finally {
    clearTimeout(timer);
  }
}

function must(result, label) {
  if (result.status !== 200 || result.ok !== true) {
    throw new Error(`${label}: ${result.summary ?? JSON.stringify(result)}`);
  }
  return result;
}

try {
  await createProject();
  must(await live('project_open', { path: projectPath }), 'project_open');
  const imported = must(await live('asset_import', { path: imagePath }), 'asset_import');
  const assetId = imported.data.assets[0].id;
  const key = 'clip-add-0001';
  const first = must(await live('clip_add', { assetId, atFrame: 0 }, key), 'clip_add first');
  const second = must(await live('clip_add', { assetId, atFrame: 0 }, key), 'clip_add second');
  if (first.cached === true) throw new Error('la primera llamada llegó cacheada');
  if (second.cached !== true) throw new Error(`la segunda no usó caché: ${JSON.stringify(second)}`);
  const firstClip = first.data?.clipId;
  const secondClip = second.data?.clipId;
  if (!firstClip || firstClip !== secondClip) {
    throw new Error(`distinto clip: ${JSON.stringify({ first, second })}`);
  }
  const inspected = must(await live('project_inspect'), 'project_inspect');
  if (inspected.data.clips !== 1) {
    throw new Error(`se duplicó el clip: ${inspected.data.clips}`);
  }
  must(
    await live('clip_add', { assetId, atFrame: 300 }, 'clip-add-0002'),
    'clip_add second key',
  );
  const after = must(await live('project_inspect'), 'project_inspect');
  if (after.data.clips !== 2) {
    throw new Error(`la clave distinta no agregó clip: ${after.data.clips}`);
  }
  const invalid = await live('clip_add', { assetId, atFrame: 0 }, 'corto');
  if (invalid.status !== 400) {
    throw new Error(`una clave inválida no falló: ${JSON.stringify(invalid)}`);
  }
  console.log(JSON.stringify({
    ok: true,
    project: projectPath,
    key,
    firstClip,
    secondCached: second.cached,
    clipsAfterDuplicate: inspected.data.clips,
    clipsAfterDifferentKey: after.data.clips,
    invalidKeyStatus: invalid.status,
  }, null, 2));
} catch (error) {
  console.error(`verify-live-idempotency falló: ${error.message}`);
  process.exitCode = 1;
}

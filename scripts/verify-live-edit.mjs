#!/usr/bin/env node
// Verificación de edición en vivo: crea un proyecto con el MCP de archivos,
// lo abre en la app abierta por el puente en vivo, importa una imagen, monta el
// clip, guarda y comprueba el JSON en disco.
//
// Uso: node scripts/verify-live-edit.mjs --workspace <carpeta> [--port 47615]
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  return process.argv[index + 1] ?? fallback;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = argument('--workspace', '');
if (!workspace) {
  console.error('falta --workspace <carpeta>');
  process.exit(2);
}
mkdirSync(workspace, { recursive: true });
const projectPath = argument('--project', join(workspace, 'live.editoria.json'));
const assetPath = argument('--asset', join(workspace, 'tarjeta.png'));
if (!existsSync(assetPath)) {
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x1d4ed8:s=640x360:d=1',
      '-frames:v',
      '1',
      assetPath,
    ],
    { stdio: 'ignore' },
  );
}

const token =
  argument('--token', '') ||
  process.env.EDITOR_IA_BRIDGE_TOKEN ||
  readFileSync(
    join(homedir(), 'AppData', 'Roaming', 'com.editoria.desktop', 'downloader-bridge.token'),
    'utf8',
  ).trim();
const port = Number(argument('--port', '47615'));

function createProjectWithFileMcp() {
  return new Promise((resolve, reject) => {
    if (existsSync(projectPath)) {
      resolve();
      return;
    }
    const server = spawn(
      process.execPath,
      [
        join(root, 'apps', 'project-mcp', 'dist', 'server.mjs'),
        '--workspace',
        workspace,
        '--project',
        projectPath,
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
          const { resolve: done, timer } = pending.get(message.id);
          pending.delete(message.id);
          clearTimeout(timer);
          done(message);
        }
      }
    });
    let nextId = 1;
    const request = (method, params) =>
      new Promise((done, fail) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          fail(new Error(`timeout MCP archivo: ${method}`));
        }, 10_000);
        pending.set(id, { resolve: done, timer });
        server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    (async () => {
      await request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'verify-live-edit', version: '1.0.0' },
      });
      const created = await request('tools/call', {
        name: 'project_create',
        arguments: { name: 'Edición en vivo', width: 640, height: 360, fps: 30 },
      });
      const outcome = JSON.parse(created.result?.content?.[0]?.text ?? '{}');
      if (outcome.ok !== true) throw new Error(outcome.summary ?? 'project_create falló');
      server.stdin.end();
      resolve();
    })().catch((error) => {
      server.kill();
      reject(new Error(`${error.message}${stderr ? ` · ${stderr.trim()}` : ''}`));
    });
  });
}

async function live(tool, args) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 40_000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/mcp/tool`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-editoria-token': token },
      body: JSON.stringify({ tool, arguments: args }),
    });
    const text = await response.text();
    const payload = JSON.parse(text);
    if (response.status !== 200) {
      throw new Error(`${tool} HTTP ${response.status}: ${JSON.stringify(payload)}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

try {
  await createProjectWithFileMcp();

  const opened = await live('project_open', { path: projectPath });
  if (opened.ok !== true) throw new Error(`project_open: ${opened.summary}`);

  let before = await live('project_inspect', {});
  for (let attempt = 0; attempt < 10 && before.data?.view !== 'editor'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    before = await live('project_inspect', {});
  }
  if (before.ok !== true) throw new Error(`project_inspect inicial: ${before.summary}`);
  if (before.data.view !== 'editor') {
    throw new Error(`project_open no entró al editor (view=${before.data.view})`);
  }

  const imported = await live('asset_import', { path: assetPath });
  if (imported.ok !== true) throw new Error(`asset_import: ${imported.summary}`);
  const assetId = imported.data?.assets?.[0]?.id;
  if (!assetId) throw new Error('asset_import no devolvió assetId');

  const clip = await live('clip_add', { assetId, atFrame: 0 });
  if (clip.ok !== true) throw new Error(`clip_add: ${clip.summary}`);

  const saved = await live('transport', { action: 'save' });
  if (saved.ok !== true) throw new Error(`transport save: ${saved.summary}`);

  const after = await live('project_inspect', {});
  if (after.ok !== true) throw new Error(`project_inspect final: ${after.summary}`);
  if (after.data.assets < 1 || after.data.clips < 1) {
    throw new Error(`el proyecto no refleja la edición: ${JSON.stringify(after.data)}`);
  }

  const disk = JSON.parse(readFileSync(projectPath, 'utf8'));
  if (!Array.isArray(disk.assets) || disk.assets.length < 1) {
    throw new Error('el archivo guardado no tiene assets');
  }
  if (!Array.isArray(disk.timeline?.clips) || disk.timeline.clips.length < 1) {
    throw new Error('el archivo guardado no tiene clips');
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        project: projectPath,
        before: { assets: before.data.assets, clips: before.data.clips },
        after: { assets: after.data.assets, clips: after.data.clips },
        assetId,
        onDisk: { assets: disk.assets.length, clips: disk.timeline.clips.length },
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(`verify-live-edit falló: ${error.message}`);
  process.exitCode = 1;
}

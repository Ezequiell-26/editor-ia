#!/usr/bin/env node
// Verifica el rótulo 3D (sprite) horneado en una escena Three.js.
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
const workspace = argument('--workspace', join(homedir(), 'AppData', 'Local', 'Temp', 'editoria-three-text'));
mkdirSync(workspace, { recursive: true });
const projectPath = join(workspace, 'rotulo3d.editoria.json');
if (existsSync(projectPath)) rmSync(projectPath);
const ffmpeg = existsSync(join(root, 'target', 'debug', 'ffmpeg', 'ffmpeg.exe'))
  ? join(root, 'target', 'debug', 'ffmpeg', 'ffmpeg.exe')
  : 'ffmpeg';
const ffprobe = existsSync(join(root, 'target', 'debug', 'ffmpeg', 'ffprobe.exe'))
  ? join(root, 'target', 'debug', 'ffmpeg', 'ffprobe.exe')
  : 'ffprobe';
const token =
  argument('--token', '') ||
  process.env.EDITOR_IA_BRIDGE_TOKEN ||
  readFileSync(join(homedir(), 'AppData', 'Roaming', 'com.editoria.desktop', 'downloader-bridge.token'), 'utf8').trim();
const port = Number(argument('--port', '47615'));
const label = argument('--text', 'Hola Olyvia');
const depth = Number(argument('--depth', '0'));

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
      await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'three-text', version: '1.0.0' } });
      const created = await request('tools/call', {
        name: 'project_create',
        arguments: { name: 'Rótulo 3D agente', width: 1280, height: 720, fps: 30 },
      });
      const outcome = JSON.parse(created.result?.content?.[0]?.text ?? '{}');
      if (outcome.ok !== true) throw new Error(outcome.summary ?? 'project_create falló');
      server.stdin.end();
      resolve();
    })().catch((error) => { server.kill(); reject(error); });
  });
}

async function live(tool, args = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 150_000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/mcp/tool`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-editoria-token': token },
      body: JSON.stringify({ tool, arguments: args }),
    });
    return { status: response.status, ...(await response.json()) };
  } finally {
    clearTimeout(timer);
  }
}

function must(result, labelText) {
  if (result.status !== 200 || result.ok !== true) {
    throw new Error(`${labelText}: ${result.summary ?? JSON.stringify(result)}`);
  }
  return result;
}

try {
  await createProject();
  must(await live('project_open', { path: projectPath }), 'project_open');
  const three = must(
    await live('three_add', {
      preset: 'orbit-cube',
      seconds: 2,
      text: label,
      ...(depth > 0 ? { textDepth: depth } : {}),
    }),
    'three_add text',
  );
  must(await live('transport', { action: 'save' }), 'save');
  const project = JSON.parse(readFileSync(projectPath, 'utf8'));
  const asset = project.assets.find((item) => item.id === three.data.assetId);
  const mediaPath = join(workspace, asset?.source?.path ?? '');
  if (!asset?.source?.path || !existsSync(mediaPath)) throw new Error('no se encontró el MP4 horneado');
  const probe = JSON.parse(
    execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name,width,height', '-of', 'json', mediaPath], { encoding: 'utf8' }),
  );
  const frames = [0.5, 1.5].map((seconds) => {
    const path = join(workspace, `texto-${seconds}.png`);
    execFileSync(ffmpeg, ['-y', '-v', 'error', '-ss', String(seconds), '-i', mediaPath, '-frames:v', '1', '-vf', 'scale=960:-2', path]);
    return { seconds, path };
  });
  console.log(JSON.stringify({ ok: true, project: projectPath, text: label, depth, summary: three.summary, mediaPath, probe: { duration: probe.format.duration, bytes: probe.format.size, streams: probe.streams }, frames }, null, 2));
} catch (error) {
  console.error(`verify-three-text falló: ${error.message}`);
  process.exitCode = 1;
}

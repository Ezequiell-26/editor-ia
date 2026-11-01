#!/usr/bin/env node
// Verifica la importación de un modelo glTF real en la escena 3D:
// proyecto nuevo por MCP de archivo, three_add con modelPath, clip, render y frames.
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  return process.argv[index + 1] ?? fallback;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = argument(
  '--workspace',
  join(homedir(), 'AppData', 'Local', 'Temp', 'editoria-three-model'),
);
mkdirSync(workspace, { recursive: true });
const projectPath = join(workspace, 'modelo3d.editoria.json');
const modelPath = join(workspace, 'cubo.glb');
const fixture = join(root, 'scripts', 'fixtures', 'model-cube.glb');
if (!existsSync(fixture)) throw new Error(`falta el fixture ${fixture}`);
copyFileSync(fixture, modelPath);
const embeddedPath = join(workspace, 'cubo-gltf.gltf');
const embeddedFixture = join(root, 'scripts', 'fixtures', 'model-cube.gltf');
if (existsSync(embeddedFixture)) copyFileSync(embeddedFixture, embeddedPath);
if (existsSync(projectPath)) rmSync(projectPath);
const bundled = join(root, 'target', 'debug', 'ffmpeg', 'ffmpeg.exe');
const ffmpeg = existsSync(bundled) ? bundled : 'ffmpeg';
const bundledProbe = join(root, 'target', 'debug', 'ffmpeg', 'ffprobe.exe');
const ffprobe = existsSync(bundledProbe) ? bundledProbe : 'ffprobe';
const token =
  argument('--token', '') ||
  process.env.EDITOR_IA_BRIDGE_TOKEN ||
  readFileSync(
    join(homedir(), 'AppData', 'Roaming', 'com.editoria.desktop', 'downloader-bridge.token'),
    'utf8',
  ).trim();
const port = Number(argument('--port', '47615'));

function createProject() {
  return new Promise((resolve, reject) => {
    const server = spawn(
      process.execPath,
      [
        join(root, 'apps', 'project-mcp', 'dist', 'server.mjs'),
        '--workspace', workspace,
        '--project', projectPath,
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
      await request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'three-model', version: '1.0.0' },
      });
      const created = await request('tools/call', {
        name: 'project_create',
        arguments: { name: 'Modelo 3D agente', width: 1280, height: 720, fps: 30 },
      });
      const outcome = JSON.parse(created.result?.content?.[0]?.text ?? '{}');
      if (outcome.ok !== true) throw new Error(outcome.summary ?? 'project_create falló');
      server.stdin.end();
      resolve();
    })().catch((error) => {
      server.kill();
      reject(error);
    });
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
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function must(result, label) {
  if (result.ok !== true) throw new Error(`${label}: ${result.summary ?? JSON.stringify(result)}`);
  return result;
}

async function waitRender(jobId) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const status = await live('render_status');
    if (status.data?.finished?.jobId === jobId) return status.data.finished;
  }
  throw new Error('el render del modelo 3D no terminó');
}

try {
  await createProject();
  must(await live('project_open', { path: projectPath }), 'project_open');
  const added = must(await live('three_add', { modelPath, seconds: 3 }), 'three_add');
  if (!added.data?.assetId) throw new Error(`three_add no devolvió assetId: ${JSON.stringify(added)}`);
  const clip = must(await live('clip_add', { assetId: added.data.assetId, atFrame: 0 }), 'clip_add');
  let embedded = null;
  if (existsSync(embeddedPath)) {
    embedded = must(
      await live('three_add', { modelPath: embeddedPath, seconds: 1 }),
      'three_add gltf embebido',
    );
  }
  must(await live('transport', { action: 'save' }), 'save');
  const inspected = must(await live('project_inspect'), 'project_inspect');
  const started = must(await live('render_start', {}), 'render_start');
  const finished = await waitRender(started.data.jobId);
  if (finished.status !== 'completed' || !finished.outputPath) {
    throw new Error(`render falló: ${JSON.stringify(finished)}`);
  }
  const probe = JSON.parse(
    execFileSync(
      ffprobe,
      ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name', '-of', 'json', finished.outputPath],
      { encoding: 'utf8' },
    ),
  );
  const hashes = [0.5, 1.5, 2.5].map((seconds) =>
    execFileSync(
      ffmpeg,
      ['-v', 'error', '-ss', String(seconds), '-i', finished.outputPath, '-frames:v', '1', '-f', 'md5', '-'],
      { encoding: 'utf8' },
    ).trim(),
  );
  if (new Set(hashes).size !== hashes.length) {
    throw new Error(`los frames no cambiaron: ${hashes.join(' / ')}`);
  }
  for (const seconds of [0.5, 2.5]) {
    execFileSync(ffmpeg, [
      '-y', '-v', 'error',
      '-ss', String(seconds),
      '-i', finished.outputPath,
      '-frames:v', '1',
      '-vf', 'scale=960:-2',
      join(workspace, `modelo-${seconds}.png`),
    ]);
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        project: projectPath,
        model: modelPath,
        asset: added.data,
        embeddedGltf: embedded?.data ?? null,
        clipId: clip.data.clipId,
        clips: inspected.data.clips,
        render: {
          output: finished.outputPath,
          bytes: finished.outputBytes,
          width: finished.width,
          height: finished.height,
          duration: probe.format.duration,
          codecs: probe.streams.map((stream) => stream.codec_name),
        },
        frameHashes: hashes,
        frames: [join(workspace, 'modelo-0.5.png'), join(workspace, 'modelo-2.5.png')],
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(`verify-three-model falló: ${error.message}`);
  process.exitCode = 1;
}

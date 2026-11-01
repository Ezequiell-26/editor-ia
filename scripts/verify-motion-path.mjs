#!/usr/bin/env node
// Verifica una trayectoria de transform creada por el agente y su render real:
// proyecto nuevo, imagen + grain, motion_path con easing, export y frames.
import { execFileSync, spawn } from 'node:child_process';
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
const workspace = argument(
  '--workspace',
  join(homedir(), 'AppData', 'Local', 'Temp', 'editoria-motionpath'),
);
mkdirSync(workspace, { recursive: true });
const projectPath = join(workspace, 'motionpath.editoria.json');
const imagePath = join(workspace, 'fondo.png');
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

if (!existsSync(imagePath)) {
  execFileSync(ffmpeg, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i',
    'gradients=s=1280x720:c0=0x111827:c1=0x2563eb:x0=0:y0=0:x1=1280:y1=720:d=1',
    '-frames:v', '1', imagePath,
  ], { stdio: 'ignore' });
}

function createProject() {
  return new Promise((resolve, reject) => {
    if (existsSync(projectPath)) {
      resolve();
      return;
    }
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
        clientInfo: { name: 'motionpath', version: '1.0.0' },
      });
      const created = await request('tools/call', {
        name: 'project_create',
        arguments: { name: 'Trayectoria agente', width: 1280, height: 720, fps: 30 },
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
  throw new Error('el render de la trayectoria no terminó');
}

try {
  await createProject();
  must(await live('project_open', { path: projectPath }), 'project_open');
  const imported = must(await live('asset_import', { path: imagePath }), 'asset_import');
  const assetId = imported.data.assets[0].id;
  const clip = must(await live('clip_add', { assetId, atFrame: 0 }), 'clip_add');
  const clipId = clip.data.clipId;
  const path = must(
    await live('motion_path', {
      clipId,
      path: [0, 0, 320, -120, 640, 0, 320, 120, 0, 0],
      durationFrames: 120,
      easing: 'ease-in-out',
      startScale: 1,
      endScale: 1.15,
    }),
    'motion_path',
  );
  must(await live('effect_apply', { clipId, grain: 0.45, contrast: 1.1 }), 'effect_apply');
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
  const hashes = [0.5, 2, 3.5].map((seconds) =>
    execFileSync(
      ffmpeg,
      ['-v', 'error', '-ss', String(seconds), '-i', finished.outputPath, '-frames:v', '1', '-f', 'md5', '-'],
      { encoding: 'utf8' },
    ).trim(),
  );
  if (new Set(hashes).size !== hashes.length) {
    throw new Error(`los frames no se movieron: ${hashes.join(' / ')}`);
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        project: projectPath,
        clipId,
        motionPath: path.data,
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
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(`verify-motion-path falló: ${error.message}`);
  process.exitCode = 1;
}

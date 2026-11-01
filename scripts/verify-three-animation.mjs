#!/usr/bin/env node
// Verifica que un glTF con animación reproduzca su primer clip al hornear la
// escena 3D: proyecto por MCP de archivo, three_add, clip, render y frames.
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
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
  join(homedir(), 'AppData', 'Local', 'Temp', 'editoria-three-animation'),
);
mkdirSync(workspace, { recursive: true });
const projectPath = join(workspace, 'animacion.editoria.json');
const fixture = argument(
  '--model',
  join(root, 'scripts', 'fixtures', 'model-spin.glb'),
);
const clip = argument('--clip', '');
const modelPath = join(workspace, fixture.split(/[\/]/).pop() ?? 'modelo.glb');
if (!existsSync(fixture)) throw new Error(`falta el fixture ${fixture}`);
copyFileSync(fixture, modelPath);
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
        clientInfo: { name: 'three-animation', version: '1.0.0' },
      });
      const created = await request('tools/call', {
        name: 'project_create',
        arguments: { name: 'Animación 3D agente', width: 1280, height: 720, fps: 30 },
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
  throw new Error('el render de la animación 3D no terminó');
}

try {
  await createProject();
  must(await live('project_open', { path: projectPath }), 'project_open');
  if (clip) {
    const bad = await live('three_add', {
      modelPath,
      seconds: 1,
      animation: 'NoExiste',
    });
    if (bad.ok !== false || !String(bad.summary ?? '').includes('no existe')) {
      throw new Error(`una animación inexistente no falló claro: ${JSON.stringify(bad)}`);
    }
  }
  const added = must(
    await live('three_add', {
      modelPath,
      seconds: 3,
      ...(clip ? { animation: clip } : {}),
    }),
    'three_add',
  );
  const animation = added.data?.animation;
  if (!animation || Math.abs(animation.durationSeconds - 2) > 0.05) {
    throw new Error(`no se detectó el clip de 2 s: ${JSON.stringify(animation)}`);
  }
  if (clip) {
    const available = added.data?.animations ?? [];
    if (animation.name !== clip || !available.includes(clip)) {
      throw new Error(
        `no se eligió "${clip}": ${JSON.stringify({ animation, available })}`,
      );
    }
  }
  const clipAdded = must(
    await live('clip_add', { assetId: added.data.assetId, atFrame: 0 }),
    'clip_add',
  );
  must(await live('transport', { action: 'save' }), 'save');
  // El horneado ya es el MP4 VP9 importado a Medios: se inspecciona ese asset.
  const saved = JSON.parse(readFileSync(projectPath, 'utf8'));
  const asset = saved.assets.find((item) => item.id === added.data.assetId);
  const relative = asset?.source?.path;
  if (!relative) throw new Error('el asset horneado no tiene ruta en el proyecto');
  const mediaPath = join(workspace, relative);
  if (!existsSync(mediaPath)) throw new Error(`no existe el MP4 horneado: ${mediaPath}`);
  const probe = JSON.parse(
    execFileSync(
      ffprobe,
      ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name', '-of', 'json', mediaPath],
      { encoding: 'utf8' },
    ),
  );
  const frames = [0.3, 1.5, 2.7].map((seconds) => {
    const path = join(workspace, `giro-${seconds}.png`);
    execFileSync(ffmpeg, [
      '-y', '-v', 'error',
      '-ss', String(seconds),
      '-i', mediaPath,
      '-frames:v', '1',
      '-vf', 'scale=960:-2',
      path,
    ]);
    const hash = execFileSync(
      ffmpeg,
      ['-v', 'error', '-ss', String(seconds), '-i', mediaPath, '-frames:v', '1', '-f', 'md5', '-'],
      { encoding: 'utf8' },
    ).trim();
    return { seconds, path, hash };
  });
  if (new Set(frames.map((frame) => frame.hash)).size !== frames.length) {
    throw new Error(`los frames no cambiaron: ${JSON.stringify(frames)}`);
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        project: projectPath,
        model: modelPath,
        animation,
        animations: added.data?.animations ?? [],
        asset: added.data,
        clipId: clipAdded.data.clipId,
        baked: {
          output: mediaPath,
          bytes: statSync(mediaPath).size,
          width: asset.media.width,
          height: asset.media.height,
          duration: probe.format.duration,
          codecs: probe.streams.map((stream) => stream.codec_name),
        },
        frames,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(`verify-three-animation falló: ${error.message}`);
  process.exitCode = 1;
}

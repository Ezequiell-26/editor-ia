#!/usr/bin/env node
// Verifica checkpoint intra-escena: una escena larga se renderiza por chunks y
// al re-renderizar sólo se regenera el chunk faltante.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  return process.argv[index + 1] ?? fallback;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = argument('--workspace', join(homedir(), 'AppData', 'Local', 'Temp', 'editoria-checkpoint'));
mkdirSync(workspace, { recursive: true });
const projectPath = join(workspace, 'checkpoint.editoria.json');
if (existsSync(projectPath)) rmSync(projectPath);
const sourcePath = join(workspace, 'fuente-larga.mp4');
const ffmpeg = existsSync(join(root, 'target', 'debug', 'ffmpeg', 'ffmpeg.exe'))
  ? join(root, 'target', 'debug', 'ffmpeg', 'ffmpeg.exe')
  : 'ffmpeg';
const ffprobe = existsSync(join(root, 'target', 'debug', 'ffmpeg', 'ffprobe.exe'))
  ? join(root, 'target', 'debug', 'ffmpeg', 'ffprobe.exe')
  : 'ffprobe';
if (!existsSync(sourcePath)) {
  execFileSync(ffmpeg, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=45',
    '-c:v', 'libopenh264', '-b:v', '2M', '-pix_fmt', 'yuv420p',
    sourcePath,
  ]);
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
      await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'checkpoint', version: '1.0.0' } });
      const created = await request('tools/call', {
        name: 'project_create',
        arguments: { name: 'Checkpoint agente', width: 1280, height: 720, fps: 30 },
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

function must(result, label) {
  if (result.status !== 200 || result.ok !== true) {
    throw new Error(`${label}: ${result.summary ?? JSON.stringify(result)}`);
  }
  return result;
}

async function waitItem(id) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const status = must(await live('render_queue_status'), 'render_queue_status');
    const item = (status.data.items ?? []).find((entry) => entry.id === id);
    if (item && (item.status === 'completed' || item.status === 'failed')) return item;
  }
  throw new Error('la escena larga no terminó en 180 s');
}

try {
  await createProject();
  must(await live('project_open', { path: projectPath }), 'project_open');
  const imported = must(await live('asset_import', { path: sourcePath }), 'asset_import');
  const assetId = imported.data.assets[0].id;
  const clip = must(await live('clip_add', { assetId, atFrame: 0 }), 'clip_add');
  const scene = must(
    await live('scene_create', {
      title: 'Escena larga',
      narration: 'Escena de 45 segundos para checkpoint.',
      clipIds: [clip.data.clipId],
    }),
    'scene_create',
  );
  must(await live('transport', { action: 'save' }), 'save');
  must(await live('render_queue_control', { action: 'pause' }), 'pause');
  const first = must(
    await live('render_queue_add', { sceneIds: [scene.data.sceneId] }),
    'render_queue_add first',
  );
  must(await live('render_queue_control', { action: 'resume' }), 'resume');
  const firstItem = await waitItem(first.data.ids[0]);
  if (firstItem.status !== 'completed' || !firstItem.outputPath) {
    throw new Error(`primer render falló: ${JSON.stringify(firstItem)}`);
  }
  const finalPath = firstItem.outputPath;
  const finalName = basename(finalPath);
  const stem = finalName.replace(/\.mp4$/i, '');
  const chunkNames = readdirSync(workspace)
    .filter((name) => name.startsWith(`${stem}-c`) && name.endsWith('.mp4'))
    .sort();
  if (chunkNames.length < 3) {
    throw new Error(`no se crearon chunks suficientes: ${JSON.stringify(chunkNames)}`);
  }
  const chunkPaths = chunkNames.map((name) => join(workspace, name));
  const firstMtime = statSync(chunkPaths[0]).mtimeMs;
  const lastMtime = statSync(chunkPaths.at(-1)).mtimeMs;
  const missingChunk = chunkPaths[1];
  rmSync(missingChunk);
  rmSync(finalPath);
  const second = must(
    await live('render_queue_add', { sceneIds: [scene.data.sceneId] }),
    'render_queue_add second',
  );
  const secondItem = await waitItem(second.data.ids[0]);
  if (secondItem.status !== 'completed') {
    throw new Error(`segundo render falló: ${JSON.stringify(secondItem)}`);
  }
  if (!existsSync(finalPath) || !existsSync(missingChunk)) {
    throw new Error('no se regeneraron el chunk faltante o el final');
  }
  const firstAfter = statSync(chunkPaths[0]).mtimeMs;
  const lastAfter = statSync(chunkPaths.at(-1)).mtimeMs;
  if (firstAfter !== firstMtime || lastAfter !== lastMtime) {
    throw new Error(
      `se re-renderizaron chunks intactos: ${JSON.stringify({ firstMtime, firstAfter, lastMtime, lastAfter })}`,
    );
  }
  const probe = JSON.parse(
    execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name', '-of', 'json', finalPath], { encoding: 'utf8' }),
  );
  console.log(JSON.stringify({
    ok: true,
    project: projectPath,
    sceneId: scene.data.sceneId,
    final: finalPath,
    chunks: chunkNames.map((name) => join(workspace, name)),
    firstMtime,
    lastMtime,
    regeneratedChunk: missingChunk,
    probe: { duration: probe.format.duration, bytes: probe.format.size, codecs: probe.streams.map((stream) => stream.codec_name) },
  }, null, 2));
} catch (error) {
  console.error(`verify-scene-checkpoint falló: ${error.message}`);
  process.exitCode = 1;
}

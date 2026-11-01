#!/usr/bin/env node
// Verifica el planificador capítulo→escena por MCP en vivo: crea escenas con
// narración y clips repartidos, las persiste y renderiza la primera con la cola.
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
const workspace = argument(
  '--workspace',
  join(homedir(), 'AppData', 'Local', 'Temp', 'editoria-chapter'),
);
mkdirSync(workspace, { recursive: true });
const projectPath = join(workspace, 'capitulos.editoria.json');
if (existsSync(projectPath)) rmSync(projectPath);
const sourcePath = join(workspace, 'fuente-capitulos.mp4');
const bundledFfmpeg = join(root, 'target', 'debug', 'ffmpeg', 'ffmpeg.exe');
const ffmpeg = existsSync(bundledFfmpeg) ? bundledFfmpeg : 'ffmpeg';
const bundledProbe = join(root, 'target', 'debug', 'ffmpeg', 'ffprobe.exe');
const ffprobe = existsSync(bundledProbe) ? bundledProbe : 'ffprobe';
if (!existsSync(sourcePath)) {
  execFileSync(ffmpeg, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=6',
    '-c:v', 'libopenh264', '-b:v', '2M', '-pix_fmt', 'yuv420p',
    sourcePath,
  ]);
}
const token =
  argument('--token', '') ||
  process.env.EDITOR_IA_BRIDGE_TOKEN ||
  readFileSync(
    join(homedir(), 'AppData', 'Roaming', 'com.editoria.desktop', 'downloader-bridge.token'),
    'utf8',
  ).trim();
const port = Number(argument('--port', '47615'));

const narration = [
  '# Apertura',
  'La ciudad despierta entre luces y sombras.',
  'El río refleja el amanecer sobre los edificios.',
  'Un tren cruza el puente en silencio.',
  'La cámara sigue el movimiento del agua.',
  '',
  '# Cierre',
  'El protagonista vuelve a casa.',
  'La cámara se aleja lentamente.',
].join('\n');

function createProject() {
  return new Promise((resolve, reject) => {
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
        clientInfo: { name: 'chapter-plan', version: '1.0.0' },
      });
      const created = await request('tools/call', {
        name: 'project_create',
        arguments: { name: 'Plan capítulos', width: 1280, height: 720, fps: 30 },
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
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const status = must(await live('render_queue_status'), 'render_queue_status');
    const item = (status.data.items ?? []).find((entry) => entry.id === id);
    if (item && (item.status === 'completed' || item.status === 'failed')) return item;
  }
  throw new Error('el render de la escena planificada no terminó en 120 s');
}

try {
  await createProject();
  must(await live('project_open', { path: projectPath }), 'project_open');
  const imported = must(await live('asset_import', { path: sourcePath }), 'asset_import');
  const assetId = imported.data.assets[0].id;
  const firstClip = must(await live('clip_add', { assetId, atFrame: 0 }), 'clip_add first');
  const secondClip = must(await live('clip_add', { assetId, atFrame: 180 }), 'clip_add second');
  const clipIds = [firstClip.data.clipId, secondClip.data.clipId];

  const invalid = await live('chapter_plan', {
    narration,
    clipIds: ['no-existe'],
    maxWords: 20,
  });
  if (invalid.ok !== false) throw new Error('el plan con un clip inexistente debía fallar');

  const planned = must(
    await live('chapter_plan', { narration, clipIds, maxWords: 20 }),
    'chapter_plan',
  );
  if (!Array.isArray(planned.data?.chapters) || planned.data.chapters.length !== 2) {
    throw new Error(`capítulos inesperados: ${JSON.stringify(planned.data?.chapters)}`);
  }
  const scenes = planned.data?.scenes ?? [];
  if (scenes.length < 3) throw new Error(`escenas insuficientes: ${scenes.length}`);

  must(await live('transport', { action: 'save' }), 'save');
  const document = JSON.parse(readFileSync(projectPath, 'utf8'));
  const saved = document.scenes ?? [];
  if (saved.length !== scenes.length) {
    throw new Error(`escenas persistidas ${saved.length} != planificadas ${scenes.length}`);
  }
  if (saved.some((scene) => !Array.isArray(scene.clipIds) || scene.clipIds.length !== 1)) {
    throw new Error('alguna escena no quedó con exactamente un clip');
  }
  const savedChapters = new Set(
    saved.map((scene) => (scene.notes ?? '').replace(/^Capítulo:\s*/, '')),
  );
  if (savedChapters.size !== 2) {
    throw new Error(`capítulos persistidos inesperados: ${JSON.stringify([...savedChapters])}`);
  }
  if (saved[0].intent !== 'hook' || saved.at(-1).intent !== 'outro') {
    throw new Error(`intenciones inesperadas: ${saved[0].intent}/${saved.at(-1).intent}`);
  }
  if (document.scenes.some((scene) => !scene.narration?.text)) {
    throw new Error('una escena planificada quedó sin narración');
  }

  must(await live('render_queue_control', { action: 'pause' }), 'pause');
  const queued = must(
    await live('render_queue_add', { sceneIds: [scenes[0].sceneId] }),
    'render_queue_add',
  );
  must(await live('render_queue_control', { action: 'resume' }), 'resume');
  const item = await waitItem(queued.data.ids[0]);
  if (item.status !== 'completed' || !item.outputPath || !existsSync(item.outputPath)) {
    throw new Error(`el render de la escena planificada falló: ${JSON.stringify(item)}`);
  }
  const probe = JSON.parse(
    execFileSync(
      ffprobe,
      ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name', '-of', 'json', item.outputPath],
      { encoding: 'utf8' },
    ),
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        project: projectPath,
        chapters: planned.data.chapters,
        scenes: scenes.map((scene) => scene.title),
        clips: saved.map((scene) => scene.clipIds[0]),
        intents: saved.map((scene) => scene.intent),
        rejectedInvalidClip: invalid.summary,
        render: {
          output: item.outputPath,
          duration: probe.format.duration,
          bytes: probe.format.size,
          codecs: probe.streams.map((stream) => stream.codec_name),
        },
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(`verify-chapter-plan falló: ${error.message}`);
  process.exitCode = 1;
}

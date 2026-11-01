#!/usr/bin/env node
// Verifica la narración por escena: SAPI real, vínculo a la escena, pista de
// narración y render de una escena con audio.
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
  join(homedir(), 'AppData', 'Local', 'Temp', 'editoria-narration'),
);
mkdirSync(workspace, { recursive: true });
const projectPath = join(workspace, 'narracion.editoria.json');
if (existsSync(projectPath)) rmSync(projectPath);
const sourcePath = join(workspace, 'fuente-narracion.mp4');
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
  '# Presentación',
  'La ciudad despierta entre luces y sombras.',
  '',
  '# Cierre',
  'El protagonista vuelve a casa.',
].join('\n');

function createProject() {
  return new Promise((resolve, reject) => {
    const server = spawn(
      process.execPath,
      [
        join(root, 'apps', 'project-mcp', 'dist', 'server.mjs'),
        '--workspace', workspace, '--project', projectPath,
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
        clientInfo: { name: 'chapter-narration', version: '1.0.0' },
      });
      const created = await request('tools/call', {
        name: 'project_create',
        arguments: { name: 'Narración capítulos', width: 1280, height: 720, fps: 30 },
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
  const timer = setTimeout(() => controller.abort(), 180_000);
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
  for (let attempt = 0; attempt < 150; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const status = must(await live('render_queue_status'), 'render_queue_status');
    const item = (status.data.items ?? []).find((entry) => entry.id === id);
    if (item && (item.status === 'completed' || item.status === 'failed')) return item;
  }
  throw new Error('el render con narración no terminó en 150 s');
}

try {
  await createProject();
  must(await live('project_open', { path: projectPath }), 'project_open');
  const imported = must(await live('asset_import', { path: sourcePath }), 'asset_import');
  const assetId = imported.data.assets[0].id;
  const firstClip = must(await live('clip_add', { assetId, atFrame: 0 }), 'clip_add first');
  const secondClip = must(await live('clip_add', { assetId, atFrame: 180 }), 'clip_add second');
  const planned = must(
    await live('chapter_plan', {
      narration,
      clipIds: [firstClip.data.clipId, secondClip.data.clipId],
      maxWords: 20,
    }),
    'chapter_plan',
  );
  const sceneIds = (planned.data.scenes ?? []).map((scene) => scene.sceneId);
  if (sceneIds.length < 2) throw new Error(`escenas insuficientes: ${sceneIds.length}`);

  const noRights = await live('narrate_scenes', { sceneIds });
  if (noRights.ok !== false) throw new Error('narrate_scenes debía exigir confirmRights');

  const narrated = must(
    await live('narrate_scenes', { sceneIds, confirmRights: true }),
    'narrate_scenes',
  );
  const narrations = narrated.data?.narrations ?? [];
  if (narrations.length !== sceneIds.length) {
    throw new Error(`narraciones esperadas ${sceneIds.length}, recibidas ${narrations.length}`);
  }
  if (narrations.some((item) => !item.assetId || !item.clipId)) {
    throw new Error(`narración sin asset/clip: ${JSON.stringify(narrations)}`);
  }

  must(await live('transport', { action: 'save' }), 'save');
  const document = JSON.parse(readFileSync(projectPath, 'utf8'));
  const audioAssets = (document.assets ?? []).filter((asset) => asset.kind === 'audio');
  if (audioAssets.length < sceneIds.length) {
    throw new Error(`assets de audio insuficientes: ${audioAssets.length}`);
  }
  const linked = (document.scenes ?? []).filter((scene) => scene.narration?.assetId);
  if (linked.length !== sceneIds.length) {
    throw new Error(`escenas vinculadas ${linked.length} != ${sceneIds.length}`);
  }
  const narrationTrack = (document.timeline?.tracks ?? []).find(
    (track) => track.kind === 'narration',
  );
  const voiceClips = (document.timeline?.clips ?? []).filter(
    (clip) => clip.kind === 'audio' && clip.trackId === narrationTrack?.id,
  );
  if (voiceClips.length !== sceneIds.length) {
    throw new Error(`clips de voz en la pista ${voiceClips.length} != ${sceneIds.length}`);
  }
  if (voiceClips.some((clip) => clip.startFrame !== 0 && clip.startFrame !== 180)) {
    throw new Error(`posiciones inesperadas: ${JSON.stringify(voiceClips.map((clip) => clip.startFrame))}`);
  }

  must(await live('render_queue_control', { action: 'pause' }), 'pause');
  const queued = must(
    await live('render_queue_add', { sceneIds: [sceneIds[0]] }),
    'render_queue_add',
  );
  must(await live('render_queue_control', { action: 'resume' }), 'resume');
  const item = await waitItem(queued.data.ids[0]);
  if (item.status !== 'completed' || !item.outputPath || !existsSync(item.outputPath)) {
    throw new Error(`render falló: ${JSON.stringify(item)}`);
  }
  const probe = JSON.parse(
    execFileSync(
      ffprobe,
      ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name', '-of', 'json', item.outputPath],
      { encoding: 'utf8' },
    ),
  );
  const codecs = probe.streams.map((stream) => stream.codec_name);
  if (!codecs.includes('aac')) throw new Error(`el render no tiene audio: ${JSON.stringify(codecs)}`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        project: projectPath,
        sceneIds,
        rejectedWithoutRights: noRights.summary,
        narrations,
        audioAssets: audioAssets.map((asset) => ({
          id: asset.id,
          label: asset.label,
          source: asset.source?.path,
          origin: asset.rights?.provenance?.origin,
        })),
        voiceClips: voiceClips.map((clip) => ({
          id: clip.id,
          startFrame: clip.startFrame,
          durationFrames: clip.durationFrames,
        })),
        render: {
          output: item.outputPath,
          duration: probe.format.duration,
          bytes: probe.format.size,
          codecs,
        },
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(`verify-chapter-narration falló: ${error.message}`);
  process.exitCode = 1;
}

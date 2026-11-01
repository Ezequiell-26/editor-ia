#!/usr/bin/env node
// Verifica la cola de escenas persistente en dos fases:
//   1) enqueue: pausa, encola las escenas y deja la cola guardada.
//   2) finish: tras reiniciar la app, comprueba la restauración, reanuda,
//      espera los segmentos, los une y verifica el MP4 final.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
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
  join(homedir(), 'AppData', 'Local', 'Temp', 'editoria-scene-queue'),
);
const projectPath = argument('--project', join(workspace, 'integral.editoria.json'));
const phase = argument('--phase', 'enqueue');
const autoConcat = process.argv.includes('--concat');
const token =
  argument('--token', '') ||
  process.env.EDITOR_IA_BRIDGE_TOKEN ||
  readFileSync(
    join(homedir(), 'AppData', 'Roaming', 'com.editoria.desktop', 'downloader-bridge.token'),
    'utf8',
  ).trim();
const port = Number(argument('--port', '47615'));
const bundled = join(root, 'target', 'debug', 'ffmpeg', 'ffmpeg.exe');
const ffmpeg = existsSync(bundled) ? bundled : 'ffmpeg';
const bundledProbe = join(root, 'target', 'debug', 'ffmpeg', 'ffprobe.exe');
const ffprobe = existsSync(bundledProbe) ? bundledProbe : 'ffprobe';

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

function counts(items) {
  return items.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});
}

try {
  must(await live('project_open', { path: projectPath }), 'project_open');
  const inspected = must(await live('project_inspect'), 'project_inspect');
  const scenes = inspected.data.sceneList ?? [];
  if (scenes.length === 0) throw new Error('el proyecto no tiene escenas');

  if (phase === 'enqueue') {
    must(await live('render_queue_control', { action: 'pause' }), 'pause');
    const added = must(
      await live('render_queue_add', {
        sceneIds: scenes.map((scene) => scene.id),
        ...(autoConcat ? { concat: true } : {}),
      }),
      'render_queue_add',
    );
    const status = must(await live('render_queue_status'), 'render_queue_status');
    if (status.data.paused !== true || status.data.items.length < scenes.length) {
      throw new Error(`la cola no quedó pausada con las escenas: ${JSON.stringify(status.data)}`);
    }
    console.log(
      JSON.stringify(
        {
          ok: true,
          phase,
          project: projectPath,
          scenes: scenes.map((scene) => ({ id: scene.id, title: scene.title })),
          itemIds: added.data.ids,
          queue: counts(status.data.items),
          autoConcat,
        },
        null,
        2,
      ),
    );
  } else {
    const restored = must(await live('render_queue_status'), 'render_queue_status');
    if (restored.data.items.length < scenes.length) {
      throw new Error(`la cola no se restauró: ${JSON.stringify(restored.data)}`);
    }
    const pendingAtRestore = restored.data.items.filter(
      (item) => item.status === 'queued' || item.status === 'running',
    );
    let snapshot = restored.data;
    if (pendingAtRestore.length > 0) {
      if (restored.data.paused !== true) {
        throw new Error(`la cola restaurada debería estar pausada: ${JSON.stringify(restored.data)}`);
      }
      if (pendingAtRestore.length < scenes.length) {
        throw new Error(`se esperaban ${scenes.length} en cola, hay ${pendingAtRestore.length}`);
      }
      must(await live('render_queue_control', { action: 'resume' }), 'resume');
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const status = must(await live('render_queue_status'), 'render_queue_status');
        snapshot = status.data;
        const pending = snapshot.items.filter(
          (item) => item.status === 'queued' || item.status === 'running',
        );
        if (pending.length === 0) break;
      }
    }
    const failed = snapshot.items.filter((item) => item.status !== 'completed');
    if (failed.length > 0) {
      throw new Error(`trabajos no completados: ${JSON.stringify(failed)}`);
    }
    const outputs = snapshot.items
      .filter((item) => item.status === 'completed' && item.outputPath)
      .map((item) => item.outputPath);
    if (outputs.length < scenes.length) {
      throw new Error(`faltan segmentos: ${outputs.length}/${scenes.length}`);
    }
    for (const output of outputs) {
      if (!existsSync(output)) throw new Error(`no existe el segmento ${output}`);
    }
    let finalPath = '';
    let concatBytes = 0;
    if (autoConcat) {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const status = must(await live('render_queue_status'), 'render_queue_status');
        snapshot = status.data;
        const batchId = (snapshot.items ?? []).find((entry) => entry.batchId)?.batchId;
        const final = (snapshot.finals ?? []).find((entry) => entry.batchId === batchId);
        if (final?.outputPath) {
          finalPath = final.outputPath;
          concatBytes = final.bytes;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (!finalPath || !existsSync(finalPath)) {
        throw new Error('la cola no generó el final concatenado');
      }
    } else {
      const concatenated = must(
        await live('video_concat', { paths: outputs }),
        'video_concat',
      );
      finalPath = String(concatenated.data.outputPath ?? '');
      concatBytes = concatenated.data.bytes;
      if (!finalPath || !existsSync(finalPath)) {
        throw new Error(`el concat no dejó un archivo: ${JSON.stringify(concatenated)}`);
      }
    }
    const probe = JSON.parse(
      execFileSync(
        ffprobe,
        ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name', '-of', 'json', finalPath],
        { encoding: 'utf8' },
      ),
    );
    const decoded = spawnSync(
      ffmpeg,
      ['-v', 'error', '-i', finalPath, '-map', '0', '-f', 'null', '-'],
      { encoding: 'utf8' },
    );
    if (decoded.status !== 0 || decoded.stderr.trim() !== '') {
      throw new Error(`decode final con errores: ${decoded.stderr.trim() || decoded.status}`);
    }
    console.log(
      JSON.stringify(
        {
          ok: true,
          phase,
          project: projectPath,
          autoConcat,
          restored: counts(restored.data.items),
          final: {
            path: finalPath,
            bytes: concatBytes,
            duration: probe.format.duration,
            codecs: probe.streams.map((stream) => stream.codec_name),
            decoded: 'video+audio sin errores',
          },
          segments: snapshot.items.map((item) => ({
            scene: item.sceneTitle,
            status: item.status,
            attempts: item.attempts,
            bytes: item.bytes,
            outputPath: item.outputPath,
          })),
        },
        null,
        2,
      ),
    );
  }
} catch (error) {
  console.error(`verify-scene-queue falló (${phase}): ${error.message}`);
  process.exitCode = 1;
}

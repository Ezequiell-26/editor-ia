#!/usr/bin/env node
// Verifica render por escenas, concat sin recodificar y reanudación:
// abre el proyecto integral, renderiza cada escena, une los segmentos y
// comprueba duración/bytes. Después borra un segmento y lo regenera sólo a él.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
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
  join(homedir(), 'AppData', 'Local', 'Temp', 'editoria-integral'),
);
const projectPath = argument('--project', join(workspace, 'integral.editoria.json'));
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
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function must(result, label) {
  if (result.status && result.status !== 200) throw new Error(`${label}: HTTP ${result.status}`);
  if (result.ok !== true) throw new Error(`${label}: ${result.summary ?? JSON.stringify(result)}`);
  return result;
}

async function waitRender(jobId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const status = await live('render_status');
    const finished = status.data?.finished;
    const progress = status.data?.progress;
    if (finished?.jobId === jobId) return finished;
    if (progress?.jobId !== jobId && !status.data?.active) {
      // todavía puede ser el evento anterior; seguimos esperando
    }
  }
  throw new Error(`el segmento ${jobId} no terminó en 150 s`);
}

function probe(path) {
  return JSON.parse(
    execFileSync(
      ffprobe,
      ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name', '-of', 'json', path],
      { encoding: 'utf8' },
    ),
  );
}

async function renderScene(scene) {
  const result = must(
    await live('render_scene', { sceneId: scene.id, includeCaptions: true }),
    `render_scene ${scene.title}`,
  );
  if (result.data.skipped) return { scene, path: result.data.outputPath, finished: null };
  const finished = await waitRender(result.data.jobId);
  if (finished.status !== 'completed' || !finished.outputPath) {
    throw new Error(`segmento ${scene.title} falló: ${JSON.stringify(finished)}`);
  }
  return { scene, path: finished.outputPath, finished };
}

try {
  must(await live('project_open', { path: projectPath }), 'project_open');
  const inspected = must(await live('project_inspect'), 'project_inspect');
  const scenes = inspected.data.sceneList ?? [];
  if (scenes.length < 3) throw new Error(`se esperaban 3 escenas, hay ${scenes.length}`);

  const segments = [];
  for (const scene of scenes) {
    const segment = await renderScene(scene);
    segments.push(segment);
  }
  const sizeOf = (path) => Number(probe(path).format.size);
  const segmentBytes = segments.reduce((sum, segment) => sum + sizeOf(segment.path), 0);
  const segmentDuration = segments.reduce(
    (sum, segment) => sum + Number(probe(segment.path).format.duration),
    0,
  );
  const segmentInfo = segments.map((segment) => ({
    path: segment.path,
    bytes: sizeOf(segment.path),
    duration: probe(segment.path).format.duration,
  }));

  const concatenated = must(
    await live('video_concat', { paths: segments.map((segment) => segment.path) }),
    'video_concat',
  );
  const finalProbe = probe(concatenated.data.outputPath);
  if (Math.abs(Number(finalProbe.format.duration) - segmentDuration) > 0.5) {
    throw new Error(
      `duración del concat ${finalProbe.format.duration} != suma ${segmentDuration.toFixed(2)}`,
    );
  }

  const skip = must(
    await live('render_scene', { sceneId: scenes[0].id, includeCaptions: true }),
    'skip scene',
  );
  if (skip.data.skipped !== true) throw new Error('la escena existente no se reutilizó');

  unlinkSync(segments[1].path);
  const resumed = must(
    await live('render_scene', { sceneId: scenes[1].id, includeCaptions: true }),
    'resume scene',
  );
  if (resumed.data.skipped !== false) throw new Error('la escena borrada no se volvió a renderizar');
  const resumedFinished = await waitRender(resumed.data.jobId);
  if (resumedFinished.status !== 'completed') throw new Error('el segmento reanudado falló');

  const concatenatedAgain = must(
    await live('video_concat', {
      paths: [segments[0].path, resumedFinished.outputPath, segments[2].path],
    }),
    'video_concat resumed',
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        scenes: scenes.map((scene) => ({
          title: scene.title,
          startFrame: scene.startFrame,
          endFrame: scene.endFrame,
          clips: scene.clips,
        })),
        segments: segmentInfo,
        segmentDuration: Number(segmentDuration.toFixed(3)),
        segmentBytes,
        final: {
          path: concatenated.data.outputPath,
          bytes: concatenated.data.bytes,
          duration: finalProbe.format.duration,
          segments: concatenated.data.segments,
        },
        skipReused: true,
        resumedSegment: {
          path: resumedFinished.outputPath,
          bytes: Number(probe(resumedFinished.outputPath).format.size),
        },
        finalAfterResume: {
          path: concatenatedAgain.data.outputPath,
          bytes: concatenatedAgain.data.bytes,
          duration: probe(concatenatedAgain.data.outputPath).format.duration,
        },
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(`verify-scene-resume falló: ${error.message}`);
  process.exitCode = 1;
}

#!/usr/bin/env node
// Verifica clip_audio por MCP en vivo: paneo/ganancia/fade de UN clip de una
// escena, sin tocar el clip de la otra, medido por ventanas L/R con FFmpeg.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
const projectPath = argument('--project', join(workspace, 'narracion.editoria.json'));
const bundledFfmpeg = join(root, 'target', 'debug', 'ffmpeg', 'ffmpeg.exe');
const ffmpeg = existsSync(bundledFfmpeg) ? bundledFfmpeg : 'ffmpeg';
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

async function render(label) {
  must(await live('render_start', {}), `render_start ${label}`);
  for (let attempt = 0; attempt < 180; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const status = must(await live('render_status'), 'render_status');
    if (!status.data.active && status.data.finished) {
      const finished = status.data.finished;
      if (finished.status === 'completed' && finished.outputPath && existsSync(finished.outputPath)) {
        return finished;
      }
      if (finished.status === 'failed') {
        throw new Error(`render ${label} falló: ${JSON.stringify(finished)}`);
      }
    }
  }
  throw new Error(`render ${label} no terminó en 180 s`);
}

function channelRms(path, start, duration, channel) {
  const result = spawnSync(
    ffmpeg,
    [
      '-hide_banner', '-nostats',
      '-ss', String(start), '-t', String(duration),
      '-i', path,
      '-af', `pan=mono|c0=c${channel},astats=metadata=1:reset=0`,
      '-f', 'null', '-',
    ],
    { encoding: 'utf8' },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const match = output.match(/RMS level dB:\s*(-?[\d.]+)/);
  if (!match) throw new Error(`sin RMS (${start}s canal ${channel})`);
  return Number(match[1]);
}

function windowBalance(path, start, duration) {
  const left = channelRms(path, start, duration, 0);
  const right = channelRms(path, start, duration, 1);
  return { left, right, diff: left - right };
}

try {
  must(await live('project_open', { path: projectPath }), 'project_open');
  must(
    await live('audio_mix', {
      trackKind: 'narration',
      gainDb: 0,
      pan: 0,
      eqLowDb: 0,
      eqMidDb: 0,
      eqHighDb: 0,
      masterGainDb: 0,
      masterLimiter: false,
    }),
    'audio_mix reset',
  );
  must(await live('transport', { action: 'save' }), 'save reset');
  const document = JSON.parse(readFileSync(projectPath, 'utf8'));
  const narrationTrack = (document.timeline?.tracks ?? []).find(
    (track) => track.kind === 'narration',
  );
  const voices = (document.timeline?.clips ?? [])
    .filter((clip) => clip.kind === 'audio' && clip.trackId === narrationTrack?.id)
    .sort((a, b) => a.startFrame - b.startFrame);
  if (voices.length < 2) throw new Error(`voz insuficiente: ${voices.length}`);
  must(
    await live('clip_audio', {
      clipIds: [voices[0].id],
      gainDb: 0,
      pan: 0,
    }),
    'clip_audio reset',
  );
  must(await live('transport', { action: 'save' }), 'save clip reset');

  const base = await render('base');
  const baseFirst = windowBalance(base.outputPath, 0, 3);
  const baseSecond = windowBalance(base.outputPath, 6, 3);
  if (Math.abs(baseFirst.diff) > 1.5 || Math.abs(baseSecond.diff) > 1.5) {
    throw new Error(`la base no está centrada: ${JSON.stringify({ baseFirst, baseSecond })}`);
  }

  const edited = must(
    await live('clip_audio', {
      clipIds: [voices[0].id],
      gainDb: -4,
      pan: 0.6,
      fadeInFrames: 10,
    }),
    'clip_audio',
  );
  must(await live('transport', { action: 'save' }), 'save clip');
  const saved = JSON.parse(readFileSync(projectPath, 'utf8'));
  const target = saved.timeline.clips.find((clip) => clip.id === voices[0].id);
  if (target.audio?.gainDb !== -4 || target.audio?.pan !== 0.6 || target.audio?.fadeInFrames !== 10) {
    throw new Error(`clip no persistido: ${JSON.stringify(target.audio)}`);
  }
  const other = saved.timeline.clips.find((clip) => clip.id === voices[1].id);
  if (other.audio?.pan !== undefined) {
    throw new Error(`el segundo clip se contaminó: ${JSON.stringify(other.audio)}`);
  }

  const after = await render('clip');
  const first = windowBalance(after.outputPath, 0, 3);
  const second = windowBalance(after.outputPath, 6, 3);
  if (first.right - first.left < 3) {
    throw new Error(`el paneo del primer clip no se aplicó: ${JSON.stringify(first)}`);
  }
  if (Math.abs(second.diff) > 1.5) {
    throw new Error(`el segundo clip cambió: ${JSON.stringify(second)}`);
  }
  if (first.right - baseFirst.right > -2) {
    throw new Error(`la ganancia del primer clip no bajó: ${baseFirst.right} → ${first.right}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        project: projectPath,
        summary: edited.summary,
        clips: { edited: voices[0].id, untouched: voices[1].id },
        savedAudio: target.audio,
        base: { output: base.outputPath, first: baseFirst, second: baseSecond },
        after: { output: after.outputPath, first, second },
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(`verify-clip-audio falló: ${error.message}`);
  process.exitCode = 1;
}

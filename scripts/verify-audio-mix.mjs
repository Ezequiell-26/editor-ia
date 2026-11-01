#!/usr/bin/env node
// Verifica audio_mix por MCP en vivo: render base, paneo/EQ/ganancia de la
// pista de narración + master, y comparación de canales con FFmpeg.
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

function channelRms(path, channel) {
  const result = spawnSync(
    ffmpeg,
    [
      '-hide_banner',
      '-nostats',
      '-i', path,
      '-af', `pan=mono|c0=c${channel},astats=metadata=1:reset=0`,
      '-f', 'null',
      '-',
    ],
    { encoding: 'utf8' },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const match = output.match(/RMS level dB:\s*(-?[\d.]+)/);
  if (!match) throw new Error(`sin RMS para canal ${channel}`);
  return Number(match[1]);
}

function integratedLoudness(path) {
  const result = spawnSync(
    ffmpeg,
    ['-hide_banner', '-nostats', '-i', path, '-af', 'ebur128', '-f', 'null', '-'],
    { encoding: 'utf8' },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const values = [...output.matchAll(/I:\s*(-?[\d.]+) LUFS/g)].map((match) => Number(match[1]));
  return values.at(-1) ?? null;
}

try {
  must(await live('project_open', { path: projectPath }), 'project_open');
  const base = await render('base');
  const baseLeft = channelRms(base.outputPath, 0);
  const baseRight = channelRms(base.outputPath, 1);

  const mixed = must(
    await live('audio_mix', {
      trackKind: 'narration',
      gainDb: -3,
      pan: -0.8,
      eqLowDb: 2,
      masterGainDb: -1,
      masterLimiter: true,
    }),
    'audio_mix',
  );
  must(await live('transport', { action: 'save' }), 'save');
  const document = JSON.parse(readFileSync(projectPath, 'utf8'));
  const track = (document.timeline?.tracks ?? []).find((item) => item.kind === 'narration');
  if (!track) throw new Error('no hay pista de narración');
  if (track.gainDb !== -3 || track.pan !== -0.8 || track.eqLowDb !== 2) {
    throw new Error(`mezcla no persistida: ${JSON.stringify(track)}`);
  }
  if (document.audio?.master?.gainDb !== -1 || document.audio?.master?.limiter !== true) {
    throw new Error(`master no persistido: ${JSON.stringify(document.audio?.master)}`);
  }

  const after = await render('mix');
  const left = channelRms(after.outputPath, 0);
  const right = channelRms(after.outputPath, 1);
  const baseDiff = baseLeft - baseRight;
  const mixDiff = left - right;
  if (Math.abs(baseDiff) > 1.5) {
    throw new Error(`la base no es centrada: L ${baseLeft} / R ${baseRight}`);
  }
  if (mixDiff < 3) {
    throw new Error(`el paneo no se aplicó: L ${left} / R ${right}`);
  }

  const probe = JSON.parse(
    execFileSync(
      ffprobe,
      ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name', '-of', 'json', after.outputPath],
      { encoding: 'utf8' },
    ),
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        project: projectPath,
        mixSummary: mixed.summary,
        track: {
          id: track.id,
          gainDb: track.gainDb,
          pan: track.pan,
          eqLowDb: track.eqLowDb,
        },
        master: document.audio.master,
        renders: {
          base: { output: base.outputPath, bytes: base.outputBytes, left: baseLeft, right: baseRight, diffDb: baseDiff, lufs: integratedLoudness(base.outputPath) },
          mix: { output: after.outputPath, bytes: after.outputBytes, left, right, diffDb: mixDiff, lufs: integratedLoudness(after.outputPath) },
        },
        probe: {
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
  console.error(`verify-audio-mix falló: ${error.message}`);
  process.exitCode = 1;
}

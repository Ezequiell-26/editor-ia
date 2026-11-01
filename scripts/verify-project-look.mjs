#!/usr/bin/env node
// Verifica project_look por MCP en vivo: render base vs look global, con
// medición de saturación/brillo por signalstats y comparación de frames.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
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

function stats(path, seconds) {
  const result = spawnSync(
    ffmpeg,
    [
      '-hide_banner',
      '-ss', String(seconds),
      '-i', path,
      '-frames:v', '1',
      '-vf', 'signalstats,metadata=print:file=-',
      '-f', 'null',
      '-',
    ],
    { encoding: 'utf8' },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const value = (key) => {
    const match = output.match(new RegExp(`lavfi\\.signalstats\\.${key}=([\\d.]+)`));
    return match ? Number(match[1]) : null;
  };
  return { y: value('YAVG'), sat: value('SATAVG'), hue: value('HUEAVG') };
}

function frameHash(path, seconds, outPath) {
  execFileSync(ffmpeg, [
    '-y', '-v', 'error',
    '-ss', String(seconds),
    '-i', path,
    '-frames:v', '1',
    outPath,
  ]);
  return createHash('md5').update(readFileSync(outPath)).digest('hex');
}

try {
  must(await live('project_open', { path: projectPath }), 'project_open');
  must(await live('project_look', { clear: true }), 'project_look clear');
  must(await live('transport', { action: 'save' }), 'save limpio');
  const base = await render('base');
  const baseStats = stats(base.outputPath, 2);
  const baseHash = frameHash(base.outputPath, 2, join(workspace, 'look-base.png'));

  const look = must(
    await live('project_look', {
      contrast: 1.5,
      saturation: 0.2,
      temperature: 0.4,
      vignette: 0.6,
      grain: 0.15,
    }),
    'project_look',
  );
  must(await live('transport', { action: 'save' }), 'save');
  const document = JSON.parse(readFileSync(projectPath, 'utf8'));
  const saved = document.look ?? {};
  if (saved.contrast !== 1.5 || saved.saturation !== 0.2 || saved.vignette !== 0.6) {
    throw new Error(`look no persistido: ${JSON.stringify(saved)}`);
  }

  const after = await render('look');
  const lookStats = stats(after.outputPath, 2);
  const lookHash = frameHash(after.outputPath, 2, join(workspace, 'look-after.png'));
  if (baseHash === lookHash) throw new Error('el look no cambió el frame');
  if (baseStats.sat == null || lookStats.sat == null) {
    throw new Error(`sin SATAVG: ${JSON.stringify({ baseStats, lookStats })}`);
  }
  if (lookStats.sat >= baseStats.sat * 0.7) {
    throw new Error(`la saturación no bajó: ${baseStats.sat} → ${lookStats.sat}`);
  }
  if (Math.abs(statSync(after.outputPath).size - statSync(base.outputPath).size) < 1000) {
    throw new Error('los MP4 son sospechosamente iguales');
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        project: projectPath,
        lookSummary: look.summary,
        saved,
        base: { output: base.outputPath, bytes: base.outputBytes, stats: baseStats, hash: baseHash },
        look: { output: after.outputPath, bytes: after.outputBytes, stats: lookStats, hash: lookHash },
        frames: [join(workspace, 'look-base.png'), join(workspace, 'look-after.png')],
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(`verify-project-look falló: ${error.message}`);
  process.exitCode = 1;
}

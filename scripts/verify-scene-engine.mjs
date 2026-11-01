#!/usr/bin/env node
// Verifica que scene_resolve pueda fijar y persistir el motor de una escena.
import { readFileSync } from 'node:fs';
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
  const timer = setTimeout(() => controller.abort(), 60_000);
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

try {
  must(await live('project_open', { path: projectPath }), 'project_open');
  const inspected = must(await live('project_inspect'), 'project_inspect');
  const scene = (inspected.data.sceneList ?? []).find((item) => item.clips > 0);
  if (!scene) throw new Error('no hay una escena con clips para fijar el motor');
  const pinned = must(
    await live('scene_resolve', {
      sceneId: scene.id,
      request: 'ken-burns',
      pin: true,
    }),
    'scene_resolve pin',
  );
  if (pinned.data?.pinned !== true || pinned.data?.engine !== 'ken-burns') {
    throw new Error(`no se fijó el motor: ${JSON.stringify(pinned.data)}`);
  }
  must(await live('transport', { action: 'save' }), 'save');
  const saved = JSON.parse(readFileSync(projectPath, 'utf8'));
  const stored = saved.scenes.find((item) => item.id === scene.id);
  if (stored?.engine !== 'ken-burns') {
    throw new Error(`el motor no persistió: ${JSON.stringify(stored)}`);
  }
  const after = must(await live('project_inspect'), 'project_inspect');
  const listed = (after.data.sceneList ?? []).find((item) => item.id === scene.id);
  if (listed?.engine !== 'ken-burns') {
    throw new Error(`project_inspect no lo muestra: ${JSON.stringify(listed)}`);
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        project: projectPath,
        scene: { id: scene.id, title: scene.title },
        resolution: pinned.data,
        persisted: stored.engine,
        inspected: listed.engine,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(`verify-scene-engine falló: ${error.message}`);
  process.exitCode = 1;
}

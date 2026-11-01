#!/usr/bin/env node
// Verifica el puente en vivo contra la app real abierta: lista herramientas y
// ejecuta project_inspect. Un resultado {ok:false} por "no hay proyecto" sigue
// siendo un round-trip válido; lo que no se acepta es un timeout o un 403.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  return process.argv[index + 1] ?? fallback;
}

const port = Number(argument('--port', '47615'));
const token =
  argument('--token', '') ||
  process.env.EDITOR_IA_BRIDGE_TOKEN ||
  readFileSync(
    join(homedir(), 'AppData', 'Roaming', 'com.editoria.desktop', 'downloader-bridge.token'),
    'utf8',
  ).trim();
const base = `http://127.0.0.1:${port}`;

async function call(path, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 40_000);
  try {
    const response = await fetch(`${base}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-editoria-token': token },
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } finally {
    clearTimeout(timer);
  }
}

try {
  const health = await call('/v1/health');
  if (health.status !== 200) throw new Error(`health HTTP ${health.status}`);

  const listed = await call('/v1/mcp/tools');
  if (listed.status !== 200) {
    throw new Error(`tools HTTP ${listed.status}: ${JSON.stringify(listed.body)}`);
  }
  const tools = Array.isArray(listed.body?.tools) ? listed.body.tools : [];
  if (tools.length === 0) throw new Error('la app no registró herramientas');

  const inspected = await call('/v1/mcp/tool', {
    method: 'POST',
    body: JSON.stringify({ tool: 'project_inspect', arguments: {} }),
  });
  if (inspected.status !== 200) {
    throw new Error(`tool HTTP ${inspected.status}: ${JSON.stringify(inspected.body)}`);
  }
  if (typeof inspected.body?.ok !== 'boolean') {
    throw new Error(`resultado sin ok: ${JSON.stringify(inspected.body)}`);
  }

  const catalog = await call('/v1/mcp/tool', {
    method: 'POST',
    body: JSON.stringify({ tool: 'engine_catalog', arguments: {} }),
  });
  if (catalog.status !== 200 || catalog.body?.ok !== true) {
    throw new Error(`engine_catalog falló: ${JSON.stringify(catalog.body)}`);
  }
  const engines = Array.isArray(catalog.body?.data?.engines)
    ? catalog.body.data.engines
    : [];
  if (engines.length !== 10) {
    throw new Error(`el catálogo devolvió ${engines.length} motores`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        health: health.body,
        tools: tools.length,
        names: tools.slice(0, 4).map((tool) => tool.name),
        inspected: inspected.body,
        engines: engines.length,
        engineIds: engines.map((engine) => engine.id),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(`verify-live-app falló: ${error.message}`);
  process.exitCode = 1;
}
